import { scoreRound, type PlayerView } from '../engine/index.js';
import { heuristicPlay, optionsFor, type Option } from './policy.js';
import { cloneSim, determinize, playout, simPlay, unseenCards, type Policy, type Sim } from './sim.js';

export const LEVELS = ['apprentice', 'warrior', 'master'] as const;
export type Level = (typeof LEVELS)[number];

const BID_SAMPLES: Record<Level, number> = { apprentice: 8, warrior: 60, master: 40 };
const PLAY_SAMPLES = 30;
/** How often the apprentice plays a random legal card instead of thinking. */
const APPRENTICE_RANDOM = 0.6;

/** Everyone grabs every trick they can: a measure of raw trick-taking power. */
const greedy: Policy = (player, sim) => heuristicPlay(sim.hands[player], sim.plays, player, sim.hands.length, Infinity);

/** Everyone plays to land exactly on their bid. */
const towards =
  (bids: readonly number[]): Policy =>
  (player, sim) =>
    heuristicPlay(sim.hands[player], sim.plays, player, sim.hands.length, bids[player] - sim.tricksWon[player]);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function expectedTricks(view: PlayerView, samples: number, rng: () => number): number {
  const unseen = unseenCards(view);
  let total = 0;
  for (let i = 0; i < samples; i++) {
    const sim = determinize(view, unseen, rng);
    playout(sim, greedy);
    total += sim.tricksWon[view.viewer];
  }
  return total / samples;
}

/** Tries every bid against sampled deals and keeps the one that scores best on average. */
function searchBid(view: PlayerView, rng: () => number): number {
  const me = view.viewer;
  const unseen = unseenCards(view);
  const totals = Array<number>(view.round + 1).fill(0);
  let expected = 0;
  for (let i = 0; i < BID_SAMPLES.master; i++) {
    const deal = determinize(view, unseen, rng);
    const baseline = cloneSim(deal);
    playout(baseline, greedy);
    expected += baseline.tricksWon[me];
    // Opponents are assumed to bid what they would take in this deal.
    const bids = baseline.tricksWon.slice();
    for (let bid = 0; bid <= view.round; bid++) {
      bids[me] = bid;
      const sim = cloneSim(deal);
      playout(sim, towards(bids));
      totals[bid] += scoreRound(view.round, bid, sim.tricksWon[me], sim.bonus[me]).delta;
    }
  }
  expected /= BID_SAMPLES.master;
  let pick = 0;
  for (let bid = 1; bid <= view.round; bid++) {
    const better = totals[bid] > totals[pick];
    const tied = totals[bid] === totals[pick] && Math.abs(bid - expected) < Math.abs(pick - expected);
    if (better || tied) pick = bid;
  }
  return pick;
}

export function chooseBid(view: PlayerView, level: Level, rng: () => number): number {
  if (level === 'master') return searchBid(view, rng);
  let bid = Math.round(expectedTricks(view, BID_SAMPLES[level], rng));
  if (level === 'apprentice' && rng() < 0.5) bid += rng() < 0.5 ? -1 : 1;
  return clamp(bid, 0, view.round);
}

function searchPlay(view: PlayerView, options: Option[], fallback: Option, rng: () => number): Option {
  const me = view.viewer;
  const bids = view.bids as number[];
  const policy = towards(bids);
  const unseen = unseenCards(view);
  const totals = options.map(() => 0);
  for (let i = 0; i < PLAY_SAMPLES; i++) {
    const world: Sim = determinize(view, unseen, rng);
    options.forEach((option, k) => {
      const sim = cloneSim(world);
      simPlay(sim, option);
      playout(sim, policy);
      totals[k] += scoreRound(view.round, bids[me], sim.tricksWon[me], sim.bonus[me]).delta;
    });
  }
  const top = Math.max(...totals);
  const fallbackIndex = options.findIndex((o) => o.card === fallback.card && o.as === fallback.as);
  // Prefer the rule-of-thumb choice whenever the search sees nothing better.
  if (totals[fallbackIndex] === top) return fallback;
  return options[totals.indexOf(top)];
}

/** The card a bot plays. `view` must be the bot's own view and it must be its turn. */
export function choosePlay(view: PlayerView, level: Level, rng: () => number): Option {
  const me = view.viewer;
  const options = optionsFor(view.hand, view.trick.plays);
  if (options.length === 1) return options[0];
  if (level === 'apprentice' && rng() < APPRENTICE_RANDOM) {
    return options[Math.floor(rng() * options.length)];
  }
  const need = (view.bids[me] ?? 0) - view.tricksWon[me];
  const fallback = heuristicPlay(view.hand, view.trick.plays, me, view.handSizes.length, need);
  return level === 'master' ? searchPlay(view, options, fallback, rng) : fallback;
}
