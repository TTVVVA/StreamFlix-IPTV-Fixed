export default {
  async fetch(request, env) {
    const reqUrl = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // --- NOVAS ROTAS DE API PARA A UI DO RALLY ---
    
    // ROTA: /api/session
    if (reqUrl.pathname === '/session' || reqUrl.pathname === '/api/session') {
      const guildId = reqUrl.searchParams.get('guildId');
      const voiceChannelId = reqUrl.searchParams.get('voiceChannelId');
      
      if (!guildId || !voiceChannelId) {
        return json({ ok: false, error: 'missing_params' }, 400);
      }

      const key = `session:${guildId}:${voiceChannelId}`;
      const redisUrl = 'https://sure-fowl-121802.upstash.io';
      const redisToken = 'gQAAAAAAAdvKAAIgcDI1MjJmNmRmMTdlMzg0YzZkYTE5N2U2YzBjMzdmZmZlMQ';

      if (request.method === 'POST') {
        const body = await request.json();
        const session = {
          guildId,
          voiceChannelId,
          channelsUrl: body.channelsUrl || '',
          updatedAt: new Date().toISOString()
        };
        await fetch(`${redisUrl}/set/${key}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${redisToken}` },
          body: JSON.stringify(session)
        });
        return json({ ok: true, session });
      }

      const res = await fetch(`${redisUrl}/get/${key}`, {
        headers: { 'Authorization': `Bearer ${redisToken}` }
      });
      const data = await res.json();
      const session = data.result ? JSON.parse(data.result) : null;
      
      // Se não houver sessão no Redis, retornamos uma padrão
      return json({ 
        ok: true, 
        session: session || { 
          guildId, 
          voiceChannelId, 
          channelsUrl: 'https://benfica-sempre-m3u.benficasempretv20260311.workers.dev/device-m3u/discord-a0410a3281b84c0ea34f34a196c85ec6.m3u' 
        } 
      });
    }

    // ROTA: /api/channels
    if (reqUrl.pathname === '/channels' || reqUrl.pathname === '/api/channels') {
      const url = reqUrl.searchParams.get('url');
      if (!url) return json({ error: 'missing_url' }, 400);

      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18' }
        });
        const text = await response.text();
        const channels = parseM3uChannels(text, url);
        return json({ ok: true, channels });
      } catch (err) {
        return json({ ok: false, error: err.message }, 500);
      }
    }

    // ROTA: /api/resolve (Para canais Stalker)
    if (reqUrl.pathname === '/resolve' || reqUrl.pathname === '/api/resolve') {
      const targetUrl = reqUrl.searchParams.get('url');
      return json({ url: targetUrl });
    }

    // --- LÃ“GICA ORIGINAL DE PROXY ---
    
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

function parseM3uChannels(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  let currentItem = null;
  
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    
    if (line.startsWith('#EXTINF')) {
      currentItem = { name: 'Canal', group: 'Geral', logo: '' };
      const groupMatch = line.match(/group-title="([^"]+)"/i);
      if (groupMatch) currentItem.group = groupMatch[1];
      const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
      if (logoMatch) currentItem.logo = logoMatch[1];
      const comma = line.lastIndexOf(',');
      if (comma >= 0) currentItem.name = line.slice(comma + 1).trim();
      continue;
    }
    
    if (line.startsWith('#')) continue;
    
    if (currentItem) {
      try {
        channels.push({
          name: currentItem.name,
          url: new URL(line, baseUrl).toString(),
          group: currentItem.group,
          logo: currentItem.logo
        });
      } catch {}
      currentItem = null;
    }
  }
  return channels;
}

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
  // VLC/3.0.18 User-Agent is very trusted by IPTV servers
  const vlcUA = 'VLC/3.0.18 LibVLC/3.0.18';
  const headers = new Headers({
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'connection': 'keep-alive',
    'user-agent': vlcUA,
    'x-requested-with': 'org.videolan.vlc'
  });

  if (range) {
    headers.set('range', range);
  }

  // MODO VLC TOTAL: Remover Referer e Origin para evitar bloqueios 403/406
  // No VLC nativo, estes headers não são enviados no pedido do stream.
  
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
