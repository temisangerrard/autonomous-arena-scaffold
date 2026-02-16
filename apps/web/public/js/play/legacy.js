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
  targetSelect,
  gameSelect,
  wagerInput,
  sendChallengeBtn,
  clearChallengeBtn,
  acceptBtn,
  declineBtn,
  rpsButtons,
  coinButtons,
  feedPanel,
  challengeStatusLine,
  worldMapCanvas,
  mapCoords,
  deskToggle,
  challengePanel,
  gameModal,
  gameTitle,
  gamePlayers,
  gameStatus,
  gameDetail,
  gameClose,
  challengeTimerWrap,
  challengeTimerBar,
  matchControls,
  matchControlsTitle,
  matchControlsStatus,
  matchControlsActions,
  matchCounterOffer,
  counterWagerInput,
  counterSendBtn,
  interactionPrompt,
  interactionCard,
  interactionTitle,
  interactionClose,
  interactionGame,
  interactionWager,
  interactionSend,
  interactionOpenDesk,
  stationUi,
  quickstartPanel,
  quickstartList,
  quickstartClose,
  worldLoading,
  worldLoadingBar,
  worldLoadingText,
  mobileControls,
  mobileInteract,
  mobileSend,
  mobileAccept,
  mobileDecline,
  mobileCounter,
  mobileMoves,
  mobileMove1,
  mobileMove2,
  mobileMove3,
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

if (deskToggle && challengePanel) {
  deskToggle.addEventListener('click', () => {
    state.deskCollapsed = !state.deskCollapsed;
    state.deskAutoCollapsedByMatch = false;
    challengePanel.classList.toggle('compact', state.deskCollapsed);
    deskToggle.textContent = state.deskCollapsed ? 'Expand' : 'Collapse';
  });
}

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

    refreshNearbyTargetOptions();
    updateRpsVisibility();
    updateGameModalFromState();
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
    refreshNearbyTargetOptions();
    return;
  }

  if (payload.type === 'station_ui' && typeof payload.stationId === 'string') {
    const ok = Boolean(payload.view?.ok);
    const reason = String(payload.view?.reason || '');
    if (!ok) {
      addFeedEvent('system', `Station ${labelFor(payload.stationId)}: ${reason || 'request_failed'}`);
      showToast(`Station error: ${reason || 'request_failed'}`);
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
    sendChallenge,
    setInteractOpen,
    getUiTargetId,
    cycleNearbyTarget,
    respondToIncoming,
    sendCounterOffer,
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

sendChallengeBtn?.addEventListener('click', () => sendChallenge());
targetSelect?.addEventListener('change', () => {
  const value = String(targetSelect?.value || '');
  if (value && state.nearbyIds.has(value)) {
    state.ui.targetId = value;
  }
});
clearChallengeBtn?.addEventListener('click', () => {
  state.challengeMessage = '';
  state.challengeStatus = 'none';
  hideGameModal();
});
acceptBtn?.addEventListener('click', () => respondToIncoming(true));
declineBtn?.addEventListener('click', () => respondToIncoming(false));
interactionPrompt?.addEventListener('click', () => {
  if (!getUiTargetId()) {
    return;
  }
  setInteractOpen(true);
});
interactionClose?.addEventListener('click', () => setInteractOpen(false));
interactionSend?.addEventListener('click', () => {
  if (!state.ui.interactOpen) {
    setInteractOpen(true);
  }
  sendChallenge();
});
interactionOpenDesk?.addEventListener('click', () => {
  if (!challengePanel) {
    return;
  }
  state.deskCollapsed = false;
  state.deskAutoCollapsedByMatch = false;
  challengePanel.classList.remove('compact');
  if (deskToggle) {
    deskToggle.textContent = 'Collapse';
  }
  setInteractOpen(false);
});
gameClose?.addEventListener('click', () => hideGameModal());
rpsButtons?.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  const move = target.dataset.rps;
  if (!move || (move !== 'rock' && move !== 'paper' && move !== 'scissors')) {
    return;
  }
  sendGameMove(move);
});
coinButtons?.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  const move = target.dataset.coin;
  if (!move || (move !== 'heads' && move !== 'tails')) {
    return;
  }
  sendGameMove(move);
});

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
  const incoming = Boolean(state.incomingChallengeId);
  if (inMatch || incoming) {
    setInteractOpen(false);
    return;
  }
  const targetId = getUiTargetId();
  if (!targetId) {
    setInteractOpen(false);
    return;
  }
  const station = isStation(targetId) && state.stations instanceof Map ? state.stations.get(targetId) : null;

  const challengeRows = interactionCard.querySelectorAll('.interaction-row, .interaction-actions, #wager-hint');
  const showStation = Boolean(station);
  for (const row of challengeRows) {
    row.style.display = showStation ? 'none' : '';
  }
  if (stationUi) {
    stationUi.hidden = !showStation;
  }

  if (station) {
    interactionTitle.textContent = station.displayName || 'Station';
    if (stationUi) {
      if (station.kind === 'dealer_coinflip') {
        stationUi.innerHTML = `
          <div class="station-ui__title">Dealer: Coinflip</div>
          <div class="station-ui__row">
            <label for="station-wager">Wager (each)</label>
            <input id="station-wager" type="number" min="0" max="10000" step="1" value="${Math.max(0, Math.min(10000, Number(interactionWager?.value || 1)))}" />
          </div>
          <div class="station-ui__actions">
            <button id="station-house-heads" class="btn-gold" type="button">Heads vs House</button>
            <button id="station-house-tails" class="btn-gold" type="button">Tails vs House</button>
          </div>
          <div class="station-ui__meta">PvP: use the Desk for now to challenge a nearby player to Coinflip.</div>
        `;

        const wagerEl = document.getElementById('station-wager');
        const headsBtn = document.getElementById('station-house-heads');
        const tailsBtn = document.getElementById('station-house-tails');

        function playerSeed() {
          try {
            const buf = new Uint8Array(16);
            crypto.getRandomValues(buf);
            return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
          } catch {
            return String(Math.random()).slice(2) + String(Date.now());
          }
        }

        function sendHouse(pick) {
          if (!socket || socket.readyState !== WebSocket.OPEN) {
            showToast('Not connected to server.');
            return;
          }
          const wager = Math.max(0, Math.min(10000, Number(wagerEl?.value || 0)));
          socket.send(JSON.stringify({
            type: 'station_interact',
            stationId: station.id,
            action: 'coinflip_house',
            wager,
            pick,
            playerSeed: playerSeed()
          }));
          showToast(`Coinflip vs House: ${pick} (${wager})`);
          setInteractOpen(false);
        }

        headsBtn?.addEventListener('click', () => sendHouse('heads'), { once: true });
        tailsBtn?.addEventListener('click', () => sendHouse('tails'), { once: true });
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

        refreshBtn?.addEventListener('click', () => void refresh(), { once: true });
        fundBtn?.addEventListener('click', () => void fund().catch((e) => showToast(String(e.message || e))), { once: true });
        withdrawBtn?.addEventListener('click', () => void withdraw().catch((e) => showToast(String(e.message || e))), { once: true });
        transferBtn?.addEventListener('click', () => void transfer().catch((e) => showToast(String(e.message || e))), { once: true });
        void refresh();
      } else {
        stationUi.innerHTML = `<div class="station-ui__meta">Unknown station.</div>`;
      }
    }
    if (interactionSend) interactionSend.style.display = 'none';
    if (interactionOpenDesk) interactionOpenDesk.style.display = '';
    return;
  }

  if (interactionSend) interactionSend.style.display = '';
  if (interactionOpenDesk) interactionOpenDesk.style.display = '';
  const isNpc = isStaticNpc(targetId);
  interactionTitle.textContent = isNpc ? `Request a game: ${labelFor(targetId)}` : `Challenge: ${labelFor(targetId)}`;
  if (interactionSend) {
    interactionSend.textContent = isNpc ? 'Request Game' : 'Send Challenge';
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
  const active = state.activeChallenge;
  const inMatch = Boolean(active && active.status === 'active');
  const incoming = Boolean(state.incomingChallengeId && state.challengeStatus === 'incoming');
  const canSend = Boolean(hasTarget && !incoming && !inMatch);

  if (mobileInteract) mobileInteract.style.display = canSend ? 'inline-flex' : 'none';
  if (mobileSend) mobileSend.style.display = (canSend && state.ui.interactOpen) ? 'inline-flex' : 'none';

  if (mobileAccept) mobileAccept.style.display = incoming ? 'inline-flex' : 'none';
  if (mobileDecline) mobileDecline.style.display = incoming ? 'inline-flex' : 'none';
  if (mobileCounter) mobileCounter.style.display = incoming ? 'inline-flex' : 'none';

  if (mobileMoves) {
    const showMoves = Boolean(inMatch && active && (active.challengerId === state.playerId || active.opponentId === state.playerId));
    mobileMoves.style.display = showMoves ? 'grid' : 'none';
  }

  const gameType = active?.gameType || '';
  const showRps = inMatch && gameType === 'rps';
  const showCoin = inMatch && gameType === 'coinflip';
  if (mobileMove1) mobileMove1.style.display = showRps ? 'inline-flex' : 'none';
  if (mobileMove2) mobileMove2.style.display = showRps ? 'inline-flex' : 'none';
  if (mobileMove3) mobileMove3.style.display = showRps ? 'inline-flex' : 'none';
  if (mobileMoveH) mobileMoveH.style.display = showCoin ? 'inline-flex' : 'none';
  if (mobileMoveT) mobileMoveT.style.display = showCoin ? 'inline-flex' : 'none';
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
  renderContextPanel();
  renderInteractionPrompt();
  renderInteractionCard();
  renderMatchControls();
  renderMobileControls();
  renderQuickstart();
}

function render() {
  renderer.render(scene, camera);
}

function frame(nowMs) {
  const isTest = queryParams.get('test') === '1';
  if (state.incomingChallengeExpiresAt && challengeTimerBar) {
    const remaining = Math.max(0, state.incomingChallengeExpiresAt - Date.now());
    const ratio = Math.max(0, Math.min(1, remaining / 15000));
    challengeTimerBar.style.width = `${(ratio * 100).toFixed(1)}%`;
    if (remaining <= 0) {
      state.incomingChallengeExpiresAt = null;
      if (challengeTimerWrap) {
        challengeTimerWrap.style.display = 'none';
      }
    }
  }
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

function isStaticNpc(id) {
  return typeof id === 'string' && id.startsWith('agent_bg_');
}

function isStation(id) {
  return typeof id === 'string' && id.startsWith('station_');
}

function refreshNearbyTargetOptions() {
  if (!targetSelect) {
    return;
  }

  const previous = targetSelect.value;
  targetSelect.innerHTML = '';

  const options = [...state.nearbyIds].sort();
  if (options.length === 0) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'No nearby players';
    targetSelect.appendChild(empty);
    targetSelect.disabled = true;
    return;
  }

  targetSelect.disabled = false;
  for (const id of options) {
    const option = document.createElement('option');
    option.value = id;
    const role = isStaticNpc(id) ? 'npc' : (state.players.get(id)?.role === 'agent' ? 'agent' : 'human');
    option.textContent = `${labelFor(id)} (${role})`;
    targetSelect.appendChild(option);
  }

  if (options.includes(previous)) {
    targetSelect.value = previous;
    state.ui.targetId = previous;
  } else if (state.ui?.targetId && options.includes(state.ui.targetId)) {
    targetSelect.value = state.ui.targetId;
  }
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

function getUiTargetId() {
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
  if (targetSelect) {
    targetSelect.value = state.ui.targetId;
  }
}

function setInteractOpen(nextOpen) {
  state.ui.interactOpen = Boolean(nextOpen);
  if (!interactionCard) {
    return;
  }
  interactionCard.classList.toggle('open', state.ui.interactOpen);
  interactionCard.setAttribute('aria-hidden', state.ui.interactOpen ? 'false' : 'true');
  if (state.ui.interactOpen) {
    try {
      document.activeElement?.blur?.();
    } catch {
      // ignore
    }
    if (interactionWager) {
      const targetId = getUiTargetId();
      const isNpc = isStaticNpc(targetId);
      const suggested = isNpc ? (state.walletBalance >= 1 ? 1 : 0) : Number(interactionWager.value ?? 1);
      interactionWager.value = String(Math.max(0, Math.min(10000, Number.isFinite(suggested) ? suggested : 0)));
      interactionWager.focus?.();
      interactionWager.select?.();
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

function sendChallenge() {
  if (!state.wsConnected || !socket || socket.readyState !== WebSocket.OPEN) {
    state.challengeMessage = 'Not connected to game server.';
    return;
  }

  const selectedTarget = targetSelect?.value || '';
  const targetId =
    (selectedTarget && state.nearbyIds.has(selectedTarget) ? selectedTarget : '') ||
    (state.ui?.targetId && state.nearbyIds.has(state.ui.targetId) ? state.ui.targetId : '') ||
    closestNearbyTargetId();
  if (!targetId) {
    state.challengeMessage = 'No nearby target selected.';
    return;
  }

  const gameTypeSource = (interactionGame && state.ui.interactOpen) ? interactionGame : gameSelect;
  const wagerSource = (interactionWager && state.ui.interactOpen) ? interactionWager : wagerInput;
  const gameType = gameTypeSource?.value === 'coinflip' ? 'coinflip' : 'rps';
  const wager = Math.max(0, Math.min(10000, Number(wagerSource?.value ?? 1)));

  socket.send(
    JSON.stringify({
      type: 'challenge_send',
      targetId,
      gameType,
      wager
    })
  );

  state.challengeStatus = 'sent';
  state.challengeMessage = `Challenge sent (${gameType}, ${formatWagerInline(wager)}) to ${labelFor(targetId)}`;
  state.quickstart.challengeSent = true;
  setInteractOpen(false);
}

function respondToIncoming(accept) {
  if (!state.incomingChallengeId || !socket || socket.readyState !== WebSocket.OPEN) {
    state.challengeMessage = 'No incoming challenge to respond to.';
    return;
  }

  if (state.respondingIncoming) {
    return;
  }
  state.respondingIncoming = true;
  state.challengeStatus = 'responding';
  state.challengeMessage = accept ? 'Accepting challenge...' : 'Declining challenge...';

  socket.send(
    JSON.stringify({
      type: 'challenge_response',
      challengeId: state.incomingChallengeId,
      accept
    })
  );
  if (accept) {
    state.quickstart.challengeSent = true;
  }
}

function sendCounterOffer() {
  const challenge = state.activeChallenge;
  if (!challenge || challenge.status !== 'pending' || challenge.opponentId !== state.playerId) {
    state.challengeMessage = 'No incoming challenge to counter.';
    return;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    state.challengeMessage = 'Not connected to game server.';
    return;
  }
  if (state.respondingIncoming) {
    return;
  }
  const wager = Math.max(0, Math.min(10000, Number(counterWagerInput?.value ?? challenge.wager ?? 1)));
  state.respondingIncoming = true;
  state.challengeStatus = 'responding';
  state.challengeMessage = `Countering with ${formatWagerInline(wager)}...`;

  socket.send(
    JSON.stringify({
      type: 'challenge_counter',
      challengeId: challenge.id,
      wager
    })
  );
  state.quickstart.challengeSent = true;
}

function sendGameMove(move) {
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
  if (!rpsButtons) {
    return;
  }

  const challenge = state.activeChallenge;
  const show =
    challenge &&
    challenge.status === 'active' &&
    challenge.gameType === 'rps' &&
    (challenge.challengerId === state.playerId || challenge.opponentId === state.playerId);

  rpsButtons.classList.toggle('visible', Boolean(show));
  const showCoin =
    challenge &&
    challenge.status === 'active' &&
    challenge.gameType === 'coinflip' &&
    (challenge.challengerId === state.playerId || challenge.opponentId === state.playerId);
  coinButtons?.classList.toggle('visible', Boolean(showCoin));

  if (rpsButtons) {
    rpsButtons.style.opacity = show ? '1' : '0.55';
  }
  if (coinButtons) {
    coinButtons.style.opacity = showCoin ? '1' : '0.55';
  }
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

function showGameModal(challenge, statusText, detailText = '') {
  if (!gameModal || !gameTitle || !gamePlayers || !gameStatus || !gameDetail) {
    return;
  }

  gameTitle.textContent = challenge.gameType === 'rps' ? 'Rock Paper Scissors' : 'Coin Flip';
  gamePlayers.textContent = `${labelFor(challenge.challengerId)} vs ${labelFor(challenge.opponentId)} | ${formatWagerLabel(challenge.wager)}`;
  gameStatus.textContent = statusText;
  gameDetail.textContent = detailText;
  const showAlways = statusText.toLowerCase().includes('incoming') || statusText.toLowerCase().includes('resolved');
  if (showAlways) {
    gameModal.classList.add('visible');
  }
}

function hideGameModal() {
  gameModal?.classList.remove('visible');
}

function updateGameModalFromState() {
  const challenge = state.activeChallenge;
  if (!challenge || challenge.status !== 'active') {
    return;
  }

  if (challenge.gameType === 'rps') {
    const left = challenge.challengerMove ? `${labelFor(challenge.challengerId)} locked move` : `${labelFor(challenge.challengerId)} thinking...`;
    const right = challenge.opponentMove ? `${labelFor(challenge.opponentId)} locked move` : `${labelFor(challenge.opponentId)} thinking...`;
    showGameModal(challenge, 'Submit move to play', `${left} | ${right}`);
    return;
  }

  const left =
    challenge.challengerMove && (challenge.challengerMove === 'heads' || challenge.challengerMove === 'tails')
      ? `${labelFor(challenge.challengerId)} picked ${challenge.challengerMove}`
      : `${labelFor(challenge.challengerId)} choosing...`;
  const right =
    challenge.opponentMove && (challenge.opponentMove === 'heads' || challenge.opponentMove === 'tails')
      ? `${labelFor(challenge.opponentId)} picked ${challenge.opponentMove}`
      : `${labelFor(challenge.opponentId)} choosing...`;
  showGameModal(challenge, 'Choose heads or tails (H/T)', `${left} | ${right}`);
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
      state.incomingChallengeExpiresAt = Number(challenge.expiresAt || (Date.now() + 15000));
      if (challengeTimerWrap) {
        challengeTimerWrap.style.display = 'block';
      }
      if (challengeTimerBar) {
        challengeTimerBar.style.width = '100%';
      }
      showGameModal(
        challenge,
        'Incoming challenge',
        `${labelFor(challenge.challengerId)} challenges you to ${challenge.gameType.toUpperCase()} (${formatWagerInline(challenge.wager)}). Accept as-is, or counter-offer (O).`
      );
    }

    if (challenge.challengerId === state.playerId) {
      state.outgoingChallengeId = challenge.id;
      state.challengeStatus = 'sent';
      state.challengeMessage = `Challenge created. Waiting for ${labelFor(challenge.opponentId)}.`;
      hideGameModal();
    }
  }

  if (payload.event === 'accepted' && challenge) {
    state.respondingIncoming = false;
    state.incomingChallengeId = null;
    state.outgoingChallengeId = null;
    state.challengeStatus = 'active';
    state.challengeMessage = `${challenge.gameType.toUpperCase()} active.`;
    state.incomingChallengeExpiresAt = null;
    if (challengeTimerWrap) {
      challengeTimerWrap.style.display = 'none';
    }
    state.quickstart.matchActive = true;
    hideGameModal();
  }

  if (payload.event === 'move_submitted' && challenge) {
    state.challengeStatus = 'active';
    hideGameModal();
  }

  if (payload.event === 'declined' && challenge) {
    state.respondingIncoming = false;
    state.activeChallenge = null;
    state.incomingChallengeId = null;
    state.outgoingChallengeId = null;
    state.challengeStatus = 'declined';
    const reason = payload.reason ? challengeReasonLabel(payload.reason) : '';
    state.challengeMessage = `Challenge declined (${challenge.id})${reason ? ` · ${reason}` : ''}`;
    state.incomingChallengeExpiresAt = null;
    if (challengeTimerWrap) {
      challengeTimerWrap.style.display = 'none';
    }
    hideGameModal();
  }

  if (payload.event === 'expired' && challenge) {
    state.respondingIncoming = false;
    state.activeChallenge = null;
    state.incomingChallengeId = null;
    state.outgoingChallengeId = null;
    state.challengeStatus = 'expired';
    const reason = payload.reason ? challengeReasonLabel(payload.reason) : '';
    state.challengeMessage = `Challenge expired (${challenge.id})${reason ? ` · ${reason}` : ''}`;
    state.incomingChallengeExpiresAt = null;
    if (challengeTimerWrap) {
      challengeTimerWrap.style.display = 'none';
    }
    hideGameModal();
  }

  if (payload.event === 'resolved' && challenge) {
    state.respondingIncoming = false;
    state.activeChallenge = null;
    state.incomingChallengeId = null;
    state.outgoingChallengeId = null;
    state.challengeStatus = 'resolved';
    const winnerLabel = challenge.winnerId ? labelFor(challenge.winnerId) : 'Draw';
    const coinInfo = challenge.gameType === 'coinflip' && challenge.coinflipResult ? ` | Toss: ${challenge.coinflipResult}` : '';
    if (challenge.winnerId === state.playerId) {
      state.streak += 1;
      state.walletBalance += Number(challenge.wager || 0);
    } else if (challenge.winnerId) {
      state.streak = 0;
      state.walletBalance = Math.max(0, state.walletBalance - Number(challenge.wager || 0));
    }
    state.challengeMessage = challenge.winnerId ? `Resolved. Winner: ${winnerLabel}` : 'Resolved. Draw/refund.';
    state.quickstart.matchResolved = true;
    showGameModal(challenge, 'Match resolved', `Winner: ${winnerLabel}${coinInfo}`);
    setTimeout(() => {
      hideGameModal();
    }, 3500);
  }

  if (payload.event === 'invalid' || payload.event === 'busy') {
    state.respondingIncoming = false;
    state.challengeMessage = challengeReasonLabel(payload.reason);
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

function renderContextPanel() {
  if (!challengePanel) {
    return;
  }
  const hasNearby = state.nearbyIds.size > 0;
  const isIncoming = Boolean(state.incomingChallengeId && state.challengeStatus === 'incoming');
  const inMatch = Boolean(state.activeChallenge && state.activeChallenge.status === 'active');
  challengePanel.classList.toggle('active', hasNearby || isIncoming || inMatch);
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
  const targetId = getUiTargetId();
  if (!targetId) {
    interactionPrompt.classList.remove('visible');
    setInteractOpen(false);
    return;
  }
  const distance = state.nearbyDistances.get(targetId);
  const verb = isStaticNpc(targetId) ? 'request game' : 'interact';
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
    { done: state.nearbyIds.size > 0, text: 'Find a nearby player/agent' },
    { done: state.quickstart.challengeSent, text: 'Send or accept a challenge (C / Y)' },
    { done: state.quickstart.matchActive, text: 'Match started' },
    { done: state.quickstart.moveSubmitted, text: 'Submit your move (1/2/3 or H/T)' },
    { done: state.quickstart.matchResolved, text: 'Match resolved and payout posted' }
  ];

  quickstartList.innerHTML = steps
    .map((step) => `<li class="${step.done ? 'done' : ''}">${step.done ? '✓' : '○'} ${step.text}</li>`)
    .join('');
}

function renderMatchControls() {
  if (!matchControls || !matchControlsActions || !matchControlsStatus || !matchControlsTitle) {
    return;
  }

  const challenge = state.activeChallenge;
  const isIncoming = Boolean(state.incomingChallengeId && state.challengeStatus === 'incoming');
  const isParticipant =
    challenge && (challenge.challengerId === state.playerId || challenge.opponentId === state.playerId);

  const shouldShow = Boolean(isIncoming || (challenge && challenge.status === 'active' && isParticipant));
  if (!shouldShow) {
    if (state.deskAutoCollapsedByMatch && challengePanel && deskToggle) {
      state.deskCollapsed = false;
      state.deskAutoCollapsedByMatch = false;
      challengePanel.classList.remove('compact');
      deskToggle.textContent = 'Collapse';
    }
    matchControls.classList.remove('visible');
    matchControlsActions.innerHTML = '';
    matchCounterOffer?.classList.remove('visible');
    return;
  }

  if (!state.deskCollapsed && challengePanel && deskToggle) {
    state.deskCollapsed = true;
    state.deskAutoCollapsedByMatch = true;
    challengePanel.classList.add('compact');
    deskToggle.textContent = 'Expand';
  }

  matchControls.classList.add('visible');
  matchControlsActions.innerHTML = '';

  if (isIncoming && challenge) {
    matchControlsTitle.textContent = 'Incoming Challenge';
    matchControlsStatus.textContent = `${labelFor(challenge.challengerId)} challenged you (${challenge.gameType}, ${formatWagerInline(challenge.wager)}).`;
    matchControlsActions.className = 'match-controls__actions two';
    matchControlsActions.innerHTML = `
      <button type="button" data-action="accept" ${state.respondingIncoming ? 'disabled' : ''}>Accept (Y)</button>
      <button type="button" data-action="decline" ${state.respondingIncoming ? 'disabled' : ''}>Decline (N)</button>
    `;
    if (counterWagerInput) {
      counterWagerInput.value = String(Math.max(0, Number(challenge.wager ?? 1)));
      counterWagerInput.disabled = state.respondingIncoming;
    }
    if (counterSendBtn) {
      counterSendBtn.disabled = state.respondingIncoming;
    }
    matchCounterOffer?.classList.add('visible');
    return;
  }

  if (!challenge) {
    return;
  }
  matchCounterOffer?.classList.remove('visible');

  matchControlsTitle.textContent = challenge.gameType === 'rps' ? 'RPS Match' : 'Coinflip Match';
  matchControlsStatus.textContent = `${labelFor(challenge.challengerId)} vs ${labelFor(challenge.opponentId)} | ${formatWagerLabel(challenge.wager)}`;

  const iAmChallenger = challenge.challengerId === state.playerId;
  const myMove = iAmChallenger ? challenge.challengerMove : challenge.opponentMove;

  if (challenge.gameType === 'rps') {
    matchControlsActions.className = 'match-controls__actions';
    matchControlsActions.innerHTML = `
      <button type="button" data-move="rock" ${myMove ? 'disabled' : ''}>Rock (1)</button>
      <button type="button" data-move="paper" ${myMove ? 'disabled' : ''}>Paper (2)</button>
      <button type="button" data-move="scissors" ${myMove ? 'disabled' : ''}>Scissors (3)</button>
    `;
  } else {
    matchControlsActions.className = 'match-controls__actions two';
    matchControlsActions.innerHTML = `
      <button type="button" data-move="heads" ${myMove ? 'disabled' : ''}>Heads (H)</button>
      <button type="button" data-move="tails" ${myMove ? 'disabled' : ''}>Tails (T)</button>
    `;
  }

  if (myMove) {
    matchControlsStatus.textContent = `${matchControlsStatus.textContent} | Locked: ${myMove}. Waiting for opponent.`;
  }
}

matchControlsActions?.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  const action = target.dataset.action;
  if (action === 'accept') {
    respondToIncoming(true);
    return;
  }
  if (action === 'decline') {
    respondToIncoming(false);
    return;
  }
  const move = target.dataset.move;
  if (move) {
    sendGameMove(move);
  }
});

counterSendBtn?.addEventListener('click', () => {
  sendCounterOffer();
});

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
