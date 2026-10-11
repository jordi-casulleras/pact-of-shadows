import { createDeck, resolveTrick, type Card, type Play, type PlayerView } from '../engine/index.js';
import type { Option } from './policy.js';

/** Mutable, minimal round state used for fast playouts. */
export interface Sim {
  hands: Card[][];
  plays: Play[];
  current: number;
  tricksWon: number[];
  bonus: number[];
}

export type Policy = (player: number, sim: Sim) => Option;

function shuffleInPlace<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

/** Cards the viewer has not seen: neither in their hand nor played this round. */
export function unseenCards(view: PlayerView): Card[] {
  const seen = new Set<string>(view.hand.map((c) => c.id));
  for (const trick of view.completedTricks) for (const p of trick.plays) seen.add(p.card.id);
  for (const p of view.trick.plays) seen.add(p.card.id);
  return createDeck().filter((c) => !seen.has(c.id));
}

/** One possible world: the viewer's real hand plus random hands for everyone else. */
export function determinize(view: PlayerView, unseen: readonly Card[], rng: () => number): Sim {
  const pool = unseen.slice();
  shuffleInPlace(pool, rng);
  let next = 0;
  const hands = view.handSizes.map((size, p) => {
    if (p === view.viewer) return view.hand.slice();
    const hand = pool.slice(next, next + size);
    next += size;
    return hand;
  });
  return {
    hands,
    plays: view.trick.plays.slice(),
    current: view.currentPlayer ?? view.trick.leader,
    tricksWon: view.tricksWon.slice(),
    bonus: view.pendingBonus.slice(),
  };
}

export function cloneSim(sim: Sim): Sim {
  return {
    hands: sim.hands.map((h) => h.slice()),
    plays: sim.plays.slice(),
    current: sim.current,
    tricksWon: sim.tricksWon.slice(),
    bonus: sim.bonus.slice(),
  };
}

/** Applies one play for the current player, resolving the trick if it completes. */
export function simPlay(sim: Sim, option: Option): void {
  const player = sim.current;
  const hand = sim.hands[player];
  hand.splice(hand.indexOf(option.card), 1);
  sim.plays.push({ player, card: option.card, as: option.as });
  const n = sim.hands.length;
  if (sim.plays.length < n) {
    sim.current = (player + 1) % n;
    return;
  }
  const result = resolveTrick(sim.plays);
  sim.tricksWon[result.winner] += 1;
  sim.bonus[result.winner] += result.bonus;
  sim.plays = [];
  sim.current = result.winner;
}

/** Plays the round out to the end with `policy` choosing for every seat. */
export function playout(sim: Sim, policy: Policy): void {
  while (sim.plays.length > 0 || sim.hands[sim.current].length > 0) {
    simPlay(sim, policy(sim.current, sim));
  }
}
