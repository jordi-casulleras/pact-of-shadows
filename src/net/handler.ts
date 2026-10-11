import { CODE_LENGTH, topicFor, type ApiRequest, type ApiResponse, type RoomPush } from './protocol.js';
import * as rooms from './room.js';
import { RoomError, type Room } from './room.js';
import type { RoomStore } from './store.js';

/** No 0/O or 1/I/L: codes get read aloud and typed on phones. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/**
 * Delivers each view to the one player it belongs to. Nobody polls, so this is how the
 * rest of the table learns that someone acted.
 */
export type Push = (messages: { topic: string; payload: RoomPush }[]) => Promise<void>;

/** Presence is only written this often, to keep storage writes down. */
const PRESENCE_EVERY = 4_000;
const MAX_ATTEMPTS = 6;

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;

export const normalizeCode = (raw: unknown) =>
  typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH) : '';

/**
 * The signed-in user a request's access token belongs to, or null if it is not a user's token.
 * It only reads the token: the platform has already checked its signature (verify_jwt) before
 * the function runs, which is also what keeps out the project's own anon key, a JWT with no user.
 */
export function userOf(authorization: string | null): string | null {
  try {
    const payload = (authorization ?? '').replace(/^Bearer\s+/i, '').split('.')[1];
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
    return typeof claims.sub === 'string' && claims.sub && claims.role === 'authenticated' ? claims.sub : null;
  } catch {
    return null;
  }
}

const validToken = (token: unknown): token is string =>
  typeof token === 'string' && token.length >= 16 && token.length <= 64;

async function create(req: Extract<ApiRequest, { op: 'create' }>, store: RoomStore, now: number): Promise<ApiResponse> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const room = rooms.createRoom(randomCode(), req.token, req.name, now, {
      rounds: req.rounds,
      speed: req.speed,
      seed: randomSeed(),
    });
    if (await store.put(room, null)) return { ok: true, room: rooms.viewFor(room, req.token, now) };
  }
  return { ok: false, error: 'storage' };
}

/** Applies the request to the room in place. Returns false if the room should be deleted. */
function apply(room: Room, req: Exclude<ApiRequest, { op: 'create' }>, now: number): boolean {
  switch (req.op) {
    case 'join':
      rooms.join(room, req.token, req.name, now);
      break;
    case 'state':
      break;
    case 'addBot':
      rooms.addBot(room, req.token, req.level, now);
      break;
    case 'removeSeat':
      rooms.removeSeat(room, req.token, req.seat);
      break;
    case 'start':
      rooms.start(room, req.token, now);
      break;
    case 'bid':
      rooms.bid(room, req.token, req.bid, now);
      break;
    case 'play':
      rooms.play(room, req.token, req.cardId, req.as, now);
      break;
    case 'ready':
      rooms.ready(room, req.token);
      break;
    case 'backToLobby':
      rooms.backToLobby(room, req.token);
      break;
    case 'leave':
      return rooms.leave(room, req.token);
    default:
      throw new RoomError('badRequest');
  }
  return true;
}

/** Sends the others their new view of the room, and tells those who lost their seat. */
async function announce(push: Push, room: Room | null, code: string, before: string[], by: string, now: number) {
  const seated = room ? rooms.humanTokens(room) : [];
  const targets = new Set([...before, ...seated]);
  targets.delete(by);
  if (targets.size === 0) return;
  try {
    await push(
      [...targets].map((token) => ({
        topic: topicFor(code, token),
        payload: { room: room && seated.includes(token) ? rooms.viewFor(room, token, now) : null },
      })),
    );
  } catch (e) {
    // A lost push is not fatal: every player asks for the state again on a slow heartbeat.
    console.error(e);
  }
}

/** Handles one API request against the store. Pure apart from the store, the push and the clock passed in. */
export async function handle(body: unknown, store: RoomStore, now: number, push?: Push): Promise<ApiResponse> {
  const req = body as ApiRequest;
  if (!req || typeof req !== 'object' || !validToken(req.token)) return { ok: false, error: 'badRequest' };
  try {
    if (req.op === 'create') return await create(req, store, now);
    const code = normalizeCode(req.code);
    if (code.length !== CODE_LENGTH) return { ok: false, error: 'notFound' };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const room = await store.get(code);
      if (!room) return { ok: false, error: 'notFound' };
      const before = JSON.stringify(room);
      const shownBefore = rooms.visibleState(room, now);
      const tokensBefore = rooms.humanTokens(room);
      const seat = room.seats.find((s) => s.token === req.token);
      const stale = seat ? now - seat.lastSeen > PRESENCE_EVERY : false;

      const keep = apply(room, req, now);
      if (!keep) {
        await store.delete(code);
        return { ok: true, room: null };
      }
      if (stale) rooms.touch(room, req.token, now);
      rooms.tick(room, now);

      if (JSON.stringify(room) !== before) {
        const expected = room.version;
        room.version = expected + 1;
        if (!(await store.put(room, expected))) continue;
        if (push && rooms.visibleState(room, now) !== shownBefore) {
          await announce(push, room, code, tokensBefore, req.token, now);
        }
      }
      return { ok: true, room: req.op === 'leave' ? null : rooms.viewFor(room, req.token, now) };
    }
    return { ok: false, error: 'storage' };
  } catch (e) {
    if (e instanceof RoomError) return { ok: false, error: e.code };
    console.error(e);
    return { ok: false, error: 'storage' };
  }
}
