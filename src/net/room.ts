import { chooseBid, choosePlay, LEVELS, type Level } from '../ai/bots.js';
import {
  applyAction,
  createGame,
  createRng,
  EngineError,
  playerView,
  type GameState,
  type KitsuneMode,
} from '../engine/index.js';
import {
  MAX_SEATS,
  MIN_SEATS,
  NAME_MAX,
  type ApiErrorCode,
  type RoomStatus,
  type RoomView,
} from './protocol.js';

/** How long the table holds after the bids are revealed and after each trick, so everyone sees it. */
const REVEAL_HOLD = 1800;
const TRICK_HOLD = 2600;
/** Pause before a bot (or an absent player's stand-in) plays. */
const BOT_DELAY = 900;
/** A player silent for this long (two missed heartbeats) is shown as away... */
const AWAY_AFTER = 45_000;
/** ...and after this long a stand-in takes their turns so the table does not stall. */
const STAND_IN_AFTER = 60_000;
/** The round summary closes on its own after this long. */
const ROUND_END_MAX = 30_000;
const STAND_IN_LEVEL: Level = 'warrior';
const BOT_NAMES = ['Aiko', 'Kenji', 'Hana', 'Ryu', 'Sora'];

interface Seat {
  kind: 'human' | 'bot';
  name: string;
  /** Humans only: the id of their signed-in (anonymous) user. */
  token?: string;
  level?: Level;
  lastSeen: number;
}

/** A room as stored on the server. Never sent to clients: it holds every hand and token. */
export interface Room {
  code: string;
  version: number;
  status: RoomStatus;
  hostToken: string;
  seats: Seat[];
  game: GameState | null;
  ready: boolean[];
  /** No one may act before this time. */
  holdUntil: number;
  lastMoveAt: number;
  roundEndAt: number;
  rounds: number;
  /** Divides every wait; above 1 only in automated checks. */
  speed: number;
  seed: number;
}

export class RoomError extends Error {
  constructor(readonly code: ApiErrorCode) {
    super(code);
    this.name = 'RoomError';
  }
}

const clampInt = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

export function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';
  return name || 'Ninja';
}

export function createRoom(
  code: string,
  token: string,
  name: unknown,
  now: number,
  options: { rounds?: number; speed?: number; seed: number },
): Room {
  return {
    code,
    version: 1,
    status: 'lobby',
    hostToken: token,
    seats: [{ kind: 'human', name: cleanName(name), token, lastSeen: now }],
    game: null,
    ready: [],
    holdUntil: 0,
    lastMoveAt: now,
    roundEndAt: 0,
    rounds: clampInt(options.rounds, 1, 10, 10),
    speed: clampInt(options.speed, 1, 10, 1),
    seed: options.seed,
  };
}

const seatOf = (room: Room, token: string) => room.seats.findIndex((s) => s.kind === 'human' && s.token === token);

function requireSeat(room: Room, token: string): number {
  const seat = seatOf(room, token);
  if (seat === -1) throw new RoomError('notInRoom');
  return seat;
}

function requireHost(room: Room, token: string): void {
  requireSeat(room, token);
  if (room.hostToken !== token) throw new RoomError('notHost');
}

function requireLobby(room: Room): void {
  if (room.status !== 'lobby') throw new RoomError('alreadyStarted');
}

/** Two players may not share a name: the table tells them apart by it. */
function uniqueName(room: Room, wanted: string): string {
  const taken = new Set(room.seats.map((s) => s.name.toLowerCase()));
  if (!taken.has(wanted.toLowerCase())) return wanted;
  for (let i = 2; ; i++) {
    const candidate = `${wanted.slice(0, NAME_MAX - 2)} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Joining again with the same token returns the player to their seat, even mid-game. */
export function join(room: Room, token: string, name: unknown, now: number): void {
  const existing = seatOf(room, token);
  if (existing !== -1) {
    room.seats[existing].lastSeen = now;
    return;
  }
  requireLobby(room);
  if (room.seats.length >= MAX_SEATS) throw new RoomError('full');
  room.seats.push({ kind: 'human', name: uniqueName(room, cleanName(name)), token, lastSeen: now });
}

export function addBot(room: Room, token: string, level: unknown, now: number): void {
  requireHost(room, token);
  requireLobby(room);
  if (!LEVELS.includes(level as Level)) throw new RoomError('badRequest');
  if (room.seats.length >= MAX_SEATS) throw new RoomError('full');
  const free = BOT_NAMES.find((n) => !room.seats.some((s) => s.name.toLowerCase() === n.toLowerCase())) ?? 'Bot';
  room.seats.push({ kind: 'bot', name: uniqueName(room, free), level: level as Level, lastSeen: now });
}

/** The host may remove anyone but themselves while in the lobby. */
export function removeSeat(room: Room, token: string, seat: unknown): void {
  requireHost(room, token);
  requireLobby(room);
  if (typeof seat !== 'number' || !room.seats[seat] || room.seats[seat].token === token) {
    throw new RoomError('badRequest');
  }
  room.seats.splice(seat, 1);
}

export function start(room: Room, token: string, now: number): void {
  requireHost(room, token);
  requireLobby(room);
  if (room.seats.length < MIN_SEATS) throw new RoomError('tooFewPlayers');
  room.game = createGame({ playerCount: room.seats.length, seed: room.seed, rounds: room.rounds }).state;
  room.status = 'playing';
  room.ready = room.seats.map(() => false);
  room.holdUntil = 0;
  room.lastMoveAt = now;
}

/** The host sends everyone back to the lobby once a game is over. */
export function backToLobby(room: Room, token: string): void {
  requireHost(room, token);
  if (room.status !== 'finished') throw new RoomError('wrongPhase');
  room.status = 'lobby';
  room.game = null;
  room.ready = [];
  room.seed = (Math.imul(room.seed, 1103515245) + 12345) & 0x7fffffff;
}

/**
 * Leaving the lobby frees the seat. Leaving a game hands the seat to a bot so
 * the others can finish. Returns false when no human is left and the room can go.
 */
export function leave(room: Room, token: string): boolean {
  const seat = requireSeat(room, token);
  if (room.status === 'lobby') room.seats.splice(seat, 1);
  else room.seats[seat] = { kind: 'bot', name: room.seats[seat].name, level: STAND_IN_LEVEL, lastSeen: 0 };
  const humans = room.seats.filter((s) => s.kind === 'human');
  if (humans.length === 0) return false;
  if (room.hostToken === token) room.hostToken = humans[0].token!;
  return true;
}

function engine<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof EngineError) throw new RoomError(e.code === 'wrongPhase' ? 'wrongPhase' : 'illegal');
    throw e;
  }
}

/** Applies a play and sets the hold that lets everyone see how the trick ended. */
function applyPlay(room: Room, player: number, cardId: string, as: KitsuneMode | undefined, now: number): void {
  const { state, events } = applyAction(room.game!, { type: 'play', player, cardId, as });
  room.game = state;
  room.lastMoveAt = now;
  if (events.some((e) => e.type === 'trickWon')) room.holdUntil = now + TRICK_HOLD / room.speed;
  if (state.phase === 'roundEnd') {
    room.roundEndAt = now;
    room.ready = room.seats.map((s) => s.kind === 'bot');
  }
}

function applyBid(room: Room, player: number, bid: number, now: number): void {
  room.game = applyAction(room.game!, { type: 'bid', player, bid }).state;
  if (room.game.phase === 'playing') {
    room.holdUntil = now + REVEAL_HOLD / room.speed;
    room.lastMoveAt = room.holdUntil;
  }
}

export function bid(room: Room, token: string, value: unknown, now: number): void {
  const seat = requireSeat(room, token);
  if (!room.game || typeof value !== 'number') throw new RoomError('badRequest');
  engine(() => applyBid(room, seat, value, now));
}

export function play(room: Room, token: string, cardId: unknown, as: unknown, now: number): void {
  const seat = requireSeat(room, token);
  if (!room.game || typeof cardId !== 'string') throw new RoomError('badRequest');
  if (as !== undefined && as !== 'master' && as !== 'smokeBomb') throw new RoomError('badRequest');
  if (now < room.holdUntil) throw new RoomError('busy');
  engine(() => applyPlay(room, seat, cardId, as, now));
}

export function ready(room: Room, token: string): void {
  const seat = requireSeat(room, token);
  if (room.game?.phase !== 'roundEnd') throw new RoomError('wrongPhase');
  room.ready[seat] = true;
}

export function touch(room: Room, token: string, now: number): void {
  const seat = seatOf(room, token);
  if (seat !== -1) room.seats[seat].lastSeen = now;
}

/** Whether the server should act for this seat: a bot, or a human gone long enough. */
function automated(seat: Seat, now: number): Level | null {
  if (seat.kind === 'bot') return seat.level ?? STAND_IN_LEVEL;
  return now - seat.lastSeen > STAND_IN_AFTER ? STAND_IN_LEVEL : null;
}

/**
 * Moves the game forward as far as time allows: bot bids and plays, stand-ins
 * for absent players, and the step from one round to the next. There is no
 * background process, so this runs on every request any player makes; `wakeIn`
 * tells the players when to make the next one.
 */
export function tick(room: Room, now: number): void {
  for (let guard = 0; guard < 16; guard++) {
    const game = room.game;
    if (room.status !== 'playing' || !game) return;
    if (game.phase === 'gameOver') {
      room.status = 'finished';
      return;
    }
    if (now < room.holdUntil) return;
    const rng = createRng(room.seed ^ Math.imul(room.version + guard, 0x9e3779b1) ^ game.round);

    if (game.phase === 'bidding') {
      const seat = room.seats.findIndex((s, p) => game.bids[p] === null && automated(s, now));
      if (seat === -1) return;
      applyBid(room, seat, chooseBid(playerView(game, seat), automated(room.seats[seat], now)!, rng), now);
    } else if (game.phase === 'playing') {
      const player = game.currentPlayer!;
      const level = automated(room.seats[player], now);
      if (!level || now - room.lastMoveAt < BOT_DELAY / room.speed) return;
      const choice = choosePlay(playerView(game, player), level, rng);
      applyPlay(room, player, choice.card.id, choice.as, now);
    } else {
      const everyone = room.seats.every((s, p) => room.ready[p] || automated(s, now));
      if (!everyone && now - room.roundEndAt < ROUND_END_MAX / room.speed) return;
      room.game = applyAction(game, { type: 'nextRound' }).state;
      room.ready = room.seats.map(() => false);
      room.lastMoveAt = now;
    }
  }
}

/**
 * How long until `tick` has something to do without anyone acting, or null if
 * the room is waiting on people. Must mirror the conditions in `tick`.
 */
export function wakeIn(room: Room, now: number): number | null {
  const game = room.game;
  if (room.status !== 'playing' || !game) return null;
  const free = Math.max(now, room.holdUntil);
  /** When the server may act for this seat. */
  const takeover = (seat: Seat) => (seat.kind === 'bot' ? 0 : seat.lastSeen + STAND_IN_AFTER + 1);
  let due: number;

  if (game.phase === 'gameOver') {
    due = now;
  } else if (game.phase === 'bidding') {
    const waiting = room.seats.filter((_, p) => game.bids[p] === null);
    due = Math.min(...waiting.map(takeover));
  } else if (game.phase === 'playing') {
    due = Math.max(takeover(room.seats[game.currentPlayer!]), room.lastMoveAt + BOT_DELAY / room.speed);
  } else {
    const unready = room.seats.filter((_, p) => !room.ready[p]);
    due = Math.min(Math.max(0, ...unready.map(takeover)), room.roundEndAt + ROUND_END_MAX / room.speed);
  }
  return Math.max(free, due) - now;
}

/**
 * Everything about the room a player could notice, as a string to compare. Leaves out
 * the version and the exact presence times, which change without anything to show.
 */
export function visibleState(room: Room, now: number): string {
  return JSON.stringify({
    ...room,
    version: 0,
    seats: room.seats.map((s) => ({ ...s, lastSeen: 0, online: s.kind === 'bot' || now - s.lastSeen < AWAY_AFTER })),
  });
}

/** The secrets of the people seated in the room. */
export const humanTokens = (room: Room): string[] =>
  room.seats.flatMap((s) => (s.kind === 'human' && s.token ? [s.token] : []));

export function viewFor(room: Room, token: string, now: number): RoomView {
  const me = requireSeat(room, token);
  return {
    code: room.code,
    version: room.version,
    status: room.status,
    seats: room.seats.map((s) => ({
      name: s.name,
      kind: s.kind,
      level: s.level,
      host: s.kind === 'human' && s.token === room.hostToken,
      online: s.kind === 'bot' || now - s.lastSeen < AWAY_AFTER,
    })),
    me,
    isHost: room.hostToken === token,
    game: room.game ? playerView(room.game, me) : null,
    ready: room.ready,
    wakeIn: wakeIn(room, now),
  };
}
