export interface StalkerConfig {
  url: string;
  mac?: string;
  token?: string;
}

export async function stalkerHandshake(config: StalkerConfig) {
  const { url, mac } = config;
  const baseUrl = new URL(url).origin + '/stalker_portal/server/load.php';
  
  const params = new URLSearchParams({
    type: 'stb',
    action: 'handshake',
    token: ''
  });

  const response = await fetch(`${baseUrl}?${params.toString()}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) Mag200 sb.713 Safari/533.3',
      'X-User-Agent': 'Model: MAG250; Link: WiFi',
    }
  });

  if (!response.ok) throw new Error(`Stalker handshake failed: ${response.status}`);
  
  const data = await response.json() as any;
  return data?.js?.token || '';
}

export async function getStalkerChannels(url: string, token: string) {
  const baseUrl = new URL(url).origin + '/stalker_portal/server/load.php';
  
  const params = new URLSearchParams({
    type: 'itv',
    action: 'get_all_channels',
    JsHttpRequest: '1-xml'
  });

  const response = await fetch(`${baseUrl}?${params.toString()}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) Mag200 sb.713 Safari/533.3',
      'Authorization': `Bearer ${token}`,
      'Cookie': `mac=00:1A:79:00:00:00; stb_lang=en; timezone=Europe/Lisbon;`
    }
  });

  if (!response.ok) throw new Error(`Stalker channels fetch failed: ${response.status}`);
  
  const data = await response.json() as any;
  return data?.js?.data || [];
}
