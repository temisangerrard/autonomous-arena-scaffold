import { describe, expect, it, vi } from 'vitest';
import { sendGameMoveRuntime } from '../public/js/play/runtime/game-moves.js';

describe('dealer game moves', () => {
  it('preserves quick-play remote launch mode for dealer pick hotkeys', () => {
    const send = vi.fn();
    const state = {
      ui: {
        interactOpen: true,
        interactionMode: 'station',
        dealer: {
          state: 'ready',
          stationId: 'station_npc_host_3',
          gameType: 'coinflip',
          quickPlayEnabled: true,
          quickPlayStationId: 'station_dealer_coinflip_a'
        }
      },
      challengeMessage: '',
      quickstart: { moveSubmitted: false }
    };

    sendGameMoveRuntime({
      move: 'heads',
      state,
      socket: { readyState: WebSocket.OPEN, send },
      resolveStationIdForSend: () => 'station_dealer_coinflip_a',
      makePlayerSeed: () => 'seed_123',
      showToast: vi.fn(),
      pluginRegistry: {
        game: () => ({
          validateMove: (candidateMove) => candidateMove === 'heads' || candidateMove === 'tails'
        })
      }
    });

    expect(send).toHaveBeenCalledWith(JSON.stringify({
      type: 'station_interact',
      stationId: 'station_dealer_coinflip_a',
      action: 'coinflip_house_pick',
      pick: 'heads',
      playerSeed: 'seed_123',
      quickPlay: true
    }));
  });
});
