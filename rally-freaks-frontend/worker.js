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
