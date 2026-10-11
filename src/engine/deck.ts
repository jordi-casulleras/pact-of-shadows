import { createRng, shuffle } from './rng.js';
import { MAX_RANK, SUITS, type Card, type SpecialKind } from './types.js';

const SPECIAL_COUNTS: Record<SpecialKind, number> = {
  smokeBomb: 5,
  master: 5,
  geisha: 2,
  shogun: 1,
  kitsune: 1,
};

/** The 70-card deck in a fixed order: 56 numbered cards, then 14 specials. */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= MAX_RANK; rank++) {
      deck.push({ id: `${suit}-${rank}`, kind: 'number', suit, rank });
    }
  }
  for (const kind of Object.keys(SPECIAL_COUNTS) as SpecialKind[]) {
    const count = SPECIAL_COUNTS[kind];
    for (let i = 1; i <= count; i++) {
      deck.push({ id: count === 1 ? kind : `${kind}-${i}`, kind });
    }
  }
  return deck;
}

export const DECK_SIZE = createDeck().length;

/** Deals `round` cards to each player from a deck shuffled for this seed and round. */
export function deal(seed: number, round: number, playerCount: number): Card[][] {
  const rng = createRng(Math.imul(seed | 0, 0x9e3779b1) + round);
  const deck = shuffle(createDeck(), rng);
  return Array.from({ length: playerCount }, (_, p) => deck.slice(p * round, (p + 1) * round));
}
