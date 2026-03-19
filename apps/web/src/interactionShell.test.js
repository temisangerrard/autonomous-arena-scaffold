import { describe, expect, it, vi } from 'vitest';
import { setInteractOpenState, renderInteractionPromptLine } from '../public/js/play/runtime/interaction-shell.js';

function makeClassList() {
  return {
    toggle: vi.fn(),
    add: vi.fn(),
    remove: vi.fn()
  };
}

if (!globalThis.HTMLElement) {
  globalThis.HTMLElement = class HTMLElement {};
}

describe('interaction shell targeting', () => {
  it('keeps currently targeted nearby station when opening interaction card', () => {
    const state = {
      nearbyIds: new Set(['agent_profile_8']),
      nearbyStationIds: new Set(['station_npc_host_5', 'station_npc_host_8']),
      ui: {
        targetId: 'station_npc_host_5',
        interactOpen: false,
        interactionMode: 'none',
        dealer: { state: 'idle', escrowTx: null },
        world: { stationId: '', detail: '', actionLabel: 'Use' }
      }
    };
    const interactionCard = {
      classList: makeClassList(),
      setAttribute: vi.fn(),
      contains: vi.fn(() => false)
    };

    const originalDocument = globalThis.document;
    globalThis.document = {
      body: { classList: makeClassList() },
      activeElement: null
    };

    try {
      setInteractOpenState({
        nextOpen: true,
        state,
        interactionCard,
        interactionHelp: null,
        interactionHelpToggle: null,
        interactionCardState: { interactionStationRenderKey: '' },
        closestNearbyStationId: () => 'station_npc_host_8',
        closestNearbyPlayerId: () => 'agent_profile_8'
      });
    } finally {
      globalThis.document = originalDocument;
    }

    expect(state.ui.targetId).toBe('station_npc_host_5');
    expect(state.ui.interactionMode).toBe('station');
  });

  it('resets transient dealer and prediction state when closing without clearing target selection', () => {
    const state = {
      players: new Map(),
      stations: new Map([
        ['station_npc_host_5', { id: 'station_npc_host_5', kind: 'dealer_coinflip' }]
      ]),
      nearbyIds: new Set(),
      nearbyStationIds: new Set(['station_npc_host_5']),
      ui: {
        targetId: 'station_npc_host_5',
        interactOpen: true,
        interactionMode: 'station',
        challenge: { gameType: 'rps', wager: 1, approvalState: 'idle', approvalMessage: '', approvalWager: 0 },
        dealer: {
          stationId: 'station_npc_host_5',
          gameType: 'coinflip',
          state: 'reveal',
          quickPlayEnabled: true,
          quickPlayStationId: 'station_npc_host_5',
          wager: 5,
          commitHash: 'commit_hash',
          method: 'dealer_reveal',
          challengeId: 'challenge_1',
          playerPick: 'heads',
          opponentPick: 'tails',
          coinflipResult: 'heads',
          diceResult: 4,
          payoutDelta: 10,
          escrowTx: { resolve: '0xabc' },
          reason: 'busy',
          reasonCode: 'dealer_busy',
          reasonText: 'Dealer busy.',
          preflight: { playerOk: true, houseOk: true }
        },
        world: { stationId: 'station_npc_host_5', interactionTag: 'dealer', title: 'Coinflip', detail: 'Ready', actionLabel: 'Play' },
        prediction: {
          stationId: 'station_npc_host_5',
          state: 'pending',
          markets: [{ marketId: 'btc_5m_current' }],
          positions: [{ marketId: 'btc_5m_current' }],
          selectedRail: 'btc_24h',
          selectedRound: 'next',
          selectedMarketId: 'btc_5m_current',
          positionStatus: 'pending',
          lastReason: 'prediction_pending',
          lastReasonText: 'Pending'
        }
      }
    };
    const interactionCard = {
      classList: makeClassList(),
      setAttribute: vi.fn(),
      contains: vi.fn(() => false)
    };

    const originalDocument = globalThis.document;
    globalThis.document = {
      body: { classList: makeClassList() },
      activeElement: null
    };

    try {
      setInteractOpenState({
        nextOpen: false,
        state,
        interactionCard,
        interactionHelp: null,
        interactionHelpToggle: null,
        interactionCardState: { interactionStationRenderKey: 'station:key' },
        closestNearbyStationId: () => 'station_npc_host_5',
        closestNearbyPlayerId: () => null
      });
    } finally {
      globalThis.document = originalDocument;
    }

    expect(state.ui.targetId).toBe('station_npc_host_5');
    expect(state.ui.interactionMode).toBe('none');
    expect(state.ui.interactOpen).toBe(false);
    expect(state.ui.dealer).toMatchObject({
      stationId: '',
      gameType: '',
      state: 'idle',
      quickPlayEnabled: false,
      quickPlayStationId: '',
      challengeId: '',
      playerPick: '',
      opponentPick: '',
      coinflipResult: '',
      diceResult: 0,
      payoutDelta: 0,
      escrowTx: null,
      reason: '',
      reasonCode: '',
      reasonText: '',
      preflight: null
    });
    expect(state.ui.prediction).toMatchObject({
      stationId: '',
      state: 'idle',
      markets: [],
      positions: [],
      selectedRail: 'btc_5m',
      selectedRound: 'current',
      selectedMarketId: '',
      positionStatus: '',
      lastReason: '',
      lastReasonText: ''
    });
  });

  it('keeps the card hidden after close even when a nearby target remains selected', () => {
    const state = {
      players: new Map(),
      stations: new Map([
        ['station_npc_host_5', { id: 'station_npc_host_5', kind: 'dealer_coinflip' }]
      ]),
      nearbyIds: new Set(),
      nearbyStationIds: new Set(['station_npc_host_5']),
      ui: {
        targetId: 'station_npc_host_5',
        interactOpen: true,
        interactionMode: 'station',
        challenge: { gameType: 'rps', wager: 1, approvalState: 'idle', approvalMessage: '', approvalWager: 0 },
        dealer: { state: 'ready', stationId: 'station_npc_host_5', quickPlayEnabled: false, quickPlayStationId: '', escrowTx: null },
        world: { stationId: '', detail: '', actionLabel: 'Use' },
        prediction: { stationId: 'station_npc_host_5', state: 'list', markets: [{ marketId: 'btc_5m_current' }], positions: [], selectedRail: 'btc_5m', selectedRound: 'current', selectedMarketId: 'btc_5m_current', positionStatus: '', lastReason: '', lastReasonText: '' }
      }
    };
    const interactionCard = {
      classList: makeClassList(),
      setAttribute: vi.fn(),
      contains: vi.fn(() => false)
    };

    const originalDocument = globalThis.document;
    globalThis.document = {
      body: { classList: makeClassList() },
      activeElement: null
    };

    try {
      setInteractOpenState({
        nextOpen: false,
        state,
        interactionCard,
        interactionHelp: null,
        interactionHelpToggle: null,
        interactionCardState: { interactionStationRenderKey: '' },
        closestNearbyStationId: () => 'station_npc_host_5',
        closestNearbyPlayerId: () => null
      });
      renderInteractionPromptLine({
        state,
        interactionPrompt: { innerHTML: '', classList: makeClassList() },
        getUiTargetId: () => state.ui.targetId,
        setInteractOpen: () => undefined,
        challengeController: { currentIncomingChallenge: () => null },
        isStation: (id) => String(id).startsWith('station_'),
        labelFor: (id) => String(id)
      });
    } finally {
      globalThis.document = originalDocument;
    }

    expect(state.ui.interactOpen).toBe(false);
    expect(state.ui.targetId).toBe('station_npc_host_5');
    expect(interactionCard.classList.toggle).toHaveBeenCalledWith('open', false);
    expect(interactionCard.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
  });
});

describe('interaction prompt hints', () => {
  it('shows station-specific play hint for named dealer hosts', () => {
    const interactionPrompt = {
      innerHTML: '',
      classList: makeClassList()
    };
    const state = {
      activeChallenge: null,
      ui: { interactOpen: false },
      stations: new Map([
        ['station_npc_host_5', { id: 'station_npc_host_5', kind: 'dealer_rps', localInteraction: { title: 'Vera' } }]
      ])
    };

    renderInteractionPromptLine({
      state,
      interactionPrompt,
      getUiTargetId: () => 'station_npc_host_5',
      setInteractOpen: () => undefined,
      challengeController: { currentIncomingChallenge: () => null },
      isStation: (id) => String(id).startsWith('station_'),
      labelFor: (id) => String(id)
    });

    expect(interactionPrompt.innerHTML).toContain('Vera');
    expect(interactionPrompt.innerHTML).toContain('Rock Paper Scissors');
  });
});
