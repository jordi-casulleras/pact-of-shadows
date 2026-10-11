export const SUITS = ['fire', 'water', 'forest', 'shadow'] as const;
export type Suit = (typeof SUITS)[number];

/** Shadow is the trump clan: it beats any card of the other three. */
export const TRUMP: Suit = 'shadow';
export const MAX_RANK = 14;

export type SpecialKind = 'smokeBomb' | 'master' | 'geisha' | 'shogun' | 'kitsune';

export interface NumberCard {
  id: string;
  kind: 'number';
  suit: Suit;
  rank: number;
}

export interface SpecialCard {
  id: string;
  kind: SpecialKind;
}

export type Card = NumberCard | SpecialCard;

/** The Kitsune is declared as one of these when it is played. */
export type KitsuneMode = 'master' | 'smokeBomb';

export interface Play {
  player: number;
  card: Card;
  /** Set only for the Kitsune. */
  as?: KitsuneMode;
}

/** What a play counts as once the Kitsune's choice is applied. */
export type EffectiveKind = 'number' | 'smokeBomb' | 'master' | 'geisha' | 'shogun';

/** Why a trick was won; the UI turns these codes into text. */
export type WinReason =
  | 'geishaKillsShogun'
  | 'shogun'
  | 'master'
  | 'geisha'
  | 'highestShadow'
  | 'highestLeadSuit'
  | 'allSmokeBombs';

export interface TrickResult {
  winner: number;
  /** Index into the trick's plays. */
  winningIndex: number;
  reason: WinReason;
  /** Bonus points earned by the winner; only paid if they make their bid. */
  bonus: number;
}

export type Phase = 'bidding' | 'playing' | 'roundEnd' | 'gameOver';

export interface GameConfig {
  playerCount: number;
  seed: number;
  rounds: number;
  /** Player who leads round 1; the lead rotates one seat each round. */
  firstPlayer: number;
}

export interface RoundResult {
  round: number;
  bids: number[];
  tricksWon: number[];
  /** Bonus actually paid (0 for players who missed their bid). */
  bonus: number[];
  /** Points gained or lost this round. */
  delta: number[];
}

export interface Trick {
  leader: number;
  plays: Play[];
}

/** Fully JSON-serializable. */
export interface GameState {
  config: GameConfig;
  phase: Phase;
  round: number;
  startingPlayer: number;
  hands: Card[][];
  bids: (number | null)[];
  tricksWon: number[];
  /** Bonus accumulated this round, pending the bid check. */
  pendingBonus: number[];
  trick: Trick;
  /** Every completed trick of the current round, in order; public information. */
  completedTricks: Trick[];
  /** The last completed trick of the current round, for display. */
  lastTrick: (Trick & { result: TrickResult }) | null;
  /** Whose turn it is to play a card; null outside the playing phase. */
  currentPlayer: number | null;
  scores: number[];
  history: RoundResult[];
}

export type Action =
  | { type: 'bid'; player: number; bid: number }
  | { type: 'play'; player: number; cardId: string; as?: KitsuneMode }
  | { type: 'nextRound' };

export type GameEvent =
  | { type: 'roundStarted'; round: number; startingPlayer: number }
  | { type: 'bidPlaced'; player: number }
  | { type: 'bidsRevealed'; bids: number[] }
  | { type: 'cardPlayed'; player: number; card: Card; as?: KitsuneMode }
  | { type: 'trickWon'; trick: Trick; result: TrickResult }
  | { type: 'roundScored'; result: RoundResult; scores: number[] }
  | { type: 'gameOver'; scores: number[]; winners: number[] };

export interface StepResult {
  state: GameState;
  events: GameEvent[];
}

export type ErrorCode =
  | 'invalidConfig'
  | 'wrongPhase'
  | 'invalidPlayer'
  | 'invalidBid'
  | 'alreadyBid'
  | 'notYourTurn'
  | 'cardNotInHand'
  | 'illegalCard'
  | 'kitsuneModeRequired'
  | 'kitsuneModeNotAllowed';

export class EngineError extends Error {
  constructor(
    readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'EngineError';
  }
}
