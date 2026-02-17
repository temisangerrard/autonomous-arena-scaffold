import { createHash } from 'node:crypto';
import type { RpsMove } from '@arena/shared';

const RPS_MOVES: RpsMove[] = ['rock', 'paper', 'scissors'];

export const RPS_DEALER_METHOD = 'sha256(houseSeed|playerSeed|challengeId), byte mod 3 picks house move';

export function pickHouseRpsMove(houseSeed: string, playerSeed: string, challengeId: string): RpsMove {
  const digest = createHash('sha256').update(`${houseSeed}|${playerSeed}|${challengeId}|rps`).digest('hex');
  const idx = Number.parseInt(digest.slice(0, 2), 16) % 3;
  return RPS_MOVES[idx] ?? 'rock';
}
