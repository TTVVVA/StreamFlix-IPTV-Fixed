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

    const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // --- ROTA: LOGS ---
    if (pathname === "/api/log" || pathname === "/activity/log" || pathname === "/activity/session/log") {
      return jsonResponse({ ok: true });
    }

    // --- ROTA: SESSION ---
    if (pathname === "/api/session" || pathname === "/activity/session") {
      return jsonResponse({
        ok: true,
        session: {
          channelsUrl: env.DEFAULT_M3U,
          activeChannelUrl: null,
          activeChannelName: null,
          updatedAt: new Date().toISOString()
        }
      });
    }

    // --- ROTA: CHANNELS API (Fetch Direto + Parsing Local) ---
    if (pathname.startsWith("/.proxy/channels-api")) {
      const m3uUrl = url.searchParams.get("url") || env.DEFAULT_M3U || "";
      const group = url.searchParams.get("group") || "";
      const onlyGroups = url.searchParams.get("onlyGroups") === "true" || url.searchParams.get("onlyGroups") === "1";

      if (!m3uUrl) return jsonResponse({ ok: false, error: "Sem URL configurada" }, 400);

      try {
        const resp = await fetch(m3uUrl, {
          headers: {
            "User-Agent": "VLC/3.0.18 LibVLC/3.0.18",
            "Accept": "*/*"
          }
        });

        if (!resp.ok) return jsonResponse({ ok: false, error: `M3U: HTTP ${resp.status}` }, 502);

        const text = await resp.text();
        if (!text.includes("#EXTINF")) {
          return jsonResponse({ ok: false, error: `Resposta inválida: ${text.slice(0, 80)}` }, 502);
        }

        const { channels, groups } = parseM3u(text, m3uUrl);

        if (onlyGroups) return jsonResponse({ ok: true, groups });

        if (group) {
          const filtered = channels.filter(c => c.group === group);
          return jsonResponse({ ok: true, group, channels: filtered });
        }

        return jsonResponse({ ok: true, channels: channels.slice(0, 150) });

      } catch (err) {
        return jsonResponse({ ok: false, error: err.message }, 500);
      }
    }

    // --- ROTA: STREAM PROXY (Com reescrita de M3U8 otimizada) ---
    if (pathname.startsWith("/.proxy/stream-proxy")) {
      let targetUrl = url.searchParams.get("url");
      if (!targetUrl) return jsonResponse({ ok: false, error: "Missing URL" }, 400);

      // Limpeza de URL recursiva (evita o erro manifestLoadError por URL malformada)
      if (targetUrl.includes("/.proxy/stream-proxy")) {
        try {
          const innerUrl = new URL(targetUrl, url.origin);
          targetUrl = innerUrl.searchParams.get("url") || targetUrl;
        } catch (e) {}
      }

      try {
        const response = await fetch(targetUrl, {
          headers: {
            "User-Agent": "VLC/3.0.18 LibVLC/3.0.18",
            "Accept": "*/*",
            "Range": request.headers.get("Range") || ""
          }
        });

        const contentType = response.headers.get("Content-Type") || "";
        let body = response.body;

        // Reescrever apenas se for uma playlist M3U8 para garantir que segmentos passem pelo proxy
        if (contentType.includes("mpegurl") || targetUrl.includes(".m3u8")) {
          let text = await response.text();
          const baseUrl = new URL(targetUrl);
          
          text = text.split('\n').map(line => {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine.startsWith("#")) return line;
            try {
              const absoluteUrl = new URL(trimmedLine, baseUrl).toString();
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
        return jsonResponse({ ok: false, error: err.message }, 500);
      }
    }

    // --- LÓGICA DE ASSETS ---
    const assetPath = pathname === "/" ? "/index.html" : pathname;
    try {
      const asset = await env.ASSETS.fetch(new Request(new URL(assetPath, request.url), request));
      if (asset.ok) {
        const ext = assetPath.substring(assetPath.lastIndexOf("."));
        if (ext === ".html") {
          let html = await asset.text();
          html = html.replace(/__DISCORD_CLIENT_ID__/g, env.DISCORD_CLIENT_ID || "");
          return new Response(html, {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "access-control-allow-origin": "*",
              "Content-Security-Policy": "default-src * 'unsafe-inline' 'unsafe-eval' blob: data:; style-src * 'unsafe-inline' blob: data:; font-src * data:; img-src * blob: data:; media-src * blob: data:; connect-src * blob: data:; script-src * 'unsafe-inline' 'unsafe-eval' blob: data:"
            }
          });
        }
        return asset;
      }
      return await env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
    } catch (err) { return new Response("Not Found", { status: 404 }); }
  }
};

function parseM3u(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  const groupSet = new Set();
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#EXTM3U")) continue;

    if (line.startsWith("#EXTINF")) {
      current = { name: "Canal", group: "Geral", logo: "", id: "" };
      const g = line.match(/group-title="([^"]+)"/i);
      if (g) current.group = g[1];
      const id = line.match(/tvg-id="([^"]+)"/i);
      if (id) current.id = id[1];
      const logo = line.match(/tvg-logo="([^"]+)"/i);
      if (logo) current.logo = logo[1];
      const comma = line.lastIndexOf(",");
      if (comma !== -1) current.name = line.substring(comma + 1).trim();
      continue;
    }

    if (line.startsWith("#")) continue;

    if (current) {
      try {
        const groupName = current.group;
        groupSet.add(groupName);
        channels.push({ ...current, url: new URL(line, baseUrl).toString() });
      } catch (_) {}
      current = null;
    }
  }

  const groups = Array.from(groupSet)
    .map(name => ({ 
      name, 
      count: channels.filter(c => c.group === name).length 
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { channels, groups };
}
