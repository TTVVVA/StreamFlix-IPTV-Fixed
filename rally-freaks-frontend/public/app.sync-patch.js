// =============================================================================
// PATCH: watch-together sync — adicionar ao app.js existente
// Cobre: B) drift correction  C) join automático  D) live HLS  E) anti-loop
// =============================================================================

// ---------------------------------------------------------------------------
// CONSTANTES de sync
// ---------------------------------------------------------------------------
const SYNC_DRIFT_THRESHOLD_SEC = 1.5;   // seek se delta > 1.5 s
const SYNC_CHECK_INTERVAL_MS   = 2000;  // verificar drift cada 2 s
const SYNC_LIVE_EDGE_THRESHOLD = 3.0;   // para live sem DVR: seek se >3 s atrás da edge
const PLAYBACK_RATE_DEFAULT    = 1.0;

// ---------------------------------------------------------------------------
// E) Guard anti-loop — impede POST em cascata quando sync remoto aplica seek
// ---------------------------------------------------------------------------
let _applyingRemoteUpdate = false;

// ---------------------------------------------------------------------------
// Utilitário: é um stream live sem DVR?
// Deteta pela ausência de #EXT-X-ENDLIST no manifest (hls.js expõe via hls.levels)
// ---------------------------------------------------------------------------
function isLiveStream(hls) {
  if (!hls) return false;
  try {
    // hls.js: se duration === Infinity ou levels[0].details.live === true
    const details = hls.levels?.[hls.currentLevel]?.details;
    if (!details) return false;
    return details.live === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// B) Aplicar update remoto de sessão ao player
// Chamado sempre que GET /activity/session devolve dados novos
// ---------------------------------------------------------------------------
function applyRemotePlaybackSync(video, hls, session) {
  if (!video || !session) return;

  const {
    playbackAnchorUnixMs,
    playbackAnchorMediaTimeSec,
    hostPlaybackRate,
    hostPaused,
    activeChannelUrl
  } = session;

  // Sem anchor definido → sem sync de tempo (host ainda não enviou)
  if (playbackAnchorUnixMs == null || playbackAnchorMediaTimeSec == null) return;

  // E) activar guard
  _applyingRemoteUpdate = true;

  try {
    const nowMs = Date.now();
    const elapsedSec = (nowMs - playbackAnchorUnixMs) / 1000;

    if (isLiveStream(hls)) {
      // D) Live HLS sem DVR: sincronizar pela live edge em vez de currentTime absoluto
      syncLiveEdge(video, hls, elapsedSec, hostPaused);
    } else {
      // VOD / DVR: sync por targetTime calculado
      const targetTime = playbackAnchorMediaTimeSec + (hostPaused ? 0 : elapsedSec);
      const delta = Math.abs(video.currentTime - targetTime);

      if (delta > SYNC_DRIFT_THRESHOLD_SEC) {
        console.log(`[SYNC] seek VOD: currentTime=${video.currentTime.toFixed(2)} target=${targetTime.toFixed(2)} delta=${delta.toFixed(2)}`);
        video.currentTime = targetTime;
      }

      // Sync pause/play
      if (hostPaused && !video.paused) video.pause();
      if (!hostPaused && video.paused) video.play().catch(() => showManualPlayButton());
    }

    // Sync playback rate
    const rate = typeof hostPlaybackRate === "number" && hostPlaybackRate > 0 ? hostPlaybackRate : PLAYBACK_RATE_DEFAULT;
    if (Math.abs(video.playbackRate - rate) > 0.05) {
      video.playbackRate = rate;
    }

  } finally {
    // E) desactivar guard após microtask (evita que eventos 'seeking' disparem POST)
    setTimeout(() => { _applyingRemoteUpdate = false; }, 0);
  }
}

// D) Forçar live edge quando drift > threshold
function syncLiveEdge(video, hls, _elapsedSec, hostPaused) {
  try {
    if (!hls || !hls.liveSyncPosition) return;
    const liveEdge = hls.liveSyncPosition;
    if (liveEdge == null) return;

    const delta = liveEdge - video.currentTime;
    if (delta > SYNC_LIVE_EDGE_THRESHOLD) {
      console.log(`[SYNC] live-edge seek: currentTime=${video.currentTime.toFixed(2)} edge=${liveEdge.toFixed(2)} delta=${delta.toFixed(2)}`);
      video.currentTime = liveEdge;
    }

    if (!hostPaused && video.paused) video.play().catch(() => showManualPlayButton());
  } catch (err) {
    console.warn("[SYNC] live-edge error", err);
  }
}

// ---------------------------------------------------------------------------
// B) Periodic drift correction loop
// Chamar após MANIFEST_PARSED; cancelar ao trocar canal
// ---------------------------------------------------------------------------
let _syncIntervalId = null;

function startSyncLoop(video, hls, getSession) {
  stopSyncLoop();
  _syncIntervalId = setInterval(() => {
    const session = getSession();
    if (session) applyRemotePlaybackSync(video, hls, session);
  }, SYNC_CHECK_INTERVAL_MS);
}

function stopSyncLoop() {
  if (_syncIntervalId != null) {
    clearInterval(_syncIntervalId);
    _syncIntervalId = null;
  }
}

// ---------------------------------------------------------------------------
// A) Construir payload de update-active com clock de playback
// Chamar quando o host muda de canal ou altera o estado de playback
// E) Só envia se NÃO estiver a aplicar update remoto
// ---------------------------------------------------------------------------
function buildPlaybackAnchor(video, hls) {
  const isLive = isLiveStream(hls);
  return {
    playbackAnchorUnixMs: Date.now(),
    // Para live: 0 (o relevante é a live edge, não currentTime absoluto)
    playbackAnchorMediaTimeSec: isLive ? 0 : (video?.currentTime ?? 0),
    hostPlaybackRate: video?.playbackRate ?? PLAYBACK_RATE_DEFAULT,
    hostPaused: video?.paused ?? false
  };
}

async function postActiveChannelUpdate({ guildId, voiceChannelId, activeChannelUrl, activeChannelName, video, hls }) {
  // E) guard anti-loop
  if (_applyingRemoteUpdate) return;

  const anchor = buildPlaybackAnchor(video, hls);
  const body = {
    guildId,
    voiceChannelId,
    activeChannelUrl,
    activeChannelName,
    updatedAt: new Date().toISOString(),
    ...anchor
  };

  try {
    const res = await fetch("/activity/session/update-active", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn("[SESSION] update-active failed", err);
    }
  } catch (err) {
    console.warn("[SESSION] update-active error", err);
  }
}

// ---------------------------------------------------------------------------
// C) Join behaviour — ao abrir Activity, iniciar canal já activo da sessão
// Integrar no handler de init (após SDK ready + session fetch)
// ---------------------------------------------------------------------------
async function joinAndSyncActiveChannel({ session, video, hls, loadChannel, guildId, voiceChannelId }) {
  if (!session?.activeChannelUrl) return false; // sem canal activo na sala

  console.log("[JOIN] sessão tem canal activo:", session.activeChannelName || session.activeChannelUrl);

  // Iniciar o canal (a função loadChannel deve criar/reconfigurar hls.js)
  await loadChannel(session.activeChannelUrl, session.activeChannelName);

  // C) Aguardar MANIFEST_PARSED antes de aplicar sync de tempo
  await waitForManifestParsed(hls);

  // Aplicar sync inicial
  applyRemotePlaybackSync(video, hls, session);

  // Iniciar loop de drift correction
  startSyncLoop(video, hls, () => session);

  return true;
}

// Promessa que resolve no próximo MANIFEST_PARSED (ou timeout de 10 s)
function waitForManifestParsed(hls) {
  return new Promise((resolve) => {
    if (!hls) return resolve();
    const TIMEOUT = 10_000;
    const timer = setTimeout(resolve, TIMEOUT);

    hls.once(Hls.Events.MANIFEST_PARSED, () => {
      clearTimeout(timer);
      resolve();
    });

    // Se já tiver manifest carregado, resolve imediatamente
    if (hls.levels && hls.levels.length > 0) {
      clearTimeout(timer);
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// C) Autoplay fallback — mostrar botão manual quando browser bloquear
// Implementar no HTML/CSS conforme necessário; esta função activa-o
// ---------------------------------------------------------------------------
function showManualPlayButton() {
  const btn = document.getElementById("manual-play-btn");
  if (btn) btn.style.display = "flex";
}

function hideManualPlayButton() {
  const btn = document.getElementById("manual-play-btn");
  if (btn) btn.style.display = "none";
}

// ---------------------------------------------------------------------------
// POLLING de sessão remota (substitui ou complementa o polling existente)
// Chamar no arranque; recebe callback para reagir a mudança de canal
// ---------------------------------------------------------------------------
let _sessionPollId = null;
let _lastActiveChannelUrl = null;
let _lastActiveUpdatedAt = null;

function startSessionPoll({ guildId, voiceChannelId, video, hls, loadChannel, pollIntervalMs = 3000 }) {
  stopSessionPoll();

  const doFetch = async () => {
    try {
      const params = new URLSearchParams({ guildId: guildId || "", voiceChannelId: voiceChannelId || "" });
      const res = await fetch(`/activity/session?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      const session = data?.session;
      if (!session) return;

      const urlChanged  = session.activeChannelUrl  !== _lastActiveChannelUrl;
      const timeChanged = session.activeUpdatedAt   !== _lastActiveUpdatedAt;

      if (urlChanged && session.activeChannelUrl) {
        // C) Canal mudou → carregar novo canal e fazer join sync
        console.log("[POLL] canal remoto mudou para", session.activeChannelName || session.activeChannelUrl);
        _lastActiveChannelUrl  = session.activeChannelUrl;
        _lastActiveUpdatedAt   = session.activeUpdatedAt;
        stopSyncLoop();
        await loadChannel(session.activeChannelUrl, session.activeChannelName);
        await waitForManifestParsed(hls);
        applyRemotePlaybackSync(video, hls, session);
        startSyncLoop(video, hls, () => session);

      } else if (timeChanged) {
        // B) Mesmo canal, timestamp mudou → corrigir drift
        _lastActiveUpdatedAt = session.activeUpdatedAt;
        applyRemotePlaybackSync(video, hls, session);
      }
    } catch (err) {
      console.warn("[POLL] session poll error", err);
    }
  };

  doFetch(); // imediato
  _sessionPollId = setInterval(doFetch, pollIntervalMs);
}

function stopSessionPoll() {
  if (_sessionPollId != null) {
    clearInterval(_sessionPollId);
    _sessionPollId = null;
  }
}

// ---------------------------------------------------------------------------
// EXPORTS — integrar no app.js existente
// ---------------------------------------------------------------------------
// Se estiver a usar módulos ES:
export {
  applyRemotePlaybackSync,
  postActiveChannelUpdate,
  joinAndSyncActiveChannel,
  startSessionPoll,
  stopSessionPoll,
  startSyncLoop,
  stopSyncLoop,
  buildPlaybackAnchor,
  showManualPlayButton,
  hideManualPlayButton,
  isLiveStream,
  SYNC_DRIFT_THRESHOLD_SEC,
  SYNC_CHECK_INTERVAL_MS,
  SYNC_LIVE_EDGE_THRESHOLD
};
