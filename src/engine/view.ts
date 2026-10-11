import type { Card, GameState } from './types.js';

/** What one player is allowed to know: no other hands, no bids before the reveal. */
export interface PlayerView extends Omit<GameState, 'hands' | 'bids'> {
  viewer: number;
  hand: Card[];
  handSizes: number[];
  /** During bidding only the viewer's own bid is visible. */
  bids: (number | null)[];
  /** Who has already bid, without revealing how much. */
  hasBid: boolean[];
}

export function playerView(state: GameState, viewer: number): PlayerView {
  const { hands, bids, ...rest } = state;
  const hidden = state.phase === 'bidding';
  return {
    ...rest,
    viewer,
    hand: hands[viewer],
    handSizes: hands.map((h) => h.length),
    bids: bids.map((b, p) => (hidden && p !== viewer ? null : b)),
    hasBid: bids.map((b) => b !== null),
  };
}
