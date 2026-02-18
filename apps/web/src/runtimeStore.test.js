import { describe, expect, it } from 'vitest';
import { createRuntimeStore, selectChallengeView, selectWalletView, selectWorldLoad } from '../public/js/play/runtime/store.js';

function makeState() {
  return {
    worldAlias: 'mega',
    worldLoaded: false,
    worldLoad: { stage: 'idle', loaded: 0, total: 0, message: '' },
    wsConnected: false,
    playerId: null,
    players: new Map(),
    serverStations: new Map(),
    hostStations: new Map(),
    bakedStations: new Map(),
    stations: new Map(),
    nearbyIds: new Set(),
    nearbyStationIds: new Set(),
    challengeStatus: 'none',
    challengeMessage: '',
    incomingChallengeId: null,
    outgoingChallengeId: null,
    walletBalance: null,
    walletChainId: null
  };
}

describe('runtime store', () => {
  it('tracks staged world loading lifecycle', () => {
    const store = createRuntimeStore(makeState());
    store.dispatch({ type: 'WORLD_LOAD_STAGE_SET', stage: 'connecting', message: 'Connecting' });
    expect(selectWorldLoad(store.getState()).stage).toBe('connecting');

    store.dispatch({ type: 'WORLD_LOAD_STAGE_SET', stage: 'downloading', loaded: 10, total: 20, message: 'Downloading' });
    expect(selectWorldLoad(store.getState())).toMatchObject({ stage: 'downloading', loaded: 10, total: 20 });

    store.dispatch({ type: 'WORLD_LOADED', message: 'Entering world' });
    expect(store.getState().worldLoaded).toBe(true);
    expect(selectWorldLoad(store.getState()).stage).toBe('entered');
  });

  it('updates challenge and wallet state through actions', () => {
    const store = createRuntimeStore(makeState());
    store.dispatch({ type: 'CHALLENGE_STATUS_SET', status: 'incoming', message: 'Incoming challenge' });
    expect(selectChallengeView(store.getState())).toMatchObject({ status: 'incoming', message: 'Incoming challenge' });

    store.dispatch({ type: 'WALLET_SUMMARY_SET', balance: 12.5, chainId: 8453 });
    expect(selectWalletView(store.getState())).toMatchObject({ balance: 12.5, chainId: 8453 });
  });
});
