const express = require('express');
const path = require('path');
const { Readable } = require('node:stream');

const PLAYLIST_CONTENT_TYPES = [
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl'
];

function createStreamFlixApp(options = {}) {
  const app = express();
  const staticDir = options.staticDir || process.cwd();

  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    next();
  });

  app.options('*', (_req, res) => {
    res.sendStatus(204);
  });

  app.get('/api/relay/health', (_req, res) => {
    res.json({ ok: true, service: 'stream-relay' });
  });

  app.get('/api/relay', async (req, res) => {
    const rawTarget = req.query.url;
    if (!rawTarget || typeof rawTarget !== 'string') {
      return res.status(400).json({ error: 'Missing query param: url' });
    }

    let targetUrl;
    try {
      targetUrl = new URL(rawTarget);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid target url' });
    }

    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return res.status(400).json({ error: 'Only http/https urls are supported' });
    }

    if (isBlockedHost(targetUrl.hostname)) {
      return res.status(403).json({ error: 'Host is blocked by relay policy' });
    }

    const controller = new AbortController();
    req.once('close', () => controller.abort());

    try {
      const upstreamResponse = await fetch(targetUrl.toString(), {
        redirect: 'follow',
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'accept': '*/*',
          'accept-language': 'en-US,en;q=0.9',
          'accept-encoding': 'gzip, deflate, br',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'cross-site',
          'origin': targetUrl.origin,
          'referer': targetUrl.origin + '/'
        },
        signal: controller.signal
      });

      if (!upstreamResponse.ok) {
        return res.status(upstreamResponse.status).send(`Upstream error: ${upstreamResponse.status}`);
      }

      const contentType = upstreamResponse.headers.get('content-type') || '';
      const isPlaylist = isPlaylistResponse(targetUrl.pathname, contentType);

      if (isPlaylist) {
        const playlistText = await upstreamResponse.text();
        const rewritten = rewritePlaylist(playlistText, targetUrl, req);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        return res.status(200).send(rewritten);
      }

      if (contentType) {
        res.setHeader('Content-Type', contentType);
      }
      const contentLength = upstreamResponse.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }
      const acceptRanges = upstreamResponse.headers.get('accept-ranges');
      if (acceptRanges) {
        res.setHeader('Accept-Ranges', acceptRanges);
      }
      res.setHeader('Cache-Control', 'no-store, max-age=0');

      if (!upstreamResponse.body) {
        return res.status(204).end();
      }

      const upstreamStream = Readable.fromWeb(upstreamResponse.body);
      upstreamStream.on('error', (streamError) => {
        console.error('Relay stream error:', streamError);
        if (!res.headersSent) {
          res.status(502).json({ error: 'Upstream stream error', detail: streamError.message });
        } else {
          res.destroy(streamError);
        }
      });

      res.on('close', () => upstreamStream.destroy());
      return upstreamStream.pipe(res);
    } catch (error) {
      return res.status(502).json({ error: 'Failed to fetch upstream stream', detail: error.message });
    }
  });

  app.use(express.static(staticDir, {
    extensions: ['html']
  }));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'));
  });

  return app;
}

function isPlaylistResponse(pathname = '', contentType = '') {
  const lowerPath = pathname.toLowerCase();
  const lowerType = contentType.toLowerCase();
  if (lowerPath.endsWith('.m3u8') || lowerPath.endsWith('.m3u')) {
    return true;
  }
  return PLAYLIST_CONTENT_TYPES.some((type) => lowerType.includes(type));
}

function rewritePlaylist(text, baseUrl, req) {
  const relayBase = `${req.protocol}://${req.get('host')}/api/relay?url=`;
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
    return line.replace(/URI="([^"]+)"/g, (_match, uriValue) => {
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

function toAbsoluteUrl(maybeRelative, baseUrl) {
  try {
    const normalized = maybeRelative.trim();
    if (!normalized || normalized.startsWith('data:')) {
      return null;
    }
    return new URL(normalized, baseUrl).toString();
  } catch (_error) {
    return null;
  }
}

function isBlockedHost(hostname = '') {
  const host = hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    return true;
  }
  return false;
}

module.exports = {
  createStreamFlixApp
};
