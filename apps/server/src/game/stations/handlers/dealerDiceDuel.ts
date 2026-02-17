import { createHash } from 'node:crypto';
import type { DiceDuelMove } from '@arena/shared';

const DICE_MOVES: DiceDuelMove[] = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];

export const DICE_DUEL_DEALER_METHOD = 'sha256(houseSeed|playerSeed|challengeId|dice_duel), byte mod 6 + 1';

export function pickHouseDiceGuess(houseSeed: string, playerSeed: string, challengeId: string): DiceDuelMove {
  const digest = createHash('sha256').update(`${houseSeed}|${playerSeed}|${challengeId}|dice_guess`).digest('hex');
  const idx = Number.parseInt(digest.slice(0, 2), 16) % 6;
  return DICE_MOVES[idx] ?? 'd1';
}
