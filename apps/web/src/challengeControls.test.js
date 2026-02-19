import { describe, expect, it } from 'vitest';
import { createChallengeController } from '../public/js/play/challenge.js';

function makeController(overrides = {}) {
  const state = {
    playerId: 'p1',
    incomingChallengeId: null,
    activeChallenge: null,
    outgoingChallengeId: null,
    ui: {
      interactOpen: true,
      interactionMode: 'station',
      dealer: {
        state: 'ready',
        gameType: 'coinflip'
      },
      challenge: { gameType: 'rps', wager: 1, approvalState: 'idle', approvalWager: 0 }
    },
    escrowApproval: { mode: 'auto' }
  };

  return createChallengeController({
    state: Object.assign(state, overrides.state || {}),
    socketRef: { current: { readyState: 1, send: () => undefined } },
    showToast: () => undefined,
    labelFor: (id) => id,
    isStation: () => false,
    closestNearbyPlayerId: () => null,
    getUiTargetId: () => null,
    formatWagerInline: (n) => `$${n}`,
    ...overrides
  });
}

describe('challenge control context', () => {
  it('returns dealer-specific ready contexts', () => {
    const coinflip = makeController();
    expect(coinflip.computeControlContext()).toBe('dealer_ready_coinflip');

    const rps = makeController({ state: { ui: { interactOpen: true, interactionMode: 'station', dealer: { state: 'ready', gameType: 'rps' } } } });
    expect(rps.computeControlContext()).toBe('dealer_ready_rps');

    const dice = makeController({ state: { ui: { interactOpen: true, interactionMode: 'station', dealer: { state: 'ready', gameType: 'dice_duel' } } } });
    expect(dice.computeControlContext()).toBe('dealer_ready_dice_duel');
  });

  it('does not expose dealer controls for unknown dealer game types', () => {
    const unknown = makeController({
      state: { ui: { interactOpen: true, interactionMode: 'station', dealer: { state: 'ready', gameType: 'future_game_x' } } }
    });
    expect(unknown.computeControlContext()).toBe('idle');
  });
});
