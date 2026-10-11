import { describe, expect, it } from 'vitest';
import { applyAction, createGame, createRng, playerView, type Card, type GameState } from '../engine/index.js';
import { num, special } from '../engine/testing.js';
import { chooseBid, LEVELS } from './bots.js';
import { heuristicPlay } from './policy.js';
import { unseenCards } from './sim.js';
import { playBotGame, runMatchup } from './tournament.js';

/** A playing-phase state with hand-picked hands; player 0 leads. */
function rigged(hands: Card[][], bids: number[]): GameState {
  const { state } = createGame({ playerCount: hands.length, seed: 1 });
  return { ...state, phase: 'playing', round: hands[0].length, hands, bids, currentPlayer: 0 };
}

describe('heuristicPlay', () => {
  it('takes the trick with the cheapest winner when playing last', () => {
    const hand = [num('fire', 4), num('fire', 9), num('fire', 13), special('master')];
    const plays = [{ player: 0, card: num('fire', 7) }];
    expect(heuristicPlay(hand, plays, 1, 2, 1).card.id).toBe('fire-9');
  });

  it('throws away its cheapest card when it cannot win', () => {
    const hand = [num('fire', 4), num('fire', 9)];
    const plays = [{ player: 0, card: num('fire', 12) }];
    expect(heuristicPlay(hand, plays, 1, 2, 1).card.id).toBe('fire-4');
  });

  it('sheds its most dangerous losing card when dodging', () => {
    const hand = [num('fire', 4), num('fire', 11), special('smokeBomb')];
    const plays = [{ player: 0, card: num('fire', 12) }];
    expect(heuristicPlay(hand, plays, 1, 2, 0).card.id).toBe('fire-11');
  });

  it('uses the Kitsune as a smoke bomb to duck a trick it must not win', () => {
    const hand = [special('kitsune'), num('fire', 13)];
    const plays = [{ player: 0, card: num('fire', 2) }];
    expect(heuristicPlay(hand, plays, 1, 2, 0)).toEqual({ card: special('kitsune'), as: 'smokeBomb' });
  });

  it('answers the shogun with a geisha when it wants the trick', () => {
    const hand = [special('geisha'), special('master'), num('shadow', 14)];
    const plays = [{ player: 0, card: special('shogun') }];
    expect(heuristicPlay(hand, plays, 1, 3, 1).card.id).toBe('geisha-1');
  });
});

describe('unseenCards', () => {
  it('excludes the hand and everything already played this round', () => {
    let state = rigged(
      [
        [num('fire', 5), num('water', 2)],
        [num('fire', 9), num('water', 7)],
      ],
      [1, 1],
    );
    state = applyAction(state, { type: 'play', player: 0, cardId: 'fire-5' }).state;
    state = applyAction(state, { type: 'play', player: 1, cardId: 'fire-9' }).state;
    state = applyAction(state, { type: 'play', player: 1, cardId: 'water-7' }).state;
    const ids = unseenCards(playerView(state, 0)).map((c) => c.id);
    expect(ids).toHaveLength(70 - 4);
    for (const id of ['fire-5', 'fire-9', 'water-7', 'water-2']) expect(ids).not.toContain(id);
  });
});

describe('bots', () => {
  it.each(LEVELS)('%s only ever makes legal bids and plays', (level) => {
    // The engine throws on anything illegal, so finishing the games is the assertion.
    for (const players of [2, 4, 6]) {
      const scores = playBotGame(Array(players).fill(level), 100 + players);
      expect(scores).toHaveLength(players);
    }
  });

  it('is deterministic for a given random stream', () => {
    const { state } = createGame({ playerCount: 4, seed: 21, rounds: 6 });
    const view = playerView({ ...state, round: 1 }, 2);
    for (const level of LEVELS) {
      expect(chooseBid(view, level, createRng(5))).toBe(chooseBid(view, level, createRng(5)));
    }
  });

  it('a master bids on the strength of the hand', () => {
    const strong = rigged([[special('shogun')], [num('fire', 1)], [num('fire', 2)]], [0, 0, 0]);
    const weak = rigged([[special('smokeBomb')], [num('fire', 1)], [num('fire', 2)]], [0, 0, 0]);
    const bid = (s: GameState) => chooseBid(playerView({ ...s, phase: 'bidding', currentPlayer: null }, 0), 'master', createRng(3));
    expect(bid(strong)).toBe(1);
    expect(bid(weak)).toBe(0);
  });

  it('warriors outscore apprentices', () => {
    const r = runMatchup('warrior', 'apprentice', 40);
    expect(r.mean[0]).toBeGreaterThan(r.mean[1] + 30);
    expect(r.wins[0]).toBeGreaterThan(r.wins[1]);
  });

  it('masters outscore warriors', { timeout: 60_000 }, () => {
    const r = runMatchup('master', 'warrior', 16);
    expect(r.mean[0]).toBeGreaterThan(r.mean[1] + 30);
    expect(r.wins[0]).toBeGreaterThan(r.wins[1]);
  });
});
