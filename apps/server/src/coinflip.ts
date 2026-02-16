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
