export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Pega a URL da playlist dos parâmetros ou usa a padrão
    const m3uUrl = url.searchParams.get("url") || env.DEFAULT_M3U;

    try {
      const response = await fetch(m3uUrl, {
        headers: {
          "User-Agent": "VLC/3.0.18 LibVLC/3.0.18",
          "Accept": "*/*"
        }
      });

      if (!response.ok) {
        return new Response(JSON.stringify({ ok: false, error: `Falha ao carregar M3U: ${response.status}` }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const text = await response.text();
      const channels = parseM3u(text, m3uUrl);

      return new Response(JSON.stringify({ ok: true, channels }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};

function parseM3u(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  let currentItem = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF")) {
      currentItem = { name: "Canal", group: "Geral", logo: "" };
      
      // Extrair grupo e ID
      const groupMatch = line.match(/group-title="([^"]+)"/i);
      if (groupMatch) currentItem.group = groupMatch[1];
      
      const idMatch = line.match(/tvg-id="([^"]+)"/i);
      if (idMatch) currentItem.id = idMatch[1];
      
      // Extrair logo
      const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
      if (logoMatch) currentItem.logo = logoMatch[1];
      
      // Extrair nome
      const commaIndex = line.lastIndexOf(",");
      if (commaIndex !== -1) {
        currentItem.name = line.substring(commaIndex + 1).trim();
      }
      continue;
    }

    if (line.startsWith("#")) continue;

    if (currentItem) {
      try {
        const channelUrl = new URL(line, baseUrl).toString();
        channels.push({
          ...currentItem,
          url: channelUrl
        });
      } catch (e) {}
      currentItem = null;
    }
  }

  return channels;
}
