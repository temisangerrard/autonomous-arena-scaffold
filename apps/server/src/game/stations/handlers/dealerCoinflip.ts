import type { CoinflipMove } from '@arena/shared';

export const COINFLIP_DEALER_METHOD = 'sha256(houseSeed|playerSeed|challengeId), LSB(firstByte)=1 -> heads';

export function oppositeCoinflipPick(playerPick: CoinflipMove): CoinflipMove {
  return playerPick === 'heads' ? 'tails' : 'heads';
}
