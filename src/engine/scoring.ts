export interface RoundScore {
  /** Bonus actually paid: the pending bonus if the bid was made, else 0. */
  bonus: number;
  /** Total points gained or lost, bonus included. */
  delta: number;
}

/** Scores one player's round from their bid, tricks won and pending bonus. */
export function scoreRound(round: number, bid: number, tricksWon: number, pendingBonus: number): RoundScore {
  if (bid === 0) {
    return { bonus: 0, delta: tricksWon === 0 ? 10 * round : -10 * round };
  }
  if (tricksWon === bid) {
    return { bonus: pendingBonus, delta: 20 * bid + pendingBonus };
  }
  return { bonus: 0, delta: -10 * Math.abs(tricksWon - bid) };
}
