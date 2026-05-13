import { DiscordSDK } from "/sdk/index.mjs";

const HLS_CDN_PRIMARY = "/js/hls.min.js";
const HLS_CDN_FALLBACK = "/lib/hls.min.js";
// RESOLVER_BASE removido: /resolve Ã© now same-origin no worker principal (CSP fix)
const BUILD = "worker-discord-activity-ux-error-b6";
const DIAG_VERBOSE = true;
const DIAG_HLS_EVENTS = true;
const ACTIVITY_LOG_ENDPOINT = "/api/log";
const SYNC_INTERVAL_MS = 2000;
const SYNC_PENDING_LOCAL_GRACE_MS = 3000;

const fallbackChannels = [
  { name: "A carregar canais...", url: "" }
];

const DEFAULT_M3U = "https://benfica-sempre-m3u.benficasempretv20260311.workers.dev/device-m3u/discord-a0410a3281b84c0ea34f34a196c85ec6.m3u";

const state = {
  sdk: null,
  ready: false,
  guildId: "",
  voiceChannelId: "",
  session: null,
  channels: [],
  activeIndex: -1,
  activeChannel: null,
  activeUpdatedAt: null,      // timestamp do canal activo remoto
  applyingRemoteUpdate: false, // guard anti-loop de sync
  syncTimer: null,            // intervalo do watcher remoto
  hls: null,
  autoRefresh: false,
  autoRefreshTimer: null,
  channelsRetryTimer: null,
  channelsRetryCount: 0,
  userInteracted: false,
  hasLoadedHlsScript: false,
  isLoading: false,
  clientId: "",
  requestSeq: 0,
  pollSeq: 0,
  channelSeq: 0,
  playSeq: 0,
  loadingChannelSeq: 0,
  lastPollStartedAtMs: 0,
  syncPollRunning: false,
  syncStopped: true,
  pendingLocalMutation: null,
  optimisticActiveUpdatedAt: null,
  androidRuntime: false,
  playBlockedByPolicy: false,
  pendingUserPlayContext: null,
  autoMutedForAndroid: false,
  activeCorrelationId: null,
  lastUserGestureAtMs: 0
};

const refs = {
  buildLabel: document.getElementById("buildLabel"),
  toast: document.getElementById("toast"),
  toastTitle: document.getElementById("toastTitle"),
  toastMessage: document.getElementById("toastMessage"),
  closeToast: document.getElementById("closeToast"),
  loadSession: document.getElementById("loadSession"),
  autoRefresh: document.getElementById("autoRefresh"),
  updatedAt: document.getElementById("updatedAt"),
  activeChannelText: document.getElementById("activeChannelText"),
  channelCount: document.getElementById("channelCount"),
  channelsList: document.getElementById("channelsList"),
  channelSearch: document.getElementById("channelSearch"),
  playPause: document.getElementById("playPause"),
  videoTime: document.getElementById("videoTime"),
  progressBar: document.getElementById("progressBar"),
  streamVideo: document.getElementById("streamVideo"),
  playerCard: document.getElementById("playerCard"),
  muteButton: document.getElementById("muteButton"),
  fullscreenButton: document.getElementById("fullscreenButton"),
  volumeSlider: document.getElementById("volumeSlider"),
  volDown: document.getElementById("volDown"),
  volUp: document.getElementById("volUp"),
  discordDiag: document.getElementById("discordDiag"),
  sessionDiag: document.getElementById("sessionDiag"),
  streamDiag: document.getElementById("streamDiag")
};

function setDiag(el, kind, text) {
  el.classList.remove("ok", "warn", "error");
  el.classList.add(kind);
  el.querySelector("span").textContent = text;
}

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "--/--/---- --:--:--";
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function showToast(title, message, kind = "ok") {
  refs.toastTitle.textContent = title;
  refs.toastMessage.textContent = message;
  refs.toast.classList.remove("is-hidden", "is-error", "is-warn");
  if (kind === "error") refs.toast.classList.add("is-error");
  if (kind === "warn") refs.toast.classList.add("is-warn");
}

function updateTimestamp(value) {
  refs.updatedAt.textContent = formatDate(value || Date.now());
}

function getPersistentDiagnosticClientId() {
  const key = "discordActivityDiagClientId";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const generated = crypto?.randomUUID?.() || `diag-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(key, generated);
    return generated;
  } catch (_) {
    return `diag-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}


function detectAndroidRuntime() {
  const ua = navigator.userAgent || "";
  return /Android/i.test(ua);
}

function createCorrelationId(prefix = "play") {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch (_) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function shouldUseResolver(channel) {
  const n = String(channel?.name || "").toLowerCase();
  const u = String(channel?.url || "").toLowerCase();
  const res = (
    n.includes("backup") ||
    n.includes("sport tv 4") ||
    n.includes("sport tv4") ||
    u.includes("daddylive") ||
    u.includes("giokko") ||
    u.includes("worldip") ||
    u.includes("/api/play/stalker/")
  );
  if (res) {
    void logEvent("resolver.should_use_true", { name: n, url: u });
  }
  return res;
}

async function maybeResolveChannelUrl(rawUrl, channel) {
  if (!shouldUseResolver(channel)) return { url: rawUrl, headers: null };
  try {
    const r = await fetch(`/api/resolve?url=${encodeURIComponent(rawUrl)}`);
    const d = await r.json().catch(() => ({}));
    if (r.ok && d?.ok && d?.url) {
      await logEvent("resolver.resolve_ok", {
        channel: channel?.name,
        rawUrl: String(rawUrl).split("?")[0],
        resolvedUrl: String(d.url).split("?")[0]
      });
      return { url: d.url, headers: d.headers || null };
    }
    await logEvent("resolver.resolve_fail", {
      channel: channel?.name,
      status: r.status,
      payload: d
    });
    return { url: rawUrl, headers: null };
  } catch (err) {
    await logEvent("resolver.resolve_error", {
      channel: channel?.name,
      error: serializeError(err)
    });
    return { url: rawUrl, headers: null };
  }
}

function markUserGesture(source) {
  state.userInteracted = true;
  state.lastUserGestureAtMs = nowMs();
  if (state.androidRuntime && state.autoMutedForAndroid) {
    refs.streamVideo.muted = false;
    state.autoMutedForAndroid = false;
  }
  void logEvent("android.user_gesture", {
    source,
    androidRuntime: state.androidRuntime,
    pendingPlay: Boolean(state.pendingUserPlayContext),
    video: videoSnapshot()
  });
}

function shouldIgnorePlaybackCallback(hlsInstance, channelSeq) {
  return state.hls !== hlsInstance || state.channelSeq !== channelSeq;
}

async function logStalePlaybackCallback(eventName, context = {}, hlsInstance) {
  await logEvent("hls.stale_callback_ignored", {
    ...context,
    eventName,
    currentChannelSeq: state.channelSeq,
    hasSameHls: state.hls === hlsInstance,
    video: videoSnapshot()
  });
}

function serializeError(err) {
  if (!err) return {};
  return {
    name: err.name,
    message: String(err.message || err),
    status: err.status,
    stack: err.stack ? String(err.stack).slice(0, 1200) : undefined,
    payload: err.payload
  };
}

function videoSnapshot() {
  const video = refs.streamVideo;
  if (!video) return {};
  return {
    readyState: video.readyState,
    networkState: video.networkState,
    paused: video.paused,
    muted: video.muted,
    volume: video.volume,
    currentTime: Number.isFinite(video.currentTime) ? video.currentTime : undefined,
    duration: Number.isFinite(video.duration) ? video.duration : undefined,
    srcSet: Boolean(video.currentSrc || video.src),
    currentSrc: video.currentSrc ? video.currentSrc.split("?")[0] : undefined
  };
}

function diagBase() {
  if (!state.clientId) state.clientId = getPersistentDiagnosticClientId();
  return {
    build: BUILD,
    clientId: state.clientId,
    guildId: state.guildId || undefined,
    voiceChannelId: state.voiceChannelId || undefined,
    activeIndex: state.activeIndex,
    activeChannelName: state.activeChannel?.name,
    activeChannelUrl: state.activeChannel?.url,
    activeUpdatedAt: state.activeUpdatedAt,
    optimisticActiveUpdatedAt: state.optimisticActiveUpdatedAt,
    pendingMutationId: state.pendingLocalMutation?.mutationId,
    pendingChannelSeq: state.pendingLocalMutation?.channelSeq,
    channelSeq: state.channelSeq,
    pollSeq: state.pollSeq,
    requestSeq: state.requestSeq,
    androidRuntime: state.androidRuntime,
    activeCorrelationId: state.activeCorrelationId || undefined,
    visibilityState: document.visibilityState,
    hidden: document.hidden
  };
}

async function logEvent(event, details = {}) {
  const payload = {
    event,
    at: nowIso(),
    ...diagBase(),
    details
  };

  if (DIAG_VERBOSE) {
    console.debug(`[DIAG] ${event}`, payload);
  }

  try {
    await fetch(ACTIVITY_LOG_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true
    });
  } catch (err) {
    console.debug("log failed", err);
  }
}

function endpointFromUrl(url) {
  const value = String(url || "");
  if (value.includes(ACTIVITY_LOG_ENDPOINT)) return "activity-log";
  if (value.includes("/activity/session/update-active")) return "update-active";
  if (value.includes("/activity/session")) return "session";
  if (value.includes("/activity/channels")) return "channels";
  if (value.includes("/proxy")) return "proxy";
  return "other";
}

function redactedUrlForLog(url) {
  const value = String(url || "");
  if (value.includes("/proxy")) return "/proxy?url=<redacted>";
  if (value.includes("/activity/channels")) return "/activity/channels?url=<redacted>";
  return value;
}

function classifyPlayError(err) {
  if (err?.name === "NotAllowedError") return "policy_not_allowed";
  if (err?.name === "NotSupportedError") return "media_not_supported_or_load";
  if (err?.name === "AbortError") return "play_aborted_or_new_load";
  return "unknown_play_error";
}

async function attemptVideoPlay(reason, context = {}) {
  const startedAtMs = nowMs();
  const PLAY_TIMEOUT_MS = state.androidRuntime ? 10000 : 4500;
  const channelSeq = context.channelSeq || state.channelSeq;
  const playSeq = context.playSeq || state.playSeq;
  const correlationId = context.correlationId || state.activeCorrelationId || createCorrelationId("play");
  const playContext = { ...context, channelSeq, playSeq, correlationId, androidRuntime: state.androidRuntime };

  if (state.channelSeq !== channelSeq) {
    await logEvent("video.play_skip", {
      ...playContext,
      reason: "stale_channel_seq_before_play",
      currentChannelSeq: state.channelSeq,
      video: videoSnapshot()
    });
    return false;
  }

  const playWithTimeout = async () => {
    const playPromise = refs.streamVideo.play();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("play_timeout_pending")), PLAY_TIMEOUT_MS)
    );
    return Promise.race([playPromise, timeoutPromise]);
  };

  await logEvent("video.play_start", {
    reason,
    ...playContext,
    userInteracted: state.userInteracted,
    msSinceGesture: state.lastUserGestureAtMs ? nowMs() - state.lastUserGestureAtMs : null,
    video: videoSnapshot()
  });

  try {
    await playWithTimeout();
    refs.playPause.setAttribute("aria-label", "Pausar");
    state.playBlockedByPolicy = false;
    state.pendingUserPlayContext = null;
    await logEvent("video.play_ok", {
      reason,
      durationMs: nowMs() - startedAtMs,
      userInteracted: state.userInteracted,
      video: videoSnapshot(),
      ...playContext
    });
    return true;
  } catch (err) {
    const errorClass = classifyPlayError(err);

    if (String(err?.message || "") === "play_timeout_pending") {
      await logEvent("video.play_timeout_pending", {
        reason,
        userInteracted: state.userInteracted,
        timeoutMs: PLAY_TIMEOUT_MS,
        video: videoSnapshot(),
        ...playContext
      });
    }

    if (errorClass === "policy_not_allowed") {
      state.playBlockedByPolicy = true;
      state.pendingUserPlayContext = { reason: "user_gesture_retry_after_policy", ...playContext };
      setDiag(refs.streamDiag, "warn", "Toque em Ã¢â€“Â¶ para reproduzir");
      showToast("Toque para reproduzir.", "diag: Android/Discord bloqueou autoplay; toca no botÃƒÂ£o play ou no vÃƒÂ­deo.", "warn");
      await logEvent("android.play_blocked_user_gesture_required", {
        reason,
        errorClass,
        userInteracted: state.userInteracted,
        video: videoSnapshot(),
        durationMs: nowMs() - startedAtMs,
        ...playContext
      });
      await logEvent("video.play_error", {
        reason,
        errorClass,
        error: serializeError(err),
        userInteracted: state.userInteracted,
        video: videoSnapshot(),
        durationMs: nowMs() - startedAtMs,
        ...playContext
      });
      return false;
    }

    // Single-start retry for cold pipeline/race on Discord Android runtime.
    // No recursion: exactly one inline retry, guarded by channelSeq + hlsInstance.
    if (!context._retriedOnce) {
      await logEvent("video.play_retry_once", {
        reason,
        retryDelayMs: 600,
        errorClass,
        error: serializeError(err),
        ...playContext
      });
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (state.channelSeq !== channelSeq || (context._hlsInstance && state.hls !== context._hlsInstance)) {
        await logEvent("hls.stale_callback_ignored", {
          ...playContext,
          eventName: "PLAY_RETRY_ONCE",
          currentChannelSeq: state.channelSeq,
          hasSameHls: context._hlsInstance ? state.hls === context._hlsInstance : undefined,
          video: videoSnapshot()
        });
        return false;
      }
      try {
        await playWithTimeout();
        refs.playPause.setAttribute("aria-label", "Pausar");
        state.playBlockedByPolicy = false;
        state.pendingUserPlayContext = null;
        await logEvent("video.play_ok", {
          reason: `${reason}_retry_once_ok`,
          retriedOnce: true,
          durationMs: nowMs() - startedAtMs,
          userInteracted: state.userInteracted,
          video: videoSnapshot(),
          ...playContext
        });
        return true;
      } catch (retryErr) {
        const retryErrorClass = classifyPlayError(retryErr);
        if (retryErrorClass === "policy_not_allowed") {
          state.playBlockedByPolicy = true;
          state.pendingUserPlayContext = { reason: "user_gesture_retry_after_policy", ...playContext };
          setDiag(refs.streamDiag, "warn", "Toque em Ã¢â€“Â¶ para reproduzir");
          showToast("Toque para reproduzir.", "diag: Android/Discord bloqueou autoplay.", "warn");
        }
        await logEvent("video.play_error", {
          reason,
          retriedOnce: true,
          errorClass: retryErrorClass,
          error: serializeError(retryErr),
          userInteracted: state.userInteracted,
          video: videoSnapshot(),
          durationMs: nowMs() - startedAtMs,
          ...playContext
        });
        return false;
      }
    }

    if (String(err?.message || "") === "play_timeout_pending" && !refs.streamVideo.muted && !state.androidRuntime) {
      try {
        refs.streamVideo.muted = true;
        await logEvent("video.play_timeout_pending", {
          reason,
          retry: "muted_true_non_android_only",
          userInteracted: state.userInteracted,
          video: videoSnapshot(),
          ...playContext
        });
        await playWithTimeout();
        refs.playPause.setAttribute("aria-label", "Pausar");
        await logEvent("video.play_ok", {
          reason: `${reason}_retry_muted`,
          durationMs: nowMs() - startedAtMs,
          userInteracted: state.userInteracted,
          video: videoSnapshot(),
          ...playContext
        });
        return true;
      } catch (retryErr) {
        err = retryErr;
      }
    }

    await logEvent("video.play_error", {
      reason,
      errorClass: classifyPlayError(err),
      error: serializeError(err),
      userInteracted: state.userInteracted,
      video: videoSnapshot(),
      durationMs: nowMs() - startedAtMs,
      ...playContext
    });

    if (classifyPlayError(err) === "play_aborted_or_new_load") {
      setDiag(refs.streamDiag, "warn", "Stream interrompido por nova carga");
      return false;
    }

    setDiag(refs.streamDiag, "warn", "Toque em Ã¢â€“Â¶ para reproduzir");
    showToast("InteraÃƒÂ§ÃƒÂ£o necessÃƒÂ¡ria.", "diag: toca no botÃƒÂ£o play ou no vÃƒÂ­deo para iniciar no Android/Discord.", "warn");
    return false;
  }
}

function compareIsoTs(a, b) {
  const ta = Date.parse(a || "");
  const tb = Date.parse(b || "");
  if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
  if (!Number.isFinite(ta)) return -1;
  if (!Number.isFinite(tb)) return 1;
  return ta - tb;
}

async function logSyncDecision(decision, details = {}) {
  await logEvent("sync.remote_decision", {
    decision,
    localTs: state.activeUpdatedAt || "",
    optimisticLocalTs: state.optimisticActiveUpdatedAt || "",
    localChannelName: state.activeChannel?.name || "",
    localChannelUrl: state.activeChannel?.url || "",
    ...details
  });
}

async function fetchJson(url, options = {}, diag = {}) {
  const requestSeq = ++state.requestSeq;
  const endpoint = diag.endpoint || endpointFromUrl(url);
  const startedAtMs = nowMs();

  await logEvent("request.start", {
    requestSeq,
    endpoint,
    method: options.method || "GET",
    url: redactedUrlForLog(url),
    channelSeq: diag.channelSeq,
    pollSeq: diag.pollSeq,
    mutationId: diag.mutationId,
    reason: diag.reason
  });

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        accept: "application/json",
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    const durationMs = nowMs() - startedAtMs;

    await logEvent("request.end", {
      requestSeq,
      endpoint,
      method: options.method || "GET",
      ok: response.ok,
      status: response.status,
      durationMs,
      serverDate: response.headers.get("date") || undefined,
      channelSeq: diag.channelSeq,
      pollSeq: diag.pollSeq,
      mutationId: diag.mutationId,
      responseOkField: data?.ok,
      responseError: data?.error,
      responseSessionTs: data?.session?.activeUpdatedAt || data?.session?.updatedAt
    });

    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  } catch (err) {
    await logEvent("request.error", {
      requestSeq,
      endpoint,
      method: options.method || "GET",
      url: redactedUrlForLog(url),
      durationMs: nowMs() - startedAtMs,
      channelSeq: diag.channelSeq,
      pollSeq: diag.pollSeq,
      mutationId: diag.mutationId,
      error: serializeError(err)
    });
    throw err;
  }
}

function getClientId() {
  const meta = document.querySelector('meta[name="discord-client-id"]');
  return meta?.content?.trim() || new URLSearchParams(location.search).get("clientId") || "";
}

function getContextIdsFromUrl() {
  const params = new URLSearchParams(location.search);
  return {
    guildId: params.get("guildId") || params.get("guild_id") || "",
    voiceChannelId: params.get("voiceChannelId") || params.get("voice_channel_id") || params.get("channelId") || params.get("channel_id") || ""
  };
}

async function initDiscord() {
  const clientId = getClientId();
  const urlIds = getContextIdsFromUrl();
  state.guildId = urlIds.guildId;
  state.voiceChannelId = urlIds.voiceChannelId;

  if (!clientId || clientId === "__DISCORD_CLIENT_ID__") {
    setDiag(refs.discordDiag, "warn", "Discord SDK: sem clientId");
    showToast("Client ID em falta.", "diag: define DISCORD_CLIENT_ID no Worker ou usa ?clientId=...", "warn");
    await logEvent("sdk.ready_error", { reason: "missing_client_id" });
    return;
  }

  try {
    state.sdk = new DiscordSDK(clientId);
    await state.sdk.ready();
    state.ready = true;

    state.guildId = state.sdk.guildId || state.sdk.guild_id || state.guildId || "";
    state.voiceChannelId = state.sdk.channelId || state.sdk.channel_id || state.voiceChannelId || "";

    setDiag(refs.discordDiag, "ok", "Discord SDK: ready");
    showToast("Discord Activity pronta.", "diag: sdk.ready() concluÃƒÆ’Ã‚Â­do.");
    await logEvent("sdk.ready_ok", { hasGuildId: Boolean(state.guildId), hasVoiceChannelId: Boolean(state.voiceChannelId) });
  } catch (err) {
    setDiag(refs.discordDiag, "error", "Discord SDK: erro ready()");
    showToast("Erro no Discord SDK.", `diag: ${err?.message || "sdk.ready() falhou"}`, "error");
    await logEvent("sdk.ready_error", { message: String(err?.message || err) });
  }
}

async function loadSession() {
  await logEvent("session_fetch_start");
  setDiag(refs.sessionDiag, "warn", "SessÃƒÆ’Ã‚Â£o: a carregar");
  showToast("A carregar sessÃƒÆ’Ã‚Â£o...", "diag: a pedir /api/session.", "warn");

  const params = new URLSearchParams();
  if (state.guildId) params.set("guildId", state.guildId);
  if (state.voiceChannelId) params.set("voiceChannelId", state.voiceChannelId);

  try {
    const data = await fetchJson(`/api/session?${params.toString()}`, {}, { reason: "load_session" });
    state.session = data.session;

    const sessionUpdatedAt = data.session?.updatedAt || Date.now();
    updateTimestamp(sessionUpdatedAt);
    refs.activeChannelText.textContent = data.session?.activeChannelName || "SessÃƒÆ’Ã‚Â£o carregada";

    setDiag(refs.sessionDiag, "ok", "SessÃƒÆ’Ã‚Â£o: carregada");
    showToast("SessÃƒÆ’Ã‚Â£o carregada.", "diag: sessÃƒÆ’Ã‚Â£o encontrada no Worker.");
    await logEvent("session_fetch_ok", { hasChannelsUrl: Boolean(data.session?.channelsUrl), updatedAt: data.session?.updatedAt, source: data.session?.source });

    const channelsUrl = data.session?.channelsUrl || new URLSearchParams(location.search).get("url") || "";
    if (channelsUrl) {
      await loadChannels(channelsUrl);
    } else {
      state.channels = data.session?.channels || fallbackChannels;
      renderChannels();
      if (!state.channels.length) markEmptyChannels();
    }

    const activeUrl = data.session?.activeChannelUrl;
    if (activeUrl) {
      // Guarda timestamp para comparaÃƒÂ§ÃƒÂ£o no poll de sync
      state.activeUpdatedAt = data.session?.activeUpdatedAt || data.session?.updatedAt || new Date().toISOString();
      const idx = state.channels.findIndex((item) => item.url === activeUrl);
      selectChannel(idx >= 0 ? idx : 0, { autoplay: false, remote: true });
    }
  } catch (err) {
    setDiag(refs.sessionDiag, "error", "SessÃƒÆ’Ã‚Â£o: nÃƒÆ’Ã‚Â£o encontrada");
    showToast("SessÃƒÆ’Ã‚Â£o nÃƒÆ’Ã‚Â£o encontrada.", `diag: ${err.payload?.error || err.message}`, "error");
    await logEvent("session_fetch_error", { status: err.status, message: err.message, payload: err.payload });
    
    // Fallback: Tenta carregar a lista padrão se a sessão falhar
    const urlFromParams = new URLSearchParams(location.search).get("url");
    await loadChannels(urlFromParams || DEFAULT_M3U);
  }
}

async function loadChannels(url) {
  await logEvent("channels_fetch_start", { url });
  setDiag(refs.sessionDiag, "warn", "Canais: a carregar");

  // USAR O PROXY DO DISCORD ACTIVITY (MAPADO NO WRANGLER.TOML)
  const channelsApi = `/.proxy/channels-api/?url=${encodeURIComponent(url)}`;

  try {
    const response = await fetch(channelsApi);
    const data = await response.json();
    
    if (data.ok && data.channels) {
      if (state.channelsRetryTimer) clearTimeout(state.channelsRetryTimer);
      state.channelsRetryTimer = null;
      state.channelsRetryCount = 0;
      state.channels = data.channels || [];
      renderChannels();

      if (!state.channels.length) {
        markEmptyChannels();
        setDiag(refs.sessionDiag, "warn", "Lista vazia");
        showToast("Lista vazia.", "diag: o ficheiro .m3u/.m3u8 não devolveu canais.", "warn");
        await logEvent("channels_fetch_ok", { count: 0 });
        return;
      }

      setDiag(refs.sessionDiag, "ok", `Canais: ${state.channels.length}`);
      showToast("Lista de canais carregada.", `diag: ${state.channels.length} canais encontrados.`);
      await logEvent("channels_fetch_ok", { count: state.channels.length });
    } else {
      throw new Error(data.error || "Erro desconhecido no Worker");
    }
  } catch (err) {
    state.channels = [];
    renderChannels();
    markEmptyChannels();
    setDiag(refs.sessionDiag, "error", "Canais: erro");
    showToast("Erro ao carregar canais.", `diag: ${err.payload?.error || err.message}`, "error");
    await logEvent("channels_fetch_error", { status: err.status, message: err.message, payload: err.payload });
    if (state.channelsRetryCount < 4) {
      state.channelsRetryCount += 1;
      const delay = state.channelsRetryCount === 1 ? 1200 : 2500;
      if (state.channelsRetryTimer) clearTimeout(state.channelsRetryTimer);
      state.channelsRetryTimer = setTimeout(() => {
        void loadChannels(url);
      }, delay);
    }
  }
}

function markEmptyChannels() {
  refs.channelCount.textContent = "0 canais";
  refs.channelsList.innerHTML = `<div class="channel-item is-empty">Lista vazia</div>`;
}

function renderChannels(filter = "") {
  const normalized = filter.trim().toLowerCase();
  const visible = state.channels
    .map((channel, index) => ({ channel, index }))
    .filter(({ channel }) => (channel.name || "").toLowerCase().includes(normalized));

  refs.channelCount.textContent = `${visible.length} canais`;
  refs.channelsList.innerHTML = "";

  if (!visible.length) {
    refs.channelsList.innerHTML = `<div class="channel-item is-empty">Lista vazia</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  visible.forEach(({ channel, index }) => {
    const button = document.createElement("button");
    button.className = `channel-item${index === state.activeIndex ? " active" : ""}`;
    button.type = "button";
    button.dataset.index = String(index);
    button.innerHTML = `
      <span class="channel-number">${index + 1}</span>
      <span class="channel-name">${escapeHtml(channel.name || `Canal ${index + 1}`)}</span>
      <span class="signal" aria-hidden="true"><i></i><i></i><i></i></span>
    `;
    
    // CORREÇÃO DO CLIQUE PARA REPRODUÇÃO
    button.addEventListener("click", () => {
      markUserGesture("channel.click");
      selectChannel(index, { autoplay: true });
    });
    
    fragment.appendChild(button);
  });

  refs.channelsList.appendChild(fragment);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function setActiveChannelUI() {
  refs.channelsList.querySelectorAll(".channel-item").forEach((item) => {
    const index = Number(item.dataset.index);
    item.classList.toggle("active", index === state.activeIndex);
  });
  const label = state.activeChannel?.name || "Nenhum canal selecionado";
  refs.activeChannelText.textContent = label;
  updateTimestamp();
}

async function ensureHls() {
  if (state.hasLoadedHlsScript && window.Hls) return window.Hls;

  state.hasLoadedHlsScript = false;
  const old = document.querySelector('script[data-hls="1"]');
  if (old) old.remove();

  await loadScript(HLS_CDN_PRIMARY).catch(async () => {
    console.warn("[HLS] primary falhou, a tentar fallback...");
    await loadScript(HLS_CDN_FALLBACK);
  });

  if (!window.Hls) {
    throw new Error("hls.js carregou mas window.Hls nao esta definido");
  }

  state.hasLoadedHlsScript = true;
  return window.Hls;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.setAttribute("data-hls", "1");
    script.onload = () => {
      console.info(`[HLS] script carregado: ${src}`);
      resolve();
    };
    script.onerror = () => reject(new Error(`Falha ao carregar: ${src}`));
    document.head.appendChild(script);
  });
}

function destroyHls(context = {}) {
  void logEvent("hls.destroy_start", { ...context, hadHls: Boolean(state.hls), video: videoSnapshot() });
  const hls = state.hls;
  state.hls = null;

  if (hls) {
    try { hls.stopLoad(); } catch (err) { void logEvent("android.hls_destroy_warn", { step: "stopLoad", error: serializeError(err), ...context }); }
    try { hls.detachMedia(); } catch (err) { void logEvent("android.hls_destroy_warn", { step: "detachMedia", error: serializeError(err), ...context }); }
    try { hls.destroy(); } catch (err) { void logEvent("android.hls_destroy_warn", { step: "destroy", error: serializeError(err), ...context }); }
  }

  try { refs.streamVideo.pause(); } catch (err) { void logEvent("android.video_reset_warn", { step: "pause", error: serializeError(err), ...context }); }
  try { refs.streamVideo.removeAttribute("src"); } catch (err) { void logEvent("android.video_reset_warn", { step: "remove_src", error: serializeError(err), ...context }); }
  try { refs.streamVideo.load(); } catch (err) { void logEvent("android.video_reset_warn", { step: "load", error: serializeError(err), ...context }); }

  state.playBlockedByPolicy = false;
  state.pendingUserPlayContext = null;
  void logEvent("hls.destroy_end", { ...context, video: videoSnapshot() });
}

async function reconcileAfterConflict({ mutationId, channelSeq, localTs, reason = "update_active_409" } = {}) {
  await logEvent("sync.reconcile_start", { mutationId, channelSeq, localTs, reason });
  try {
    const params = new URLSearchParams();
    if (state.guildId) params.set("guildId", state.guildId);
    if (state.voiceChannelId) params.set("voiceChannelId", state.voiceChannelId);
    const data = await fetchJson(`/activity/session?${params.toString()}`, {}, { channelSeq, mutationId, reason: "reconcile_after_conflict" });
    const serverSession = data.session || {};
    if (serverSession.activeUpdatedAt) {
      state.activeUpdatedAt = serverSession.activeUpdatedAt;
      state.optimisticActiveUpdatedAt = null;
    }
    await logEvent("update_active.conflict_resolved", {
      mutationId,
      channelSeq,
      localTs,
      serverTs: serverSession.activeUpdatedAt || serverSession.updatedAt || "",
      serverChannelUrl: serverSession.activeChannelUrl || "",
      serverChannelName: serverSession.activeChannelName || ""
    });
    await logEvent("sync.reconcile_state", {
      mutationId,
      channelSeq,
      localTs,
      remoteUrl: serverSession.activeChannelUrl,
      remoteName: serverSession.activeChannelName,
      remoteTs: serverSession.activeUpdatedAt || serverSession.updatedAt || "",
      serverSession: {
        updatedAt: serverSession.updatedAt,
        activeUpdatedAt: serverSession.activeUpdatedAt,
        source: serverSession.source
      }
    });
  } catch (err) {
    await logEvent("sync.reconcile_error", { mutationId, channelSeq, localTs, error: serializeError(err) });
  }
}

async function selectChannel(index, { autoplay = false, remote = false } = {}) {
  const channel = state.channels[index];
  const channelSeq = ++state.channelSeq;
  const mutationId = remote ? undefined : (crypto?.randomUUID?.() || `mutation-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const correlationId = createCorrelationId("channel");
  state.activeCorrelationId = correlationId;

  await logEvent("channel.select_start", {
    index,
    channelSeq,
    mutationId,
    remote,
    autoplay,
    applyingRemoteUpdate: state.applyingRemoteUpdate,
    channelName: channel?.name,
    hasUrl: Boolean(channel?.url),
    correlationId
  });

  if (!channel) {
    await logEvent("channel.select_skip", { reason: "channel_not_found", index, channelSeq, mutationId, remote });
    return;
  }

  state.activeIndex = index;
  state.activeChannel = channel;
  setActiveChannelUI();

  if (!channel.url) {
    setDiag(refs.streamDiag, "warn", "Stream: sem URL");
    showToast("Canal selecionado.", "diag: este canal nÃƒÂ£o tem URL configurada.", "warn");
    await logEvent("channel.select_skip", { reason: "missing_channel_url", index, channelSeq, mutationId, remote, channelName: channel.name });
    return;
  }

  if (!remote && !state.applyingRemoteUpdate) {
    if (!state.guildId || !state.voiceChannelId) {
      await logEvent("update_active.skip", {
        reason: "missing_context",
        channelSeq,
        mutationId,
        hasGuildId: Boolean(state.guildId),
        hasVoiceChannelId: Boolean(state.voiceChannelId)
      });
    } else {
      const localTs = nowIso();
      state.optimisticActiveUpdatedAt = localTs;
      state.pendingLocalMutation = {
        mutationId,
        channelSeq,
        channelUrl: channel.url,
        channelName: channel.name || "",
        localTs,
        startedAtMs: nowMs()
      };

      await logEvent("update_active.start", {
        channelSeq,
        mutationId,
        localTs,
        channelName: channel.name || "",
        channelUrl: channel.url
      });

      fetchJson("/api/session/update-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId: state.guildId,
          voiceChannelId: state.voiceChannelId,
          activeChannelUrl: channel.url,
          activeChannelName: channel.name || "",
          mutationId,
          clientId: state.clientId
        })
      }, { channelSeq, mutationId, reason: "local_channel_select" })
        .then(async (data) => {
          const serverTs = data.session?.activeUpdatedAt || data.session?.updatedAt || localTs;
          state.activeUpdatedAt = serverTs;
          state.optimisticActiveUpdatedAt = null;
          if (state.pendingLocalMutation?.mutationId === mutationId) {
            state.pendingLocalMutation = null;
          }
          await logEvent("update_active.confirmed", {
            channelSeq,
            mutationId,
            localTs,
            serverTs,
            responseSession: {
              updatedAt: data.session?.updatedAt,
              activeUpdatedAt: data.session?.activeUpdatedAt,
              activeChannelName: data.session?.activeChannelName,
              activeChannelUrl: data.session?.activeChannelUrl
            }
          });
        })
        .catch(async (err) => {
          if (err.status === 409) {
            await logEvent("update_active.conflict", {
              channelSeq,
              mutationId,
              localTs,
              error: serializeError(err)
            });
            await reconcileAfterConflict({ mutationId, channelSeq, localTs, reason: "update_active_409" });
          } else {
            await logEvent("update_active.error", {
              channelSeq,
              mutationId,
              localTs,
              error: serializeError(err)
            });
          }
          if (state.pendingLocalMutation?.mutationId === mutationId) {
            state.pendingLocalMutation = null;
          }
        });
    }
  } else {
    await logEvent("update_active.skip", {
      reason: remote ? "remote_apply_no_repost" : "applying_remote_update",
      channelSeq,
      mutationId,
      remote,
      applyingRemoteUpdate: state.applyingRemoteUpdate
    });
  }

  await playChannel(channel, autoplay, { remote, channelSeq, mutationId, correlationId });
}

async function playChannel(channel, autoplay, context = {}) {
  const channelSeq = context.channelSeq || state.channelSeq;
  const playSeq = ++state.playSeq;
  const remote = Boolean(context.remote);
  const mutationId = context.mutationId;
  const correlationId = context.correlationId || state.activeCorrelationId || createCorrelationId("play");

  if (state.isLoading && channelSeq <= state.loadingChannelSeq) {
    console.log("[PLAY] ja a carregar, skip");
    return;
  }
  state.isLoading = true;
  state.loadingChannelSeq = channelSeq;

  destroyHls({ reason: "play_channel_start", channelSeq, playSeq, mutationId, remote });
  refs.playerCard.classList.remove("has-video");
  refs.videoTime.classList.add("buffering");
  setDiag(refs.streamDiag, "warn", "Stream: a carregar");

  // CAMUFLAGEM VLC TOTAL + SUPORTE STALKER
  const isStalker = channel.url.includes('/stalker_portal/') || channel.url.includes('/api/play/stalker/');
  let finalUrl = channel.url;
  
  if (isStalker) {
    finalUrl = `/.proxy/stream-proxy/resolve?url=${encodeURIComponent(channel.url)}&mac=00:1A:79:00:00:00`;
  }

  const proxyUrlObj = new URL("/.proxy/stream-proxy", location.origin);
  proxyUrlObj.searchParams.set("url", finalUrl);
  proxyUrlObj.searchParams.set("userAgent", "VLC/3.0.18 LibVLC/3.0.18");
  const proxyUrl = proxyUrlObj.pathname + proxyUrlObj.search;

  try {
    const Hls = await ensureHls();
    if (Hls.isSupported()) {
      refs.streamVideo.muted = true;
      const hlsInstance = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 60,
        manifestLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 5
      });
      state.hls = hlsInstance;
      
      hlsInstance.loadSource(proxyUrl);
      hlsInstance.attachMedia(refs.streamVideo);
      
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        state.isLoading = false;
        refs.videoTime.classList.remove("buffering");
        refs.playerCard.classList.add("has-video");
        setDiag(refs.streamDiag, "ok", "Stream: online");
        refs.streamVideo.play().catch(e => {
          console.warn("Autoplay bloqueado", e);
          setDiag(refs.streamDiag, "warn", "Clique Play para iniciar");
        });
      });

      hlsInstance.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.error("HLS Fatal Error:", data);
          setDiag(refs.streamDiag, "error", `Erro: ${data.type}`);
          state.isLoading = false;
          refs.videoTime.classList.remove("buffering");
        }
      });
    }
  } catch (err) {
    console.error("Erro ao iniciar player:", err);
    state.isLoading = false;
  }
}

async function tryPlayVideo(reason = "manual_or_native_play", context = {}) {
  const pending = state.pendingUserPlayContext || {};
  const merged = { ...pending, ...context };

  // In blocked/pending state, avoid destroy/reload race. Only attempt play now that
  // a user gesture is available.
  if ((state.playBlockedByPolicy || state.pendingUserPlayContext) && state.activeChannel?.url) {
    await logEvent("android.manual_resume_attempt_play", {
      reason,
      channelSeq: state.channelSeq,
      playSeq: state.playSeq,
      activeChannel: state.activeChannel?.name,
      hasPendingContext: Boolean(state.pendingUserPlayContext),
      video: videoSnapshot()
    });
    state.playBlockedByPolicy = false;
    state.pendingUserPlayContext = null;
    return attemptVideoPlay(reason, {
      ...merged,
      channelSeq: state.channelSeq,
      _hlsInstance: state.hls,
      correlationId: merged.correlationId || state.activeCorrelationId || createCorrelationId("manual-resume")
    });
  }

  return attemptVideoPlay(reason, merged);
}

function toggleAutoRefresh() {
  state.autoRefresh = !state.autoRefresh;
  void logEvent("auto_refresh.toggle", { enabled: state.autoRefresh });
  refs.autoRefresh.classList.toggle("is-active", state.autoRefresh);
  refs.autoRefresh.setAttribute("aria-pressed", String(state.autoRefresh));

  if (state.autoRefresh) {
    showToast("Auto refresh ligado.", "diag: sessÃƒÆ’Ã‚Â£o serÃƒÆ’Ã‚Â¡ atualizada automaticamente.");
    state.autoRefreshTimer = setInterval(loadSession, 30000);
  } else {
    showToast("Auto refresh desligado.", "diag: atualizaÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o automÃƒÆ’Ã‚Â¡tica parada.", "warn");
    clearInterval(state.autoRefreshTimer);
  }
}


// -- Sync multi-user ---------------------------------------------------------
async function pollRemoteActive() {
  const pollSeq = ++state.pollSeq;
  const startedAtMs = nowMs();
  const deltaMs = state.lastPollStartedAtMs ? startedAtMs - state.lastPollStartedAtMs : null;
  state.lastPollStartedAtMs = startedAtMs;

  await logEvent("sync.poll_start", {
    pollSeq,
    expectedIntervalMs: SYNC_INTERVAL_MS,
    deltaMs,
    inFlightBeforeStart: state.syncPollRunning,
    pendingLocalMutation: state.pendingLocalMutation
  });

  if (state.syncPollRunning) {
    await logSyncDecision("skip", { reason: "previous_poll_in_flight", pollSeq, deltaMs });
    return;
  }

  state.syncPollRunning = true;

  try {
    if (!state.guildId || !state.voiceChannelId) {
      await logSyncDecision("skip", {
        reason: "missing_context",
        pollSeq,
        hasGuildId: Boolean(state.guildId),
        hasVoiceChannelId: Boolean(state.voiceChannelId)
      });
      return;
    }

    if (state.applyingRemoteUpdate) {
      await logSyncDecision("skip", { reason: "applying_remote_update", pollSeq });
      return;
    }

    if (state.pendingLocalMutation) {
      const pendingAgeMs = nowMs() - state.pendingLocalMutation.startedAtMs;
      if (pendingAgeMs < SYNC_PENDING_LOCAL_GRACE_MS) {
        await logSyncDecision("skip", {
          reason: "sync.skip local_mutation_pending",
          pollSeq,
          pendingAgeMs,
          pendingMutation: state.pendingLocalMutation
        });
        return;
      }
      await logSyncDecision("skip", {
        reason: "local_mutation_pending_expired",
        pollSeq,
        pendingAgeMs,
        pendingMutation: state.pendingLocalMutation
      });
      await reconcileAfterConflict({
        mutationId: state.pendingLocalMutation.mutationId,
        channelSeq: state.pendingLocalMutation.channelSeq,
        localTs: state.pendingLocalMutation.localTs,
        reason: "local_mutation_pending_expired"
      });
      state.pendingLocalMutation = null;
    }

    const params = new URLSearchParams({
      guildId: state.guildId,
      voiceChannelId: state.voiceChannelId
    });
    const data = await fetchJson(`/activity/session?${params}`, {}, { pollSeq, reason: "sync_poll" });
    const remoteUrl = data.session?.activeChannelUrl;
    const remoteName = data.session?.activeChannelName;
    const remoteTs = data.session?.activeUpdatedAt || data.session?.updatedAt || "";
    const cmp = compareIsoTs(remoteTs, state.activeUpdatedAt);

    if (!remoteUrl) {
      await logSyncDecision("skip", { reason: "no_remote_url", pollSeq, remoteTs, remoteName });
      return;
    }

    if (remoteTs && cmp <= 0) {
      await logSyncDecision("skip", {
        reason: "remote_not_newer",
        pollSeq,
        remoteTs,
        remoteName,
        remoteUrl,
        cmp
      });
      return;
    }

    if (remoteUrl === state.activeChannel?.url) {
      state.activeUpdatedAt = remoteTs;
      state.optimisticActiveUpdatedAt = null;
      await logSyncDecision("skip", {
        reason: "same_channel",
        pollSeq,
        remoteTs,
        remoteName,
        remoteUrl,
        cmp
      });
      return;
    }

    const idx = state.channels.findIndex(c => c.url === remoteUrl);
    if (idx < 0) {
      await logSyncDecision("skip", {
        reason: "channel_not_found",
        pollSeq,
        remoteTs,
        remoteName,
        remoteUrl,
        cmp,
        channelCount: state.channels.length
      });
      return;
    }

    await logSyncDecision("apply", {
      reason: "remote_newer_different_channel",
      pollSeq,
      remoteTs,
      remoteName,
      remoteUrl,
      cmp,
      targetIndex: idx,
      targetName: state.channels[idx]?.name || ""
    });

    state.applyingRemoteUpdate = true;
    state.activeUpdatedAt = remoteTs;
    state.optimisticActiveUpdatedAt = null;
    try {
      await selectChannel(idx, { autoplay: true, remote: true });
    } finally {
      state.applyingRemoteUpdate = false;
    }
  } catch (err) {
    await logSyncDecision("skip", { reason: "poll_error", pollSeq, error: serializeError(err) });
  } finally {
    state.syncPollRunning = false;
    await logEvent("sync.poll_end", {
      pollSeq,
      durationMs: nowMs() - startedAtMs,
      expectedIntervalMs: SYNC_INTERVAL_MS
    });
  }
}

function scheduleNextSync(delayMs = SYNC_INTERVAL_MS) {
  if (state.syncStopped) return;
  clearTimeout(state.syncTimer);
  state.syncTimer = setTimeout(async () => {
    await pollRemoteActive();
    scheduleNextSync(SYNC_INTERVAL_MS);
  }, delayMs);
}

function startSync() {
  if (state.syncTimer && !state.syncStopped) return;
  state.syncStopped = false;
  console.log("[SYNC] watcher iniciado, intervalo:", SYNC_INTERVAL_MS, "ms");
  void logEvent("sync.start", { intervalMs: SYNC_INTERVAL_MS });
  scheduleNextSync(0);
}

function stopSync() {
  if (state.syncTimer) {
    clearTimeout(state.syncTimer);
    state.syncTimer = null;
  }
  state.syncStopped = true;
  console.log("[SYNC] watcher parado");
  void logEvent("sync.stop");
}
// --------------------------------------------------------------------------

function wireRuntimeLifecycleLogs() {
  ["visibilitychange", "pagehide", "pageshow", "freeze", "resume", "blur", "focus", "online", "offline"].forEach((eventName) => {
    const target = ["blur", "focus", "online", "offline"].includes(eventName) ? window : document;
    target.addEventListener(eventName, (event) => {
      logEvent("runtime.lifecycle", {
        eventName,
        persisted: event?.persisted,
        video: videoSnapshot(),
        pendingLocalMutation: state.pendingLocalMutation
      });
    });
  });
}

function wireVideoDiagnostics() {
  const videoEvents = [
    "loadstart", "durationchange", "loadedmetadata", "loadeddata", "progress",
    "canplay", "canplaythrough", "play", "playing", "pause", "waiting",
    "stalled", "suspend", "abort", "emptied", "error", "ended", "seeking",
    "seeked", "volumechange", "ratechange"
  ];

  videoEvents.forEach((eventName) => {
    refs.streamVideo?.addEventListener(eventName, () => {
      logEvent("video.event", {
        eventName,
        channelSeq: state.channelSeq,
        playSeq: state.playSeq,
        video: videoSnapshot(),
        mediaError: refs.streamVideo?.error ? {
          code: refs.streamVideo.error.code,
          message: refs.streamVideo.error.message
        } : undefined
      });
    });
  });
}

function wireEvents() {
  console.log("[BOOT] wireEvents start");
  wireRuntimeLifecycleLogs();
  wireVideoDiagnostics();
  void logEvent("boot.wire_events_start");
  const on = (el, event, fn, label) => {
    if (!el) {
      console.warn(`[BOOT] ref nula, skip: ${label || event}`);
      return;
    }
    el.addEventListener(event, fn);
  };

  document.addEventListener("pointerdown", () => {
    state.userInteracted = true;
    logEvent("user.interaction", { type: "pointerdown", once: true, video: videoSnapshot() });
  }, { once: true });

  on(refs.closeToast, "click", () => refs.toast.classList.add("is-hidden"), "closeToast.click");
  on(refs.loadSession, "click", () => {
    state.userInteracted = true;
    logEvent("ui.click", { target: "loadSession" });
    loadSession();
  }, "loadSession.click");
  on(refs.autoRefresh, "click", () => {
    logEvent("ui.click", { target: "autoRefresh", before: state.autoRefresh });
    toggleAutoRefresh();
  }, "autoRefresh.click");

  on(refs.channelSearch, "input", (event) => renderChannels(event.target.value), "channelSearch.input");

  on(refs.playPause, "click", () => {
    markUserGesture("playPause.click");
    logEvent("ui.click", { target: "playPause", pausedBefore: refs.streamVideo.paused, video: videoSnapshot() });
    if (refs.streamVideo.paused) {
      tryPlayVideo("manual_play_button", { channelSeq: state.channelSeq, playSeq: state.playSeq });
    }
    else refs.streamVideo.pause();
  }, "playPause.click");

  on(refs.streamVideo, "click", () => {
    markUserGesture("video.click");
    if (refs.streamVideo.paused || state.playBlockedByPolicy || state.pendingUserPlayContext) {
      tryPlayVideo("manual_video_tap", { channelSeq: state.channelSeq, playSeq: state.playSeq });
    }
  }, "streamVideo.click");

  on(refs.streamVideo, "touchend", () => {
    markUserGesture("video.touchend");
    if (refs.streamVideo.paused || state.playBlockedByPolicy || state.pendingUserPlayContext) {
      tryPlayVideo("manual_video_touch", { channelSeq: state.channelSeq, playSeq: state.playSeq });
    }
  }, "streamVideo.touchend");

  on(refs.streamVideo, "timeupdate", () => {
    const current = refs.streamVideo.currentTime || 0;
    refs.videoTime.textContent = `${Math.floor(current / 60)}:${String(Math.floor(current % 60)).padStart(2, "0")}`;
    if (refs.streamVideo.duration && Number.isFinite(refs.streamVideo.duration)) {
      refs.progressBar.style.width = `${Math.min(100, (current / refs.streamVideo.duration) * 100)}%`;
    }
  }, "streamVideo.timeupdate");

  // --- Volume ---
  function syncVolumeUI() {
    const muted = refs.streamVideo.muted || refs.streamVideo.volume === 0;
    refs.muteButton.classList.toggle("is-muted", muted);
    if (refs.volumeSlider) refs.volumeSlider.value = muted ? 0 : refs.streamVideo.volume;
  }

  on(refs.muteButton, "click", () => {
    refs.streamVideo.muted = !refs.streamVideo.muted;
    if (!refs.streamVideo.muted && refs.streamVideo.volume === 0) refs.streamVideo.volume = 0.5;
    syncVolumeUI();
  }, "muteButton.click");

  on(refs.volumeSlider, "input", () => {
    const v = parseFloat(refs.volumeSlider.value);
    refs.streamVideo.volume = v;
    refs.streamVideo.muted = v === 0;
    syncVolumeUI();
  }, "volumeSlider.input");

  on(refs.volDown, "click", () => {
    const v = Math.max(0, Math.round((refs.streamVideo.volume - 0.1) * 100) / 100);
    refs.streamVideo.volume = v;
    refs.streamVideo.muted = v === 0;
    syncVolumeUI();
  }, "volDown.click");

  on(refs.volUp, "click", () => {
    const v = Math.min(1, Math.round((refs.streamVideo.volume + 0.1) * 100) / 100);
    refs.streamVideo.volume = v;
    refs.streamVideo.muted = false;
    syncVolumeUI();
  }, "volUp.click");

  // --- Fullscreen ---
  async function requestFullscreen() {
    // Tentativas por ordem: vÃƒÂ­deo Ã¢â€ â€™ card Ã¢â€ â€™ body
    const targets = [refs.streamVideo, refs.playerCard, document.documentElement];
    const methods = ["requestFullscreen", "webkitRequestFullscreen", "mozRequestFullScreen", "msRequestFullscreen"];
    for (const el of targets) {
      if (!el) continue;
      for (const m of methods) {
        if (typeof el[m] === "function") {
          try {
            await el[m]();
            return true;
          } catch (_) {}
        }
      }
    }
    return false;
  }

  on(refs.fullscreenButton, "click", async () => {
    const ok = await requestFullscreen();
    if (!ok) {
      // Discord iframe bloqueia fullscreen Ã¢â‚¬â€ feedback claro ao utilizador
      setDiag(refs.streamDiag, "warn", "EcrÃƒÂ£ inteiro indisponÃƒÂ­vel no Discord");
      showToast("Fullscreen bloqueado.", "diag: o Discord nÃƒÂ£o permite ecrÃƒÂ£ inteiro em Activities. Usa o botÃƒÂ£o de pop-out do Discord.", "warn");
      void logEvent("android.fullscreen_blocked", { androidRuntime: state.androidRuntime, video: videoSnapshot() });
      logEvent("fullscreen.error", { reason: "request_fullscreen_failed" });
    }
  }, "fullscreenButton.click");
  void logEvent("boot.wire_events_end");
  console.log("[BOOT] wireEvents end");
}

async function boot() {
  try {
    // Forced ping to verify the Discord runtime is on this exact build.
    fetch("/activity/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "boot.force_ping", build: BUILD, ts: Date.now() })
    }).catch(() => {});

    state.clientId = getPersistentDiagnosticClientId();
    console.log("[BOOT] start", { build: BUILD, clientId: state.clientId });
    await logEvent("boot.start", {
      href: location.href,
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });
    refs.buildLabel.textContent = BUILD;
    updateTimestamp();
    console.log("[BOOT] refs", {
      loadSession: !!refs.loadSession,
      playPause: !!refs.playPause,
      muteButton: !!refs.muteButton,
      fullscreenButton: !!refs.fullscreenButton,
      streamVideo: !!refs.streamVideo
    });
    wireEvents();
    renderChannels();
    await initDiscord();
    await loadSession();
    // Inicia watcher de sync multi-user (sÃƒÂ³ se temos guild+voiceChannel)
    if (state.guildId && state.voiceChannelId) {
      startSync();
      console.log("[BOOT] sync activo para guild:", state.guildId, "channel:", state.voiceChannelId);
    } else {
      console.log("[BOOT] sync desactivado (sem guildId/voiceChannelId)");
    }
    await logEvent("boot.done", { ready: state.ready, hasGuildId: Boolean(state.guildId), hasVoiceChannelId: Boolean(state.voiceChannelId) });
    console.log("[BOOT] done");
  } catch (e) {
    await logEvent("boot.error", { error: serializeError(e) });
    console.error("[BOOT] falhou:", e);
    const msg = document.getElementById("error-message") || document.body;
    msg.innerHTML += `<p style="color:red;padding:1rem">Boot error: ${String(e?.message || e)}</p>`;
  }
}

boot();





