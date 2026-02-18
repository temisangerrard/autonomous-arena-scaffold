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
    serverStations: new Map(),
    hostStations: new Map(),
    bakedStations: new Map(),
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
    walletBalance: null,
    walletChainId: null,
    escrowApproval: {
      mode: 'manual',
      network: 'unknown',
      reason: '',
      source: 'config',
      autoApproveMaxWager: null,
      autoApproveDailyCap: null
    },
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
      challenge: {
        gameType: 'rps',
        wager: 1,
        approvalState: 'idle',
        approvalMessage: '',
        approvalWager: 0
      },
      dealer: {
        stationId: '',
        gameType: 'coinflip',
        state: 'idle',
        wager: 1,
        commitHash: '',
        method: '',
        challengeId: '',
        playerPick: '',
        coinflipResult: '',
        diceResult: 0,
        payoutDelta: 0,
        escrowTx: null,
        reason: '',
        reasonCode: '',
        reasonText: '',
        preflight: null
      },
      world: {
        stationId: '',
        interactionTag: '',
        title: '',
        detail: '',
        actionLabel: 'Use'
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
