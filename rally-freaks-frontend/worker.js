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

    // --- PROXY PARA BYPASS DA SANDBOX DO DISCORD ---
    if (url.pathname.startsWith("/.proxy/channels-api")) {
      const targetUrlStr = url.searchParams.get("url") || env.DEFAULT_M3U;
      
      // Implementação idêntica à app antiga (handleChannels)
      const headers = new Headers();
      headers.set("User-Agent", "VLC/3.0.18 LibVLC/3.0.18");
      headers.set("Accept", "*/*");
      
      try {
        const response = await fetch(targetUrlStr, {
          headers,
          cf: { cacheTtl: 30 }
        });
        
        if (!response.ok) {
          return new Response(JSON.stringify({ ok: false, error: "upstream_error", status: response.status }), {
            status: 502,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
        
        const text = await response.text();
        const channels = parseM3u(text, targetUrlStr);
        
        return new Response(JSON.stringify({ ok: true, count: channels.length, channels }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    if (url.pathname.startsWith("/.proxy/stream-proxy")) {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) return new Response("Missing url", { status: 400 });

      const headers = new Headers(request.headers);
      headers.set("User-Agent", "VLC/3.0.18 LibVLC/3.0.18");
      // Remover headers que causam 403 em alguns servidores
      headers.delete("Referer");
      headers.delete("Origin");
      
      const upstream = await fetch(targetUrl, {
        method: request.method,
        headers,
        redirect: "follow"
      });

      const newHeaders = new Headers(upstream.headers);
      newHeaders.set("Access-Control-Allow-Origin", "*");
      
      return new Response(upstream.body, {
        status: upstream.status,
        headers: newHeaders
      });
    }

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
      const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
      if (logoMatch) currentItem.logo = logoMatch[1];
      const commaIndex = line.lastIndexOf(",");
      if (commaIndex !== -1) currentItem.name = line.substring(commaIndex + 1).trim();
      continue;
    }

    if (line.startsWith("#")) continue;

    if (currentItem) {
      try {
        currentItem.url = new URL(line, baseUrl).toString();
        channels.push(currentItem);
      } catch (e) {}
      currentItem = null;
    }
  }
  return channels;
}


    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;

    try {
      const asset = await env.ASSETS.fetch(new Request(new URL(pathname, request.url), request));
      if (asset.ok) {
        const ext = pathname.substring(pathname.lastIndexOf("."));
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
      
      // Fallback to index.html for SPA-like behavior
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
