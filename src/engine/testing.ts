import type { Card, KitsuneMode, Play, SpecialKind, Suit } from './types.js';

/** Test helpers for building cards and tricks by hand. */
export const num = (suit: Suit, rank: number): Card => ({ id: `${suit}-${rank}`, kind: 'number', suit, rank });

export const special = (kind: SpecialKind, i = 1): Card => ({ id: `${kind}-${i}`, kind });

/** Builds a trick where seat i plays the i-th entry; a tuple declares the Kitsune's mode. */
export const trickOf = (...cards: (Card | [Card, KitsuneMode])[]): Play[] =>
  cards.map((entry, player) =>
    Array.isArray(entry) ? { player, card: entry[0], as: entry[1] } : { player, card: entry },
  );
