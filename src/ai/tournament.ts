import { applyAction, createGame, createRng, playerView, type GameState } from '../engine/index.js';
import { chooseBid, choosePlay, type Level } from './bots.js';

/** Plays one full game with a bot of the given level in each seat; returns final scores. */
export function playBotGame(levels: readonly Level[], seed: number): number[] {
  const rng = createRng(seed ^ 0x51ed270b);
  let state: GameState = createGame({ playerCount: levels.length, seed }).state;
  while (state.phase !== 'gameOver') {
    if (state.phase === 'bidding') {
      const bids = levels.map((level, p) => chooseBid(playerView(state, p), level, rng));
      bids.forEach((bid, player) => {
        state = applyAction(state, { type: 'bid', player, bid }).state;
      });
    } else if (state.phase === 'playing') {
      const player = state.currentPlayer!;
      const { card, as } = choosePlay(playerView(state, player), levels[player], rng);
      state = applyAction(state, { type: 'play', player, cardId: card.id, as }).state;
    } else {
      state = applyAction(state, { type: 'nextRound' }).state;
    }
  }
  return state.scores;
}

export interface Matchup {
  games: number;
  /** Mean final score per seat held by each level. */
  mean: [number, number];
  /** Games in which the level's best seat outscored the other level's best seat. */
  wins: [number, number];
}

/** Four-player games with two seats per level; seating alternates every game. */
export function runMatchup(a: Level, b: Level, games: number, firstSeed = 1): Matchup {
  const total: [number, number] = [0, 0];
  const wins: [number, number] = [0, 0];
  for (let g = 0; g < games; g++) {
    const aFirst = g % 2 === 0;
    const levels = aFirst ? [a, b, a, b] : [b, a, b, a];
    const scores = playBotGame(levels, firstSeed + g);
    const seats = (level: Level) => scores.filter((_, p) => levels[p] === level);
    const [sa, sb] = a === b ? [[scores[0], scores[2]], [scores[1], scores[3]]] : [seats(a), seats(b)];
    total[0] += (sa[0] + sa[1]) / 2;
    total[1] += (sb[0] + sb[1]) / 2;
    if (Math.max(...sa) > Math.max(...sb)) wins[0]++;
    else if (Math.max(...sb) > Math.max(...sa)) wins[1]++;
  }
  return { games, mean: [total[0] / games, total[1] / games], wins };
}
