import { describe, expect, it } from 'vitest';
import {
  formatWinningOutcomeLine,
  txExplorerBase,
  txExplorerUrl
} from '../public/js/play/runtime/formatting.js';

describe('txExplorerBase', () => {
  it('defaults unknown chains to Base explorer', () => {
    expect(txExplorerBase(null)).toBe('https://basescan.org');
    expect(txExplorerBase(undefined)).toBe('https://basescan.org');
    expect(txExplorerBase(999999)).toBe('https://basescan.org');
  });

  it('builds valid tx URLs against Base explorer by default', () => {
    const txHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(txExplorerUrl(txHash, null)).toBe(`https://basescan.org/tx/${txHash}`);
  });
});

describe('formatWinningOutcomeLine', () => {
  it('surfaces the winning pick for coinflip rounds', () => {
    expect(formatWinningOutcomeLine({
      gameType: 'coinflip',
      coinflipResult: 'heads'
    })).toBe('Winning pick: HEADS');
  });

  it('surfaces the winning throw for rps rounds', () => {
    expect(formatWinningOutcomeLine({
      gameType: 'rps',
      playerPick: 'rock',
      opponentPick: 'scissors'
    })).toBe('Winning throw: ROCK');
  });

  it('surfaces the winning roll for dice rounds', () => {
    expect(formatWinningOutcomeLine({
      gameType: 'dice_duel',
      diceResult: 4
    })).toBe('Winning roll: 4');
  });
});
