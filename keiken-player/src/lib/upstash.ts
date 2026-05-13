interface RedisConfig {
  restUrl: string;
  token: string;
}

export async function redisGetJson<T>(key: string): Promise<T | null> {
  const config = getRedisConfig();
  if (!config) return null;

  const endpoint = `${config.restUrl}/get/${encodeURIComponent(key)}`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: { authorization: `Bearer ${config.token}` }
  });

  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as { result?: string | null } | null;
  const raw = body?.result;
  if (!raw || typeof raw !== 'string') return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function redisSetJson(key: string, value: unknown, ttlSec?: number): Promise<boolean> {
  const config = getRedisConfig();
  if (!config) return false;

  const payload = encodeURIComponent(JSON.stringify(value));
  let endpoint = `${config.restUrl}/set/${encodeURIComponent(key)}/${payload}`;
  if (ttlSec && ttlSec > 0) endpoint += `?EX=${ttlSec}`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: { authorization: `Bearer ${config.token}` }
  });

  return response.ok;
}

function getRedisConfig(): RedisConfig | null {
  const envUrl = String(process.env.UPSTASH_REDIS_REST_URL || '').trim();
  const envToken = String(process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  if (envUrl && envToken) {
    return { restUrl: normalizeRestUrl(envUrl), token: envToken };
  }

  const redisUrlRaw = String(process.env.REDIS_URL || '').trim();
  if (!redisUrlRaw) return null;

  try {
    const redisUrl = new URL(redisUrlRaw);
    const token = decodeURIComponent(redisUrl.password || '');
    if (!token) return null;

    return {
      restUrl: `https://${redisUrl.host}`,
      token
    };
  } catch {
    return null;
  }
}

function normalizeRestUrl(value: string): string {
  return value.replace(/\/+$/, '');
}