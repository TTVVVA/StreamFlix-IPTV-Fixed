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

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // --- ROTA: CHANNELS API PROXY (Parsing Local - Opção B) ---
    if (pathname.startsWith("/.proxy/channels-api")) {
      const m3uUrl = url.searchParams.get("url") || env.DEFAULT_M3U;
      try {
        const response = await fetch(m3uUrl, {
          headers: {
            "User-Agent": "VLC/3.0.18 LibVLC/3.0.18",
            "Accept": "*/*"
          }
        });

        if (!response.ok) {
          return new Response(JSON.stringify({ ok: false, error: `Falha ao carregar M3U: ${response.status}` }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const text = await response.text();
        const channels = parseM3u(text, m3uUrl);
        return new Response(JSON.stringify({ ok: true, channels }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // --- ROTA: STREAM PROXY ---
    if (pathname.startsWith("/.proxy/stream-proxy")) {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) return new Response("Missing URL", { status: 400 });

      try {
        const response = await fetch(targetUrl, {
          headers: {
            "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
            "Accept": "*/*",
            "Range": request.headers.get("Range") || ""
          }
        });

        const contentType = response.headers.get("Content-Type") || "";
        let body = response.body;

        // Se for uma playlist M3U8, reescrever URLs relativas para passarem pelo proxy
        if (contentType.includes("mpegurl") || contentType.includes("apple-mpegurl") || targetUrl.includes(".m3u8")) {
          let text = await response.text();
          const baseUrl = new URL(targetUrl);
          
          // Reescrever URLs relativas e absolutas para usarem o nosso proxy
          text = text.split('\n').map(line => {
            line = line.trim();
            if (!line || line.startsWith("#")) return line;
            try {
              const absoluteUrl = new URL(line, baseUrl).toString();
              return `/.proxy/stream-proxy?url=${encodeURIComponent(absoluteUrl)}`;
            } catch (e) {
              return line;
            }
          }).join('\n');
          
          body = text;
        }

        const responseHeaders = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => responseHeaders.set(k, v));
        
        return new Response(body, {
          status: response.status,
          headers: responseHeaders
        });
      } catch (err) {
        return new Response(err.message, { status: 500, headers: corsHeaders });
      }
    }

    // --- LÓGICA ORIGINAL DE ASSETS ---
    const assetPath = pathname === "/" ? "/index.html" : pathname;
    try {
      const asset = await env.ASSETS.fetch(new Request(new URL(assetPath, request.url), request));
      if (asset.ok) {
        const ext = assetPath.substring(assetPath.lastIndexOf("."));
        const contentType = TEXT_TYPES[ext] || asset.headers.get("content-type");
        
        let response = asset;
        if (ext === ".html") {
          let html = await asset.text();
          html = html.replace(/__DISCORD_CLIENT_ID__/g, env.DISCORD_CLIENT_ID || "");
          response = new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
        }

        const newHeaders = new Headers(response.headers);
        if (contentType) newHeaders.set("content-type", contentType);
        newHeaders.set("access-control-allow-origin", "*");
        
        return new Response(response.body, {
          status: response.status,
          headers: newHeaders
        });
      }
      
      const index = await env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
      return new Response(index.body, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "access-control-allow-origin": "*" }
      });

    } catch (err) {
      return new Response("Not Found", { status: 404 });
    }
  }
};

function parseM3u(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  let currentItem = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF")) {
      currentItem = { name: "Canal", group: "Geral", logo: "" };
      const groupMatch = line.match(/group-title="([^"]+)"/i);
      if (groupMatch) currentItem.group = groupMatch[1];
      const idMatch = line.match(/tvg-id="([^"]+)"/i);
      if (idMatch) currentItem.id = idMatch[1];
      const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
      if (logoMatch) currentItem.logo = logoMatch[1];
      const commaIndex = line.lastIndexOf(",");
      if (commaIndex !== -1) {
        currentItem.name = line.substring(commaIndex + 1).trim();
      }
      continue;
    }

    if (line.startsWith("#")) continue;

    if (currentItem) {
      try {
        const channelUrl = new URL(line, baseUrl).toString();
        channels.push({ ...currentItem, url: channelUrl });
      } catch (e) {}
      currentItem = null;
    }
  }
  return channels;
}
