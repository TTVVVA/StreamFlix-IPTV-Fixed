import type { RoboRequest } from '@robojs/server';
import { jsonResponse, optionsResponse } from '../../lib/activity-utils';
import { getStalkerChannels, stalkerHandshake } from '../../lib/stalker';

export default async (req: RoboRequest) => {
  if (req.method === 'OPTIONS') return optionsResponse();
  
  const { url, type, mac } = req.query;
  if (!url || Array.isArray(url)) {
    return jsonResponse({ ok: false, error: 'missing_url' }, 400);
  }

  try {
    // Se for Stalker, usar lógica específica
    if (type === 'stalker' || url.includes('/stalker_portal/')) {
      const stalkerMac = (Array.isArray(mac) ? mac[0] : mac) || '00:1A:79:00:00:00';
      const token = await stalkerHandshake({ url, mac: stalkerMac });
      const stalkerChannels = await getStalkerChannels(url, token);
      
      const mapped = stalkerChannels.map((ch: any) => ({
        name: ch.name || ch.number,
        url: ch.cmd, // O link do stalker geralmente precisa de resolve posterior
        group: ch.category_name || 'Stalker',
        logo: ch.logo,
        tvgId: ch.id,
        isStalker: true
      }));
      
      return jsonResponse({ ok: true, channels: mapped });
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
        'Accept': '*/*'
      }
    });

    if (!response.ok) {
      return jsonResponse({ ok: false, error: 'fetch_failed', status: response.status }, 502);
    }

    const text = await response.text();
    const channels = parseM3uChannels(text, url);
    
    return jsonResponse({ ok: true, channels });
  } catch (err: any) {
    return jsonResponse({ ok: false, error: 'server_error', message: err.message }, 500);
  }
};

function parseM3uChannels(playlistText: string, baseUrl: string) {
  const lines = playlistText.split(/\r?\n/);
  const channels = [];
  let currentItem: any = null;
  
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    
    if (line.startsWith("#EXTINF")) {
      currentItem = {
        name: "Canal",
        group: "Geral",
        logo: "",
        tvgId: "",
        extinf: line
      };
      
      // Extrair atributos
      const groupMatch = line.match(/group-title="([^"]+)"/i);
      if (groupMatch) currentItem.group = groupMatch[1];
      
      const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
      if (logoMatch) currentItem.logo = logoMatch[1];
      
      const tvgIdMatch = line.match(/tvg-id="([^"]+)"/i);
      if (tvgIdMatch) currentItem.tvgId = tvgIdMatch[1];
      
      const comma = line.lastIndexOf(",");
      if (comma >= 0) currentItem.name = line.slice(comma + 1).trim();
      continue;
    }
    
    if (line.startsWith("#")) continue;
    
    if (currentItem) {
      try {
        const absolute = new URL(line, baseUrl).toString();
        channels.push({
          name: currentItem.name,
          url: absolute,
          group: currentItem.group,
          logo: currentItem.logo,
          tvgId: currentItem.tvgId,
          extinf: currentItem.extinf,
        });
      } catch {
        // ignore invalid channel url
      }
      currentItem = null;
    }
  }
  return channels;
}
