const TEXT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Range",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // --- ROTA: LOGS ---
    if (pathname === "/api/log" || pathname === "/activity/log" || pathname === "/activity/session/log") {
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- ROTA: SESSION ---
    if (pathname === "/api/session" || pathname === "/activity/session") {
      return new Response(JSON.stringify({
        ok: true,
        session: {
          channelsUrl: env.DEFAULT_M3U,
          activeChannelUrl: null,
          activeChannelName: null,
          updatedAt: new Date().toISOString()
        }
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- ROTA: CHANNELS API (Proxy Simples com Lazy Load) ---
    if (pathname.startsWith("/.proxy/channels-api")) {
      const m3uUrl = url.searchParams.get("url") || env.DEFAULT_M3U;
      const onlyGroups = url.searchParams.get("onlyGroups");
      const group = url.searchParams.get("group");
      
      try {
        const cwUrl = new URL("https://streamflix-v2-channels.874a220e5e5bae3c5edcb7497a55635b.workers.dev/");
        cwUrl.searchParams.set("url", m3uUrl);
        if (group) cwUrl.searchParams.set("group", group);
        if (onlyGroups) cwUrl.searchParams.set("onlyGroups", onlyGroups);

        const response = await fetch(cwUrl.toString(), { 
          headers: { "User-Agent": "VLC/3.0.18", "Accept": "*/*" } 
        });

        if (!response.ok) return new Response(JSON.stringify({ ok: false }), { status: 502, headers: corsHeaders });
        const data = await response.json();
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (err) { 
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders }); 
      }
    }

    // --- LÓGICA DE ASSETS ---
    const assetPath = pathname === "/" ? "/index.html" : pathname;
    try {
      const asset = await env.ASSETS.fetch(new Request(new URL(assetPath, request.url), request));
      if (asset.ok) {
        const ext = assetPath.substring(assetPath.lastIndexOf("."));
        let response = asset;
        if (ext === ".html") {
          let html = await asset.text();
          html = html.replace(/__DISCORD_CLIENT_ID__/g, env.DISCORD_CLIENT_ID || "");
          const htmlHeaders = new Headers(asset.headers);
          htmlHeaders.set("Content-Security-Policy", "default-src 'self' blob: data: https://*.discordsays.com https://*.discord.com; style-src 'self' 'unsafe-inline' blob: https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: *; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; connect-src 'self' *; media-src 'self' blob: data: *;");
          return new Response(html, { headers: htmlHeaders });
        }
        return asset;
      }
      return await env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
    } catch (err) { return new Response("Not Found", { status: 404 }); }
  }
};

function parseM3uOptimized(text, baseUrl, options) {
  const lines = text.split(/\r?\n/);
  const groups = new Set();
  const channels = [];
  let currentItem = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#EXTM3U")) continue;

    if (line.startsWith("#EXTINF")) {
      const groupMatch = line.match(/group-title="([^"]+)"/i);
      const groupName = groupMatch ? groupMatch[1] : "Geral";
      groups.add(groupName);

      if (options.onlyGroups) continue;
      if (options.targetGroup && groupName !== options.targetGroup) {
        currentItem = null;
        continue;
      }

      currentItem = { name: "Canal", group: groupName, logo: "" };
      const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
      if (logoMatch) currentItem.logo = logoMatch[1];
      const commaIndex = line.lastIndexOf(",");
      if (commaIndex !== -1) currentItem.name = line.substring(commaIndex + 1).trim();
      continue;
    }

    if (line.startsWith("#")) continue;

    if (currentItem && !options.onlyGroups) {
      try {
        currentItem.url = new URL(line, baseUrl).toString();
        channels.push(currentItem);
      } catch (e) {}
      currentItem = null;
    }
  }

  return options.onlyGroups ? { groups: Array.from(groups).sort() } : { channels };
}
