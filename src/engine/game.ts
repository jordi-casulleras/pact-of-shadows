import { DECK_SIZE, deal } from './deck.js';
import { createRng } from './rng.js';
import { scoreRound } from './scoring.js';
import { legalCards, resolveTrick } from './trick.js';
import {
  EngineError,
  type Action,
  type Card,
  type GameConfig,
  type GameEvent,
  type GameState,
  type KitsuneMode,
  type Play,
  type RoundResult,
  type StepResult,
} from './types.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const DEFAULT_ROUNDS = 10;

export interface NewGameOptions {
  playerCount: number;
  seed: number;
  rounds?: number;
  firstPlayer?: number;
}

function startRound(config: GameConfig, round: number, scores: number[], history: RoundResult[]): GameState {
  const n = config.playerCount;
  const startingPlayer = (config.firstPlayer + round - 1) % n;
  return {
    config,
    phase: 'bidding',
    round,
    startingPlayer,
    hands: deal(config.seed, round, n),
    bids: Array<number | null>(n).fill(null),
    tricksWon: Array<number>(n).fill(0),
    pendingBonus: Array<number>(n).fill(0),
    trick: { leader: startingPlayer, plays: [] },
    completedTricks: [],
    lastTrick: null,
    currentPlayer: null,
    scores,
    history,
  };
}

/**
 * Who opens round 1 when it is left to chance. Drawn from the game's seed, so the same seed
 * always gives the same game.
 */
export const randomFirstPlayer = (seed: number, playerCount: number): number =>
  Math.floor(createRng(seed ^ 0x1ead)() * playerCount);

export function createGame(options: NewGameOptions): StepResult {
  const config: GameConfig = {
    playerCount: options.playerCount,
    seed: options.seed,
    rounds: options.rounds ?? DEFAULT_ROUNDS,
    firstPlayer: options.firstPlayer ?? 0,
  };
  const { playerCount: n, rounds, firstPlayer } = config;
  if (!Number.isInteger(n) || n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new EngineError('invalidConfig', `playerCount must be ${MIN_PLAYERS}-${MAX_PLAYERS}`);
  }
  if (!Number.isInteger(rounds) || rounds < 1 || rounds * n > DECK_SIZE) {
    throw new EngineError('invalidConfig', 'rounds must fit in the deck');
  }
  if (!Number.isInteger(firstPlayer) || firstPlayer < 0 || firstPlayer >= n) {
    throw new EngineError('invalidConfig', 'firstPlayer out of range');
  }
  if (!Number.isInteger(config.seed)) {
    throw new EngineError('invalidConfig', 'seed must be an integer');
  }
  const state = startRound(config, 1, Array<number>(n).fill(0), []);
  return { state, events: [{ type: 'roundStarted', round: 1, startingPlayer: state.startingPlayer }] };
}

function assertPlayer(state: GameState, player: number): void {
  if (!Number.isInteger(player) || player < 0 || player >= state.config.playerCount) {
    throw new EngineError('invalidPlayer');
  }
}

function applyBid(state: GameState, player: number, bid: number): StepResult {
  if (state.phase !== 'bidding') throw new EngineError('wrongPhase');
  assertPlayer(state, player);
  if (!Number.isInteger(bid) || bid < 0 || bid > state.round) throw new EngineError('invalidBid');
  if (state.bids[player] !== null) throw new EngineError('alreadyBid');

  const bids = state.bids.slice();
  bids[player] = bid;
  const events: GameEvent[] = [{ type: 'bidPlaced', player }];
  if (bids.some((b) => b === null)) return { state: { ...state, bids }, events };

  events.push({ type: 'bidsRevealed', bids: bids as number[] });
  return { state: { ...state, bids, phase: 'playing', currentPlayer: state.startingPlayer }, events };
}

function scoreCurrentRound(state: GameState): { result: RoundResult; scores: number[] } {
  const bids = state.bids as number[];
  const perPlayer = bids.map((bid, p) => scoreRound(state.round, bid, state.tricksWon[p], state.pendingBonus[p]));
  const result: RoundResult = {
    round: state.round,
    bids,
    tricksWon: state.tricksWon,
    bonus: perPlayer.map((s) => s.bonus),
    delta: perPlayer.map((s) => s.delta),
  };
  return { result, scores: state.scores.map((s, p) => s + result.delta[p]) };
}

function applyPlay(state: GameState, player: number, cardId: string, as?: KitsuneMode): StepResult {
  if (state.phase !== 'playing') throw new EngineError('wrongPhase');
  assertPlayer(state, player);
  if (player !== state.currentPlayer) throw new EngineError('notYourTurn');

  const hand = state.hands[player];
  const card = hand.find((c) => c.id === cardId);
  if (!card) throw new EngineError('cardNotInHand');
  if (card.kind === 'kitsune' && as !== 'master' && as !== 'smokeBomb') {
    throw new EngineError('kitsuneModeRequired');
  }
  if (card.kind !== 'kitsune' && as !== undefined) throw new EngineError('kitsuneModeNotAllowed');
  if (!legalCards(hand, state.trick.plays).includes(card)) throw new EngineError('illegalCard');

  const n = state.config.playerCount;
  const play: Play = as ? { player, card, as } : { player, card };
  const hands = state.hands.map((h, p) => (p === player ? h.filter((c) => c !== card) : h));
  const trick = { leader: state.trick.leader, plays: [...state.trick.plays, play] };
  const events: GameEvent[] = [as ? { type: 'cardPlayed', player, card, as } : { type: 'cardPlayed', player, card }];

  if (trick.plays.length < n) {
    return { state: { ...state, hands, trick, currentPlayer: (player + 1) % n }, events };
  }

  const result = resolveTrick(trick.plays);
  const tricksWon = state.tricksWon.slice();
  tricksWon[result.winner] += 1;
  const pendingBonus = state.pendingBonus.slice();
  pendingBonus[result.winner] += result.bonus;
  events.push({ type: 'trickWon', trick, result });

  const next: GameState = {
    ...state,
    hands,
    tricksWon,
    pendingBonus,
    trick: { leader: result.winner, plays: [] },
    completedTricks: [...state.completedTricks, trick],
    lastTrick: { ...trick, result },
    currentPlayer: result.winner,
  };
  if (hands[0].length > 0) return { state: next, events };

  const scored = scoreCurrentRound(next);
  events.push({ type: 'roundScored', result: scored.result, scores: scored.scores });
  return {
    state: {
      ...next,
      phase: 'roundEnd',
      currentPlayer: null,
      scores: scored.scores,
      history: [...state.history, scored.result],
    },
    events,
  };
}

function applyNextRound(state: GameState): StepResult {
  if (state.phase !== 'roundEnd') throw new EngineError('wrongPhase');
  if (state.round >= state.config.rounds) {
    return {
      state: { ...state, phase: 'gameOver' },
      events: [{ type: 'gameOver', scores: state.scores, winners: winners(state) }],
    };
  }
  const next = startRound(state.config, state.round + 1, state.scores, state.history);
  return {
    state: next,
    events: [{ type: 'roundStarted', round: next.round, startingPlayer: next.startingPlayer }],
  };
}

/** Pure reducer: returns the new state and the events the action produced. Throws EngineError on an illegal action. */
export function applyAction(state: GameState, action: Action): StepResult {
  switch (action.type) {
    case 'bid':
      return applyBid(state, action.player, action.bid);
    case 'play':
      return applyPlay(state, action.player, action.cardId, action.as);
    case 'nextRound':
      return applyNextRound(state);
  }
}

/** Players with the highest score; more than one means a shared victory. */
export function winners(state: GameState): number[] {
  const best = Math.max(...state.scores);
  return state.scores.flatMap((s, p) => (s === best ? [p] : []));
}

/** Cards `player` may play right now; empty when it is not their turn. */
export function legalPlays(state: GameState, player: number): Card[] {
  if (state.phase !== 'playing' || player !== state.currentPlayer) return [];
  return legalCards(state.hands[player], state.trick.plays);
}

/** Bids `player` may still place; empty once they have bid or outside bidding. */
export function legalBids(state: GameState, player: number): number[] {
  if (state.phase !== 'bidding' || state.bids[player] !== null) return [];
  return Array.from({ length: state.round + 1 }, (_, i) => i);
}
