import type { Level } from '../ai/bots.js';
import type { KitsuneMode, PlayerView } from '../engine/index.js';

export const MAX_SEATS = 6;
export const MIN_SEATS = 2;
export const CODE_LENGTH = 5;
export const NAME_MAX = 14;

export type RoomStatus = 'lobby' | 'playing' | 'finished';

export interface SeatView {
  name: string;
  kind: 'human' | 'bot';
  /** Bots only. */
  level?: Level;
  host: boolean;
  /** Humans who have not been heard from for a while are away; a bot covers their turns. */
  online: boolean;
}

/** Everything one player is allowed to know about their room. */
export interface RoomView {
  code: string;
  version: number;
  status: RoomStatus;
  seats: SeatView[];
  /** This player's seat. */
  me: number;
  isHost: boolean;
  game: PlayerView | null;
  /** Who is ready to leave the round summary. */
  ready: boolean[];
  /**
   * Milliseconds until the server has a move of its own to make (a bot, a stand-in, the
   * next round). It only moves when asked, so someone must ask for the state then. Null
   * while it waits on people.
   */
  wakeIn: number | null;
}

/** What the server pushes to a player when their room changes; null once they are out of it. */
export interface RoomPush {
  room: RoomView | null;
}
export const PUSH_EVENT = 'room';

/**
 * The private Realtime topic one player's views are pushed to. The database only lets the
 * signed-in user whose id ends the name listen to it (see the realtime.messages policy).
 */
export const topicFor = (code: string, userId: string) => `room:${code}:${userId}`;

export type ApiRequest =
  | { op: 'create'; token: string; name: string; rounds?: number; speed?: number }
  | { op: 'join'; code: string; token: string; name: string }
  | { op: 'state'; code: string; token: string }
  | { op: 'addBot'; code: string; token: string; level: Level }
  | { op: 'removeSeat'; code: string; token: string; seat: number }
  | { op: 'start'; code: string; token: string }
  | { op: 'bid'; code: string; token: string; bid: number }
  | { op: 'play'; code: string; token: string; cardId: string; as?: KitsuneMode }
  | { op: 'ready'; code: string; token: string }
  | { op: 'backToLobby'; code: string; token: string }
  | { op: 'leave'; code: string; token: string };

export type ApiErrorCode =
  | 'badRequest'
  | 'notFound'
  | 'full'
  | 'alreadyStarted'
  | 'notInRoom'
  | 'notHost'
  | 'tooFewPlayers'
  | 'wrongPhase'
  | 'illegal'
  | 'busy'
  | 'auth'
  | 'storage';

export type ApiResponse = { ok: true; room: RoomView | null } | { ok: false; error: ApiErrorCode };
