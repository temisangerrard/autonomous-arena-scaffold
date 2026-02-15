import { THREE, installResizeHandler, loadWorldWithProgress, makeCamera, makeRenderer, makeScene } from '../world-common.js';
import { getDom } from './dom.js';
import { WORLD_BOUND, createInitialState } from './state.js';
import { createToaster } from './ui/toast.js';
import { createAnnouncer } from './ui/sr.js';
import { initOnboarding } from './ui/onboarding.js';
import { AVATAR_GROUND_OFFSET, animateAvatar, createAvatarSystem } from './avatars.js';
import { createInputSystem } from './input.js';
import { initMenu } from './menu.js';
import { createPresence } from './ws.js';

const dom = getDom();
const queryParams = new URL(window.location.href).searchParams;

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

const state = createInitialState();
initMenu(dom, { queryParams });

const presence = createPresence({ queryParams });
presence.installOfflineBeacon();

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
        signal: controller.signal
      });
      window.clearTimeout(timeout);
      if (!cfgRes.ok) return null;
      const cfg = await cfgRes.json();
      if (cfg && typeof cfg === 'object') {
        window.__ARENA_CONFIG = cfg;
        if (!window.ARENA_CONFIG) {
          window.ARENA_CONFIG = cfg;
        }
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
  const sameOrigin = window.location.protocol === 'https:'
    ? `wss://${window.location.host}${wsPath}`
    : `ws://${window.location.host}${wsPath}`;
  return sameOrigin;
}

let socket = null;
const socketRef = { current: null };
let presenceTimer = null;

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
        signal: controller.signal
      });
      window.clearTimeout(timeout);
      if (meResponse.status === 401 || meResponse.status === 403) {
        // Hard gate: no unauthenticated play access (even if static hosting bypasses /play routing).
        localStorage.removeItem('arena_last_name');
        window.location.href = '/welcome';
        return;
      }
      if (meResponse.ok) {
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
      }
    } catch {
      // If auth is flaky, fail closed: no unauthenticated play.
      window.location.href = '/welcome';
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

  const wsUrl = wsUrlObj.toString();
  socket = new WebSocket(wsUrl);
  socketRef.current = socket;

  socket.addEventListener('open', () => {
    state.wsConnected = true;
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
  state.cameraYaw = me.displayYaw;
  state.cameraYawInitialized = true;
}

const inputSystem = createInputSystem({
  THREE,
  state,
  dom,
  socketRef,
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

  // Initialize the camera yaw from the player's current yaw exactly once so
  // the initial spawn camera "looks correct" without making camera orbit depend
  // on ongoing server-authoritative yaw updates.
  if (!state.cameraYawInitialized) {
    state.cameraYaw = local.displayYaw;
    state.cameraYawInitialized = true;
  }

  const active = state.activeChallenge;
  const inMatch = active && active.status === 'active' && (active.challengerId === state.playerId || active.opponentId === state.playerId);
  const opponentId =
    inMatch && active
      ? (active.challengerId === state.playerId ? active.opponentId : active.challengerId)
      : null;
  const opponent = opponentId ? state.players.get(opponentId) : null;

  if (inMatch && opponent) {
    const cx = (local.displayX + opponent.displayX) * 0.5;
    const cz = (local.displayZ + opponent.displayZ) * 0.5;
    const dx = opponent.displayX - local.displayX;
    const dz = opponent.displayZ - local.displayZ;
    const len = Math.max(0.001, Math.hypot(dx, dz));
    const nx = dx / len;
    const nz = dz / len;
    const sideX = -nz;
    const sideZ = nx;
    const desired = new THREE.Vector3(
      cx + sideX * 4.2 - nx * 1.1,
      Math.max(local.displayY, opponent.displayY) + AVATAR_GROUND_OFFSET + 3.3,
      cz + sideZ * 4.2 - nz * 1.1
    );
    camera.position.lerp(desired, 0.12);
    camera.lookAt(cx, local.displayY + AVATAR_GROUND_OFFSET + 1.0, cz);

    // IMPORTANT: Sync cameraYaw to match camera's actual facing direction during match
    // This ensures movement input (computed from cameraYaw) matches the visual camera direction
    const camDx = cx - camera.position.x;
    const camDz = cz - camera.position.z;
    const matchYaw = Math.atan2(camDx, camDz);
    state.cameraYaw = matchYaw;

    return;
  }

  // Camera orbit is controlled by the player, not by the character yaw.
  const yaw = state.cameraYaw;
  const forwardX = Math.sin(yaw);
  const forwardZ = Math.cos(yaw);

  // Use the zoom-adjustable camera distance
  const followDistance = state.cameraDistance;
  const followHeight = 1.8 + state.cameraPitch * 2.6;

  const desired = new THREE.Vector3(
    local.displayX - forwardX * followDistance,
    local.displayY + AVATAR_GROUND_OFFSET + followHeight,
    local.displayZ - forwardZ * followDistance
  );

  camera.position.lerp(desired, 0.14);
  camera.lookAt(local.displayX, local.displayY + AVATAR_GROUND_OFFSET + 1.15, local.displayZ);
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
  if (!target) {
    targetSpotlight.visible = false;
    return;
  }
  targetSpotlight.visible = true;
  targetSpotlight.position.x = target.displayX;
  targetSpotlight.position.z = target.displayZ;
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
  interactionTitle.textContent = `Challenge: ${labelFor(targetId)}`;
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
  inputSystem.sendInput(nowMs);
  updateLocalAvatar();
  syncRemoteAvatars(state, state.playerId);
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
  return player?.displayName || state.nearbyNames.get(id) || id;
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
    const role = state.players.get(id)?.role === 'agent' ? 'agent' : 'human';
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

function getUiTargetId() {
  const preferred = state.ui?.targetId || '';
  if (preferred && state.nearbyIds.has(preferred)) {
    return preferred;
  }
  const closest = closestNearbyTargetId();
  if (closest) {
    state.ui.targetId = closest;
  }
  return closest;
}

function cycleNearbyTarget(next = true) {
  const ids = [...state.nearbyIds];
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
      interactionWager.value = String(Math.max(1, Math.min(10000, Number(interactionWager.value || 1))));
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
  const wager = Math.max(1, Math.min(10000, Number(wagerSource?.value || 1)));

  socket.send(
    JSON.stringify({
      type: 'challenge_send',
      targetId,
      gameType,
      wager
    })
  );

  state.challengeStatus = 'sent';
  state.challengeMessage = `Challenge sent (${gameType}, wager ${wager}) to ${labelFor(targetId)}`;
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
  const wager = Math.max(1, Math.min(10000, Number(counterWagerInput?.value || challenge.wager || 1)));
  state.respondingIncoming = true;
  state.challengeStatus = 'responding';
  state.challengeMessage = `Countering with wager ${wager}...`;

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
  gamePlayers.textContent = `${labelFor(challenge.challengerId)} vs ${labelFor(challenge.opponentId)} | Wager ${challenge.wager}`;
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
      state.challengeMessage = `Incoming ${challenge.gameType} challenge from ${labelFor(challenge.challengerId)} (wager ${challenge.wager}).`;
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
        `${labelFor(challenge.challengerId)} challenges you to ${challenge.gameType.toUpperCase()} for ${challenge.wager}. Accept as-is, or counter with your own wager (O).`
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
      return 'Both players need funded wallets to start wagered matches.';
    case 'challenger_wallet_policy_disabled':
    case 'opponent_wallet_policy_disabled':
      return 'Wallet policy disabled. Enable wallet skills in Agents page.';
    case 'challenger_insufficient_balance':
    case 'opponent_insufficient_balance':
      return 'One player has insufficient balance for this wager.';
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
  interactionPrompt.textContent = `Near ${labelFor(targetId)}${typeof distance === 'number' ? ` (${distance.toFixed(1)}m)` : ''}. E interact · Tab switch · V profile`;
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
    matchControlsStatus.textContent = `${labelFor(challenge.challengerId)} challenged you (${challenge.gameType}, wager ${challenge.wager}).`;
    matchControlsActions.className = 'match-controls__actions two';
    matchControlsActions.innerHTML = `
      <button type="button" data-action="accept" ${state.respondingIncoming ? 'disabled' : ''}>Accept (Y)</button>
      <button type="button" data-action="decline" ${state.respondingIncoming ? 'disabled' : ''}>Decline (N)</button>
    `;
    if (counterWagerInput) {
      counterWagerInput.value = String(Math.max(1, Number(challenge.wager || 1)));
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
  matchControlsStatus.textContent = `${labelFor(challenge.challengerId)} vs ${labelFor(challenge.opponentId)} | Wager ${challenge.wager}`;

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
  const desired = inputSystem.computeInputVector();
  return JSON.stringify({
    mode: 'play',
    wsConnected: state.wsConnected,
    playerId: state.playerId,
    worldAlias: state.worldAlias,
    worldLoaded: state.worldLoaded,
    tick: state.tick,
    coords: 'origin at world center, +X right, +Z forward, +Y up',
    cameraYaw: state.cameraYaw,
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
