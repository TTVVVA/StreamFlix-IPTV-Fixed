export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const m3uUrl = url.searchParams.get("url") || env.DEFAULT_M3U;
    const onlyGroups = url.searchParams.get("onlyGroups") === "true";
    const targetGroup = url.searchParams.get("group");

    try {
      const response = await fetch(m3uUrl, {
        headers: { "User-Agent": "VLC/3.0.18", "Accept": "*/*" }
      });

      if (!response.ok) return new Response(JSON.stringify({ ok: false }), { status: 502, headers: corsHeaders });

      const text = await response.text();
      const result = parseM3uOptimized(text, m3uUrl, { onlyGroups, targetGroup });

      return new Response(JSON.stringify({ ok: true, ...result }), {
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

function parseM3uOptimized(text, baseUrl, options) {
  const lines = text.split(/\r?\n/);
  const groups = new Set();
  const channels = [];
  let currentItem = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#EXTM3U")) continue;

    if (line.startsWith("#EXTINF")) {
      const groupMatch = line.match(/group-title="([^"]+)"/i);
      const groupName = groupMatch ? groupMatch[1] : "Geral";
      groups.add(groupName);

      if (options.onlyGroups) continue;
      if (options.targetGroup && groupName !== options.targetGroup) {
        currentItem = null;
        continue;
      }

      currentItem = { name: "Canal", group: groupName, logo: "" };
      const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
      if (logoMatch) currentItem.logo = logoMatch[1];
      const commaIndex = line.lastIndexOf(",");
      if (commaIndex !== -1) currentItem.name = line.substring(commaIndex + 1).trim();
      continue;
    }

    if (line.startsWith("#")) continue;

    if (currentItem && !options.onlyGroups) {
      try {
        currentItem.url = new URL(line, baseUrl).toString();
        channels.push(currentItem);
      } catch (e) {}
      currentItem = null;
    }
  }

  return options.onlyGroups ? { groups: Array.from(groups).sort() } : { channels };
}
