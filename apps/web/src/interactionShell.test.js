import { describe, expect, it, vi } from 'vitest';
import { setInteractOpenState, renderInteractionPromptLine } from '../public/js/play/runtime/interaction-shell.js';

function makeClassList() {
  return {
    toggle: vi.fn(),
    add: vi.fn(),
    remove: vi.fn()
  };
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
