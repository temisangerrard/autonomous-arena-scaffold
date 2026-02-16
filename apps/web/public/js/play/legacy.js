import { THREE, installResizeHandler, loadWorldWithProgress, makeCamera, makeRenderer, makeScene } from '../world-common.js';
import { getDom } from './dom.js';
import { WORLD_BOUND, createInitialState } from './state.js';
import { createToaster } from './ui/toast.js';
import { createAnnouncer } from './ui/sr.js';
import { initOnboarding } from './ui/onboarding.js';
import { AVATAR_GROUND_OFFSET, animateAvatar, createAvatarSystem } from './avatars.js';
import { createStationSystem } from './stations.js';
import { createInputSystem } from './input.js';
import { initMenu } from './menu.js';
import { createPresence } from './ws.js';
import { createCameraController } from './camera.js';
import { createMovementSystem } from './movement.js';

const dom = getDom();
const queryParams = new URL(window.location.href).searchParams;
const SID_KEY = 'arena_sid_fallback';

function buildSessionHeaders(existingHeaders) {
  const headers = new Headers(existingHeaders || {});
  const sid = String(localStorage.getItem(SID_KEY) || '').trim();
  if (sid) {
    headers.set('x-arena-sid', sid);
  }
  return headers;
}

async function apiJson(path, init = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: buildSessionHeaders(init.headers)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(String(payload?.reason || `http_${response.status}`));
  }
  return payload;
}

function showResultSplash(text, tone = 'neutral') {
  const el = document.createElement('div');
  const palette = tone === 'win'
    ? { bg: 'rgba(14, 49, 31, 0.95)', border: 'rgba(54, 209, 134, 0.9)', fg: '#d7ffe8' }
    : tone === 'loss'
      ? { bg: 'rgba(57, 20, 25, 0.95)', border: 'rgba(244, 93, 113, 0.9)', fg: '#ffd7dc' }
      : { bg: 'rgba(37, 31, 18, 0.95)', border: 'rgba(228, 188, 92, 0.9)', fg: '#fff3cc' };
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    top: '18%',
    transform: 'translate(-50%, -50%) scale(0.95)',
    zIndex: '1200',
    minWidth: '340px',
    maxWidth: '88vw',
    padding: '14px 18px',
    borderRadius: '14px',
    border: `2px solid ${palette.border}`,
    background: palette.bg,
    color: palette.fg,
    fontFamily: '"Cormorant Garamond", serif',
    fontSize: '26px',
    fontWeight: '700',
    textAlign: 'center',
    whiteSpace: 'pre-line',
    boxShadow: '0 16px 40px rgba(0,0,0,0.36)',
    opacity: '0',
    transition: 'opacity 180ms ease, transform 180ms ease'
  });
  el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%, -50%) scale(1)';
  });
  window.setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%, -50%) scale(0.96)';
    window.setTimeout(() => el.remove(), 220);
  }, 2100);
}

async function refreshWalletBalanceAndShowDelta(beforeBalance, challenge = null) {
  try {
    const summary = await apiJson('/api/player/wallet/summary');
    const after = Number(summary?.wallet?.balance ?? summary?.balance ?? state.walletBalance ?? 0);
    if (Number.isFinite(after)) {
      state.walletBalance = after;
    }
    if (challenge) {
      const delta = Number((after - Number(beforeBalance || 0)).toFixed(2));
      const won = challenge.winnerId === state.playerId;
      const lost = Boolean(challenge.winnerId && challenge.winnerId !== state.playerId);
      const toss = challenge.gameType === 'coinflip' && challenge.coinflipResult
        ? `\nTOSS: ${String(challenge.coinflipResult).toUpperCase()}`
        : '';
      if (won) {
        showResultSplash(`YOU WIN${toss}\n+${Math.abs(delta).toFixed(2)}`, 'win');
      } else if (lost) {
        showResultSplash(`YOU LOSE${toss}\n-${Math.abs(delta).toFixed(2)}`, 'loss');
      } else {
        showResultSplash(`DRAW${toss}\n${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`, 'neutral');
      }
    }
  } catch {
    // keep local value if summary endpoint is temporarily unavailable
  }
}

const { showToast } = createToaster(dom.toastContainer);
const { announce } = createAnnouncer(dom.srAnnouncer);
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initOnboarding(dom, { showToast, announce }));
} else {
  initOnboarding(dom, { showToast, announce });
}

const {
  canvas,
  hud,
  topbarName,
  topbarWallet,
  topbarStreak,
  feedPanel,
  challengeStatusLine,
  worldMapCanvas,
  mapCoords,
  interactionPrompt,
  interactionCard,
  interactionTitle,
  interactionClose,
  stationUi,
  interactionNpcInfo,
  quickstartPanel,
  quickstartList,
  quickstartClose,
  worldLoading,
  worldLoadingBar,
  worldLoadingText,
  mobileControls,
  mobileInteract,
  mobileMoves,
  mobileMoveH,
  mobileMoveT
} = dom;


const renderer = makeRenderer(canvas);
const scene = makeScene();
const camera = makeCamera();
installResizeHandler(camera, renderer);

const matchSpotlight = new THREE.Mesh(
  new THREE.RingGeometry(2.4, 3.2, 40),
  new THREE.MeshStandardMaterial({
    color: 0xd7b24d,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    emissive: 0x5a3f08,
    emissiveIntensity: 0.5
  })
);
matchSpotlight.rotation.x = -Math.PI / 2;
matchSpotlight.position.y = 0.04;
matchSpotlight.visible = false;
scene.add(matchSpotlight);

const targetSpotlight = new THREE.Mesh(
  new THREE.RingGeometry(1.6, 2.2, 34),
  new THREE.MeshStandardMaterial({
    color: 0xf2d27a,
    transparent: true,
    opacity: 0.62,
    side: THREE.DoubleSide,
    emissive: 0x6a4a10,
    emissiveIntensity: 0.55
  })
);
targetSpotlight.rotation.x = -Math.PI / 2;
targetSpotlight.position.y = 0.03;
targetSpotlight.visible = false;
scene.add(targetSpotlight);

const { localAvatarParts, remoteAvatars, syncRemoteAvatars } = createAvatarSystem({ THREE, scene });
const { syncStations } = createStationSystem({ THREE, scene });

const state = createInitialState();
if (!(state.stations instanceof Map)) {
  state.stations = new Map();
}
if (!(state.nearbyStationIds instanceof Set)) {
  state.nearbyStationIds = new Set();
}
initMenu(dom, { queryParams });

const presence = createPresence({ queryParams });
presence.installOfflineBeacon();

const cameraController = createCameraController({ THREE, camera, state });

quickstartClose?.addEventListener('click', () => {
  state.quickstart.dismissed = true;
  if (quickstartPanel) {
    quickstartPanel.style.display = 'none';
  }
});

// Netlify cannot reliably proxy WebSockets and doesn't ship large GLBs.
// Pull infra settings from `/api/config` (proxied to the web-api on Cloud Run).
let arenaConfigPromise = null;
async function loadArenaConfig() {
  if (arenaConfigPromise) return arenaConfigPromise;
  arenaConfigPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 3500);
      const cfgRes = await fetch('/api/config', {
        credentials: 'include',
        headers: buildSessionHeaders(),
        signal: controller.signal
      });
      window.clearTimeout(timeout);
      if (!cfgRes.ok) return null;
      const cfg = await cfgRes.json();
      if (cfg && typeof cfg === 'object') {
        window.__ARENA_CONFIG = cfg;
        // Merge into runtime-config.js (Netlify env driven) so we get
        // `worldAssetBaseUrl` + `gameWsUrl` without losing origin settings.
        window.ARENA_CONFIG = {
          ...(window.ARENA_CONFIG || {}),
          ...cfg
        };
      }
      return cfg;
    } catch {
      return null;
    }
  })();
  return arenaConfigPromise;
}

async function resolveWsBaseUrl() {
  const explicit = queryParams.get('ws');
  if (explicit) return explicit;
  const cfg = await loadArenaConfig();
  if (cfg?.gameWsUrl) return String(cfg.gameWsUrl);

  const wsPath = (window.ARENA_CONFIG && window.ARENA_CONFIG.gameWsPath)
    ? String(window.ARENA_CONFIG.gameWsPath)
    : '/ws';

  const serverOrigin = window.ARENA_CONFIG?.serverOrigin || '';
  if (serverOrigin) {
    const origin = String(serverOrigin);
    const wsOrigin = origin.startsWith('https://')
      ? `wss://${origin.slice('https://'.length)}`
      : origin.startsWith('http://')
        ? `ws://${origin.slice('http://'.length)}`
        : origin;
    return `${wsOrigin}${wsPath.startsWith('/') ? wsPath : `/${wsPath}`}`;
  }

  const sameOrigin = window.location.protocol === 'https:'
    ? `wss://${window.location.host}${wsPath}`
    : `ws://${window.location.host}${wsPath}`;
  return sameOrigin;
}

let socket = null;
const socketRef = { current: null };
let presenceTimer = null;
let connectRetryTimer = null;
let connectFailureCount = 0;
let interactionStationRenderKey = '';

function formatWagerLabel(wager) {
  const value = Number(wager || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return 'Free';
  }
  return `Wager ${value}`;
}

function formatWagerInline(wager) {
  const value = Number(wager || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return 'free';
  }
  return `wager ${value}`;
}

function scheduleConnectRetry(message) {
  if (connectRetryTimer) {
    return;
  }
  connectFailureCount += 1;
  const delayMs = Math.min(15_000, 600 + Math.pow(2, Math.min(5, connectFailureCount)) * 250);
  state.challengeStatus = 'none';
  state.challengeMessage = message
    ? `${message} Retrying in ${(delayMs / 1000).toFixed(1)}s...`
    : `Retrying in ${(delayMs / 1000).toFixed(1)}s...`;
  connectRetryTimer = window.setTimeout(() => {
    connectRetryTimer = null;
    void connectSocket();
  }, delayMs);
}

async function connectSocket() {
  const wsUrlObj = new URL(await resolveWsBaseUrl());
  let sessionName = '';
  let sessionWalletId = '';
  let sessionClientId = '';
  let sessionWsAuth = '';

  // Do not block boot on auth endpoints during test harness runs.
  const skipProfileFetch = queryParams.get('test') === '1';
  if (!skipProfileFetch) {
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 3500);
      const meResponse = await fetch('/api/player/me', {
        credentials: 'include',
        headers: buildSessionHeaders(),
        signal: controller.signal
      });
      window.clearTimeout(timeout);
      if (meResponse.status === 401 || meResponse.status === 403 || meResponse.status === 404) {
        // Hard gate: no unauthenticated play access (even if static hosting bypasses /play routing).
        localStorage.removeItem('arena_last_name');
        window.location.href = '/welcome';
        return;
      }
      if (!meResponse.ok) {
        scheduleConnectRetry(`Auth backend returned ${meResponse.status}.`);
        return;
      }
      const mePayload = await meResponse.json();
      const profile = mePayload?.profile;
      if (profile?.displayName) {
        sessionName = String(profile.displayName);
      }
      if (profile?.wallet?.id || profile?.walletId) {
        sessionWalletId = String(profile.wallet?.id || profile.walletId);
      }
      if (profile?.id) {
        sessionClientId = String(profile.id);
      }
      if (mePayload?.wsAuth) {
        sessionWsAuth = String(mePayload.wsAuth);
      }
      if (mePayload?.sessionId) {
        const sid = String(mePayload.sessionId).trim();
        if (sid) {
          localStorage.setItem(SID_KEY, sid);
        }
      }
      state.walletBalance = Number(profile?.wallet?.balance ?? 0);
    } catch {
      // If auth is flaky, do not sign the user out; retry.
      scheduleConnectRetry('Auth backend unavailable.');
      return;
    }
  } else {
    sessionName = queryParams.get('name') || localStorage.getItem('arena_last_name') || '';
    sessionWalletId = queryParams.get('walletId') || localStorage.getItem('arena_wallet_id') || '';
    sessionClientId = queryParams.get('clientId') || localStorage.getItem('arena_client_id') || '';
    sessionWsAuth = queryParams.get('wsAuth') || '';
  }

  if (sessionName) {
    wsUrlObj.searchParams.set('name', sessionName);
    localStorage.setItem('arena_last_name', sessionName);
  }
  if (sessionWalletId) {
    wsUrlObj.searchParams.set('walletId', sessionWalletId);
  }
  if (sessionClientId) {
    wsUrlObj.searchParams.set('clientId', sessionClientId);
  }
  if (sessionWsAuth) {
    wsUrlObj.searchParams.set('wsAuth', sessionWsAuth);
  }
  // Fallback for cross-origin ws where browser may not send Netlify cookie.
  const sid = String(localStorage.getItem(SID_KEY) || '').trim();
  if (sid) {
    wsUrlObj.searchParams.set('sid', sid);
  }

  const wsUrl = wsUrlObj.toString();
  socket = new WebSocket(wsUrl);
  socketRef.current = socket;

  socket.addEventListener('open', () => {
    state.wsConnected = true;
    connectFailureCount = 0;
    addFeedEvent('system', 'Connected to game server.');
    void presence.setPresence('online');
    if (presenceTimer) {
      window.clearInterval(presenceTimer);
    }
    presenceTimer = window.setInterval(() => {
      void presence.setPresence('online');
    }, 25_000);
  });

  socket.addEventListener('close', () => {
    state.wsConnected = false;
    addFeedEvent('system', 'Disconnected from game server.');
    if (presenceTimer) {
      window.clearInterval(presenceTimer);
      presenceTimer = null;
    }
  });

  socket.addEventListener('message', (event) => {
  const payload = JSON.parse(event.data);

  if (payload.type === 'welcome') {
    state.playerId = payload.playerId;
    localAvatarParts.setName(`You (${payload.displayName || payload.playerId})`);
    if (payload.displayName) {
      localStorage.setItem('arena_last_name', payload.displayName);
    }
    return;
  }

  if (payload.type === 'snapshot') {
    state.tick = payload.tick;
    const seen = new Set();

    for (const player of payload.players) {
      seen.add(player.id);
      const existing = state.players.get(player.id);
      if (!existing) {
        state.players.set(player.id, {
          id: player.id,
          x: player.x,
          y: player.y,
          z: player.z,
          yaw: player.yaw,
          speed: player.speed,
          role: player.role ?? 'human',
          displayName: player.displayName ?? player.id,
          displayX: player.x,
          displayY: player.y,
          displayZ: player.z,
          displayYaw: player.yaw
        });
      } else {
        existing.x = player.x;
        existing.y = player.y;
        existing.z = player.z;
        existing.yaw = player.yaw;
        existing.speed = player.speed;
        existing.role = player.role ?? 'human';
        existing.displayName = player.displayName ?? player.id;
      }
    }

    const stationSeen = new Set();
    if (Array.isArray(payload.stations)) {
      for (const station of payload.stations) {
        if (!station || typeof station.id !== 'string') continue;
        stationSeen.add(station.id);
        state.stations.set(station.id, {
          id: station.id,
          kind: String(station.kind || ''),
          displayName: String(station.displayName || station.id),
          x: Number(station.x || 0),
          z: Number(station.z || 0),
          yaw: Number(station.yaw || 0),
          actions: Array.isArray(station.actions) ? station.actions.map((a) => String(a)) : []
        });
      }
    }
    for (const id of [...state.stations.keys()]) {
      if (!stationSeen.has(id)) {
        state.stations.delete(id);
      }
    }

    for (const id of [...state.players.keys()]) {
      if (!seen.has(id)) {
        state.players.delete(id);
        const remote = remoteAvatars.get(id);
        if (remote) {
          scene.remove(remote.avatar);
          remoteAvatars.delete(id);
        }
      }
    }

    updateRpsVisibility();
    return;
  }

  if (payload.type === 'proximity' && typeof payload.otherId === 'string') {
    if (payload.event === 'enter') {
      state.nearbyIds.add(payload.otherId);
      if (typeof payload.otherName === 'string') {
        state.nearbyNames.set(payload.otherId, payload.otherName);
      }
      if (typeof payload.distance === 'number') {
        state.nearbyDistances.set(payload.otherId, payload.distance);
      }
      addFeedEvent('proximity', `${payload.otherName || payload.otherId} entered range.`);
    }
    if (payload.event === 'exit') {
      state.nearbyIds.delete(payload.otherId);
      state.nearbyNames.delete(payload.otherId);
      state.nearbyDistances.delete(payload.otherId);
      addFeedEvent('proximity', `${payload.otherName || payload.otherId} left range.`);
    }
    return;
  }

  if (payload.type === 'station_ui' && typeof payload.stationId === 'string') {
    const view = payload.view || {};
    const ok = Boolean(view.ok);
    const reason = String(view.reason || '');
    const reasonCode = String(view.reasonCode || '');
    const reasonText = String(view.reasonText || '');
    const preflight = view.preflight && typeof view.preflight === 'object'
      ? {
          playerOk: Boolean(view.preflight.playerOk),
          houseOk: Boolean(view.preflight.houseOk)
        }
      : null;
    const stateName = String(view.state || '');
    if (!ok || stateName === 'dealer_error') {
      state.ui.dealer.state = 'error';
      state.ui.dealer.reason = reason || 'request_failed';
      state.ui.dealer.reasonCode = reasonCode;
      state.ui.dealer.reasonText = reasonText;
      state.ui.dealer.preflight = preflight;
      addFeedEvent(
        'system',
        `Station ${labelFor(payload.stationId)}: ${reasonText || reason || 'request_failed'}${reasonCode ? ` [${reasonCode}]` : ''}`
      );
      showToast(reasonText || `Station error: ${reason || 'request_failed'}`);
      return;
    }
    if (stateName === 'dealer_ready') {
      state.quickstart.challengeSent = true;
      state.ui.dealer.stationId = payload.stationId;
      state.ui.dealer.state = 'ready';
      state.ui.dealer.reason = '';
      state.ui.dealer.reasonCode = '';
      state.ui.dealer.reasonText = '';
      state.ui.dealer.preflight = { playerOk: true, houseOk: true };
      state.ui.dealer.wager = Number(view.wager ?? state.ui.dealer.wager ?? 1);
      state.ui.dealer.commitHash = String(view.commitHash || '');
      state.ui.dealer.method = String(view.method || '');
      return;
    }
    if (stateName === 'dealer_dealing') {
      state.quickstart.matchActive = true;
      state.ui.dealer.state = 'dealing';
      return;
    }
    if (stateName === 'dealer_reveal') {
      state.quickstart.matchResolved = true;
      state.ui.dealer.state = 'reveal';
      state.ui.dealer.reason = '';
      state.ui.dealer.reasonCode = '';
      state.ui.dealer.reasonText = '';
      state.ui.dealer.challengeId = String(view.challengeId || '');
      state.ui.dealer.playerPick = String(view.playerPick || '');
      state.ui.dealer.coinflipResult = String(view.coinflipResult || '');
      state.ui.dealer.payoutDelta = Number(view.payoutDelta || 0);
      state.ui.dealer.escrowTx = view.escrowTx || null;
      const winnerId = String(view.winnerId || '');
      const won = winnerId && winnerId === state.playerId;
      const tone = won ? 'win' : (winnerId ? 'loss' : 'neutral');
      const title = won ? 'YOU WIN' : (winnerId ? 'YOU LOSE' : 'DRAW');
      const tossLine = state.ui.dealer.coinflipResult ? `\nTOSS: ${state.ui.dealer.coinflipResult.toUpperCase()}` : '';
      const delta = state.ui.dealer.payoutDelta;
      showResultSplash(`${title}${tossLine}\n${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`, tone);
      void refreshWalletBalanceAndShowDelta(state.walletBalance, null);
      return;
    }
    return;
  }

  if (payload.type === 'provably_fair' && typeof payload.challengeId === 'string') {
    const phase = String(payload.phase || '');
    if (phase === 'commit') {
      addFeedEvent('system', `Provably fair commit for ${payload.challengeId}: ${String(payload.commitHash || '').slice(0, 10)}...`);
      return;
    }
    if (phase === 'reveal') {
      addFeedEvent('system', `Provably fair reveal for ${payload.challengeId}: seed=${String(payload.houseSeed || '').slice(0, 10)}...`);
      return;
    }
    return;
  }

  if (payload.type === 'challenge') {
    const challenge = payload.challenge || null;
    if (challenge && state.playerId) {
      const involvesMe =
        challenge.challengerId === state.playerId || challenge.opponentId === state.playerId;
      const activeId = state.activeChallenge?.id || '';
      const incomingId = state.incomingChallengeId || '';
      const outgoingId = state.outgoingChallengeId || '';
      const isKnown =
        challenge.id === activeId || challenge.id === incomingId || challenge.id === outgoingId;
      if (!involvesMe && !isKnown) {
        return;
      }
    }
    handleChallenge(payload);
    return;
  }

  if (payload.type === 'challenge_feed' && payload.event) {
    const challenge = payload.challenge || null;
    if (challenge && state.playerId) {
      const involvesMe =
        challenge.challengerId === state.playerId || challenge.opponentId === state.playerId;
      if (!involvesMe) {
        return;
      }
    }
    const line = payload.challenge
      ? `${payload.event} ${payload.challenge.gameType} ${labelFor(payload.challenge.challengerId)} vs ${labelFor(payload.challenge.opponentId)}${payload.challenge.winnerId ? ` winner=${labelFor(payload.challenge.winnerId)}` : ''}`
      : `${payload.event}${payload.reason ? ` (${payload.reason})` : ''}`;
    addFeedEvent('match', line);
    return;
  }

  if (payload.type === 'challenge_escrow' && typeof payload.challengeId === 'string') {
    const activeId = state.activeChallenge?.id || '';
    const incomingId = state.incomingChallengeId || '';
    const outgoingId = state.outgoingChallengeId || '';
    if (payload.challengeId !== activeId && payload.challengeId !== incomingId && payload.challengeId !== outgoingId) {
      return;
    }
    const phase = String(payload.phase || 'escrow');
    const ok = payload.ok !== false;
    const tx = typeof payload.txHash === 'string' ? payload.txHash : '';
    const phaseLabel =
      phase === 'lock' ? 'Stake lock' : phase === 'resolve' ? 'Payout' : phase === 'refund' ? 'Refund' : 'Escrow';
    const statusLabel = ok ? (phase === 'resolve' ? 'cleared' : 'sealed') : 'stalled';
    const payout =
      typeof payload.payout === 'number' ? ` payout=${Number(payload.payout).toFixed(2)}` : '';
    const fee =
      typeof payload.fee === 'number' ? ` fee=${Number(payload.fee).toFixed(2)}` : '';
    const reason = payload.reason ? ` (${payload.reason})` : '';
    addFeedEvent('escrow', `${phaseLabel} ${statusLabel}${payout}${fee}${reason}`, {
      txHash: tx || null,
      phase,
      ok
    });
    if (!ok && phase === 'lock') {
      state.challengeStatus = 'declined';
      state.challengeMessage = `Escrow lock failed${reason}.`;
    }
  }
  });
}

void connectSocket();


async function loadWorldWithFallback() {
  // Ensure `/api/config` has been loaded so `worldAssetBaseUrl` is available.
  // Without this, we can race and fall back to `/assets/world/*.glb` (404 on Netlify).
  try {
    await loadArenaConfig();
  } catch {
    // ignore; loader will fall back, but we prefer a best-effort config load.
  }
  if (worldLoading) {
    worldLoading.classList.add('open');
    worldLoading.setAttribute('aria-hidden', 'false');
  }
  if (worldLoadingBar) {
    worldLoadingBar.style.width = '0%';
  }
  if (worldLoadingText) {
    worldLoadingText.textContent = 'Starting download…';
  }
  try {
    await loadWorldWithProgress(scene, state.worldAlias, (evt) => {
      const loaded = Number(evt?.loaded || 0);
      const total = Number(evt?.total || 0);
      if (worldLoadingBar && total > 0) {
        const ratio = Math.max(0, Math.min(1, loaded / total));
        worldLoadingBar.style.width = `${(ratio * 100).toFixed(1)}%`;
      }
      if (worldLoadingText) {
        if (total > 0) {
          const mb = (loaded / (1024 * 1024)).toFixed(0);
          const totalMb = (total / (1024 * 1024)).toFixed(0);
          worldLoadingText.textContent = `Downloading ${mb}/${totalMb} MB…`;
        } else if (loaded > 0) {
          const mb = (loaded / (1024 * 1024)).toFixed(0);
          worldLoadingText.textContent = `Downloading ${mb} MB…`;
        } else {
          worldLoadingText.textContent = 'Downloading…';
        }
      }
    });
    state.worldLoaded = true;
    addFeedEvent('system', `World loaded: ${state.worldAlias}`);
    if (worldLoading) {
      worldLoading.classList.remove('open');
      worldLoading.setAttribute('aria-hidden', 'true');
    }
    return;
  } catch (err) {
    console.error('Failed to load world', err);
  }

  // The mega world is very large and may fail to load behind some CDNs/proxies during scaffold.
  if (state.worldAlias === 'mega' || state.worldAlias === 'train_world' || state.worldAlias === 'train-world') {
    try {
      const fallbackAlias = 'base';
      if (worldLoadingText) {
        worldLoadingText.textContent = 'Retrying with fallback world…';
      }
      if (worldLoadingBar) {
        worldLoadingBar.style.width = '0%';
      }
      await loadWorldWithProgress(scene, fallbackAlias, (evt) => {
        const loaded = Number(evt?.loaded || 0);
        const total = Number(evt?.total || 0);
        if (worldLoadingBar && total > 0) {
          const ratio = Math.max(0, Math.min(1, loaded / total));
          worldLoadingBar.style.width = `${(ratio * 100).toFixed(1)}%`;
        }
      });
      state.worldAlias = fallbackAlias;
      state.worldLoaded = true;
      addFeedEvent('system', `World loaded: ${fallbackAlias} (fallback)`);
      if (worldLoading) {
        worldLoading.classList.remove('open');
        worldLoading.setAttribute('aria-hidden', 'true');
      }
      return;
    } catch (err) {
      console.error('Failed to load fallback world', err);
    }
  }

  addFeedEvent('system', 'Failed to load world asset.');
  if (worldLoadingText) {
    worldLoadingText.textContent = 'World failed to load. Check your network and try refresh.';
  }
}

void loadWorldWithFallback();

function resetCameraBehindPlayer() {
  const me = state.playerId ? state.players.get(state.playerId) : null;
  if (!me) return;
  cameraController.resetBehindPlayer(me);
}

const inputSystem = createInputSystem({
  state,
  dom,
  actions: {
    resetCameraBehindPlayer,
    setInteractOpen,
    getUiTargetId,
    cycleNearbyTarget,
    sendGameMove
  }
});

const movementSystem = createMovementSystem({
  THREE,
  state,
  socketRef,
  inputSystem,
  cameraController
});

interactionPrompt?.addEventListener('click', () => {
  if (!getUiTargetId()) {
    return;
  }
  setInteractOpen(true);
});
interactionClose?.addEventListener('click', () => setInteractOpen(false));

function updateLocalAvatar() {
  if (!state.playerId) {
    return;
  }

  const local = state.players.get(state.playerId);
  if (!local) {
    return;
  }

  local.displayX += (local.x - local.displayX) * 0.36;
  local.displayY += (local.y - local.displayY) * 0.36;
  local.displayZ += (local.z - local.displayZ) * 0.36;
  local.displayYaw += (local.yaw - local.displayYaw) * 0.32;

  localAvatarParts.avatar.position.set(local.displayX, local.displayY + AVATAR_GROUND_OFFSET, local.displayZ);
  localAvatarParts.avatar.rotation.y = local.displayYaw;

  animateAvatar(localAvatarParts, local.speed, performance.now() * 0.004);

  const active = state.activeChallenge;
  const inMatch = active && active.status === 'active' && (active.challengerId === state.playerId || active.opponentId === state.playerId);
  const opponentId =
    inMatch && active
      ? (active.challengerId === state.playerId ? active.opponentId : active.challengerId)
      : null;
  const opponent = opponentId ? state.players.get(opponentId) : null;

  cameraController.update({
    local,
    opponent,
    inMatch: Boolean(inMatch && opponent)
  });
}

function renderMatchSpotlight() {
  const challenge = state.activeChallenge;
  if (!challenge || challenge.status !== 'active') {
    matchSpotlight.visible = false;
    return;
  }

  const a = state.players.get(challenge.challengerId);
  const b = state.players.get(challenge.opponentId);
  if (!a || !b) {
    matchSpotlight.visible = false;
    return;
  }

  matchSpotlight.visible = true;
  matchSpotlight.position.x = (a.displayX + b.displayX) * 0.5;
  matchSpotlight.position.z = (a.displayZ + b.displayZ) * 0.5;
  matchSpotlight.rotation.z += 0.01;
}

function renderTargetSpotlight() {
  const active = state.activeChallenge;
  if (active && active.status === 'active') {
    targetSpotlight.visible = false;
    return;
  }
  const targetId = getUiTargetId();
  if (!targetId) {
    targetSpotlight.visible = false;
    return;
  }
  const target = state.players.get(targetId);
  const station = target ? null : (state.stations instanceof Map ? state.stations.get(targetId) : null);
  if (!target && !station) {
    targetSpotlight.visible = false;
    return;
  }
  targetSpotlight.visible = true;
  targetSpotlight.position.x = target ? target.displayX : Number(station?.x || 0);
  targetSpotlight.position.z = target ? target.displayZ : Number(station?.z || 0);
  targetSpotlight.rotation.z += 0.015;
}

function renderInteractionCard() {
  if (!interactionCard || !interactionTitle) {
    return;
  }
  const active = state.activeChallenge;
  const inMatch = Boolean(active && active.status === 'active');
  if (inMatch && state.ui.interactionMode !== 'station') {
    setInteractOpen(false);
    return;
  }
  if (!state.ui.interactOpen) {
    return;
  }
  const targetId = getUiTargetId();
  if (!targetId) {
    setInteractOpen(false);
    return;
  }
  const station = isStation(targetId) && state.stations instanceof Map ? state.stations.get(targetId) : null;
  const stationRenderKey = station ? `${station.id}:${station.kind}` : '';

  if (interactionNpcInfo) {
    interactionNpcInfo.hidden = true;
  }
  if (!stationUi) {
    return;
  }

  if (station && state.ui.interactionMode === 'station') {
    interactionTitle.textContent = station.displayName || 'Station';
    stationUi.hidden = false;
    stationUi.style.display = 'grid';
    if (stationUi && interactionStationRenderKey !== stationRenderKey) {
      interactionStationRenderKey = stationRenderKey;
      if (station.kind === 'dealer_coinflip') {
        stationUi.innerHTML = `
          <div class="station-ui__title">Dealer: Coinflip</div>
          <div class="station-ui__row">
            <label for="station-wager">Wager (each)</label>
            <input id="station-wager" type="number" min="0" max="10000" step="1" value="${Math.max(0, Math.min(10000, Number(state.ui.dealer.wager || 1)))}" />
          </div>
          <div class="station-ui__actions">
            <button id="station-house-start" class="btn-gold" type="button">Start Round</button>
          </div>
          <div class="station-ui__actions" id="station-pick-actions" style="display:none;">
            <button id="station-house-heads" class="btn-gold" type="button">Heads</button>
            <button id="station-house-tails" class="btn-gold" type="button">Tails</button>
          </div>
          <div class="station-ui__meta" id="station-status">Start to receive house commit hash, then pick a side.</div>
        `;

        const wagerEl = document.getElementById('station-wager');
        const startBtn = document.getElementById('station-house-start');
        const headsBtn = document.getElementById('station-house-heads');
        const tailsBtn = document.getElementById('station-house-tails');
        const pickActions = document.getElementById('station-pick-actions');
        const statusEl = document.getElementById('station-status');

        function sendStart() {
          if (!socket || socket.readyState !== WebSocket.OPEN) {
            showToast('Not connected to server.');
            return;
          }
          const wager = Math.max(0, Math.min(10000, Number(wagerEl?.value || 0)));
          socket.send(JSON.stringify({
            type: 'station_interact',
            stationId: station.id,
            action: 'coinflip_house_start',
            wager
          }));
          state.ui.dealer.state = 'preflight';
          state.ui.dealer.wager = wager;
          if (statusEl) {
            statusEl.textContent = 'Preflight check... validating player + house wallets.';
          }
          if (startBtn) startBtn.disabled = true;
          if (headsBtn) headsBtn.disabled = true;
          if (tailsBtn) tailsBtn.disabled = true;
        }

        function sendPick(pick) {
          if (!socket || socket.readyState !== WebSocket.OPEN) {
            showToast('Not connected to server.');
            return;
          }
          socket.send(JSON.stringify({
            type: 'station_interact',
            stationId: station.id,
            action: 'coinflip_house_pick',
            pick,
            playerSeed: makePlayerSeed()
          }));
          state.ui.dealer.state = 'dealing';
          if (statusEl) {
            statusEl.textContent = `Flipping... ${pick.toUpperCase()} selected.`;
          }
          if (startBtn) startBtn.disabled = true;
          if (headsBtn) headsBtn.disabled = true;
          if (tailsBtn) tailsBtn.disabled = true;
        }

        if (startBtn) {
          startBtn.onclick = () => sendStart();
        }
        if (headsBtn) {
          headsBtn.onclick = () => sendPick('heads');
        }
        if (tailsBtn) {
          tailsBtn.onclick = () => sendPick('tails');
        }
          if (state.ui.dealer.state === 'ready' && state.ui.dealer.stationId === station.id) {
          if (pickActions) pickActions.style.display = 'flex';
          if (statusEl) {
            statusEl.textContent = `Commit ${state.ui.dealer.commitHash.slice(0, 12)}... received. Pick heads or tails.`;
          }
        }
        if (state.ui.dealer.state === 'preflight') {
          if (pickActions) pickActions.style.display = 'none';
          if (statusEl) {
            statusEl.textContent = 'Preflight check...';
          }
        }
        if (state.ui.dealer.state === 'dealing') {
          if (pickActions) pickActions.style.display = 'flex';
          if (statusEl) {
            statusEl.textContent = 'Dealing...';
          }
        }
        if (state.ui.dealer.state === 'error') {
          if (pickActions) pickActions.style.display = 'none';
          if (statusEl) {
            const msg = state.ui.dealer.reasonText || state.ui.dealer.reason || 'Station request failed.';
            const code = state.ui.dealer.reasonCode ? ` [${state.ui.dealer.reasonCode}]` : '';
            statusEl.textContent = `${msg}${code}`;
          }
          if (startBtn) startBtn.disabled = false;
          if (headsBtn) headsBtn.disabled = false;
          if (tailsBtn) tailsBtn.disabled = false;
        }
      } else if (station.kind === 'cashier_bank') {
        stationUi.innerHTML = `
          <div class="station-ui__title">Cashier</div>
          <div class="station-ui__meta" id="station-balance">Loading balance...</div>
          <div class="station-ui__row">
            <label for="station-amount">Amount</label>
            <input id="station-amount" type="number" min="0" max="10000" step="1" value="10" />
          </div>
          <div class="station-ui__actions">
            <button id="station-refresh" class="btn-ghost" type="button">Refresh</button>
            <button id="station-fund" class="btn-gold" type="button">Fund</button>
            <button id="station-withdraw" class="btn-gold" type="button">Withdraw</button>
          </div>
          <div class="station-ui__row">
            <label for="station-to-wallet">To Wallet</label>
            <input id="station-to-wallet" type="text" placeholder="wallet_..." />
          </div>
          <div class="station-ui__actions">
            <button id="station-transfer" class="btn-ghost" type="button">Transfer</button>
          </div>
        `;

        const balanceEl = document.getElementById('station-balance');
        const amountEl = document.getElementById('station-amount');
        const toWalletEl = document.getElementById('station-to-wallet');
        const refreshBtn = document.getElementById('station-refresh');
        const fundBtn = document.getElementById('station-fund');
        const withdrawBtn = document.getElementById('station-withdraw');
        const transferBtn = document.getElementById('station-transfer');

        async function api(path, init) {
          const res = await fetch(path, {
            credentials: 'include',
            ...init,
            headers: buildSessionHeaders(init?.headers)
          });
          const json = await res.json().catch(() => null);
          if (!res.ok) {
            const reason = String(json?.reason || `http_${res.status}`);
            throw new Error(reason);
          }
          return json;
        }

        async function refresh() {
          try {
            const summary = await api('/api/player/wallet/summary');
            const bal = Number(summary?.wallet?.balance ?? summary?.balance ?? 0);
            balanceEl.textContent = `Balance: ${bal.toFixed(2)}`;
          } catch (err) {
            balanceEl.textContent = `Balance unavailable (${String(err.message || err)})`;
          }
        }

        async function fund() {
          const amount = Math.max(0, Number(amountEl?.value || 0));
          await api('/api/player/wallet/fund', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ amount })
          });
          await refresh();
          showToast(`Funded ${amount}.`);
        }

        async function withdraw() {
          const amount = Math.max(0, Number(amountEl?.value || 0));
          await api('/api/player/wallet/withdraw', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ amount })
          });
          await refresh();
          showToast(`Withdrew ${amount}.`);
        }

        async function transfer() {
          const amount = Math.max(0, Number(amountEl?.value || 0));
          const toWalletId = String(toWalletEl?.value || '').trim();
          if (!toWalletId) {
            showToast('Enter a target wallet id.');
            return;
          }
          await api('/api/player/wallet/transfer', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ toWalletId, amount })
          });
          await refresh();
          showToast(`Transferred ${amount} to ${toWalletId}.`);
        }

        if (refreshBtn) {
          refreshBtn.onclick = () => { void refresh(); };
        }
        if (fundBtn) {
          fundBtn.onclick = () => { void fund().catch((e) => showToast(String(e.message || e))); };
        }
        if (withdrawBtn) {
          withdrawBtn.onclick = () => { void withdraw().catch((e) => showToast(String(e.message || e))); };
        }
        if (transferBtn) {
          transferBtn.onclick = () => { void transfer().catch((e) => showToast(String(e.message || e))); };
        }
        void refresh();
      } else {
        stationUi.innerHTML = `<div class="station-ui__meta">Unknown station.</div>`;
      }
    }

    if (station.kind === 'dealer_coinflip') {
      const pickActions = document.getElementById('station-pick-actions');
      const statusEl = document.getElementById('station-status');
      const startBtn = document.getElementById('station-house-start');
      const headsBtn = document.getElementById('station-house-heads');
      const tailsBtn = document.getElementById('station-house-tails');
      if (state.ui.dealer.state === 'ready' && state.ui.dealer.stationId === station.id) {
        if (startBtn) startBtn.disabled = false;
        if (headsBtn) headsBtn.disabled = false;
        if (tailsBtn) tailsBtn.disabled = false;
        if (pickActions) pickActions.style.display = 'flex';
        if (statusEl) {
          statusEl.textContent = `Commit ${state.ui.dealer.commitHash.slice(0, 12)}... received. Pick heads or tails.`;
        }
      } else if (state.ui.dealer.state === 'preflight') {
        if (startBtn) startBtn.disabled = true;
        if (headsBtn) headsBtn.disabled = true;
        if (tailsBtn) tailsBtn.disabled = true;
        if (pickActions) pickActions.style.display = 'none';
        if (statusEl) {
          statusEl.textContent = 'Preflight check...';
        }
      } else if (state.ui.dealer.state === 'dealing') {
        if (startBtn) startBtn.disabled = true;
        if (headsBtn) headsBtn.disabled = true;
        if (tailsBtn) tailsBtn.disabled = true;
        if (pickActions) pickActions.style.display = 'flex';
        if (statusEl) {
          statusEl.textContent = 'Dealing...';
        }
      } else if (state.ui.dealer.state === 'error') {
        if (startBtn) startBtn.disabled = false;
        if (headsBtn) headsBtn.disabled = false;
        if (tailsBtn) tailsBtn.disabled = false;
        if (pickActions) pickActions.style.display = 'none';
        if (statusEl) {
          const msg = state.ui.dealer.reasonText || state.ui.dealer.reason || 'Station request failed.';
          const code = state.ui.dealer.reasonCode ? ` [${state.ui.dealer.reasonCode}]` : '';
          statusEl.textContent = `${msg}${code}`;
        }
      } else if (state.ui.dealer.state === 'reveal') {
        if (startBtn) startBtn.disabled = false;
        if (headsBtn) headsBtn.disabled = false;
        if (tailsBtn) tailsBtn.disabled = false;
        if (pickActions) pickActions.style.display = 'none';
        if (statusEl) {
          const delta = Number(state.ui.dealer.payoutDelta || 0);
          const tx = state.ui.dealer.escrowTx?.resolve || state.ui.dealer.escrowTx?.refund || state.ui.dealer.escrowTx?.lock || '';
          statusEl.textContent = `Result: ${String(state.ui.dealer.coinflipResult || '').toUpperCase()} · ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}${tx ? ` · tx ${String(tx).slice(0, 10)}...` : ''}`;
        }
      }
    }
    return;
  }

  stationUi.hidden = true;
  stationUi.style.display = 'none';
  stationUi.innerHTML = '';
  interactionStationRenderKey = '';
  if (interactionNpcInfo && state.ui.interactionMode === 'npc_info') {
    interactionTitle.textContent = `Talk: ${labelFor(targetId)}`;
    interactionNpcInfo.hidden = false;
    interactionNpcInfo.style.display = 'grid';
    const stationLabel = state.stations instanceof Map && state.stations.size > 0
      ? [...state.stations.values()][0]?.displayName || 'Dealer'
      : 'Dealer';
    interactionNpcInfo.innerHTML = `
      <div class="station-ui__title">World Guide</div>
      <div class="station-ui__meta">${labelFor(targetId)} says: Try ${stationLabel} for house games. Press E near the station to play.</div>
    `;
  }
}

function renderMobileControls() {
  if (!mobileControls) {
    return;
  }
  const isCoarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  if (!isCoarse) {
    mobileControls.setAttribute('aria-hidden', 'true');
    return;
  }
  mobileControls.setAttribute('aria-hidden', 'false');

  const hasTarget = Boolean(getUiTargetId());
  const dealerPickReady = state.ui.interactOpen
    && state.ui.interactionMode === 'station'
    && state.ui.dealer.state === 'ready';

  if (mobileInteract) mobileInteract.style.display = hasTarget ? 'inline-flex' : 'none';
  if (mobileMoves) mobileMoves.style.display = dealerPickReady ? 'grid' : 'none';
  if (mobileMoveH) mobileMoveH.style.display = dealerPickReady ? 'inline-flex' : 'none';
  if (mobileMoveT) mobileMoveT.style.display = dealerPickReady ? 'inline-flex' : 'none';
}

function update(nowMs) {
  updateLocalAvatar();
  movementSystem.send(nowMs);
  syncRemoteAvatars(state, state.playerId);
  syncStations(state);
  syncNearbyStations();
  refreshNearbyDistances();
  renderMatchSpotlight();
  renderTargetSpotlight();

  if (hud && topbarName && topbarWallet && topbarStreak) {
    const me = state.playerId ? state.players.get(state.playerId) : null;
    topbarName.textContent = me?.displayName || 'Player';
    topbarWallet.textContent = `$${state.walletBalance.toFixed(2)}`;
    topbarStreak.textContent = `Streak ${state.streak}`;
  }

  if (challengeStatusLine) {
    challengeStatusLine.textContent =
      state.challengeMessage ||
      (state.challengeStatus === 'none'
        ? 'Find a nearby target and start a challenge.'
        : `Status: ${state.challengeStatus}`);
  }

  renderWorldMap();
  renderInteractionPrompt();
  renderInteractionCard();
  renderMobileControls();
  renderQuickstart();
}

function render() {
  renderer.render(scene, camera);
}

function frame(nowMs) {
  const isTest = queryParams.get('test') === '1';
  update(nowMs);
  // Headless smoke tests don't need WebGL draws and can hang on `renderer.render`
  // under SwiftShader. Skip render in `test=1` mode; state still advances.
  if (!isTest) {
    render();
  }
  if (!isTest) {
    requestAnimationFrame(frame);
  }
}

function labelFor(id) {
  if (!id) {
    return 'Unknown';
  }
  const player = state.players.get(id);
  const station = state.stations instanceof Map ? state.stations.get(id) : null;
  if (station?.displayName) {
    return station.displayName;
  }
  return player?.displayName || state.nearbyNames.get(id) || id;
}

function isStation(id) {
  return typeof id === 'string' && id.startsWith('station_');
}

function closestNearbyTargetId() {
  const nearbyStations = state.nearbyStationIds instanceof Set ? state.nearbyStationIds : new Set();
  if (state.nearbyIds.size === 0 && nearbyStations.size === 0) {
    return '';
  }
  let bestId = '';
  let bestDist = Number.POSITIVE_INFINITY;
  for (const id of [...state.nearbyIds, ...nearbyStations]) {
    const distance = Number(state.nearbyDistances.get(id) ?? Number.POSITIVE_INFINITY);
    if (distance < bestDist) {
      bestDist = distance;
      bestId = id;
    }
  }
  return bestId || [...state.nearbyIds][0] || [...nearbyStations][0] || '';
}

function closestNearbyPlayerId() {
  if (state.nearbyIds.size === 0) {
    return '';
  }
  let bestId = '';
  let bestDist = Number.POSITIVE_INFINITY;
  for (const id of state.nearbyIds) {
    const distance = Number(state.nearbyDistances.get(id) ?? Number.POSITIVE_INFINITY);
    if (distance < bestDist) {
      bestDist = distance;
      bestId = id;
    }
  }
  return bestId || [...state.nearbyIds][0] || '';
}

function closestNearbyStationId() {
  const nearbyStations = state.nearbyStationIds instanceof Set ? state.nearbyStationIds : new Set();
  if (nearbyStations.size === 0) {
    return '';
  }
  let bestId = '';
  let bestDist = Number.POSITIVE_INFINITY;
  for (const id of nearbyStations) {
    const distance = Number(state.nearbyDistances.get(id) ?? Number.POSITIVE_INFINITY);
    if (distance < bestDist) {
      bestDist = distance;
      bestId = id;
    }
  }
  return bestId || [...nearbyStations][0] || '';
}

function getUiTargetId() {
  if (state.ui?.interactOpen && state.ui?.interactionMode === 'station') {
    const stationId = closestNearbyStationId();
    if (stationId) {
      state.ui.targetId = stationId;
      return stationId;
    }
  }
  const nearbyStations = state.nearbyStationIds instanceof Set ? state.nearbyStationIds : new Set();
  const preferred = state.ui?.targetId || '';
  if (preferred && (state.nearbyIds.has(preferred) || nearbyStations.has(preferred))) {
    return preferred;
  }
  const closest = closestNearbyTargetId();
  if (closest) {
    state.ui.targetId = closest;
  }
  return closest;
}

function cycleNearbyTarget(next = true) {
  const nearbyStations = state.nearbyStationIds instanceof Set ? state.nearbyStationIds : new Set();
  const ids = [...state.nearbyIds, ...nearbyStations];
  if (ids.length === 0) {
    state.ui.targetId = '';
    return;
  }
  ids.sort((a, b) => Number(state.nearbyDistances.get(a) ?? 9999) - Number(state.nearbyDistances.get(b) ?? 9999));
  const current = state.ui.targetId && state.nearbyIds.has(state.ui.targetId) ? state.ui.targetId : ids[0];
  const idx = Math.max(0, ids.indexOf(current));
  const nextIdx = (idx + (next ? 1 : -1) + ids.length) % ids.length;
  state.ui.targetId = ids[nextIdx] || ids[0];
}

function setInteractOpen(nextOpen) {
  state.ui.interactOpen = Boolean(nextOpen);
  if (!interactionCard) {
    return;
  }
  interactionCard.classList.toggle('open', state.ui.interactOpen);
  interactionCard.setAttribute('aria-hidden', state.ui.interactOpen ? 'false' : 'true');
  if (state.ui.interactOpen) {
    const stationFirst = closestNearbyStationId();
    if (stationFirst) {
      state.ui.targetId = stationFirst;
      state.ui.interactionMode = 'station';
    } else if (closestNearbyPlayerId()) {
      state.ui.targetId = closestNearbyPlayerId();
      state.ui.interactionMode = 'npc_info';
    } else {
      state.ui.interactionMode = 'none';
    }
    try {
      document.activeElement?.blur?.();
    } catch {
      // ignore
    }
    state.ui.dealer.state = 'idle';
    state.ui.dealer.escrowTx = null;
  } else {
    interactionStationRenderKey = '';
    state.ui.interactionMode = 'none';
    state.ui.dealer.state = 'idle';
    state.ui.dealer.escrowTx = null;
    const active = document.activeElement;
    if (active instanceof HTMLElement && interactionCard.contains(active)) {
      active.blur?.();
    }
  }
}

function refreshNearbyDistances() {
  const selfId = state.playerId;
  if (!selfId) {
    return;
  }
  const self = state.players.get(selfId);
  if (!self) {
    return;
  }
  for (const id of state.nearbyIds) {
    const other = state.players.get(id);
    if (!other) {
      continue;
    }
    state.nearbyDistances.set(id, Math.hypot(other.x - self.x, other.z - self.z));
  }
}

function syncNearbyStations() {
  const selfId = state.playerId;
  if (!selfId) return;
  const self = state.players.get(selfId);
  if (!self) return;
  if (!(state.stations instanceof Map)) {
    state.stations = new Map();
  }
  if (!(state.nearbyStationIds instanceof Set)) {
    state.nearbyStationIds = new Set();
  }

  const threshold = 8;
  const next = new Set();
  for (const station of state.stations.values()) {
    const distance = Math.hypot(station.x - self.x, station.z - self.z);
    if (distance <= threshold) {
      next.add(station.id);
      state.nearbyDistances.set(station.id, distance);
    }
  }

  for (const id of state.nearbyStationIds) {
    if (!next.has(id)) {
      state.nearbyDistances.delete(id);
    }
  }
  state.nearbyStationIds = next;
}

function makePlayerSeed() {
  try {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return String(Math.random()).slice(2) + String(Date.now());
  }
}

function sendGameMove(move) {
  if (
    (move === 'heads' || move === 'tails')
    && state.ui.interactOpen
    && state.ui.interactionMode === 'station'
    && state.ui.dealer.state === 'ready'
    && state.ui.dealer.stationId
    && socket
    && socket.readyState === WebSocket.OPEN
  ) {
    socket.send(
      JSON.stringify({
        type: 'station_interact',
        stationId: state.ui.dealer.stationId,
        action: 'coinflip_house_pick',
        pick: move,
        playerSeed: makePlayerSeed()
      })
    );
    state.ui.dealer.state = 'dealing';
    state.challengeMessage = `Flipping coin... ${move.toUpperCase()} selected.`;
    state.quickstart.moveSubmitted = true;
    return;
  }

  const challenge = state.activeChallenge;
  if (!challenge || !socket || socket.readyState !== WebSocket.OPEN) {
    state.challengeMessage = 'No active match right now.';
    return;
  }
  if (challenge.gameType === 'rps' && move !== 'rock' && move !== 'paper' && move !== 'scissors') {
    return;
  }
  if (challenge.gameType === 'coinflip' && move !== 'heads' && move !== 'tails') {
    return;
  }

  const iAmChallenger = challenge.challengerId === state.playerId;
  const iAmOpponent = challenge.opponentId === state.playerId;
  if (!iAmChallenger && !iAmOpponent) {
    return;
  }

  const myMove = iAmChallenger ? challenge.challengerMove : challenge.opponentMove;
  if (myMove) {
    state.challengeMessage = `Move already submitted (${myMove})`;
    return;
  }

  socket.send(
    JSON.stringify({
      type: 'challenge_move',
      challengeId: challenge.id,
      move
    })
  );

  state.challengeMessage = `Submitted move: ${move}`;
  state.quickstart.moveSubmitted = true;
}

function updateRpsVisibility() {
  // Station-only gameplay path: no legacy match move controls.
}

function addFeedEvent(type, text, meta = null) {
  const message = String(text || '').trim();
  if (!message) {
    return;
  }

  const at = Date.now();
  const last = state.challengeFeed[0];
  const sameTx =
    (last?.meta?.txHash || null) ===
    (meta && typeof meta === 'object' && 'txHash' in meta ? meta.txHash || null : null);
  if (last && last.type === type && last.text === message && sameTx && at - last.at < 5000) {
    return;
  }

  state.challengeFeed.unshift({
    type,
    text: message,
    at,
    meta
  });
  if (state.challengeFeed.length > 14) {
    state.challengeFeed.pop();
  }

  renderFeed();
}

function renderFeed() {
  if (!feedPanel) {
    return;
  }
  feedPanel.innerHTML = '';

  if (state.challengeFeed.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'feed-empty';
    empty.textContent = 'No challenge activity yet.';
    feedPanel.appendChild(empty);
    return;
  }

  for (const entry of state.challengeFeed) {
    const item = document.createElement('div');
    item.className = `feed-item feed-item--${entry.type}`;

    const top = document.createElement('div');
    top.className = 'feed-item__top';

    const kind = document.createElement('span');
    const dot = document.createElement('i');
    dot.className = 'feed-dot';
    if (entry.type === 'escrow') {
      dot.classList.add('gold');
    } else if (entry.text.includes('declined') || entry.text.includes('failed') || entry.text.includes('expired')) {
      dot.classList.add('red');
    } else {
      dot.classList.add('green');
    }
    kind.appendChild(dot);
    kind.appendChild(document.createTextNode(` ${entry.type}`));

    const time = document.createElement('span');
    time.textContent = new Date(entry.at).toLocaleTimeString();

    const body = document.createElement('div');
    body.className = 'feed-item__body';
    body.textContent = entry.text;

    top.appendChild(kind);
    top.appendChild(time);
    item.appendChild(top);
    item.appendChild(body);
    const txHash = typeof entry?.meta?.txHash === 'string' ? entry.meta.txHash : '';
    if (txHash) {
      const txRow = document.createElement('div');
      txRow.className = 'feed-item__tx';

      const txBadge = document.createElement('span');
      txBadge.className = 'tx-chip';
      txBadge.textContent = `${txHash.slice(0, 8)}...${txHash.slice(-6)}`;

      const txLink = document.createElement('a');
      txLink.className = 'tx-link';
      txLink.href = `https://sepolia.etherscan.io/tx/${txHash}`;
      txLink.target = '_blank';
      txLink.rel = 'noreferrer noopener';
      txLink.textContent = 'view tx';

      txRow.appendChild(txBadge);
      txRow.appendChild(txLink);
      item.appendChild(txRow);
    }
    feedPanel.appendChild(item);
  }
}

function handleChallenge(payload) {
  const challenge = payload.challenge;
  if (challenge) {
    state.activeChallenge = challenge;
  }

  if (payload.event === 'created' && challenge) {
    state.respondingIncoming = false;
    if (challenge.opponentId === state.playerId) {
      state.incomingChallengeId = challenge.id;
      state.challengeStatus = 'incoming';
      state.challengeMessage = `Incoming ${challenge.gameType} challenge from ${labelFor(challenge.challengerId)} (${formatWagerInline(challenge.wager)}).`;
    }

    if (challenge.challengerId === state.playerId) {
      state.outgoingChallengeId = challenge.id;
      state.challengeStatus = 'sent';
      state.challengeMessage = `Challenge created. Waiting for ${labelFor(challenge.opponentId)}.`;
    }
  }

  if (payload.event === 'accepted' && challenge) {
    state.respondingIncoming = false;
    state.incomingChallengeId = null;
    state.outgoingChallengeId = null;
    state.challengeStatus = 'active';
    state.challengeMessage = `${challenge.gameType.toUpperCase()} active.`;
    state.quickstart.matchActive = true;
  }

  if (payload.event === 'move_submitted' && challenge) {
    state.challengeStatus = 'active';
  }

  if (payload.event === 'declined' && challenge) {
    state.respondingIncoming = false;
    state.activeChallenge = null;
    state.incomingChallengeId = null;
    state.outgoingChallengeId = null;
    state.challengeStatus = 'declined';
    const reason = payload.reason ? challengeReasonLabel(payload.reason) : '';
    state.challengeMessage = `Challenge declined (${challenge.id})${reason ? ` · ${reason}` : ''}`;
  }

  if (payload.event === 'expired' && challenge) {
    state.respondingIncoming = false;
    state.activeChallenge = null;
    state.incomingChallengeId = null;
    state.outgoingChallengeId = null;
    state.challengeStatus = 'expired';
    const reason = payload.reason ? challengeReasonLabel(payload.reason) : '';
    state.challengeMessage = `Challenge expired (${challenge.id})${reason ? ` · ${reason}` : ''}`;
  }

  if (payload.event === 'resolved' && challenge) {
    const beforeBalance = state.walletBalance;
    state.respondingIncoming = false;
    state.activeChallenge = null;
    state.incomingChallengeId = null;
    state.outgoingChallengeId = null;
    state.challengeStatus = 'resolved';
    const winnerLabel = challenge.winnerId ? labelFor(challenge.winnerId) : 'Draw';
    if (challenge.winnerId === state.playerId) {
      state.streak += 1;
    } else if (challenge.winnerId) {
      state.streak = 0;
    }
    state.challengeMessage = challenge.winnerId ? `Resolved. Winner: ${winnerLabel}` : 'Resolved. Draw/refund.';
    state.quickstart.matchResolved = true;
    void refreshWalletBalanceAndShowDelta(beforeBalance, challenge);
  }

  if (payload.event === 'invalid' || payload.event === 'busy') {
    state.respondingIncoming = false;
    state.challengeMessage = challengeReasonLabel(payload.reason);
    showToast(state.challengeMessage);
  }

  addFeedEvent('match', `challenge:${payload.event}${payload.reason ? ` (${payload.reason})` : ''}`);
  updateRpsVisibility();
}

function challengeReasonLabel(reason) {
  switch (reason) {
    case 'target_not_found':
      return 'Target not found.';
    case 'target_not_nearby':
      return 'Move closer to your target to challenge.';
    case 'player_busy':
      return 'Target is already in a match.';
    case 'wallet_required':
      return 'Wagered matches require wallets. Tip: set wager to 0 (Free) to play instantly.';
    case 'challenger_wallet_policy_disabled':
    case 'opponent_wallet_policy_disabled':
      return 'Wallet policy disabled. Tip: set wager to 0 (Free), or enable wallet skills in Agents page.';
    case 'challenger_insufficient_balance':
    case 'opponent_insufficient_balance':
      return 'Insufficient balance for this wager. Tip: set wager to 0 (Free).';
    case 'challenger_max_bet_percent_exceeded':
    case 'opponent_max_bet_percent_exceeded':
      return 'Wager exceeds one player spend-limit policy.';
    case 'challenge_not_pending':
      return 'Challenge is no longer pending.';
    case 'challenge_not_active':
      return 'Match is not active.';
    case 'not_opponent':
      return 'Only the challenged player can accept.';
    case 'not_participant':
      return 'Only match participants can submit a move.';
    case 'invalid_rps_move':
    case 'invalid_coinflip_move':
      return 'Invalid move for current game type.';
    case 'human_challenge_cooldown':
      return 'Target is in cooldown from recent agent challenges.';
    default:
      return reason ? `Action rejected: ${reason}` : 'Challenge action rejected.';
  }
}

function renderInteractionPrompt() {
  if (!interactionPrompt) {
    return;
  }
  const active = state.activeChallenge;
  if (active && active.status === 'active') {
    interactionPrompt.classList.remove('visible');
    return;
  }
  if (state.ui?.interactOpen) {
    interactionPrompt.classList.remove('visible');
    return;
  }
  const targetId = getUiTargetId();
  if (!targetId) {
    interactionPrompt.classList.remove('visible');
    setInteractOpen(false);
    return;
  }
  const distance = state.nearbyDistances.get(targetId);
  const verb = isStation(targetId) ? 'play station' : 'talk';
  interactionPrompt.textContent = `Near ${labelFor(targetId)}${typeof distance === 'number' ? ` (${distance.toFixed(1)}m)` : ''}. E ${verb} · Tab switch · V profile`;
  interactionPrompt.classList.add('visible');
}

function renderQuickstart() {
  if (!quickstartPanel || !quickstartList) {
    return;
  }

  if (state.quickstart.dismissed) {
    quickstartPanel.style.display = 'none';
    return;
  }

  const active = state.activeChallenge;
  const inActiveMatch = Boolean(
    active &&
    active.status === 'active' &&
    (active.challengerId === state.playerId || active.opponentId === state.playerId)
  );
  if (inActiveMatch) {
    state.quickstart.matchActive = true;
    const myMove = active.challengerId === state.playerId ? active.challengerMove : active.opponentMove;
    if (myMove) {
      state.quickstart.moveSubmitted = true;
    }
  }

  const steps = [
    { done: Boolean(state.playerId && state.wsConnected), text: 'Connected to arena server' },
    { done: state.nearbyStationIds.size > 0, text: 'Find a nearby station' },
    { done: state.quickstart.challengeSent, text: 'Start a dealer round (E)' },
    { done: state.quickstart.matchActive, text: 'Dealer confirms your pick' },
    { done: state.quickstart.matchResolved, text: 'Result revealed and payout posted' }
  ];

  quickstartList.innerHTML = steps
    .map((step) => `<li class="${step.done ? 'done' : ''}">${step.done ? '✓' : '○'} ${step.text}</li>`)
    .join('');
}

function renderWorldMap() {
  if (!(worldMapCanvas instanceof HTMLCanvasElement)) {
    return;
  }
  const ctx = worldMapCanvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const { width, height } = worldMapCanvas;
  ctx.clearRect(0, 0, width, height);

  // Soft paper-like field background.
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, 'rgba(255,255,251,0.98)');
  bg.addColorStop(1, 'rgba(243,234,208,0.95)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Draw 8 sections (4x2) with alternating tint.
  for (let r = 0; r < 2; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      const x = (c / 4) * width;
      const y = (r / 2) * height;
      const w = width / 4;
      const h = height / 2;
      ctx.fillStyle = (r + c) % 2 === 0 ? 'rgba(228, 206, 147, 0.14)' : 'rgba(255,255,255,0.2)';
      ctx.fillRect(x, y, w, h);
    }
  }

  ctx.strokeStyle = 'rgba(168, 130, 24, 0.55)';
  ctx.lineWidth = 1.1;
  const cols = 4;
  const rows = 2;
  for (let c = 1; c < cols; c += 1) {
    const x = (c / cols) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let r = 1; r < rows; r += 1) {
    const y = (r / rows) * height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.fillStyle = 'rgba(91, 72, 20, 0.9)';
  for (let i = 0; i < 8; i += 1) {
    const c = i % 4;
    const r = Math.floor(i / 4);
    ctx.fillText(`S${i + 1}`, c * (width / 4) + 4, r * (height / 2) + 12);
  }

  for (const player of state.players.values()) {
    const x = ((player.x + WORLD_BOUND) / (WORLD_BOUND * 2)) * width;
    const y = ((player.z + WORLD_BOUND) / (WORLD_BOUND * 2)) * height;

    const isSelf = player.id === state.playerId;
    const role = player.role ?? 'human';

    ctx.beginPath();
    ctx.arc(x, y, isSelf ? 4.8 : 3.2, 0, Math.PI * 2);
    ctx.fillStyle = isSelf ? '#2f6dff' : role === 'agent' ? '#b4792a' : '#4f8a63';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (state.stations instanceof Map) {
    for (const station of state.stations.values()) {
      const x = ((station.x + WORLD_BOUND) / (WORLD_BOUND * 2)) * width;
      const y = ((station.z + WORLD_BOUND) / (WORLD_BOUND * 2)) * height;
      ctx.beginPath();
      const size = 6;
      ctx.rect(x - size / 2, y - size / 2, size, size);
      ctx.fillStyle = station.kind === 'cashier_bank' ? 'rgba(47, 109, 255, 0.92)' : 'rgba(243, 156, 18, 0.92)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  if (state.playerId) {
    const self = state.players.get(state.playerId);
    if (self && mapCoords) {
      mapCoords.textContent = `x:${Math.round(self.x)} z:${Math.round(self.z)}`;
    }
  }
}

window.advanceTime = (ms) => {
  const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  for (let i = 0; i < steps; i += 1) {
    update(performance.now());
  }
  render();
};

window.render_game_to_text = () => {
  const local = state.playerId ? state.players.get(state.playerId) : null;
  const desired = movementSystem.computeDesiredMove();
  return JSON.stringify({
    mode: 'play',
    wsConnected: state.wsConnected,
    playerId: state.playerId,
    worldAlias: state.worldAlias,
    worldLoaded: state.worldLoaded,
    tick: state.tick,
    coords: 'origin at world center, +X right, +Z forward, +Y up',
    cameraYaw: state.cameraYaw,
    cameraDistance: state.cameraDistance,
    desiredMove: desired,
    player: local
      ? {
          x: local.x,
          y: local.y,
          z: local.z,
          yaw: local.yaw,
          displayX: local.displayX,
          displayY: local.displayY,
          displayZ: local.displayZ,
          displayYaw: local.displayYaw,
          displayName: local.displayName
        }
      : null,
    nearbyIds: [...state.nearbyIds],
    challengeStatus: state.challengeStatus,
    activeChallenge: state.activeChallenge
      ? {
          id: state.activeChallenge.id,
          gameType: state.activeChallenge.gameType,
          challengerId: state.activeChallenge.challengerId,
          opponentId: state.activeChallenge.opponentId,
          challengerMove: state.activeChallenge.challengerMove,
          opponentMove: state.activeChallenge.opponentMove,
          wager: state.activeChallenge.wager
        }
      : null
  });
};

if (queryParams.get('test') === '1') {
  // Deterministic stepping hook for automated tests (avoid relying on rAF timing).
  let testNow = performance.now();
  window.advanceTime = async (ms) => {
    const stepMs = 1000 / 60;
    const steps = Math.max(1, Math.round(ms / stepMs));
    for (let i = 0; i < steps; i += 1) {
      testNow += stepMs;
      frame(testNow);
    }
  };
} else {
  requestAnimationFrame(frame);
}
