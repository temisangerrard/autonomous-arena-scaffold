import { describe, expect, it } from 'vitest';
import { deriveDealerGameType } from '../public/js/play/runtime/dealer-game-type.js';
import { computeMobileControlVisibility } from '../public/js/play/runtime/mobile-controls.js';

describe('runtime modular controls', () => {
  it('derives dealer game type without defaulting unknown to coinflip', () => {
    expect(deriveDealerGameType('dealer_ready_rps', {}, { kind: 'dealer_coinflip' })).toBe('rps');
    expect(deriveDealerGameType('dealer_ready', { gameType: 'dice_duel' }, { kind: 'dealer_coinflip' })).toBe('dice_duel');
    expect(deriveDealerGameType('dealer_ready', {}, { kind: 'dealer_rps' })).toBe('rps');
    expect(deriveDealerGameType('dealer_ready', {}, { kind: 'unknown_station' })).toBe('');
  });

  it('only enables controls relevant to active context', () => {
    const rps = computeMobileControlVisibility({
      hasTarget: true,
      context: 'dealer_ready_rps',
      interactionOpen: false,
      interactionVisible: false,
      dealerState: 'ready'
    });
    expect(rps.rpsVisible).toBe(true);
    expect(rps.coinflipVisible).toBe(false);
    expect(rps.diceVisible).toBe(false);
    expect(rps.mapShouldHide).toBe(true);
  });
});
