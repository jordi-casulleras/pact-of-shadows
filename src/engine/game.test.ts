import { describe, expect, it } from 'vitest';
import { applyAction, createGame, legalBids, legalPlays, winners } from './game.js';
import { createRng } from './rng.js';
import { num, special } from './testing.js';
import { EngineError, type Action, type Card, type ErrorCode, type GameEvent, type GameState } from './types.js';
import { playerView } from './view.js';

const expectError = (fn: () => unknown, code: ErrorCode) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    expect((e as EngineError).code).toBe(code);
    return;
  }
  throw new Error(`expected EngineError ${code}`);
};

const step = (state: GameState, action: Action) => applyAction(state, action).state;

/** A state in the playing phase with hand-picked hands; player 0 leads. */
function rigged(hands: Card[][], bids: number[]): GameState {
  const { state } = createGame({ playerCount: hands.length, seed: 1 });
  return {
    ...state,
    phase: 'playing',
    round: hands[0].length,
    hands,
    bids,
    currentPlayer: 0,
  };
}

/** Plays a whole game choosing uniformly among legal moves. */
function simulate(playerCount: number, seed: number) {
  const pick = createRng(seed ^ 0x5eed);
  const choose = <T>(items: T[]): T => items[Math.floor(pick() * items.length)];
  let { state, events } = createGame({ playerCount, seed });
  const all: GameEvent[] = [...events];
  const apply = (action: Action) => {
    ({ state, events } = applyAction(state, action));
    all.push(...events);
  };

  while (state.phase !== 'gameOver') {
    if (state.phase === 'bidding') {
      for (let p = 0; p < playerCount; p++) apply({ type: 'bid', player: p, bid: choose(legalBids(state, p)) });
    } else if (state.phase === 'playing') {
      const player = state.currentPlayer!;
      const card = choose(legalPlays(state, player));
      const as = card.kind === 'kitsune' ? choose(['master', 'smokeBomb'] as const) : undefined;
      apply({ type: 'play', player, cardId: card.id, as });
    } else {
      apply({ type: 'nextRound' });
    }
  }
  return { state, events: all };
}

describe('createGame', () => {
  it('starts round 1 in the bidding phase with one card each', () => {
    const { state, events } = createGame({ playerCount: 4, seed: 3 });
    expect(state.phase).toBe('bidding');
    expect(state.round).toBe(1);
    expect(state.hands.map((h) => h.length)).toEqual([1, 1, 1, 1]);
    expect(state.scores).toEqual([0, 0, 0, 0]);
    expect(events).toEqual([{ type: 'roundStarted', round: 1, startingPlayer: 0 }]);
  });

  it('rejects bad configurations', () => {
    expectError(() => createGame({ playerCount: 1, seed: 1 }), 'invalidConfig');
    expectError(() => createGame({ playerCount: 7, seed: 1 }), 'invalidConfig');
    expectError(() => createGame({ playerCount: 6, seed: 1, rounds: 12 }), 'invalidConfig');
    expectError(() => createGame({ playerCount: 3, seed: 1, firstPlayer: 3 }), 'invalidConfig');
    expectError(() => createGame({ playerCount: 3, seed: 1.5 }), 'invalidConfig');
  });
});

describe('bidding', () => {
  const start = () => createGame({ playerCount: 3, seed: 9 }).state;

  it('reveals bids and starts play only once everyone has bid', () => {
    let r = applyAction(start(), { type: 'bid', player: 2, bid: 1 });
    expect(r.state.phase).toBe('bidding');
    expect(r.events).toEqual([{ type: 'bidPlaced', player: 2 }]);
    r = applyAction(r.state, { type: 'bid', player: 0, bid: 0 });
    r = applyAction(r.state, { type: 'bid', player: 1, bid: 1 });
    expect(r.state.phase).toBe('playing');
    expect(r.state.currentPlayer).toBe(0);
    expect(r.events).toEqual([
      { type: 'bidPlaced', player: 1 },
      { type: 'bidsRevealed', bids: [0, 1, 1] },
    ]);
  });

  it('rejects invalid bids', () => {
    const s = start();
    expectError(() => step(s, { type: 'bid', player: 0, bid: 2 }), 'invalidBid');
    expectError(() => step(s, { type: 'bid', player: 0, bid: -1 }), 'invalidBid');
    expectError(() => step(s, { type: 'bid', player: 0, bid: 0.5 }), 'invalidBid');
    expectError(() => step(s, { type: 'bid', player: 3, bid: 0 }), 'invalidPlayer');
    const once = step(s, { type: 'bid', player: 0, bid: 1 });
    expectError(() => step(once, { type: 'bid', player: 0, bid: 0 }), 'alreadyBid');
  });

  it('does not allow playing or advancing during bidding', () => {
    const s = start();
    expectError(() => step(s, { type: 'play', player: 0, cardId: s.hands[0][0].id }), 'wrongPhase');
    expectError(() => step(s, { type: 'nextRound' }), 'wrongPhase');
  });
});

describe('playing', () => {
  it('enforces turn order, ownership and following the clan', () => {
    const s = rigged(
      [
        [num('fire', 5), num('water', 2)],
        [num('fire', 9), num('water', 7)],
      ],
      [1, 1],
    );
    expectError(() => step(s, { type: 'play', player: 1, cardId: 'fire-9' }), 'notYourTurn');
    expectError(() => step(s, { type: 'play', player: 0, cardId: 'fire-9' }), 'cardNotInHand');
    const led = step(s, { type: 'play', player: 0, cardId: 'fire-5' });
    expect(legalPlays(led, 1).map((c) => c.id)).toEqual(['fire-9']);
    expect(legalPlays(led, 0)).toEqual([]);
    expectError(() => step(led, { type: 'play', player: 1, cardId: 'water-7' }), 'illegalCard');
    expectError(() => step(led, { type: 'bid', player: 1, bid: 1 }), 'wrongPhase');
  });

  it('requires a mode for the Kitsune and forbids it for other cards', () => {
    const s = rigged([[special('kitsune'), num('fire', 1)], [num('fire', 2), num('fire', 3)]], [1, 1]);
    expectError(() => step(s, { type: 'play', player: 0, cardId: 'kitsune-1' }), 'kitsuneModeRequired');
    expectError(() => step(s, { type: 'play', player: 0, cardId: 'fire-1', as: 'master' }), 'kitsuneModeNotAllowed');
    const r = applyAction(s, { type: 'play', player: 0, cardId: 'kitsune-1', as: 'master' });
    expect(r.events).toEqual([{ type: 'cardPlayed', player: 0, card: special('kitsune'), as: 'master' }]);
    expect(r.state.trick.plays[0].as).toBe('master');
  });

  it('gives the lead to the trick winner and scores the round after the last trick', () => {
    let s = rigged(
      [
        [num('fire', 5), special('shogun')],
        [num('fire', 9), special('master')],
        [num('water', 3), num('water', 14)],
      ],
      [1, 1, 0],
    );
    s = step(s, { type: 'play', player: 0, cardId: 'fire-5' });
    s = step(s, { type: 'play', player: 1, cardId: 'fire-9' });
    let r = applyAction(s, { type: 'play', player: 2, cardId: 'water-14' });
    expect(r.events.at(-1)).toMatchObject({ type: 'trickWon', result: { winner: 1, reason: 'highestLeadSuit', bonus: 10 } });
    expect(r.state.currentPlayer).toBe(1);
    expect(r.state.trick).toEqual({ leader: 1, plays: [] });
    expect(r.state.lastTrick?.plays).toHaveLength(3);
    expect(r.state.tricksWon).toEqual([0, 1, 0]);

    s = step(r.state, { type: 'play', player: 1, cardId: 'master-1' });
    s = step(s, { type: 'play', player: 2, cardId: 'water-3' });
    r = applyAction(s, { type: 'play', player: 0, cardId: 'shogun-1' });

    // P0 bid 1, won 1 with +30; P1 bid 1, won 1 with the +10 from the 14; P2 made a zero bid in round 2.
    const result = { round: 2, bids: [1, 1, 0], tricksWon: [1, 1, 0], bonus: [30, 10, 0], delta: [50, 30, 20] };
    expect(r.events.at(-1)).toEqual({ type: 'roundScored', result, scores: [50, 30, 20] });
    expect(r.state.phase).toBe('roundEnd');
    expect(r.state.currentPlayer).toBeNull();
    expect(r.state.history).toEqual([result]);
    expect(r.state.hands).toEqual([[], [], []]);
  });

  it('drops the pending bonus of a player who misses their bid', () => {
    let s = rigged([[special('shogun')], [special('master')]], [0, 0]);
    s = step(s, { type: 'play', player: 0, cardId: 'shogun-1' });
    s = step(s, { type: 'play', player: 1, cardId: 'master-1' });
    expect(s.pendingBonus).toEqual([30, 0]);
    expect(s.history[0]).toMatchObject({ bonus: [0, 0], delta: [-10, 10] });
  });

  it('does not mutate the state it is given', () => {
    const s = rigged([[num('fire', 5)], [num('fire', 9)]], [1, 0]);
    const before = JSON.stringify(s);
    applyAction(s, { type: 'play', player: 0, cardId: 'fire-5' });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('rounds', () => {
  it('rotates the starting player and deals one more card each round', () => {
    const { events } = simulate(4, 11);
    const starts = events.flatMap((e) => (e.type === 'roundStarted' ? [[e.round, e.startingPlayer]] : []));
    expect(starts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => [r, (r - 1) % 4]));
  });

  it('honours firstPlayer and a shorter game', () => {
    let { state } = createGame({ playerCount: 2, seed: 5, rounds: 1, firstPlayer: 1 });
    expect(state.startingPlayer).toBe(1);
    state = step(state, { type: 'bid', player: 0, bid: 0 });
    state = step(state, { type: 'bid', player: 1, bid: 0 });
    for (const p of [1, 0]) {
      const card = state.hands[p][0];
      state = step(state, { type: 'play', player: p, cardId: card.id, as: card.kind === 'kitsune' ? 'smokeBomb' : undefined });
    }
    const end = applyAction(state, { type: 'nextRound' });
    expect(end.state.phase).toBe('gameOver');
    expect(end.events).toEqual([{ type: 'gameOver', scores: end.state.scores, winners: winners(end.state) }]);
    expectError(() => step(end.state, { type: 'nextRound' }), 'wrongPhase');
  });

  it('reports every top scorer as a winner on a tie', () => {
    const { state } = createGame({ playerCount: 3, seed: 1 });
    expect(winners({ ...state, scores: [40, 90, 90] })).toEqual([1, 2]);
    expect(winners({ ...state, scores: [-10, -30, -20] })).toEqual([0]);
  });
});

describe('full games', () => {
  it.each([2, 3, 4, 5, 6])('a random %i-player game keeps its invariants', (playerCount) => {
    for (let seed = 1; seed <= 25; seed++) {
      const { state, events } = simulate(playerCount, seed);
      expect(state.history).toHaveLength(10);
      state.history.forEach((r, i) => {
        expect(r.round).toBe(i + 1);
        expect(r.tricksWon.reduce((a, b) => a + b, 0)).toBe(r.round);
      });
      const total = (p: number) => state.history.reduce((sum, r) => sum + r.delta[p], 0);
      expect(state.scores).toEqual(state.scores.map((_, p) => total(p)));
      expect(events.filter((e) => e.type === 'trickWon')).toHaveLength(55);
      expect(events.filter((e) => e.type === 'cardPlayed')).toHaveLength(55 * playerCount);
      expect(events.at(-1)?.type).toBe('gameOver');
    }
  });

  it('is reproducible from the seed and survives a JSON round trip mid-game', () => {
    expect(simulate(4, 77).state).toEqual(simulate(4, 77).state);

    let state = createGame({ playerCount: 3, seed: 8 }).state;
    for (let p = 0; p < 3; p++) state = step(state, { type: 'bid', player: p, bid: 0 });
    const copy: GameState = JSON.parse(JSON.stringify(state));
    expect(copy).toEqual(state);
    const card = state.hands[0][0];
    const action: Action = { type: 'play', player: 0, cardId: card.id, as: card.kind === 'kitsune' ? 'master' : undefined };
    expect(applyAction(copy, action)).toEqual(applyAction(state, action));
  });
});

describe('playerView', () => {
  it('shows only the viewer hand and hides other bids until the reveal', () => {
    let state = createGame({ playerCount: 3, seed: 4 }).state;
    state = step(state, { type: 'bid', player: 1, bid: 1 });
    const view = playerView(state, 0);
    expect(view.hand).toEqual(state.hands[0]);
    expect(view.handSizes).toEqual([1, 1, 1]);
    expect(view.bids).toEqual([null, null, null]);
    expect(view.hasBid).toEqual([false, true, false]);
    expect(playerView(state, 1).bids).toEqual([null, 1, null]);
    expect(view).not.toHaveProperty('hands');
    const others = [...state.hands[1], ...state.hands[2]].map((c) => c.id);
    for (const id of others) expect(JSON.stringify(view)).not.toContain(`"${id}"`);

    state = step(state, { type: 'bid', player: 0, bid: 0 });
    state = step(state, { type: 'bid', player: 2, bid: 1 });
    expect(playerView(state, 0).bids).toEqual([0, 1, 1]);
  });
});
