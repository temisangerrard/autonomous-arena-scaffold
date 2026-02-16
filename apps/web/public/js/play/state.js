import { pickWorldAlias } from '../world-common.js';

export const WORLD_BOUND = 120;

export function createInitialState() {
  return {
    worldAlias: pickWorldAlias(),
    worldLoaded: false,
    wsConnected: false,
    playerId: null,
    tick: 0,
    players: new Map(),
    stations: new Map(),
    input: {
      forward: false,
      backward: false,
      left: false,
      right: false
    },
    nearbyIds: new Set(),
    nearbyNames: new Map(),
    nearbyDistances: new Map(),
    nearbyStationIds: new Set(),
    incomingChallengeId: null,
    outgoingChallengeId: null,
    activeChallenge: null,
    challengeStatus: 'none',
    respondingIncoming: false,
    challengeMessage: '',
    challengeFeed: [],
    cameraYaw: 0,
    cameraYawInitialized: false,
    cameraPitch: 0.27,
    cameraDistance: 5,
    deskCollapsed: false,
    deskAutoCollapsedByMatch: false,
    walletBalance: 0,
    streak: 0,
    quickstart: {
      challengeSent: false,
      matchActive: false,
      moveSubmitted: false,
      matchResolved: false,
      dismissed: false
    },
    ui: {
      targetId: '',
      interactOpen: false,
      interactionMode: 'none',
      dealer: {
        stationId: '',
        state: 'idle',
        wager: 1,
        commitHash: '',
        method: '',
        challengeId: '',
        playerPick: '',
        coinflipResult: '',
        payoutDelta: 0,
        escrowTx: null
      }
    },
    touch: {
      stickActive: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      moveX: 0,
      moveZ: 0
    }
  };
}
