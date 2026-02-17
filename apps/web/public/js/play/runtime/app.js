import { THREE, installResizeHandler, loadWorldWithProgress, makeCamera, makeRenderer, makeScene } from '../../world-common.js';
import { getDom } from '../dom.js';
import { WORLD_BOUND, createInitialState } from '../state.js';
import { createToaster } from '../ui/toast.js';
import { createAnnouncer } from '../ui/sr.js';
import { initOnboarding } from '../ui/onboarding.js';
import { AVATAR_GROUND_OFFSET, animateAvatar, createAvatarSystem } from '../avatars.js';
import { createStationSystem } from '../stations.js';
import { createInputSystem } from '../input.js';
import { initMenu } from '../menu.js';
import { createPresence } from '../ws.js';
import { createCameraController } from '../camera.js';
import { createMovementSystem } from '../movement.js';
import { createChallengeController, normalizedChallengeGameType, normalizedChallengeWager } from '../challenge.js';
import { createPluginRegistry } from './contracts.js';
import { shouldEnableFlag } from './network.js';
import { renderTopHud, renderNextActionLine } from './hud.js';
import { renderMinimap } from './minimap.js';
import { renderQuickstart as renderQuickstartModule } from './quickstart.js';
import { describeInteractionPhase } from './interactions.js';
import { coinflipGamePlugin } from '../plugins/games/coinflip.js';
import { rpsGamePlugin } from '../plugins/games/rps.js';
import { diceDuelGamePlugin } from '../plugins/games/dice-duel.js';
import { dealerStationPlugin } from '../plugins/stations/dealer.js';
import { cashierStationPlugin } from '../plugins/stations/cashier.js';
import { dealerOperatorNpcPlugin } from '../plugins/npc-operator.js';

const dom = getDom();
const queryParams = new URL(window.location.href).searchParams;
const featureMobileV2 = shouldEnableFlag('MOBILE_LAYOUT_V2_ENABLED');
const featureDirectioningV2 = shouldEnableFlag('DIRECTIONING_V2_ENABLED');

const pluginRegistry = createPluginRegistry();
pluginRegistry.registerGame(coinflipGamePlugin);
pluginRegistry.registerGame(rpsGamePlugin);
pluginRegistry.registerGame(diceDuelGamePlugin);
pluginRegistry.registerStation(dealerStationPlugin);
pluginRegistry.registerStation(cashierStationPlugin);
pluginRegistry.registerNpc(dealerOperatorNpcPlugin);

function buildSessionHeaders(existingHeaders) {
  return new Headers(existingHeaders || {});
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
    const after = Number(summary?.onchain?.tokenBalance);
    const chainId = Number(summary?.onchain?.chainId);
    state.walletChainId = Number.isFinite(chainId) ? chainId : null;
    syncEscrowApprovalPolicy();
    if (Number.isFinite(after)) {
      state.walletBalance = after;
    } else {
      state.walletBalance = null;
    }
    if (challenge && Number.isFinite(after)) {
      const settledByOutcome = challenge.winnerId === state.playerId
        ? Number(challenge.wager || 0)
        : challenge.winnerId
          ? -Number(challenge.wager || 0)
          : 0;
      const delta = Number.isFinite(settledByOutcome)
        ? Number(settledByOutcome.toFixed(2))
        : Number((after - Number(beforeBalance || 0)).toFixed(2));
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
    state.walletBalance = null;
    state.walletChainId = null;
    syncEscrowApprovalPolicy();
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
  mobileTarget,
  mobileSend,
  mobileAccept,
  mobileDecline,
  mobileMoves,
  mobileMove1,
  mobileMove2,
  mobileMove3,
  mobileMoveH,
  mobileMoveT,
  mobileMoveD1,
  mobileMoveD2,
  mobileMoveD3,
  mobileMoveD4,
  mobileMoveD5,
  mobileMoveD6
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

const SEPOLIA_CHAIN_IDS = new Set([11155111, 84532]);
const MAINNET_CHAIN_IDS = new Set([1, 8453]);

function normalizeApprovalMode(value, fallback = 'manual') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'auto') return 'auto';
  if (raw === 'manual') return 'manual';
  return fallback;
}

function classifyApprovalNetwork(chainId, chainHint = '') {
  const id = Number(chainId);
  if (Number.isFinite(id)) {
    if (SEPOLIA_CHAIN_IDS.has(id)) return 'sepolia';
    if (MAINNET_CHAIN_IDS.has(id)) return 'mainnet';
  }
  const hint = String(chainHint || '').toLowerCase();
  if (hint.includes('sepolia') || hint.includes('testnet')) return 'sepolia';
  if (hint.includes('mainnet') || hint === 'main' || hint === 'prod') return 'mainnet';
  return 'unknown';
}

function resolveEscrowApprovalForClient(chainId = null) {
  const policy = window.ARENA_CONFIG?.escrowApprovalPolicy || {};
  const fallback = policy?.effective || {};
  const modeSepolia = normalizeApprovalMode(policy.modeSepolia, 'auto');
  const modeMainnet = normalizeApprovalMode(policy.modeMainnet, 'manual');
  const defaultMode = normalizeApprovalMode(policy.defaultMode, normalizeApprovalMode(fallback.mode, 'manual'));
  const network = classifyApprovalNetwork(
    chainId,
    policy.chainHint || fallback.network || ''
  );
  const mode = network === 'sepolia'
    ? modeSepolia
    : network === 'mainnet'
      ? modeMainnet
      : defaultMode;
  return {
    mode,
    network,
    reason: network === 'unknown' ? 'fallback:default_mode' : `network:${network}`,
    source: chainId == null ? 'config' : 'chain',
    autoApproveMaxWager: Number.isFinite(Number(policy.autoApproveMaxWager))
      ? Number(policy.autoApproveMaxWager)
      : null,
    autoApproveDailyCap: Number.isFinite(Number(policy.autoApproveDailyCap))
      ? Number(policy.autoApproveDailyCap)
      : null
  };
}

function syncEscrowApprovalPolicy() {
  state.escrowApproval = resolveEscrowApprovalForClient(state.walletChainId);
}

syncEscrowApprovalPolicy();

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
        syncEscrowApprovalPolicy();
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
  const host = String(window.location.hostname || '').toLowerCase();
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  // Local dev/test should not inherit deployed `serverOrigin` baked into runtime-config.js.
  // Use same-origin ws endpoint so local web/server ports remain aligned.
  if (isLocalHost) {
    return window.location.protocol === 'https:'
      ? `wss://${window.location.host}${wsPath}`
      : `ws://${window.location.host}${wsPath}`;
  }
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

function formatUsdAmount(value, options = {}) {
  const amount = Number(value || 0);
  const signed = options.signed === true;
  if (!Number.isFinite(amount)) {
    return signed ? '$0.00' : '$0.00';
  }
  if (signed) {
    const sign = amount > 0 ? '+' : amount < 0 ? '-' : '';
    return `${sign}$${Math.abs(amount).toFixed(2)}`;
  }
  return `$${amount.toFixed(2)}`;
}

function validTxHash(txHash) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(txHash || ''));
}

function txExplorerBase(chainId) {
  const id = Number(chainId);
  if (id === 1) return 'https://etherscan.io';
  if (id === 11155111) return 'https://sepolia.etherscan.io';
  if (id === 8453) return 'https://basescan.org';
  if (id === 84532) return 'https://sepolia.basescan.org';
  return 'https://sepolia.etherscan.io';
}

function txExplorerUrl(txHash, chainId = null) {
  const normalizedHash = String(txHash || '').trim();
  if (!validTxHash(normalizedHash)) {
    return '';
  }
  return `${txExplorerBase(chainId)}/tx/${normalizedHash}`;
}

function renderDealerRevealStatus(statusEl, params) {
  if (!statusEl) return;
  const toss = String(params.coinflipResult || '').toUpperCase() || 'UNKNOWN';
  const round = formatUsdAmount(params.delta, { signed: true });
  const balance = Number(params.walletBalance);
  const balanceLabel = Number.isFinite(balance)
    ? ` · Balance: ${formatUsdAmount(balance)}`
    : '';
  const txHash = String(params.txHash || '').trim();
  const txUrl = txExplorerUrl(txHash, params.chainId);
  const txLink = txUrl
    ? ` · <a class="tx-link" href="${txUrl}" target="_blank" rel="noreferrer noopener">View onchain</a>`
    : '';
  statusEl.innerHTML = `Result: ${toss} · Round: ${round}${balanceLabel}${txLink}`;
}

function formatWagerLabel(wager) {
  const value = Number(wager || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return 'Free';
  }
  return `Wager ${formatUsdAmount(value)} USDC`;
}

function formatWagerInline(wager) {
  const value = Number(wager || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return 'free';
  }
  return `${formatUsdAmount(value)} USDC each`;
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
  // Never forward cookie-session query fallbacks to game WS.
  // WS auth must use signed wsAuth tokens.
  wsUrlObj.searchParams.delete('sid');
  wsUrlObj.searchParams.delete('arena_sid');
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
      if (mePayload?.bot && mePayload.bot.connected === false) {
        state.challengeMessage = 'Offline bot is currently disconnected. Controls still work, but that bot will not appear until runtime reconnects.';
      }
      // In local/dev environments wsAuth may be intentionally absent when
      // GAME_WS_AUTH_SECRET is not configured. In that mode the server accepts
      // cookie-authenticated websocket sessions, so do not hard-fail here.
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
    scheduleConnectRetry('Connection lost.');
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
          radius: Number(station.radius || 0),
          interactionTag: String(station.interactionTag || ''),
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
    const station = state.stations instanceof Map ? state.stations.get(payload.stationId) : null;
    if (station?.kind === 'world_interactable') {
      const method = String(view.method || '');
      const useLabel = String(view.reasonText || 'Use');
      state.ui.world.stationId = payload.stationId;
      state.ui.world.interactionTag = String(view.reasonCode || station.interactionTag || '');
      state.ui.world.title = station.displayName || 'World Interaction';
      state.ui.world.detail = method || useLabel || 'Interaction ready.';
      state.ui.world.actionLabel = stateName === 'dealer_reveal' ? 'Used' : useLabel;
      if (!ok || stateName === 'dealer_error') {
        showToast(state.ui.world.detail || 'Interaction failed.');
      }
      return;
    }
    if (!ok || stateName === 'dealer_error') {
      const resolvedReasonText = reasonText || dealerReasonLabel(reason, reasonCode);
      state.ui.dealer.state = 'error';
      state.ui.dealer.reason = reason || 'request_failed';
      state.ui.dealer.reasonCode = reasonCode;
      state.ui.dealer.reasonText = resolvedReasonText;
      state.ui.dealer.preflight = preflight;
      addFeedEvent(
        'system',
        `Station ${labelFor(payload.stationId)}: ${resolvedReasonText || reason || 'request_failed'}${reasonCode ? ` [${reasonCode}]` : ''}`
      );
      showToast(resolvedReasonText || `Station error: ${reason || 'request_failed'}`);
      return;
    }
    if (stateName === 'dealer_ready' || stateName === 'dealer_ready_rps' || stateName === 'dealer_ready_dice') {
      state.quickstart.challengeSent = true;
      state.ui.dealer.stationId = payload.stationId;
      state.ui.dealer.state = 'ready';
      state.ui.dealer.gameType =
        stateName === 'dealer_ready_rps' ? 'rps' : stateName === 'dealer_ready_dice' ? 'dice_duel' : 'coinflip';
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
    if (stateName === 'dealer_reveal' || stateName === 'dealer_reveal_rps' || stateName === 'dealer_reveal_dice') {
      state.quickstart.matchResolved = true;
      state.ui.dealer.state = 'reveal';
      state.ui.dealer.gameType =
        stateName === 'dealer_reveal_rps' ? 'rps' : stateName === 'dealer_reveal_dice' ? 'dice_duel' : 'coinflip';
      state.ui.dealer.reason = '';
      state.ui.dealer.reasonCode = '';
      state.ui.dealer.reasonText = '';
      state.ui.dealer.challengeId = String(view.challengeId || '');
      state.ui.dealer.playerPick = String(view.playerPick || '');
      state.ui.dealer.coinflipResult = String(view.coinflipResult || '');
      state.ui.dealer.diceResult = Number(view.diceResult || 0);
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

function isEscrowApprovalReason(reason) {
  const raw = String(reason || '').toLowerCase();
  return raw === 'allowance_too_low'
    || raw === 'approve_failed'
    || raw === 'wallet_prepare_failed'
    || raw === 'player_allowance_low'
    || raw.includes('allowance');
}

async function ensureEscrowApproval(wager) {
  const amount = Math.max(0, Number(wager || 0));
  const approvalMode = String(state.escrowApproval?.mode || 'manual');
  if (!(amount > 0)) {
    state.ui.challenge.approvalState = 'idle';
    state.ui.challenge.approvalMessage = '';
    state.ui.challenge.approvalWager = 0;
    return true;
  }
  if (approvalMode === 'auto') {
    state.ui.challenge.approvalState = 'ready';
    state.ui.challenge.approvalWager = amount;
    state.ui.challenge.approvalMessage = `Testnet mode: approvals handled automatically for ${formatUsdAmount(amount)}.`;
    return true;
  }

  state.ui.challenge.approvalState = 'checking';
  state.ui.challenge.approvalMessage = `Preparing escrow approval for ${formatUsdAmount(amount)}...`;
  try {
    const payload = await apiJson('/api/player/wallet/prepare-escrow', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount })
    });
    const first = Array.isArray(payload?.results) ? payload.results[0] : null;
    if (first?.ok) {
      state.ui.challenge.approvalState = 'ready';
      state.ui.challenge.approvalWager = amount;
      state.ui.challenge.approvalMessage = `Escrow approval ready for ${formatUsdAmount(amount)}.`;
      return true;
    }
    const reason = String(first?.reason || payload?.reason || 'wallet_prepare_failed');
    state.ui.challenge.approvalState = 'required';
    state.ui.challenge.approvalWager = 0;
    state.ui.challenge.approvalMessage = challengeReasonLabel(reason);
    showToast(state.ui.challenge.approvalMessage);
    return false;
  } catch (error) {
    state.ui.challenge.approvalState = 'required';
    state.ui.challenge.approvalWager = 0;
    state.ui.challenge.approvalMessage = challengeReasonLabel(
      String(error?.message || 'wallet_prepare_failed')
    );
    showToast(state.ui.challenge.approvalMessage);
    return false;
  }
}

const challengeController = createChallengeController({
  state,
  socketRef,
  showToast,
  labelFor,
  isStation,
  closestNearbyPlayerId,
  getUiTargetId,
  formatWagerInline,
  ensureEscrowApproval
});

const inputSystem = createInputSystem({
  state,
  dom,
  actions: {
    resetCameraBehindPlayer,
    setInteractOpen,
    getUiTargetId,
    cycleNearbyTarget,
    sendGameMove,
    sendChallenge: challengeController.sendChallenge,
    respondToIncoming: challengeController.respondToIncoming,
    canUseChallengeHotkeys: challengeController.canUseChallengeHotkeys
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

  const localError = Math.hypot(local.x - local.displayX, local.z - local.displayZ);
  if (localError > 0.9) {
    local.displayX = local.x;
    local.displayY = local.y;
    local.displayZ = local.z;
  } else {
    local.displayX += (local.x - local.displayX) * 0.36;
    local.displayY += (local.y - local.displayY) * 0.36;
    local.displayZ += (local.z - local.displayZ) * 0.36;
  }
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

function applyDisplaySeparation() {
  const ids = [...state.players.keys()];
  if (ids.length < 2) return;
  const minDist = 1.5;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = state.players.get(ids[i]);
        const b = state.players.get(ids[j]);
        if (!a || !b) continue;
        let dx = (b.displayX ?? b.x) - (a.displayX ?? a.x);
        let dz = (b.displayZ ?? b.z) - (a.displayZ ?? a.z);
        const distSq = dx * dx + dz * dz;
        if (distSq >= minDist * minDist) continue;
        let dist = Math.sqrt(distSq);
        if (dist < 0.0001) {
          dx = 1;
          dz = 0;
          dist = 1;
        }
        const nx = dx / dist;
        const nz = dz / dist;
        const push = (minDist - dist) * 0.5;
        a.displayX -= nx * push;
        a.displayZ -= nz * push;
        b.displayX += nx * push;
        b.displayZ += nz * push;
      }
    }
  }
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
  const targetPlayer = state.players.get(targetId);
  if (station && state.ui.interactionMode !== 'station') {
    state.ui.interactionMode = 'station';
  }
  if (!station && targetPlayer && state.ui.interactionMode !== 'player') {
    state.ui.interactionMode = 'player';
  }
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
            <label for="station-wager">Wager (each, USDC)</label>
            <input id="station-wager" type="number" min="0" max="10000" step="1" value="${Math.max(0, Math.min(10000, Number(state.ui.dealer.wager || 1)))}" />
          </div>
          <div class="station-ui__actions">
            <button id="station-house-start" class="btn-gold" type="button">Start Round</button>
          </div>
          <div class="station-ui__actions" id="station-pick-actions" style="display:none;">
            <button id="station-house-heads" class="btn-gold" type="button">Heads</button>
            <button id="station-house-tails" class="btn-gold" type="button">Tails</button>
          </div>
          <div class="station-ui__meta" id="station-status">Start to receive house commit hash, then pick a side. Wagers are in USDC (displayed as $). Press Esc to close this panel and return to movement.</div>
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
            statusEl.textContent = 'Preflight check... validating player + house wallets. Press Esc to close panel.';
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
            statusEl.textContent = `Commit ${state.ui.dealer.commitHash.slice(0, 12)}... received. Pick heads or tails (Esc closes panel).`;
          }
        }
        if (state.ui.dealer.state === 'preflight') {
          if (pickActions) pickActions.style.display = 'none';
          if (statusEl) {
            statusEl.textContent = 'Preflight check... (Esc closes panel)';
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
      } else if (station.kind === 'dealer_rps' || station.kind === 'dealer_dice_duel') {
        const isRps = station.kind === 'dealer_rps';
        const gameLabel = isRps ? 'RPS' : 'Dice Duel';
        const startAction = isRps ? 'rps_house_start' : 'dice_duel_start';
        const pickAction = isRps ? 'rps_house_pick' : 'dice_duel_pick';
        stationUi.innerHTML = `
          <div class="station-ui__title">Dealer: ${gameLabel}</div>
          <div class="station-ui__row">
            <label for="station-wager">Wager (each, USDC)</label>
            <input id="station-wager" type="number" min="0" max="10000" step="1" value="${Math.max(0, Math.min(10000, Number(state.ui.dealer.wager || 1)))}" />
          </div>
          <div class="station-ui__actions">
            <button id="station-house-start" class="btn-gold" type="button">Start Round</button>
          </div>
          <div class="station-ui__actions" id="station-pick-actions" style="display:none;">
            ${isRps
              ? '<button id="station-house-r" class="btn-gold" type="button">Rock</button><button id="station-house-p" class="btn-gold" type="button">Paper</button><button id="station-house-s" class="btn-gold" type="button">Scissors</button>'
              : '<button id="station-house-d1" class="btn-gold" type="button">1</button><button id="station-house-d2" class="btn-gold" type="button">2</button><button id="station-house-d3" class="btn-gold" type="button">3</button><button id="station-house-d4" class="btn-gold" type="button">4</button><button id="station-house-d5" class="btn-gold" type="button">5</button><button id="station-house-d6" class="btn-gold" type="button">6</button>'
            }
          </div>
          <div class="station-ui__meta" id="station-status">Start to receive commit hash, then pick your move. Press Esc to close.</div>
        `;

        const wagerEl = document.getElementById('station-wager');
        const startBtn = document.getElementById('station-house-start');
        const pickActions = document.getElementById('station-pick-actions');
        const statusEl = document.getElementById('station-status');

        if (startBtn) {
          startBtn.onclick = () => {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
              showToast('Not connected to server.');
              return;
            }
            const wager = Math.max(0, Math.min(10000, Number(wagerEl?.value || 0)));
            socket.send(JSON.stringify({
              type: 'station_interact',
              stationId: station.id,
              action: startAction,
              wager
            }));
            state.ui.dealer.state = 'preflight';
            state.ui.dealer.wager = wager;
            state.ui.dealer.gameType = isRps ? 'rps' : 'dice_duel';
            if (statusEl) {
              statusEl.textContent = 'Preflight check...';
            }
          };
        }

        const picks = isRps ? ['rock', 'paper', 'scissors'] : ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
        for (const pick of picks) {
          const id = isRps
            ? `station-house-${pick.charAt(0)}`
            : `station-house-${pick}`;
          const btn = document.getElementById(id);
          if (!(btn instanceof HTMLButtonElement)) continue;
          btn.onclick = () => {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
              showToast('Not connected to server.');
              return;
            }
            socket.send(JSON.stringify({
              type: 'station_interact',
              stationId: station.id,
              action: pickAction,
              pick,
              playerSeed: makePlayerSeed()
            }));
            state.ui.dealer.state = 'dealing';
            if (statusEl) {
              statusEl.textContent = `Dealing ${gameLabel}...`;
            }
          };
        }

        if (pickActions && state.ui.dealer.state === 'ready' && state.ui.dealer.stationId === station.id) {
          pickActions.style.display = 'flex';
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
            const bal = Number(summary?.onchain?.tokenBalance);
            const chainId = Number(summary?.onchain?.chainId);
            state.walletChainId = Number.isFinite(chainId) ? chainId : null;
            syncEscrowApprovalPolicy();
            if (!Number.isFinite(bal)) {
              balanceEl.textContent = 'Balance: unavailable (onchain)';
              state.walletBalance = null;
              return;
            }
            state.walletBalance = bal;
            balanceEl.textContent = `Balance: ${formatUsdAmount(bal)} USDC`;
          } catch (err) {
            state.walletBalance = null;
            state.walletChainId = null;
            syncEscrowApprovalPolicy();
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
      } else if (station.kind === 'world_interactable') {
        const detail = state.ui.world.stationId === station.id
          ? state.ui.world.detail
          : 'Interact with this world object.';
        const actionLabel = state.ui.world.stationId === station.id
          ? state.ui.world.actionLabel
          : 'Use';
        stationUi.innerHTML = `
          <div class="station-ui__title">${station.displayName}</div>
          <div class="station-ui__meta" id="world-interaction-detail">${detail}</div>
          <div class="station-ui__actions">
            <button id="world-interaction-open" class="btn-ghost" type="button">Inspect</button>
            <button id="world-interaction-use" class="btn-gold" type="button">${actionLabel}</button>
          </div>
        `;
        const openBtn = document.getElementById('world-interaction-open');
        const useBtn = document.getElementById('world-interaction-use');
        const detailEl = document.getElementById('world-interaction-detail');
        if (openBtn) {
          openBtn.onclick = () => {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
              showToast('Not connected to server.');
              return;
            }
            socket.send(JSON.stringify({
              type: 'station_interact',
              stationId: station.id,
              action: 'interact_open'
            }));
          };
        }
        if (useBtn) {
          useBtn.onclick = () => {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
              showToast('Not connected to server.');
              return;
            }
            socket.send(JSON.stringify({
              type: 'station_interact',
              stationId: station.id,
              action: 'interact_use',
              interactionTag: String(station.interactionTag || '')
            }));
            if (detailEl) {
              detailEl.textContent = 'Using interaction...';
            }
          };
        }
        if (socket && socket.readyState === WebSocket.OPEN && state.ui.world.stationId !== station.id) {
          socket.send(JSON.stringify({
            type: 'station_interact',
            stationId: station.id,
            action: 'interact_open'
          }));
        }
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
          statusEl.textContent = `Commit ${state.ui.dealer.commitHash.slice(0, 12)}... received. Pick heads or tails (Esc closes panel).`;
        }
      } else if (state.ui.dealer.state === 'preflight') {
        if (startBtn) startBtn.disabled = true;
        if (headsBtn) headsBtn.disabled = true;
        if (tailsBtn) tailsBtn.disabled = true;
        if (pickActions) pickActions.style.display = 'none';
        if (statusEl) {
          statusEl.textContent = 'Preflight check... (Esc closes panel)';
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
          renderDealerRevealStatus(statusEl, {
            coinflipResult: state.ui.dealer.coinflipResult,
            delta,
            txHash: tx,
            walletBalance: state.walletBalance,
            chainId: state.walletChainId
          });
        }
      }
    }
    return;
  }

  stationUi.hidden = true;
  stationUi.style.display = 'none';
  stationUi.innerHTML = '';
  interactionStationRenderKey = '';
  if (interactionNpcInfo && targetPlayer && state.ui.interactionMode === 'player') {
    interactionTitle.textContent = `Challenge: ${labelFor(targetId)}`;
    interactionNpcInfo.hidden = false;
    interactionNpcInfo.style.display = 'grid';
    const incoming = challengeController.currentIncomingChallenge();
    const outgoingPending = Boolean(state.outgoingChallengeId);
    const canSendBase = state.wsConnected && !state.respondingIncoming && !outgoingPending && targetId !== state.playerId;
    const selectedGame = normalizedChallengeGameType(state.ui?.challenge?.gameType || 'rps');
    const selectedWager = normalizedChallengeWager(state.ui?.challenge?.wager ?? 1, 1);
    const approvalMode = String(state.escrowApproval?.mode || 'manual');
    const approvalModeAuto = approvalMode === 'auto';
    const approvalState = String(state.ui?.challenge?.approvalState || 'idle');
    const approvalMessage = String(state.ui?.challenge?.approvalMessage || '').trim();
    const approvalReady = approvalState === 'ready' && Number(state.ui?.challenge?.approvalWager || 0) >= selectedWager;
    const canSend = canSendBase && (selectedWager <= 0 || approvalModeAuto || approvalReady);
    const approvalHint = selectedWager > 0
      ? (approvalModeAuto
          ? 'Super Agent Approval Active (Testnet). Wagered challenges are prepared automatically.'
          : (approvalMessage || (approvalReady
              ? `Escrow approval ready for ${formatUsdAmount(selectedWager)}.`
              : `Approve escrow to place wager (${formatUsdAmount(selectedWager)}).`)))
      : 'Free wager selected. No escrow approval needed.';
    const incomingLabel = incoming
      ? `${labelFor(incoming.challengerId)} challenged you (${incoming.gameType.toUpperCase()}, ${formatWagerInline(incoming.wager)}).`
      : '';
    interactionNpcInfo.innerHTML = `
      <div class="station-ui__title">${labelFor(targetId)}</div>
      <div class="station-ui__row">
        <label for="player-challenge-game">Game</label>
        <select id="player-challenge-game">
          <option value="rps" ${selectedGame === 'rps' ? 'selected' : ''}>Rock Paper Scissors</option>
          <option value="coinflip" ${selectedGame === 'coinflip' ? 'selected' : ''}>Coin Flip</option>
          <option value="dice_duel" ${selectedGame === 'dice_duel' ? 'selected' : ''}>Dice Duel</option>
        </select>
      </div>
      <div class="station-ui__row">
        <label for="player-challenge-wager">Wager (each, USDC)</label>
        <input id="player-challenge-wager" type="number" min="0" max="10000" step="1" value="${selectedWager}" />
      </div>
      ${approvalModeAuto
        ? '<div class="station-ui__meta">Super Agent Approval Active (Testnet)</div>'
        : `<div class="station-ui__actions">
          <button id="player-challenge-approve" class="btn-ghost" type="button" ${(selectedWager > 0 && approvalState !== 'checking') ? '' : 'disabled'}>
            ${approvalState === 'checking' ? 'Approving...' : 'Approve Escrow'}
          </button>
        </div>`}
      <div class="station-ui__actions">
        <button id="player-challenge-send" class="btn-gold" type="button" ${canSend ? '' : 'disabled'}>Send Challenge (C)</button>
      </div>
      <div class="station-ui__actions">
        <button id="player-challenge-accept" class="btn-ghost" type="button" ${(incoming && !state.respondingIncoming) ? '' : 'disabled'}>Accept (Y)</button>
        <button id="player-challenge-decline" class="btn-ghost" type="button" ${(incoming && !state.respondingIncoming) ? '' : 'disabled'}>Decline (N)</button>
      </div>
      <div class="station-ui__meta">${incomingLabel || `Pick a game and send a challenge. ${outgoingPending ? 'You already have a pending outgoing challenge.' : ''}`}</div>
      <div class="station-ui__meta">${approvalHint}</div>
    `;
    const gameEl = document.getElementById('player-challenge-game');
    const wagerEl = document.getElementById('player-challenge-wager');
    const approveBtn = document.getElementById('player-challenge-approve');
    const sendBtn = document.getElementById('player-challenge-send');
    const acceptBtn = document.getElementById('player-challenge-accept');
    const declineBtn = document.getElementById('player-challenge-decline');
    if (gameEl instanceof HTMLSelectElement) {
      gameEl.onchange = () => {
        state.ui.challenge.gameType = normalizedChallengeGameType(gameEl.value);
      };
    }
    if (wagerEl instanceof HTMLInputElement) {
      wagerEl.oninput = () => {
        const wager = normalizedChallengeWager(wagerEl.value, 1);
        state.ui.challenge.wager = wager;
        if (wager <= 0) {
          state.ui.challenge.approvalState = 'idle';
          state.ui.challenge.approvalMessage = '';
          state.ui.challenge.approvalWager = 0;
          return;
        }
        if (approvalModeAuto) {
          state.ui.challenge.approvalState = 'ready';
          state.ui.challenge.approvalWager = wager;
          state.ui.challenge.approvalMessage = 'Testnet mode: approvals handled automatically.';
          return;
        }
        if (Number(state.ui.challenge.approvalWager || 0) < wager) {
          state.ui.challenge.approvalState = 'required';
        }
      };
    }
    if (approveBtn instanceof HTMLButtonElement) {
      approveBtn.onclick = () => {
        const wager = wagerEl instanceof HTMLInputElement ? wagerEl.value : state.ui.challenge.wager;
        void ensureEscrowApproval(wager);
      };
    }
    if (sendBtn instanceof HTMLButtonElement) {
      sendBtn.onclick = () => {
        const gameType = gameEl instanceof HTMLSelectElement ? gameEl.value : state.ui.challenge.gameType;
        const wager = wagerEl instanceof HTMLInputElement ? wagerEl.value : state.ui.challenge.wager;
        void challengeController.sendChallenge(targetId, gameType, wager);
      };
    }
    if (acceptBtn instanceof HTMLButtonElement) {
      acceptBtn.onclick = () => challengeController.respondToIncoming(true);
    }
    if (declineBtn instanceof HTMLButtonElement) {
      declineBtn.onclick = () => challengeController.respondToIncoming(false);
    }
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
  const context = challengeController.computeControlContext();
  const interactionPhase = describeInteractionPhase(state);

  if (mobileInteract) mobileInteract.style.display = hasTarget ? 'inline-flex' : 'none';
  if (mobileTarget) mobileTarget.style.display = (state.nearbyIds.size + state.nearbyStationIds.size) > 1 ? 'inline-flex' : 'none';
  if (mobileSend) mobileSend.style.display = context === 'near_player_idle' ? 'inline-flex' : 'none';
  if (mobileAccept) mobileAccept.style.display = context === 'incoming_challenge' ? 'inline-flex' : 'none';
  if (mobileDecline) mobileDecline.style.display = context === 'incoming_challenge' ? 'inline-flex' : 'none';

  const rpsVisible = context === 'active_rps';
  const coinflipVisible = context === 'active_coinflip' || context === 'dealer_ready';
  const diceVisible = context === 'active_dice_duel';
  if (mobileMoves) mobileMoves.style.display = (rpsVisible || coinflipVisible || diceVisible) ? 'grid' : 'none';
  if (mobileMove1) mobileMove1.style.display = rpsVisible ? 'inline-flex' : 'none';
  if (mobileMove2) mobileMove2.style.display = rpsVisible ? 'inline-flex' : 'none';
  if (mobileMove3) mobileMove3.style.display = rpsVisible ? 'inline-flex' : 'none';
  if (mobileMoveH) mobileMoveH.style.display = coinflipVisible ? 'inline-flex' : 'none';
  if (mobileMoveT) mobileMoveT.style.display = coinflipVisible ? 'inline-flex' : 'none';
  if (mobileMoveD1) mobileMoveD1.style.display = diceVisible ? 'inline-flex' : 'none';
  if (mobileMoveD2) mobileMoveD2.style.display = diceVisible ? 'inline-flex' : 'none';
  if (mobileMoveD3) mobileMoveD3.style.display = diceVisible ? 'inline-flex' : 'none';
  if (mobileMoveD4) mobileMoveD4.style.display = diceVisible ? 'inline-flex' : 'none';
  if (mobileMoveD5) mobileMoveD5.style.display = diceVisible ? 'inline-flex' : 'none';
  if (mobileMoveD6) mobileMoveD6.style.display = diceVisible ? 'inline-flex' : 'none';

  if (featureMobileV2 && mobileControls) {
    mobileControls.dataset.phase = interactionPhase;
  }
}

function update(nowMs) {
  updateLocalAvatar();
  movementSystem.send(nowMs);
  syncRemoteAvatars(state, state.playerId);
  applyDisplaySeparation();
  syncStations(state);
  syncNearbyStations();
  refreshNearbyDistances();
  renderMatchSpotlight();
  renderTargetSpotlight();

  renderTopHud(state, { hud, topbarName, topbarWallet, topbarStreak });
  if (featureDirectioningV2) {
    renderNextActionLine(state, challengeStatusLine, labelFor);
  } else if (challengeStatusLine) {
    if (!state.wsConnected) {
      challengeStatusLine.textContent = state.challengeMessage || 'Disconnected from game server. Reconnecting...';
    } else {
      challengeStatusLine.textContent =
        state.challengeMessage ||
        (state.challengeStatus === 'none'
          ? 'Find a nearby target and start a challenge.'
          : `Status: ${state.challengeStatus}`);
    }
  }

  renderMinimap(state, worldMapCanvas, mapCoords);
  renderInteractionPrompt();
  renderInteractionCard();
  renderMobileControls();
  renderQuickstartModule(state, quickstartPanel, quickstartList);
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
    const preferred = state.ui?.targetId || '';
    if (preferred && isStation(preferred) && state.nearbyStationIds.has(preferred)) {
      return preferred;
    }
    const stationId = closestNearbyStationId();
    if (stationId) {
      state.ui.targetId = stationId;
      return stationId;
    }
  }
  if (state.ui?.interactOpen && state.ui?.interactionMode === 'player') {
    const preferred = state.ui?.targetId || '';
    if (preferred && !isStation(preferred) && state.nearbyIds.has(preferred)) {
      return preferred;
    }
    const playerId = closestNearbyPlayerId();
    if (playerId) {
      state.ui.targetId = playerId;
      return playerId;
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
  const current = state.ui.targetId && ids.includes(state.ui.targetId) ? state.ui.targetId : ids[0];
  const idx = Math.max(0, ids.indexOf(current));
  const nextIdx = (idx + (next ? 1 : -1) + ids.length) % ids.length;
  state.ui.targetId = ids[nextIdx] || ids[0];
  if (state.ui.interactOpen) {
    state.ui.interactionMode = isStation(state.ui.targetId) ? 'station' : 'player';
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
    const stationFirst = closestNearbyStationId();
    if (stationFirst) {
      state.ui.targetId = stationFirst;
      state.ui.interactionMode = 'station';
    } else if (closestNearbyPlayerId()) {
      state.ui.targetId = closestNearbyPlayerId();
      state.ui.interactionMode = 'player';
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
    state.ui.world.stationId = '';
    state.ui.world.detail = '';
    state.ui.world.actionLabel = 'Use';
  } else {
    interactionStationRenderKey = '';
    state.ui.interactionMode = 'none';
    state.ui.dealer.state = 'idle';
    state.ui.dealer.escrowTx = null;
    state.ui.world.stationId = '';
    state.ui.world.detail = '';
    state.ui.world.actionLabel = 'Use';
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

  const next = new Set();
  for (const station of state.stations.values()) {
    const distance = Math.hypot(station.x - self.x, station.z - self.z);
    const threshold = Number.isFinite(Number(station.radius)) && Number(station.radius) > 0
      ? Number(station.radius)
      : 8;
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
  const isDealerMove = move === 'heads'
    || move === 'tails'
    || move === 'rock'
    || move === 'paper'
    || move === 'scissors'
    || move === 'd1'
    || move === 'd2'
    || move === 'd3'
    || move === 'd4'
    || move === 'd5'
    || move === 'd6';
  if (
    isDealerMove
    && state.ui.interactOpen
    && state.ui.interactionMode === 'station'
    && state.ui.dealer.state === 'ready'
    && state.ui.dealer.stationId
    && socket
    && socket.readyState === WebSocket.OPEN
  ) {
    const action = state.ui.dealer.gameType === 'rps'
      ? 'rps_house_pick'
      : state.ui.dealer.gameType === 'dice_duel'
        ? 'dice_duel_pick'
        : 'coinflip_house_pick';
    socket.send(
      JSON.stringify({
        type: 'station_interact',
        stationId: state.ui.dealer.stationId,
        action,
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
  if (
    challenge.gameType === 'dice_duel'
    && move !== 'd1'
    && move !== 'd2'
    && move !== 'd3'
    && move !== 'd4'
    && move !== 'd5'
    && move !== 'd6'
  ) {
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
  // Mobile controls are context-driven; kept for backwards compatibility hooks.
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

      txRow.appendChild(txBadge);
      const txUrl = txExplorerUrl(txHash, state.walletChainId);
      if (txUrl) {
        const txLink = document.createElement('a');
        txLink.className = 'tx-link';
        txLink.href = txUrl;
        txLink.target = '_blank';
        txLink.rel = 'noreferrer noopener';
        txLink.textContent = 'view tx';
        txRow.appendChild(txLink);
      }
      item.appendChild(txRow);
    }
    feedPanel.appendChild(item);
  }
}

function handleChallenge(payload) {
  const challenge = payload.challenge;
  if (payload?.approvalMode === 'auto' || payload?.approvalMode === 'manual') {
    state.escrowApproval.mode = payload.approvalMode;
  }
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
    const approvalStatus = String(payload?.approvalStatus || '');
    if (approvalStatus === 'failed' || isEscrowApprovalReason(payload.reason)) {
      state.ui.challenge.approvalState = 'required';
      state.ui.challenge.approvalMessage = state.challengeMessage;
      state.ui.challenge.approvalWager = 0;
    }
    showToast(state.challengeMessage);
  }

  addFeedEvent('match', `challenge:${payload.event}${payload.reason ? ` (${payload.reason})` : ''}`);
  updateRpsVisibility();
}

function challengeReasonLabel(reason) {
  const autoApproval = String(state.escrowApproval?.mode || 'manual') === 'auto';
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
    case 'allowance_too_low':
    case 'player_allowance_low':
      return autoApproval
        ? 'Super-agent escrow prep failed on testnet. Retry the challenge in a moment.'
        : 'Escrow approval needed. Tap Approve Escrow, confirm in wallet, then send the challenge again.';
    case 'approve_failed':
      return autoApproval
        ? 'Super-agent approval step failed on testnet. Retry shortly.'
        : 'Wallet approval was not completed. Tap Approve Escrow and confirm in wallet.';
    case 'wallet_prepare_failed':
      return 'Could not prepare escrow approval. Retry in a moment.';
    case 'runtime_unavailable':
      return 'Escrow service is temporarily unavailable. Retry shortly.';
    case 'wallet_not_connected':
      return 'Connect your wallet before wagering.';
    case 'insufficient_funds':
      return 'Wallet balance is too low for this wager.';
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
    case 'invalid_dice_duel_move':
      return 'Invalid move for current game type.';
    case 'human_challenge_cooldown':
      return 'Target is in cooldown from recent agent challenges.';
    default:
      return reason ? `Action rejected: ${reason}` : 'Challenge action rejected.';
  }
}

function dealerReasonLabel(reason, reasonCode) {
  const code = String(reasonCode || '').toUpperCase();
  const raw = String(reason || '').toLowerCase();
  if (code === 'BET_ID_ALREADY_USED' || raw.includes('bet_already_exists')) {
    return 'Escrow id collision detected. Please retry the round.';
  }
  if (code === 'INVALID_WAGER' || raw === 'invalid_amount') {
    return 'Invalid wager amount. Enter a valid amount and retry.';
  }
  if (code === 'INVALID_ESCROW_PARTICIPANTS' || raw === 'invalid_address') {
    return 'Wallet participants are invalid. Reconnect and retry.';
  }
  if (code === 'BET_NOT_LOCKED' || raw === 'bet_not_locked') {
    return 'Escrow lock is missing for this round. Start a new round.';
  }
  if (code === 'WINNER_NOT_PARTICIPANT' || raw === 'winner_not_participant') {
    return 'Escrow winner wallet is invalid for this round.';
  }
  if (code === 'ONCHAIN_EXECUTION_ERROR') {
    return 'Onchain escrow transaction failed. Retry shortly.';
  }
  return '';
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
  const incoming = challengeController.currentIncomingChallenge();
  if (isStation(targetId)) {
    interactionPrompt.textContent = `Near ${labelFor(targetId)}${typeof distance === 'number' ? ` (${distance.toFixed(1)}m)` : ''}. E interact · Tab/V switch`;
  } else {
    interactionPrompt.textContent = `Near ${labelFor(targetId)}${typeof distance === 'number' ? ` (${distance.toFixed(1)}m)` : ''}. E interact · C send · Tab/V switch${incoming ? ' · Y/N respond' : ''}`;
  }
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
      ctx.fillStyle = station.kind === 'cashier_bank'
        ? 'rgba(47, 109, 255, 0.92)'
        : station.kind === 'world_interactable'
          ? 'rgba(120, 196, 163, 0.92)'
          : 'rgba(243, 156, 18, 0.92)';
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
    interactionPhase: describeInteractionPhase(state),
    targetId: state.ui?.targetId || '',
    interactionMode: state.ui?.interactionMode || 'none',
    escrowApprovalMode: state.escrowApproval?.mode || 'manual',
    escrowApprovalNetwork: state.escrowApproval?.network || 'unknown',
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
    nearbyStationIds: [...state.nearbyStationIds],
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
