import type { ActivityChannel } from '@/lib/activity-types';

export function asSingleString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeSessionKey(guildId: string, voiceChannelId: string): string {
  return `activity:session:${guildId}:${voiceChannelId}`;
}

export function parseAllowedHosts(raw: string | undefined): string[] {
  return String(raw || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedHost(url: URL, allowlist: string[]): boolean {
  if (!allowlist.length) return true;
  const host = url.hostname.toLowerCase();
  return allowlist.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function parseM3U(text: string): ActivityChannel[] {
  const lines = text.split(/\r?\n/);
  const channels: ActivityChannel[] = [];
  let current: { name: string; groupTitle: string; tvgId: string; tvgLogo: string } | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      current = parseExtInf(line);
      continue;
    }

    if (line.startsWith('#')) continue;

    if (current) {
      channels.push({
        name: current.name,
        url: line,
        groupTitle: current.groupTitle,
        tvgId: current.tvgId,
        tvgLogo: current.tvgLogo
      });
      current = null;
    }
  }

  return channels;
}

function parseExtInf(line: string): { name: string; groupTitle: string; tvgId: string; tvgLogo: string } {
  const comma = line.indexOf(',');
  const attrsPart = comma >= 0 ? line.slice(0, comma) : line;
  const name = comma >= 0 ? line.slice(comma + 1).trim() : 'Sem nome';

  return {
    name,
    groupTitle: parseQuotedAttr(attrsPart, 'group-title'),
    tvgId: parseQuotedAttr(attrsPart, 'tvg-id'),
    tvgLogo: parseQuotedAttr(attrsPart, 'tvg-logo')
  };
}

function parseQuotedAttr(input: string, attrName: string): string {
  const re = new RegExp(`${attrName}="([^"]*)"`, 'i');
  const match = input.match(re);
  return match ? match[1] : '';
}

export function withCors(headers: HeadersInit = {}): Headers {
  const h = new Headers(headers);
  h.set('access-control-allow-origin', '*');
  h.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  h.set('access-control-allow-headers', 'content-type, authorization, range, if-range, if-none-match, if-modified-since');
  h.set('access-control-expose-headers', 'content-type, content-length, content-range, accept-ranges, cache-control, etag, last-modified');
  return h;
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: withCors({ 'content-type': 'application/json; charset=utf-8' })
  });
}

export function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: withCors() });
}

export function safeUrl(input: string): URL | null {
  try {
    const url = new URL(String(input || '').trim());
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

export function rewriteManifest(baseUrl: URL, manifestText: string, proxyPrefix: string): string {
  const lines = manifestText.split(/\r?\n/);
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      if (/^https?:\/\//i.test(trimmed)) {
        return `${proxyPrefix}${encodeURIComponent(trimmed)}`;
      }
      if (trimmed.startsWith('/')) {
        const absolute = new URL(trimmed, `${baseUrl.protocol}//${baseUrl.host}`).toString();
        return `${proxyPrefix}${encodeURIComponent(absolute)}`;
      }
      const absolute = new URL(trimmed, baseUrl).toString();
      return `${proxyPrefix}${encodeURIComponent(absolute)}`;
    })
    .join('\n');
}

export function isLikelyManifest(url: URL, contentType: string): boolean {
  const path = url.pathname.toLowerCase();
  return path.endsWith('.m3u8') || path.endsWith('.m3u') || /mpegurl|m3u8|m3u/i.test(contentType);
}