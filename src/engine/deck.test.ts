import { describe, expect, it } from 'vitest';
import { createDeck, deal, DECK_SIZE } from './deck.js';
import { scoreRound } from './scoring.js';

describe('deck', () => {
  const deck = createDeck();
  const countKind = (kind: string) => deck.filter((c) => c.kind === kind).length;

  it('has 70 cards with unique ids', () => {
    expect(deck).toHaveLength(70);
    expect(DECK_SIZE).toBe(70);
    expect(new Set(deck.map((c) => c.id)).size).toBe(70);
  });

  it('has 14 numbered cards (1-14) in each of the four clans', () => {
    for (const suit of ['fire', 'water', 'forest', 'shadow']) {
      const ranks = deck.flatMap((c) => (c.kind === 'number' && c.suit === suit ? [c.rank] : []));
      expect(ranks).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    }
  });

  it('has 5 smoke bombs, 5 masters, 2 geishas, 1 shogun and 1 kitsune', () => {
    expect(countKind('smokeBomb')).toBe(5);
    expect(countKind('master')).toBe(5);
    expect(countKind('geisha')).toBe(2);
    expect(countKind('shogun')).toBe(1);
    expect(countKind('kitsune')).toBe(1);
  });
});

describe('deal', () => {
  it('gives each player `round` distinct cards', () => {
    const hands = deal(7, 10, 6);
    expect(hands.map((h) => h.length)).toEqual([10, 10, 10, 10, 10, 10]);
    expect(new Set(hands.flat().map((c) => c.id)).size).toBe(60);
  });

  it('is reproducible for a seed and differs across rounds and seeds', () => {
    const ids = (seed: number, round: number) => deal(seed, round, 4).flat().map((c) => c.id);
    expect(ids(42, 5)).toEqual(ids(42, 5));
    expect(ids(42, 5)).not.toEqual(ids(43, 5));
    expect(ids(42, 5).slice(0, 4)).not.toEqual(ids(42, 4).slice(0, 4));
  });
});

describe('scoreRound', () => {
  it('pays 20 per trick for an exact bid of one or more', () => {
    expect(scoreRound(5, 3, 3, 0)).toEqual({ bonus: 0, delta: 60 });
  });

  it('costs 10 per trick of difference, over or under', () => {
    expect(scoreRound(5, 3, 5, 0).delta).toBe(-20);
    expect(scoreRound(5, 3, 0, 0).delta).toBe(-30);
  });

  it('pays 10 x round for a made zero bid and costs the same when missed', () => {
    expect(scoreRound(7, 0, 0, 0).delta).toBe(70);
    expect(scoreRound(7, 0, 2, 0).delta).toBe(-70);
  });

  it('pays the bonus only when the bid is made', () => {
    expect(scoreRound(4, 2, 2, 50)).toEqual({ bonus: 50, delta: 90 });
    expect(scoreRound(4, 2, 3, 50)).toEqual({ bonus: 0, delta: -10 });
    expect(scoreRound(4, 0, 1, 40)).toEqual({ bonus: 0, delta: -40 });
  });
});
