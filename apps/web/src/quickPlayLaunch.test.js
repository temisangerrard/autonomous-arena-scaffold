import { describe, expect, it, vi } from 'vitest';
import { launchQuickPlayStation } from '../public/js/play/runtime/quick-play.js';

describe('quick-play launch handoff', () => {
  it('opens the existing interaction card against the resolved local station target', () => {
    const state = {
      ui: {
        targetId: '',
        interactionMode: 'none',
        dealer: {
          state: 'idle',
          quickPlayEnabled: false,
          quickPlayStationId: ''
        }
      }
    };
    const setInteractOpen = vi.fn();

    const targetId = launchQuickPlayStation({
      station: {
        id: 'station_dealer_coinflip_a',
        gameType: 'coinflip'
      },
      resolveIncomingStationId: () => 'station_npc_host_3',
      setInteractOpen,
      state
    });

    expect(targetId).toBe('station_npc_host_3');
    expect(setInteractOpen).toHaveBeenCalledWith(true);
    expect(state.ui.targetId).toBe('station_npc_host_3');
    expect(state.ui.interactionMode).toBe('station');
    expect(state.ui.dealer.quickPlayEnabled).toBe(true);
    expect(state.ui.dealer.quickPlayStationId).toBe('station_dealer_coinflip_a');
  });
});
