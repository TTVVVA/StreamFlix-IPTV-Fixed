import type { RoboRequest } from '@robojs/server';

const UA_STB = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) Mag200 sb.713 Safari/533.3";
const UA_VLC = "VLC/3.0.18 LibVLC/3.0.18";

function normalizeLink(value: any) {
  const raw = String(value ?? "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  return raw;
}

function buildProxyUrl(rawUrl: string, host: string) {
  const safe = normalizeLink(rawUrl);
  if (!safe) return "";
  // No Robo.js as rotas de API são relativas à raiz ou ao domínio atual
  return `/api/bypass?url=${encodeURIComponent(safe)}`;
}

function rewriteM3u8Manifest(manifestText: string, sourceUrl: string, host: string) {
  return manifestText
    .split("\n")
    .map((line) => {
      let result = line;
      const trimmed = line.trim();
      
      if (trimmed && !trimmed.startsWith("#")) {
        try {
          const absolute = new URL(trimmed, sourceUrl).toString();
          result = buildProxyUrl(absolute, host) || line;
        } catch {
          result = line;
        }
      } 
      else if (trimmed.startsWith("#")) {
        result = line.replace(/(URI\s*=\s*["'])([^"']+)(["'])/gi, (match, p1, p2, p3) => {
          try {
            const absolute = new URL(p2, sourceUrl).toString();
            return `${p1}${buildProxyUrl(absolute, host)}${p3}`;
          } catch {
            return match;
          }
        });
      }
      
      return result;
    })
    .join("\n");
}

export default async (req: RoboRequest) => {
  const { url: rawUrl } = req.query;
  const sourceUrl = normalizeLink(rawUrl);
  
  if (!sourceUrl) {
    return new Response("Missing or invalid url.", { status: 400 });
  }

  const host = req.headers.get("host") || "";
  const isStalker = sourceUrl.includes("/stalker/") || sourceUrl.includes("/api/play/");
  const isM3u8Request = /\.m3u8?(\?|$)/i.test(sourceUrl);
  
  const upstreamHeaders: Record<string, string> = {
    "user-agent": isStalker ? UA_STB : UA_VLC,
    "accept": "*/*",
    "connection": "keep-alive",
    "x-requested-with": "org.videolan.vlc",
    "x-user-agent": isStalker ? "StalkerRemote/1.0" : "VLC/3.0.18"
  };

  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    upstreamHeaders["range"] = rangeHeader;
  }

  // Repassar Authorization se existir
  const auth = req.headers.get("authorization");
  if (auth) upstreamHeaders["authorization"] = auth;

  try {
    const upstreamResponse = await fetch(sourceUrl, {
      method: "GET",
      headers: upstreamHeaders,
      redirect: "follow",
    });

    if (!upstreamResponse.ok) {
      const contentTypeCheck = upstreamResponse.headers.get("content-type") || "";
      if (contentTypeCheck.includes("text/html")) {
        return new Response(JSON.stringify({
          error: "invalid_content_type",
          message: "O servidor devolveu HTML em vez de vídeo. O link pode ter expirado."
        }), { 
          status: 406, 
          headers: { "content-type": "application/json" } 
        });
      }

      return new Response(
        JSON.stringify({
          error: "upstream_error",
          status: upstreamResponse.status,
          url: sourceUrl,
        }),
        {
          status: upstreamResponse.status === 403 ? 403 : 502,
          headers: { "content-type": "application/json" },
        },
      );
    }

    const contentType = upstreamResponse.headers.get("content-type") || "";
    const isActuallyM3u8 = isM3u8Request && (
      !contentType || 
      /application\/(vnd\.apple\.mpegurl|x-mpegurl)/i.test(contentType) ||
      (contentType.includes("text") && !contentType.includes("html"))
    ) && !/video\/mp2t|video\/mpeg/i.test(contentType);

    if (isActuallyM3u8) {
      const original = await upstreamResponse.text();
      const rewritten = rewriteM3u8Manifest(original, sourceUrl, host);
      return new Response(rewritten, {
        status: upstreamResponse.status,
        headers: {
          "content-type": "application/vnd.apple.mpegurl",
          "cache-control": "no-store", 
          "access-control-allow-origin": "*"
        },
      });
    }

    const headers: Record<string, string> = {
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      "content-type": contentType || "video/mp2t",
      "access-control-allow-origin": "*"
    };
    
    const contentLength = upstreamResponse.headers.get("content-length");
    if (contentLength) headers["content-length"] = contentLength;
    const contentRange = upstreamResponse.headers.get("content-range");
    if (contentRange) headers["content-range"] = contentRange;

    // Nota: Em Node.js (Robo.js), fetch retorna um Body que pode ser usado diretamente
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers,
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "proxy_exception", message: err.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};
