import type { Room } from './room.js';

/** Rooms nobody touches expire after a day. */
const TTL_SECONDS = 24 * 60 * 60;

/**
 * Where rooms live. Writes are compare-and-set on the room's version so two
 * requests arriving together cannot overwrite each other: the loser retries.
 */
export interface RoomStore {
  get(code: string): Promise<Room | null>;
  /** Saves `room` only if the stored version is `expected` (null: only if absent). */
  put(room: Room, expected: number | null): Promise<boolean>;
  delete(code: string): Promise<void>;
}

/** For local development and tests: lives and dies with the server process. */
export class MemoryStore implements RoomStore {
  private rooms = new Map<string, string>();

  async get(code: string): Promise<Room | null> {
    const raw = this.rooms.get(code);
    return raw ? (JSON.parse(raw) as Room) : null;
  }

  async put(room: Room, expected: number | null): Promise<boolean> {
    const raw = this.rooms.get(room.code);
    const current = raw ? (JSON.parse(raw) as Room).version : null;
    if (current !== expected) return false;
    this.rooms.set(room.code, JSON.stringify(room));
    return true;
  }

  async delete(code: string): Promise<void> {
    this.rooms.delete(code);
  }
}

type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Headers that authorise a server-side call to the project's APIs with its secret key. */
export function secretHeaders(key: string): Record<string, string> {
  // The legacy service_role key is a JWT and must also go in Authorization; the newer sb_secret_ keys must not.
  return key.startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
}

/** The `rooms` table in Supabase Postgres, through the project's REST API. */
export class SupabaseStore implements RoomStore {
  constructor(
    private url: string,
    private key: string,
    private fetcher: Fetch = fetch as unknown as Fetch,
  ) {}

  /** Runs one request against the table and returns the rows it touched. */
  private async rows(method: string, query: string, body?: unknown, prefer?: string): Promise<unknown[]> {
    const res = await this.fetcher(`${this.url}/rest/v1/rooms?${query}`, {
      method,
      headers: {
        ...secretHeaders(this.key),
        'Content-Type': 'application/json',
        Prefer: prefer ?? 'return=representation',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${JSON.stringify(result)}`);
    return Array.isArray(result) ? result : [];
  }

  async get(code: string): Promise<Room | null> {
    const [row] = (await this.rows('GET', `code=eq.${code}&select=data`)) as { data: Room }[];
    return row?.data ?? null;
  }

  async put(room: Room, expected: number | null): Promise<boolean> {
    const row = { version: room.version, data: room, updated_at: new Date().toISOString() };
    if (expected === null) {
      // Creating a room is the moment to sweep out the abandoned ones.
      const cutoff = new Date(Date.now() - TTL_SECONDS * 1000).toISOString();
      await this.rows('DELETE', `updated_at=lt.${cutoff}&select=code`);
      const inserted = await this.rows(
        'POST',
        'on_conflict=code&select=code',
        { code: room.code, ...row },
        'resolution=ignore-duplicates,return=representation',
      );
      return inserted.length === 1;
    }
    const updated = await this.rows('PATCH', `code=eq.${room.code}&version=eq.${expected}&select=code`, row);
    return updated.length === 1;
  }

  async delete(code: string): Promise<void> {
    await this.rows('DELETE', `code=eq.${code}&select=code`);
  }
}
