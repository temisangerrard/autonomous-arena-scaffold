import { sha256Hex } from '../../../coinflip.js';

export const BLACKJACK_DEALER_METHOD =
  'sha256(houseSeed|playerSeed) → Fisher-Yates shuffle of 52-card deck; cards dealt in index order';

// Card ranks and suits
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

/** Build and shuffle a 52-card deck deterministically from combined seeds */
export function dealDeckFromSeeds(houseSeed: string, playerSeed: string): string[] {
  const deck: string[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}`);
    }
  }
  // Fisher-Yates using successive sha256 hashes for randomness
  const combined = `${houseSeed}|${playerSeed}`;
  for (let i = deck.length - 1; i > 0; i--) {
    const hashHex = sha256Hex(`${combined}|${i}`);
    const rand = parseInt(hashHex.slice(0, 8), 16);
    const j = rand % (i + 1);
    const tmp = deck[i] as string;
    deck[i] = deck[j] as string;
    deck[j] = tmp;
  }
  return deck;
}

/** Numeric value of a single card (aces return 11; caller handles soft/hard) */
export function cardValue(card: string): number {
  const rank = card.slice(0, -1); // strip suit symbol (♠ is 3 bytes in UTF-8 but 1 char)
  if (rank === 'A') return 11;
  if (['J', 'Q', 'K'].includes(rank)) return 10;
  return parseInt(rank, 10);
}

/** Compute hand total with optimal ace handling; returns { value, soft } */
export function handValue(cards: string[]): { value: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    const v = cardValue(card);
    total += v;
    if (v === 11) aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { value: total, soft: aces > 0 };
}

/** Standard dealer rule: hit on ≤16, stand on ≥17 */
export function dealerShouldHit(total: number): boolean {
  return total <= 16;
}

/** Resolve winner; returns payoutDelta from player perspective */
export function resolveBlackjack(
  playerCards: string[],
  dealerCards: string[],
  wager: number
): { winnerId: 'player' | 'house' | null; payoutDelta: number } {
  const { value: pv } = handValue(playerCards);
  const { value: dv } = handValue(dealerCards);
  const playerBust = pv > 21;
  const dealerBust = dv > 21;

  if (playerBust) return { winnerId: 'house', payoutDelta: -wager };
  if (dealerBust) return { winnerId: 'player', payoutDelta: wager };
  if (pv > dv) return { winnerId: 'player', payoutDelta: wager };
  if (dv > pv) return { winnerId: 'house', payoutDelta: -wager };
  return { winnerId: null, payoutDelta: 0 }; // push
}

/** Build the dealer's visible hand for mid-game (hide hole card) */
export function visibleDealerHand(dealerCards: string[]): string[] {
  return dealerCards.map((c, i) => (i === 1 ? '?' : c));
}
