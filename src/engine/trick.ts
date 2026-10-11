import {
  EngineError,
  MAX_RANK,
  TRUMP,
  type Card,
  type EffectiveKind,
  type NumberCard,
  type Play,
  type Suit,
  type TrickResult,
} from './types.js';

export function effectiveKind(play: Play): EffectiveKind {
  if (play.card.kind === 'kitsune') {
    if (!play.as) throw new EngineError('kitsuneModeRequired');
    return play.as;
  }
  return play.card.kind;
}

/**
 * The clan that must be followed, or null if there is none (yet).
 * A character that opens the trick means no clan for the whole trick; smoke
 * bombs and later characters are skipped until a numbered card sets it.
 */
export function leadSuit(plays: readonly Play[]): Suit | null {
  if (plays.length === 0) return null;
  const opener = effectiveKind(plays[0]);
  if (opener === 'master' || opener === 'geisha' || opener === 'shogun') return null;
  for (const play of plays) {
    if (play.card.kind === 'number') return play.card.suit;
  }
  return null;
}

/** Cards from `hand` that may be played on the trick so far. */
export function legalCards(hand: readonly Card[], plays: readonly Play[]): Card[] {
  const suit = leadSuit(plays);
  if (suit === null) return hand.slice();
  const canFollow = hand.some((c) => c.kind === 'number' && c.suit === suit);
  if (!canFollow) return hand.slice();
  // Specials may always be played; numbered cards must follow the clan.
  return hand.filter((c) => c.kind !== 'number' || c.suit === suit);
}

function highest(plays: readonly Play[], suit: Suit): number {
  let best = -1;
  plays.forEach((play, i) => {
    const card = play.card;
    if (card.kind !== 'number' || card.suit !== suit) return;
    if (best === -1 || card.rank > (plays[best].card as NumberCard).rank) best = i;
  });
  return best;
}

function fourteenBonus(plays: readonly Play[]): number {
  let bonus = 0;
  for (const { card } of plays) {
    if (card.kind === 'number' && card.rank === MAX_RANK) bonus += card.suit === TRUMP ? 20 : 10;
  }
  return bonus;
}

/** Decides a complete trick. `plays` must be in the order they were played. */
export function resolveTrick(plays: readonly Play[]): TrickResult {
  if (plays.length === 0) throw new Error('Cannot resolve an empty trick');
  const kinds = plays.map(effectiveKind);
  const first = (kind: EffectiveKind) => kinds.indexOf(kind);
  const count = (kind: EffectiveKind) => kinds.filter((k) => k === kind).length;

  let winningIndex: number;
  let reason: TrickResult['reason'];
  let bonus = fourteenBonus(plays);

  if (first('geisha') !== -1 && first('shogun') !== -1) {
    winningIndex = first('geisha');
    reason = 'geishaKillsShogun';
    bonus += 40;
  } else if (first('shogun') !== -1) {
    winningIndex = first('shogun');
    reason = 'shogun';
    bonus += 30 * count('master');
  } else if (first('master') !== -1) {
    winningIndex = first('master');
    reason = 'master';
    bonus += 20 * count('geisha');
  } else if (first('geisha') !== -1) {
    winningIndex = first('geisha');
    reason = 'geisha';
  } else if (highest(plays, TRUMP) !== -1) {
    winningIndex = highest(plays, TRUMP);
    reason = 'highestShadow';
  } else {
    const suit = leadSuit(plays);
    if (suit === null) {
      winningIndex = 0;
      reason = 'allSmokeBombs';
    } else {
      winningIndex = highest(plays, suit);
      reason = 'highestLeadSuit';
    }
  }

  return { winner: plays[winningIndex].player, winningIndex, reason, bonus };
}
