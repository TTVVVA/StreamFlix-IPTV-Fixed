export default {
  async fetch(request, env) {
    const reqUrl = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (reqUrl.pathname === '/health') {
      return json({ ok: true, service: 'streamflix-relay' });
    }

    const rawTarget = reqUrl.searchParams.get('url');
    if (!rawTarget) {
      return json({ error: 'Missing query param: url' }, 400);
    }

    let upstreamUrl;
    try {
      upstreamUrl = new URL(rawTarget);
    } catch {
      return json({ error: 'Invalid target url' }, 400);
    }

    if (!['http:', 'https:'].includes(upstreamUrl.protocol)) {
      return json({ error: 'Only http/https urls are supported' }, 400);
    }

    if (isPrivateOrLoopbackHost(upstreamUrl.hostname)) {
      return json({ error: 'Blocked host' }, 403);
    }

    if (isBlockedPort(upstreamUrl.port)) {
      return json({ error: 'Blocked port' }, 403);
    }

    const timeoutMs = Number(env.MAX_TIMEOUT_MS || '12000');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort('timeout'), timeoutMs);

    try {
      const range = request.headers.get('range');
      let upstreamRes = await fetchUpstream(request, upstreamUrl, controller.signal, range, true);
      // Some origins reject specific headers/fingerprints. Retry once with relaxed headers.
      if ((upstreamRes.status === 401 || upstreamRes.status === 403) && !range) {
        upstreamRes = await fetchUpstream(request, upstreamUrl, controller.signal, range, false);
      }

      const contentType = (upstreamRes.headers.get('content-type') || '').toLowerCase();
      const isPlaylist = isPlaylistResponse(upstreamUrl.pathname, contentType);

      if (isPlaylist) {
        const sourceText = await upstreamRes.text();
        const rewritten = rewritePlaylist(sourceText, upstreamUrl, reqUrl.origin);
        return new Response(rewritten, {
          status: upstreamRes.status,
          headers: mergeHeaders({
            'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
            'cache-control': 'no-store, max-age=0',
            'x-relay-upstream-status': String(upstreamRes.status)
          })
        });
      }

      const passthroughHeaders = {
        'cache-control': 'no-store, max-age=0'
      };
      const passContentType = upstreamRes.headers.get('content-type');
      if (passContentType) passthroughHeaders['content-type'] = passContentType;
      const passLength = upstreamRes.headers.get('content-length');
      if (passLength) passthroughHeaders['content-length'] = passLength;
      const passRanges = upstreamRes.headers.get('accept-ranges');
      if (passRanges) passthroughHeaders['accept-ranges'] = passRanges;
      const passRange = upstreamRes.headers.get('content-range');
      if (passRange) passthroughHeaders['content-range'] = passRange;
      passthroughHeaders['x-relay-upstream-status'] = String(upstreamRes.status);

      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: mergeHeaders(passthroughHeaders)
      });
    } catch (error) {
      const detail = error && error.message ? error.message : String(error);
      return json({ error: 'Failed to fetch upstream stream', detail }, 502);
    } finally {
      clearTimeout(timeoutId);
    }
  }
};

function isPlaylistResponse(pathname = '', contentType = '') {
  const lowerPath = pathname.toLowerCase();
  if (lowerPath.endsWith('.m3u8') || lowerPath.endsWith('.m3u')) {
    return true;
  }
  return (
    contentType.includes('application/vnd.apple.mpegurl') ||
    contentType.includes('application/x-mpegurl') ||
    contentType.includes('audio/mpegurl') ||
    contentType.includes('audio/x-mpegurl')
  );
}

async function fetchUpstream(request, upstreamUrl, signal, range, strictMode) {
  // Use a fixed, modern browser User-Agent to avoid blocking
  const browserUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
  const headers = new Headers({
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'accept-encoding': 'gzip, deflate, br',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
    'user-agent': browserUA
  });
  if (range) {
    headers.set('range', range);
  }
  if (strictMode) {
    headers.set('origin', upstreamUrl.origin);
    headers.set('referer', `${upstreamUrl.origin}/`);
  }

  return fetch(upstreamUrl.toString(), {
    method: 'GET',
    headers,
    redirect: 'follow',
    signal
  });
}

function rewritePlaylist(text, baseUrl, relayOrigin) {
  const relayBase = `${relayOrigin}/?url=`;
  return text
    .split('\n')
    .map((line) => rewriteLine(line, baseUrl, relayBase))
    .join('\n');
}

function rewriteLine(line, baseUrl, relayBase) {
  const trimmed = line.trim();
  if (!trimmed) {
    return line;
  }

  if (trimmed.startsWith('#')) {
    return line
      .replace(/URI="([^"]+)"/g, (_match, uriValue) => {
        const absolute = toAbsoluteUrl(uriValue, baseUrl);
        if (!absolute) return `URI="${uriValue}"`;
        return `URI="${relayBase}${encodeURIComponent(absolute)}"`;
      });
  }

  const absolute = toAbsoluteUrl(trimmed, baseUrl);
  if (!absolute) {
    return line;
  }
  return `${relayBase}${encodeURIComponent(absolute)}`;
}

function toAbsoluteUrl(value, baseUrl) {
  try {
    const normalized = (value || '').trim();
    if (!normalized || normalized.startsWith('data:')) {
      return null;
    }
    return new URL(normalized, baseUrl).toString();
  } catch {
    return null;
  }
}

function isBlockedPort(port) {
  if (!port) return false;
  const blocked = new Set(['22', '23', '25', '53', '110', '135', '137', '138', '139', '143', '445', '3306', '3389', '5432', '6379', '27017']);
  return blocked.has(port);
}

function isPrivateOrLoopbackHost(hostname) {
  const host = (hostname || '').toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,HEAD,OPTIONS',
    'access-control-allow-headers': 'Content-Type,Range'
  };
}

function mergeHeaders(extra = {}) {
  const out = new Headers(corsHeaders());
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null) {
      out.set(key, String(value));
    }
  }
  return out;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: mergeHeaders({ 'content-type': 'application/json; charset=utf-8' })
  });
}
