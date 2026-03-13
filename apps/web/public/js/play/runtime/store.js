const DEV_MODE = typeof window !== 'undefined' && (window.location?.search || '').includes('devState=1');

function assertCoreShapes(state) {
  if (!(state.players instanceof Map)) throw new Error('state.players must be a Map');
  if (!(state.stations instanceof Map)) throw new Error('state.stations must be a Map');
  if (!(state.serverStations instanceof Map)) throw new Error('state.serverStations must be a Map');
  if (!(state.hostStations instanceof Map)) throw new Error('state.hostStations must be a Map');
  if (!(state.bakedStations instanceof Map)) throw new Error('state.bakedStations must be a Map');
  if (!(state.nearbyIds instanceof Set)) throw new Error('state.nearbyIds must be a Set');
  if (!(state.nearbyStationIds instanceof Set)) throw new Error('state.nearbyStationIds must be a Set');
}

function assertChallengeState(state) {
  const status = String(state.challengeStatus || 'none');
  const valid = new Set(['none', 'incoming', 'sent', 'accepted', 'active', 'resolved', 'declined', 'expired']);
  if (!valid.has(status)) {
    throw new Error(`invalid challengeStatus: ${status}`);
  }
}

function runInvariants(state) {
  if (!DEV_MODE) return;
  assertCoreShapes(state);
  assertChallengeState(state);
}

function reduce(state, action) {
  const type = String(action?.type || '');
  switch (type) {
    case 'WORLD_ALIAS_SET':
      state.worldAlias = String(action.alias || 'mega');
      return;
    case 'WORLD_LOAD_STAGE_SET':
      state.worldLoad = {
        stage: String(action.stage || 'idle'),
        loaded: Number(action.loaded || 0),
        total: Number(action.total || 0),
        message: String(action.message || '')
      };
      return;
    case 'WORLD_LOADED':
      state.worldLoaded = true;
      state.worldLoad = {
        stage: 'entered',
        loaded: Number(action.loaded || 0),
        total: Number(action.total || 0),
        message: String(action.message || 'Entering world…')
      };
      return;
    case 'WORLD_FAILED':
      state.worldLoaded = false;
      state.worldLoad = {
        stage: 'failed',
        loaded: 0,
        total: 0,
        message: String(action.message || 'World failed to load.')
      };
      return;
    case 'WS_CONNECTION_SET':
      state.wsConnected = Boolean(action.connected);
      return;
    case 'CHALLENGE_STATUS_SET':
      state.challengeStatus = String(action.status || 'none');
      state.challengeMessage = String(action.message || '');
      return;
    case 'WALLET_SUMMARY_SET':
      state.walletBalance = Number.isFinite(Number(action.balance)) ? Number(action.balance) : null;
      state.walletChainId = Number.isFinite(Number(action.chainId)) ? Number(action.chainId) : null;
      state.walletTokenSymbol = action.tokenSymbol ? String(action.tokenSymbol) : null;
      state.walletTokenDecimals = Number.isFinite(Number(action.tokenDecimals)) ? Number(action.tokenDecimals) : null;
      state.walletMode = action.mode ? String(action.mode) : null;
      state.walletSynced = Boolean(action.synced);
      state.walletProvider = action.walletProvider ? String(action.walletProvider) : null;
      state.walletExternalAddress = action.walletExternalAddress ? String(action.walletExternalAddress) : null;
      state.walletEscrowApprovalCapUsdc = Number.isFinite(Number(action.escrowApprovalCapUsdc)) ? Number(action.escrowApprovalCapUsdc) : null;
      state.walletEscrowApprovalTokenAddress = action.escrowApprovalTokenAddress ? String(action.escrowApprovalTokenAddress) : null;
      state.walletEscrowApprovalSpenderAddress = action.escrowApprovalSpenderAddress ? String(action.escrowApprovalSpenderAddress) : null;
      return;
    default:
      return;
  }
}

export function createRuntimeStore(initialState) {
  const state = initialState;
  const listeners = new Set();
  if (!state.worldLoad || typeof state.worldLoad !== 'object') {
    state.worldLoad = { stage: 'idle', loaded: 0, total: 0, message: '' };
  }

  function getState() {
    return state;
  }

  function dispatch(action) {
    reduce(state, action || {});
    runInvariants(state);
    for (const listener of listeners) {
      try {
        listener(state, action);
      } catch {
        // keep store dispatch resilient to subscriber issues
      }
    }
    return state;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  runInvariants(state);
  return { getState, dispatch, subscribe };
}

export function selectWorldLoad(state) {
  const payload = state?.worldLoad || {};
  return {
    stage: String(payload.stage || 'idle'),
    loaded: Number(payload.loaded || 0),
    total: Number(payload.total || 0),
    message: String(payload.message || '')
  };
}

export function selectChallengeView(state) {
  return {
    status: String(state?.challengeStatus || 'none'),
    message: String(state?.challengeMessage || ''),
    incomingId: String(state?.incomingChallengeId || ''),
    outgoingId: String(state?.outgoingChallengeId || '')
  };
}

export function selectWalletView(state) {
  return {
    balance: Number.isFinite(Number(state?.walletBalance)) ? Number(state.walletBalance) : null,
    chainId: Number.isFinite(Number(state?.walletChainId)) ? Number(state.walletChainId) : null,
    tokenSymbol: state?.walletTokenSymbol ? String(state.walletTokenSymbol) : null,
    tokenDecimals: Number.isFinite(Number(state?.walletTokenDecimals)) ? Number(state.walletTokenDecimals) : null,
    mode: state?.walletMode ? String(state.walletMode) : null,
    synced: Boolean(state?.walletSynced),
    provider: state?.walletProvider ? String(state.walletProvider) : null,
    externalAddress: state?.walletExternalAddress ? String(state.walletExternalAddress) : null,
    escrowApprovalCapUsdc: Number.isFinite(Number(state?.walletEscrowApprovalCapUsdc)) ? Number(state.walletEscrowApprovalCapUsdc) : null,
    escrowApprovalTokenAddress: state?.walletEscrowApprovalTokenAddress ? String(state.walletEscrowApprovalTokenAddress) : null,
    escrowApprovalSpenderAddress: state?.walletEscrowApprovalSpenderAddress ? String(state.walletEscrowApprovalSpenderAddress) : null
  };
}
