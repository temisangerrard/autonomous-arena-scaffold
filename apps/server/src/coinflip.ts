import { createHash } from 'node:crypto';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function computeCoinflipFromSeeds(
  houseSeed: string,
  playerSeed: string,
  challengeId: string
): 'heads' | 'tails' {
  const digest = sha256Hex(`${houseSeed}|${playerSeed}|${challengeId}`);
  const firstByte = Number.parseInt(digest.slice(0, 2), 16);
  return Number.isFinite(firstByte) && firstByte % 2 === 1 ? 'heads' : 'tails';
}

export function computeDiceDuelFromSeeds(
  houseSeed: string,
  playerSeed: string,
  challengeId: string
): 1 | 2 | 3 | 4 | 5 | 6 {
  const digest = sha256Hex(`${houseSeed}|${playerSeed}|${challengeId}|dice_duel`);
  const firstByte = Number.parseInt(digest.slice(0, 2), 16);
  const value = Number.isFinite(firstByte) ? (firstByte % 6) + 1 : 1;
  return value as 1 | 2 | 3 | 4 | 5 | 6;
}
