import { THREE, installResizeHandler, loadWorldWithProgress, makeCamera, makeRenderer, makeScene } from '../../world-common.js';
import { getDom } from '../dom.js';
import { WORLD_BOUND, createInitialState } from '../state.js';
import { createToaster } from '../ui/toast.js';
import { createAnnouncer } from '../ui/sr.js';
import { initOnboarding } from '../ui/onboarding.js';
import { AVATAR_GROUND_OFFSET, animateAvatar, createAvatarSystem, computeAvatarScaleForWorld } from '../avatars.js';
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
import { renderQuickstart as renderQuickstartModule } from './quickstart.js';
import { renderChallengeFeed } from './feed.js';
import { renderWorldMapPanel } from './world-map-renderer.js';
import { loadMainWorldRuntime } from './world-loader.js';
import { challengeReasonLabelForMode } from './challenge-reason.js';
import { renderInteractionPromptLine, setInteractOpenState } from './interaction-shell.js';
import { describeInteractionPhase } from './interactions.js';
import { deriveDealerGameType } from './dealer-game-type.js';
import { computeMobileControlVisibility, isTouchLikeDevice } from './mobile-controls.js';
import { renderMobileControlsRuntime } from './mobile-controls-renderer.js';
import { createWalletSyncController } from './wallet-sync.js';
import { createPlayerDrawerController } from './player-drawer.js';
import { createEscrowApprovalController } from './escrow-approval.js';
import { showResultSplash } from './result-splash.js';
import { installRuntimeTestHooks } from './test-hooks.js';
import { refreshWalletBalanceAndShowDelta as refreshWalletBalanceAndShowDeltaModule } from './challenge-settlement-ui.js';
import { createTargetingController } from './targeting.js';
import {
  updateLocalAvatarRuntime,
  applyDisplaySeparationRuntime,
  renderMatchSpotlightRuntime,
  renderTargetSpotlightRuntime,
  updateAmbientMotion
} from './scene-dynamics.js';
import {
  asFiniteNumber,
  normalizeYaw,
  normalizeSnapshotPlayer as normalizeSnapshotPlayerModule,
  sanitizeRenderY
} from './player-normalization.js';
import {
  formatUsdAmount,
  txExplorerUrl,
  renderDealerRevealStatus,
  formatWagerLabel,
  formatWagerInline,
  formatPredictionPrice,
  formatPredictionClose
} from './formatting.js';
import { sendGameMoveRuntime } from './game-moves.js';
import { handleChallengeEvent } from './challenge-events.js';
import { createEscrowPolicyController } from './escrow-policy.js';
import { createFeedEventsController } from './feed-events.js';
import { createChallengeBridge } from './challenge-bridge.js';
import { createFrameLoop } from './frame-loop.js';
import { createStationInteractionsController } from './station-interactions.js';
import { createApiJsonClient } from './api-client.js';
import { createRuntimeSpotlights } from './spotlights.js';
import { createWorldBillboards } from './world-billboards.js';
import { createAudioController } from './audio.js';
import { createWorldPoi } from './world-poi.js';
import { createRuntimeUpdate } from './runtime-update.js';
import { createLabelFor, isStationId } from './selectors.js';
import { startRuntimeLifecycle } from './startup-lifecycle.js';
import { playerShellFromBootstrap } from '../../shared/player-shell.js';
import { saveStoredPlayerShell } from '../../shared/player-shell-storage.js';
import { bindInteractionUi } from './interaction-bindings.js';
import { createArenaConfigRuntime } from './network/arena-config.js';
import { createQuickPlayPanel, launchQuickPlayStation } from './quick-play.js';
import { connectSocketRuntime } from './network/socket-runtime.js';
import { createRetryScheduler } from './network/retry-scheduler.js';
import { renderInteractionCardTemplate } from './templates/interaction-card/index.js';
import { createRuntimeStore } from './store.js';
import { createCoinbaseWalletApprovalClient } from '../../lib/coinbase-wallet.js';
import { getFirebaseIdToken } from '../../lib/firebase-browser-auth.js';
import { dealerReasonLabel } from './dealer-reasons.js';
import { HOST_STATION_PROXY_MAP, createWorldNpcHosts } from './world-npc-hosts.js';
import { extractBakedNpcStations } from './baked-npc-stations.js';
import { createStationRouting } from './station-routing.js';
import { createWorldStationsController } from './world-stations.js';
import { coinflipGamePlugin } from '../plugins/games/coinflip.js';
import { rpsGamePlugin } from '../plugins/games/rps.js';
import { diceDuelGamePlugin } from '../plugins/games/dice-duel.js';
import { dealerStationPlugin } from '../plugins/stations/dealer.js';
import { dealerRpsStationPlugin } from '../plugins/stations/dealer-rps.js';
import { dealerDiceDuelStationPlugin } from '../plugins/stations/dealer-dice-duel.js';
import { dealerPredictionStationPlugin } from '../plugins/stations/dealer-prediction.js';
import { cashierStationPlugin } from '../plugins/stations/cashier.js';
import { worldInteractableStationPlugin } from '../plugins/stations/world-interactable.js';
import { dealerOperatorNpcPlugin } from '../plugins/npc-operator.js';
import { updateLeaderboardFromResolution, renderLeaderboard } from './leaderboard.js';

const dom = getDom();
const queryParams = new URL(window.location.href).searchParams;
const featureMobileV2 = shouldEnableFlag('MOBILE_LAYOUT_V2_ENABLED');
const featureDirectioningV2 = shouldEnableFlag('DIRECTIONING_V2_ENABLED');

const pluginRegistry = createPluginRegistry();
pluginRegistry.registerGame(coinflipGamePlugin);
pluginRegistry.registerGame(rpsGamePlugin);
pluginRegistry.registerGame(diceDuelGamePlugin);
pluginRegistry.registerStation(dealerStationPlugin);
pluginRegistry.registerStation(dealerRpsStationPlugin);
pluginRegistry.registerStation(dealerDiceDuelStationPlugin);
pluginRegistry.registerStation(dealerPredictionStationPlugin);
pluginRegistry.registerStation(cashierStationPlugin);
pluginRegistry.registerStation(worldInteractableStationPlugin);
pluginRegistry.registerNpc(dealerOperatorNpcPlugin);
const { buildSessionHeaders, apiJson } = createApiJsonClient();

const refreshWalletBalanceAndShowDelta = (beforeBalance, challenge = null) => refreshWalletBalanceAndShowDeltaModule({
  beforeBalance,
  challenge,
  syncWalletSummary,
  state,
  showResultSplash,
  audio: audioController
});

const { showToast } = createToaster(dom.toastContainer);
const walletApprovalClient = createCoinbaseWalletApprovalClient({
  windowRef: window,
  getFirebaseIdToken: async () => await getFirebaseIdToken(window.ARENA_CONFIG || window.__ARENA_CONFIG || {}, { forceRefresh: true })
});
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
  topbarBot,
  feedPanel,
  challengeStatusLine,
  worldMapCanvas,
  mapCoords,
  interactionPrompt,
  interactionCard,
  interactionTitle,
  interactionHelpToggle,
  interactionHelp,
  interactionClose,
  stationUi,
  interactionNpcInfo,
  quickstartPanel,
  quickstartList,
  quickstartClose,
  worldLoading,
  worldLoadingBar,
  worldLoadingText,
  playerDrawer,
  playerDrawerBackdrop,
  playerDrawerClose,
  playerDrawerBody,
  mobileControls,
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
const worldMapPanel = worldMapCanvas instanceof HTMLCanvasElement
  ? worldMapCanvas.closest('.world-map-panel')
  : null;


const renderer = makeRenderer(canvas);
const scene = makeScene();
const camera = makeCamera();
installResizeHandler(camera, renderer);
const { matchSpotlight, targetSpotlight, triggerCelebrationBurst, updateBursts } = createRuntimeSpotlights({ THREE, scene });
const worldBillboards = createWorldBillboards({ THREE, scene });
const worldPoi = createWorldPoi({ THREE, scene });
const audioController = createAudioController();

const { localAvatarParts, remoteAvatars, syncRemoteAvatars, updateWorldScale } = createAvatarSystem({ THREE, scene });
const { syncStations } = createStationSystem({ THREE, scene });

const store = createRuntimeStore(createInitialState());
const state = store.getState();
const dispatch = store.dispatch;
const labelFor = createLabelFor(state);
const isStation = isStationId;
const QUICKSTART_DISMISSED_KEY = 'arena_quickstart_dismissed_v1';

function readQuickstartDismissed() {
  try {
    return localStorage.getItem(QUICKSTART_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeQuickstartDismissed(value) {
  try {
    if (value) {
      localStorage.setItem(QUICKSTART_DISMISSED_KEY, '1');
    } else {
      localStorage.removeItem(QUICKSTART_DISMISSED_KEY);
    }
  } catch {
    // ignore storage failures in restricted browser modes
  }
}

state.quickstart.dismissed = readQuickstartDismissed();

// Local function rationale (non-imported on purpose):
// - `normalizeSnapshotPlayer`: binds shared normalization logic to this runtime's WORLD_BOUND.
// - `setInteractOpen`: captures live DOM refs and delegates UI open/close transitions.
// - `onDisconnectedFallbackCamera`: tiny scene-specific camera reset closure using local camera refs.
const targeting = createTargetingController({
  state,
  isStation
});
const {
  closestNearbyPlayerId,
  closestNearbyStationId,
  getUiTargetId,
  cycleNearbyTarget,
  refreshNearbyDistances,
  syncNearbyStations
} = targeting;

function normalizeSnapshotPlayer(player, existing = null) {
  return normalizeSnapshotPlayerModule(player, existing, WORLD_BOUND);
}

const onDisconnectedFallbackCamera = () => {
  // Keep a playable-feeling framing while auth/ws is reconnecting.
  camera.position.set(0, 4.2, 14);
  camera.lookAt(0, 1.1, 0);
  state.cameraYaw = 0;
  state.cameraYawInitialized = false;
};

if (!(state.stations instanceof Map)) {
  state.stations = new Map();
}
if (!(state.serverStations instanceof Map)) {
  state.serverStations = new Map();
}
if (!(state.hostStations instanceof Map)) {
  state.hostStations = new Map();
}
if (!(state.bakedStations instanceof Map)) {
  state.bakedStations = new Map();
}
if (!(state.nearbyStationIds instanceof Set)) {
  state.nearbyStationIds = new Set();
}

async function warmPlayerShellFromBootstrap() {
  try {
    const bootstrap = await apiJson(`/api/player/bootstrap?world=${encodeURIComponent(state.worldAlias || 'mega')}`);
    const playerShell = playerShellFromBootstrap(bootstrap, state.playerShellData || {});
    state.playerShellData = playerShell;
    state.playerShellLoadedAt = Number(playerShell.loadedAt || Date.now());
    saveStoredPlayerShell(window.localStorage, playerShell);
    const summary = playerShell.walletSummary;
    if (summary && typeof summary === 'object') {
      const bal = Number(summary?.onchain?.tokenBalance);
      const chainId = Number(summary?.onchain?.chainId);
      dispatch({
        type: 'WALLET_SUMMARY_SET',
        chainId: Number.isFinite(chainId) ? chainId : state.walletChainId,
        balance: Number.isFinite(bal) ? bal : state.walletBalance,
        tokenSymbol: summary?.onchain?.tokenSymbol ?? state.walletTokenSymbol ?? null,
        tokenDecimals: Number.isFinite(Number(summary?.onchain?.tokenDecimals))
          ? Number(summary.onchain.tokenDecimals)
          : (state.walletTokenDecimals ?? null),
        mode: summary?.onchain?.mode ?? state.walletMode ?? null,
        synced: Boolean(summary?.onchain?.synced),
        walletProvider: summary?.wallet?.walletProvider ?? state.walletProvider ?? null,
        walletExternalAddress: summary?.wallet?.externalWalletAddress ?? state.walletExternalAddress ?? null,
        escrowApprovalCapUsdc: summary?.wallet?.escrowApproval?.capUsdc ?? state.walletEscrowApprovalCapUsdc ?? null,
        escrowApprovalTokenAddress: summary?.wallet?.escrowApproval?.tokenAddress ?? state.walletEscrowApprovalTokenAddress ?? null,
        escrowApprovalSpenderAddress: summary?.wallet?.escrowApproval?.spenderAddress ?? state.walletEscrowApprovalSpenderAddress ?? null
      });
    }
  } catch {
    // Keep play startup resilient if bootstrap is briefly unavailable.
  }
}

const stationRouting = createStationRouting({
  state,
  hostStationProxyMap: HOST_STATION_PROXY_MAP
});
const {
  copyStationFromPayload,
  remapLocalStationProxies,
  mergeStations,
  resolveStationIdForSend,
  resolveIncomingStationId
} = stationRouting;

const worldStations = createWorldStationsController({
  THREE,
  scene,
  state,
  createWorldNpcHosts,
  extractBakedNpcStations,
  remapLocalStationProxies: (...args) => remapLocalStationProxies(...args),
  mergeStations: (...args) => mergeStations(...args)
});

const escrowPolicy = createEscrowPolicyController({
  windowRef: window,
  state
});
const { syncEscrowApprovalPolicy } = escrowPolicy;

syncEscrowApprovalPolicy();

const presence = createPresence({ queryParams });
presence.installOfflineBeacon();

const cameraController = createCameraController({ THREE, camera, state });

quickstartClose?.addEventListener('click', () => {
  state.quickstart.dismissed = true;
  writeQuickstartDismissed(true);
  if (quickstartPanel) {
    quickstartPanel.style.display = 'none';
  }
});

const { loadArenaConfig, resolveWsBaseUrl } = createArenaConfigRuntime({
  queryParams,
  buildSessionHeaders,
  onConfigLoaded: () => {
    syncEscrowApprovalPolicy();
  }
});

const walletSync = createWalletSyncController({
  apiJson,
  state,
  dispatch,
  syncEscrowApprovalPolicy
});
const {
  syncWalletSummary,
  startWalletSyncScheduler,
  stopWalletSyncScheduler
} = walletSync;
void warmPlayerShellFromBootstrap();
const playerDrawerController = createPlayerDrawerController({
  apiJson,
  state,
  syncWalletSummary,
  showToast,
  dom,
  drawer: playerDrawer,
  drawerBackdrop: playerDrawerBackdrop,
  drawerClose: playerDrawerClose,
  drawerBody: playerDrawerBody
});
initMenu(dom, {
  queryParams,
  openPlayerDrawer: (nextOpen) => playerDrawerController.setOpen(nextOpen)
});

let socket = null;
const socketRef = { current: null };
const connectionState = { presenceTimer: null, connectFailureCount: 0 };
const interactionCardState = { interactionStationRenderKey: '' };
const retryScheduler = createRetryScheduler({
  connectionState,
  dispatch,
  onRetry: () => connectSocket()
});
const { scheduleConnectRetry } = retryScheduler;
const feedEvents = createFeedEventsController({
  state,
  feedPanel,
  txExplorerUrl,
  renderChallengeFeed
});
const addFeedEvent = feedEvents.addFeedEvent;
const stationInteractions = createStationInteractionsController({
  state,
  showToast,
  getSocket: () => socket,
  resolveStationIdForSend
});
const {
  sendStationInteract,
  renderGuideStationDetail,
  setStationStatus,
  makePlayerSeed
} = stationInteractions;

async function connectSocket() {
  await connectSocketRuntime({
    resolveWsBaseUrl,
    queryParams,
    buildSessionHeaders,
    scheduleConnectRetry,
    dispatch,
    state,
    setSocket: (nextSocket) => { socket = nextSocket; },
    socketRef,
    connectionState,
    addFeedEvent,
    presence,
    startWalletSyncScheduler,
    stopWalletSyncScheduler,
    syncWalletSummary,
    normalizeSnapshotPlayer,
    copyStationFromPayload,
    remapLocalStationProxies,
    mergeStations,
    remoteAvatars,
    scene,
    updateRpsVisibility,
    resolveIncomingStationId,
    dealerReasonLabel,
    labelFor,
    deriveDealerGameType,
    showToast,
    showResultSplash,
    refreshWalletBalanceAndShowDelta,
    handleChallenge,
    localAvatarParts,
    challengeReasonLabel: (reason) => challengeReasonLabel(reason),
    onMatchResolved: ({ winnerId, wager }) => {
      const winner = state.players.get(winnerId);
      if (winner) {
        const wx = winner.displayX ?? winner.x ?? 0;
        const wz = winner.displayZ ?? winner.z ?? 0;
        triggerCelebrationBurst(wx, wz, wager);
        state.lastWinPosition = { x: wx, z: wz, at: Date.now() };
      }
      audioController.trigger('win');
    }
  });
}

const resetCameraBehindPlayer = () => {
  const me = state.playerId ? state.players.get(state.playerId) : null;
  if (!me) return;
  cameraController.resetBehindPlayer(me);
};

const escrowApproval = createEscrowApprovalController({
  state,
  apiJson,
  walletApprovalClient,
  formatUsdAmount,
  challengeReasonLabel: (reason) => challengeReasonLabel(reason),
  showToast
});
const { isEscrowApprovalReason, ensureEscrowApproval } = escrowApproval;

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

const sendGameMove = (move) => sendGameMoveRuntime({
  move,
  state,
  socket,
  resolveStationIdForSend,
  makePlayerSeed,
  showToast,
  pluginRegistry
});

function togglePvpReady() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'pvp_ready_toggle' }));
    state.pvpReady = !state.pvpReady;
  }
}

// Initialize audio on first user gesture (browser autoplay policy requirement).
{
  let audioInitialized = false;
  function initAudioOnce() {
    if (audioInitialized) return;
    audioInitialized = true;
    audioController.init();
    // Audio assets are not yet bundled; loadSfx/loadAmbientLoop calls will be restored
    // once the asset files are placed in public/assets/audio/.
  }
  ['keydown', 'pointerdown', 'touchstart'].forEach((ev) => {
    window.addEventListener(ev, initAudioOnce, { once: true, passive: true });
  });
}

const inputSystem = createInputSystem({
  state,
  dom,
  actions: {
    resetCameraBehindPlayer,
    setInteractOpen,
    getUiTargetId,
    cycleNearbyTarget,
    computeControlContext: challengeController.computeControlContext,
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
bindInteractionUi({
  interactionPrompt,
  interactionClose,
  interactionHelpToggle,
  interactionHelp,
  getUiTargetId,
  setInteractOpen
});

const update = createRuntimeUpdate({
  state,
  localAvatarParts,
  avatarGroundOffset: AVATAR_GROUND_OFFSET,
  animateAvatar,
  cameraController,
  movementSystem,
  syncRemoteAvatars,
  worldStations,
  applyDisplaySeparationRuntime,
  syncStations,
  syncNearbyStations,
  refreshNearbyDistances,
  renderMatchSpotlightRuntime,
  matchSpotlight,
  renderTargetSpotlightRuntime,
  targetSpotlight,
  getUiTargetId,
  renderTopHud,
  hud,
  topbarName,
  topbarWallet,
  topbarStreak,
  topbarBot,
  featureDirectioningV2,
  renderNextActionLine,
  challengeStatusLine,
  labelFor,
  renderWorldMapPanel,
  worldMapCanvas,
  mapCoords,
  worldBound: WORLD_BOUND,
  renderInteractionPromptLine,
  interactionPrompt,
  setInteractOpen,
  challengeController,
  isStation,
  renderInteractionCardTemplate,
  interactionCard,
  interactionTitle,
  interactionHelpToggle,
  interactionHelp,
  interactionNpcInfo,
  stationUi,
  interactionCardState,
  normalizedChallengeGameType,
  normalizedChallengeWager,
  formatWagerInline,
  formatUsdAmount,
  formatPredictionPrice,
  formatPredictionClose,
  buildSessionHeaders,
  syncWalletSummary,
  showToast,
  ensureEscrowApproval,
  sendStationInteract,
  renderGuideStationDetail,
  setStationStatus,
  renderDealerRevealStatus,
  makePlayerSeed,
  pluginRegistry,
  getSocket: () => socket,
  renderMobileControlsRuntime,
  computeMobileControlVisibility,
  isTouchLikeDevice,
  windowRef: window,
  mobileControls,
  worldMapPanel,
  describeInteractionPhase,
  interactionCardElement: interactionCard,
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
  mobileMoveD6,
  featureMobileV2,
  renderQuickstartModule,
  quickstartPanel,
  quickstartList,
  updateLocalAvatarRuntime,
  asFiniteNumber,
  normalizeYaw,
  sanitizeRenderY,
  audio: audioController,
  topbarLfg: dom.topbarLfg,
  togglePvpReady
});

// Wrap the core update to layer in spectacle systems each frame.
const coreUpdate = update;
const spectacleUpdate = (nowMs) => {
  coreUpdate(nowMs);
  updateBursts(nowMs);
  updateAmbientMotion(scene, nowMs);
  worldBillboards.update(state, nowMs);
  worldPoi.update(state);
};

const frameLoop = createFrameLoop({
  queryParams,
  update: spectacleUpdate,
  render: () => renderer.render(scene, camera)
});

function setInteractOpen(nextOpen) {
  setInteractOpenState({
    nextOpen,
    state,
    interactionCard,
    interactionHelp,
    interactionHelpToggle,
    interactionCardState,
    closestNearbyStationId,
    closestNearbyPlayerId
  });
}

const challengeBridge = createChallengeBridge({
  state,
  dispatch,
  labelFor,
  formatWagerInline,
  refreshWalletBalanceAndShowDelta,
  isEscrowApprovalReason,
  showToast,
  addFeedEvent,
  handleChallengeEvent,
  challengeReasonLabelForMode,
  audio: audioController,
  updateLeaderboard: (challenge) => {
    updateLeaderboardFromResolution({ state, challenge });
    renderLeaderboard(state, dom.leaderboardList, state.playerId);
  }
});
const updateRpsVisibility = challengeBridge.updateRpsVisibility;
const handleChallenge = challengeBridge.handleChallenge;
const challengeReasonLabel = challengeBridge.challengeReasonLabel;

installRuntimeTestHooks({
  state,
  movementSystem,
  describeInteractionPhase,
  update,
  render: frameLoop.render,
  frame: frameLoop.frame,
  queryParams
});

createQuickPlayPanel({
  openQuickPlayStation: (station) => launchQuickPlayStation({
    station,
    resolveIncomingStationId,
    setInteractOpen,
    state
  }),
  showToast
});

void connectSocket();
startRuntimeLifecycle({
  documentRef: document,
  state,
  startWalletSyncScheduler,
  syncWalletSummary,
  stopWalletSyncScheduler,
  loadMainWorldRuntime,
  loadArenaConfig,
  worldLoading,
  worldLoadingBar,
  worldLoadingText,
  dispatch,
  loadWorldWithProgress,
  scene,
  setDisconnectedFallbackCamera: onDisconnectedFallbackCamera,
  worldStations,
  addFeedEvent,
  THREE,
  computeAvatarScaleForWorld,
  updateWorldScale
});
