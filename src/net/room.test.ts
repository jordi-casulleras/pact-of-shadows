import { describe, expect, it } from 'vitest';
import { legalCards } from '../engine/index.js';
import { handle, userOf } from './handler.js';
import { topicFor, type ApiRequest, type ApiResponse, type RoomPush, type RoomView } from './protocol.js';
import type { Room } from './room.js';
import { MemoryStore, SupabaseStore, type RoomStore } from './store.js';

const ANA = 'ana-token-0000000000';
const BEA = 'bea-token-0000000000';
const CAT = 'cat-token-0000000000';

/** A server with a clock the test moves by hand. */
function server(store: RoomStore = new MemoryStore()) {
  let now = 1_000_000;
  const pushed: { topic: string; payload: RoomPush }[] = [];
  const call = (req: ApiRequest) => handle(req, store, now, async (messages) => void pushed.push(...messages));
  const ok = async (req: ApiRequest): Promise<RoomView> => {
    const res = await call(req);
    if (!res.ok || !res.room) throw new Error(`expected ok, got ${JSON.stringify(res)}`);
    return res.room;
  };
  const error = async (req: ApiRequest) => {
    const res: ApiResponse = await call(req);
    return res.ok ? null : res.error;
  };
  return { store, call, ok, error, pushed, advance: (ms: number) => (now += ms), now: () => now };
}

async function lobby(s = server()) {
  const { code } = await s.ok({ op: 'create', token: ANA, name: 'Ana' });
  await s.ok({ op: 'join', code, token: BEA, name: 'Bea' });
  return { ...s, code };
}

/** Plays the given humans' turns with any legal move until the room is finished. */
async function playOut(s: ReturnType<typeof server>, code: string, tokens: string[]) {
  for (let step = 0; step < 5000; step++) {
    s.advance(700);
    let finished = false;
    for (const token of tokens) {
      const room = await s.ok({ op: 'state', code, token });
      if (room.status === 'finished') finished = true;
      const game = room.game;
      if (!game || room.status !== 'playing') continue;
      if (game.phase === 'bidding' && game.bids[room.me] === null) {
        await s.ok({ op: 'bid', code, token, bid: 0 });
      } else if (game.phase === 'playing' && game.currentPlayer === room.me) {
        const card = legalCards(game.hand, game.trick.plays)[0];
        const res = await s.call({ op: 'play', code, token, cardId: card.id, as: card.kind === 'kitsune' ? 'master' : undefined });
        if (!res.ok) expect(res.error).toBe('busy');
      } else if (game.phase === 'roundEnd' && !room.ready[room.me]) {
        await s.ok({ op: 'ready', code, token });
      }
    }
    if (finished) return;
  }
  throw new Error('game did not finish');
}

describe('lobby', () => {
  it('creates a room with a shareable code and seats the creator as host', async () => {
    const s = server();
    const room = await s.ok({ op: 'create', token: ANA, name: '  Ana  ' });
    expect(room.code).toMatch(/^[A-HJ-KMNP-Z2-9]{5}$/);
    expect(room).toMatchObject({ status: 'lobby', me: 0, isHost: true, game: null });
    expect(room.seats).toEqual([{ name: 'Ana', kind: 'human', host: true, online: true }]);
  });

  it('lets others join with the code, in any letter case', async () => {
    const { ok, code } = await lobby();
    const room = await ok({ op: 'join', code: code.toLowerCase(), token: CAT, name: 'Cat' });
    expect(room.me).toBe(2);
    expect(room.isHost).toBe(false);
    expect(room.seats.map((p) => p.name)).toEqual(['Ana', 'Bea', 'Cat']);
  });

  it('rejects unknown codes, bad tokens and a seventh player', async () => {
    const { ok, error, code } = await lobby();
    expect(await error({ op: 'join', code: 'ZZZZZ', token: CAT, name: 'Cat' })).toBe('notFound');
    expect(await error({ op: 'join', code, token: 'short', name: 'Cat' })).toBe('badRequest');
    for (let i = 0; i < 4; i++) await ok({ op: 'addBot', code, token: ANA, level: 'warrior' });
    expect(await error({ op: 'join', code, token: CAT, name: 'Cat' })).toBe('full');
    expect(await error({ op: 'addBot', code, token: ANA, level: 'warrior' })).toBe('full');
  });

  it('keeps names distinct and tidy', async () => {
    const { ok, code } = await lobby();
    const room = await ok({ op: 'join', code, token: CAT, name: 'ana' });
    expect(room.seats[2].name).toBe('ana 2');
    const long = await server().ok({ op: 'create', token: ANA, name: 'x'.repeat(40) });
    expect(long.seats[0].name).toHaveLength(14);
    expect((await server().ok({ op: 'create', token: ANA, name: '   ' })).seats[0].name).toBe('Ninja');
  });

  it('only the host manages seats and starts the game', async () => {
    const { ok, error, code } = await lobby();
    expect(await error({ op: 'addBot', code, token: BEA, level: 'master' })).toBe('notHost');
    expect(await error({ op: 'start', code, token: BEA })).toBe('notHost');
    expect(await error({ op: 'removeSeat', code, token: BEA, seat: 0 })).toBe('notHost');
    const withBot = await ok({ op: 'addBot', code, token: ANA, level: 'master' });
    expect(withBot.seats[2]).toMatchObject({ kind: 'bot', level: 'master', name: 'Aiko' });
    expect(await error({ op: 'removeSeat', code, token: ANA, seat: 0 })).toBe('badRequest');
    const kicked = await ok({ op: 'removeSeat', code, token: ANA, seat: 1 });
    expect(kicked.seats.map((p) => p.name)).toEqual(['Ana', 'Aiko']);
    expect(await error({ op: 'state', code, token: BEA })).toBe('notInRoom');
  });

  it('needs two seats to start and refuses newcomers afterwards', async () => {
    const s = server();
    const { code } = await s.ok({ op: 'create', token: ANA, name: 'Ana' });
    expect(await s.error({ op: 'start', code, token: ANA })).toBe('tooFewPlayers');
    await s.ok({ op: 'join', code, token: BEA, name: 'Bea' });
    const started = await s.ok({ op: 'start', code, token: ANA });
    expect(started.status).toBe('playing');
    expect(started.game?.phase).toBe('bidding');
    expect(await s.error({ op: 'join', code, token: CAT, name: 'Cat' })).toBe('alreadyStarted');
    // The same browser coming back is let in.
    expect((await s.ok({ op: 'join', code, token: BEA, name: 'whatever' })).me).toBe(1);
  });

  it('passes the host on when the host leaves and frees the seat', async () => {
    const { ok, call, code } = await lobby();
    expect(await call({ op: 'leave', code, token: ANA })).toEqual({ ok: true, room: null });
    const room = await ok({ op: 'state', code, token: BEA });
    expect(room.seats).toHaveLength(1);
    expect(room.isHost).toBe(true);
  });

  it('deletes the room when the last person leaves', async () => {
    const s = server();
    const { code } = await s.ok({ op: 'create', token: ANA, name: 'Ana' });
    await s.call({ op: 'leave', code, token: ANA });
    expect(await s.store.get(code)).toBeNull();
  });
});

describe('playing', () => {
  it('never sends a player anyone else\'s hand, token or hidden bid', async () => {
    const s = await lobby();
    await s.ok({ op: 'addBot', code: s.code, token: ANA, level: 'warrior' });
    await s.ok({ op: 'start', code: s.code, token: ANA });
    const stored = (await s.store.get(s.code)) as Room;
    const view = await s.ok({ op: 'state', code: s.code, token: BEA });
    const wire = JSON.stringify(view);
    expect(view.game?.hand).toEqual(stored.game!.hands[1]);
    expect(wire).not.toContain(ANA);
    expect(wire).not.toContain('"hands"');
    for (const card of [...stored.game!.hands[0], ...stored.game!.hands[2]]) expect(wire).not.toContain(`"${card.id}"`);

    // The bot has bid already, but nobody sees it until every bid is in.
    expect(stored.game!.bids[2]).not.toBeNull();
    expect(view.game?.bids).toEqual([null, null, null]);
    expect(view.game?.hasBid).toEqual([false, false, true]);
    await s.ok({ op: 'bid', code: s.code, token: ANA, bid: 1 });
    const mid = await s.ok({ op: 'state', code: s.code, token: BEA });
    expect(mid.game?.bids).toEqual([null, null, null]);
    const revealed = await s.ok({ op: 'bid', code: s.code, token: BEA, bid: 0 });
    expect(revealed.game?.bids.every((b) => b !== null)).toBe(true);
  });

  it('rejects plays out of turn, illegal bids and moves during a hold', async () => {
    const s = await lobby();
    await s.ok({ op: 'start', code: s.code, token: ANA });
    expect(await s.error({ op: 'bid', code: s.code, token: ANA, bid: 5 })).toBe('illegal');
    expect(await s.error({ op: 'ready', code: s.code, token: ANA })).toBe('wrongPhase');
    await s.ok({ op: 'bid', code: s.code, token: ANA, bid: 0 });
    const view = await s.ok({ op: 'bid', code: s.code, token: BEA, bid: 0 });
    const leader = view.game!.currentPlayer === 0 ? ANA : BEA;
    const other = leader === ANA ? BEA : ANA;
    const mine = (await s.ok({ op: 'state', code: s.code, token: leader })).game!.hand[0];
    const play = { op: 'play', code: s.code, token: leader, cardId: mine.id, as: mine.kind === 'kitsune' ? 'master' : undefined } as const;
    // The bids have just been revealed: the table holds for a moment.
    expect(await s.error(play)).toBe('busy');
    s.advance(3000);
    const theirs = (await s.ok({ op: 'state', code: s.code, token: other })).game!.hand[0];
    expect(await s.error({ op: 'play', code: s.code, token: other, cardId: theirs.id })).toBe('illegal');
    expect(await s.error({ op: 'play', code: s.code, token: leader, cardId: 'not-a-card' })).toBe('illegal');
    expect((await s.ok(play)).game!.trick.plays).toHaveLength(1);
  });

  it('plays a whole game between two people and a bot', async () => {
    const s = await lobby();
    await s.ok({ op: 'addBot', code: s.code, token: ANA, level: 'warrior' });
    await s.ok({ op: 'start', code: s.code, token: ANA });
    await playOut(s, s.code, [ANA, BEA]);
    const end = await s.ok({ op: 'state', code: s.code, token: BEA });
    expect(end.status).toBe('finished');
    expect(end.game?.phase).toBe('gameOver');
    expect(end.game?.history).toHaveLength(10);
    // Both players see the same public result.
    const other = await s.ok({ op: 'state', code: s.code, token: ANA });
    expect(other.game?.scores).toEqual(end.game?.scores);

    expect(await s.error({ op: 'backToLobby', code: s.code, token: BEA })).toBe('notHost');
    const again = await s.ok({ op: 'backToLobby', code: s.code, token: ANA });
    expect(again).toMatchObject({ status: 'lobby', game: null });
    expect(again.seats).toHaveLength(3);
  });

  it('covers for a player who goes silent, and takes them back when they return', async () => {
    const s = await lobby();
    await s.ok({ op: 'start', code: s.code, token: ANA });
    // Bea never does anything; Ana keeps playing and the game must still finish.
    s.advance(70_000);
    const view = await s.ok({ op: 'state', code: s.code, token: ANA });
    expect(view.seats[1].online).toBe(false);
    await playOut(s, s.code, [ANA]);
    expect((await s.ok({ op: 'state', code: s.code, token: BEA })).status).toBe('finished');
  });

  it('hands a leaver\'s seat to a bot so the others can finish', async () => {
    const s = await lobby();
    await s.ok({ op: 'join', code: s.code, token: CAT, name: 'Cat' });
    await s.ok({ op: 'start', code: s.code, token: ANA });
    await s.call({ op: 'leave', code: s.code, token: ANA });
    const view = await s.ok({ op: 'state', code: s.code, token: BEA });
    expect(view.seats[0]).toMatchObject({ kind: 'bot', name: 'Ana' });
    expect(view.isHost).toBe(true);
    expect(await s.error({ op: 'state', code: s.code, token: ANA })).toBe('notInRoom');
    await playOut(s, s.code, [BEA, CAT]);
  });
});

describe('storage', () => {
  it('refuses a write based on a stale version', async () => {
    const store = new MemoryStore();
    const s = server(store);
    const { code } = await s.ok({ op: 'create', token: ANA, name: 'Ana' });
    const room = (await store.get(code))!;
    expect(await store.put({ ...room, version: 2 }, 1)).toBe(true);
    expect(await store.put({ ...room, version: 2 }, 1)).toBe(false);
    expect(await store.put(room, null)).toBe(false);
  });

  it('retries when another request wins the race', async () => {
    const inner = new MemoryStore();
    let clashes = 2;
    const flaky: RoomStore = {
      get: (code) => inner.get(code),
      delete: (code) => inner.delete(code),
      put: async (room, expected) => {
        if (expected === null || clashes === 0) return inner.put(room, expected);
        clashes--;
        return false;
      },
    };
    const s = server(flaky);
    const { code } = await s.ok({ op: 'create', token: ANA, name: 'Ana' });
    const room = await s.ok({ op: 'join', code, token: BEA, name: 'Bea' });
    expect(room.seats).toHaveLength(2);
    expect(clashes).toBe(0);
  });

  it('talks to Supabase with a compare-and-set on the version', async () => {
    const sent: { method: string; url: string; body: unknown; prefer: string }[] = [];
    const replies: unknown[][] = [[], [{ code: 'ABCDE' }], [{ data: { code: 'ABCDE', version: 1 } }], [], []];
    const store = new SupabaseStore('https://project.example', 'sb_secret_x', async (url, init) => {
      expect(init.headers.apikey).toBe('sb_secret_x');
      expect(init.headers.Authorization).toBeUndefined();
      sent.push({ method: init.method, url, body: init.body && JSON.parse(init.body), prefer: init.headers.Prefer });
      return { ok: true, status: 200, json: async () => replies.shift() };
    });
    const room = { code: 'ABCDE', version: 1 } as Room;
    expect(await store.put(room, null)).toBe(true);
    expect((await store.get('ABCDE'))?.version).toBe(1);
    expect(await store.put({ ...room, version: 2 }, 5)).toBe(false);
    expect(await store.get('NOPE2')).toBeNull();

    const [sweep, insert, read, update] = sent;
    expect(sweep.method).toBe('DELETE');
    expect(sweep.url).toContain('/rest/v1/rooms?updated_at=lt.');
    expect(insert).toMatchObject({ method: 'POST', body: { code: 'ABCDE', version: 1, data: room } });
    expect(insert.prefer).toContain('resolution=ignore-duplicates');
    expect(read.url).toBe('https://project.example/rest/v1/rooms?code=eq.ABCDE&select=data');
    expect(update.method).toBe('PATCH');
    expect(update.url).toContain('code=eq.ABCDE&version=eq.5');
  });

  it('sends the legacy service key as a bearer token too', async () => {
    const store = new SupabaseStore('https://project.example', 'legacy.jwt.key', async (_url, init) => {
      expect(init.headers.Authorization).toBe('Bearer legacy.jwt.key');
      return { ok: true, status: 200, json: async () => [] };
    });
    expect(await store.get('ABCDE')).toBeNull();
  });

  it('reports a database failure as a storage error instead of crashing', async () => {
    const store = new SupabaseStore('https://project.example', 'secret', async () => ({
      ok: false,
      status: 401,
      json: async () => ({ message: 'unauthorized' }),
    }));
    const res = await handle({ op: 'create', token: ANA, name: 'Ana' }, store, 0);
    expect(res).toEqual({ ok: false, error: 'storage' });
  });
});

describe('push', () => {
  it('sends the others their own view when someone acts, each on their own topic', async () => {
    const s = await lobby();
    // Bea joining was pushed to Ana, the only other person there.
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0].topic).toBe(topicFor(s.code, ANA));
    expect(s.pushed[0].payload.room).toMatchObject({ me: 0, seats: [{ name: 'Ana' }, { name: 'Bea' }] });

    await s.ok({ op: 'start', code: s.code, token: ANA });
    const toBea = s.pushed[1];
    expect(s.pushed).toHaveLength(2);
    expect(toBea.topic).toBe(topicFor(s.code, BEA));
    const stored = (await s.store.get(s.code)) as Room;
    expect(toBea.payload.room?.game?.hand).toEqual(stored.game!.hands[1]);
    // A view names nobody's user id, not even its owner's.
    const views = JSON.stringify(s.pushed.map((m) => m.payload));
    expect(views).not.toContain(ANA);
    expect(views).not.toContain(BEA);
  });

  it('stays quiet when a request changes nothing to see', async () => {
    const s = await lobby();
    s.pushed.length = 0;
    await s.ok({ op: 'state', code: s.code, token: ANA });
    // A heartbeat: Ana's presence is written, but Bea has nothing new to look at.
    s.advance(20_000);
    await s.ok({ op: 'state', code: s.code, token: ANA });
    expect(s.pushed).toHaveLength(0);
  });

  it('tells a removed player they are out, and the table when someone comes back', async () => {
    const s = await lobby();
    s.pushed.length = 0;
    await s.ok({ op: 'removeSeat', code: s.code, token: ANA, seat: 1 });
    expect(s.pushed).toEqual([{ topic: topicFor(s.code, BEA), payload: { room: null } }]);

    await s.ok({ op: 'join', code: s.code, token: BEA, name: 'Bea' });
    s.pushed.length = 0;
    s.advance(50_000);
    expect((await s.ok({ op: 'state', code: s.code, token: ANA })).seats[1].online).toBe(false);
    await s.ok({ op: 'state', code: s.code, token: BEA });
    expect(s.pushed.at(-1)?.payload.room?.seats[1].online).toBe(true);
  });
});

describe('identity', () => {
  const jwt = (claims: object) => `Bearer header.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.signature`;

  it('takes the player from a signed-in user\'s token', () => {
    expect(userOf(jwt({ sub: 'user-1', role: 'authenticated', is_anonymous: true }))).toBe('user-1');
  });

  it('refuses the project\'s own keys and anything that is not a token', () => {
    expect(userOf(jwt({ role: 'anon' }))).toBeNull();
    expect(userOf(jwt({ sub: 'user-1', role: 'anon' }))).toBeNull();
    expect(userOf(jwt({ sub: '', role: 'authenticated' }))).toBeNull();
    expect(userOf('Bearer sb_publishable_abc')).toBeNull();
    expect(userOf(null)).toBeNull();
  });
});

describe('waking the server', () => {
  it('says when its next move is due, and has moved by then', async () => {
    const s = await lobby();
    expect((await s.ok({ op: 'state', code: s.code, token: ANA })).wakeIn).toBeNull();
    await s.ok({ op: 'addBot', code: s.code, token: ANA, level: 'warrior' });
    await s.ok({ op: 'start', code: s.code, token: ANA });
    const tokens = [ANA, BEA];
    // Play using nothing but the hints: act when it is our turn, otherwise sleep exactly as long as told.
    for (let step = 0; step < 5000; step++) {
      const views = await Promise.all(tokens.map((token) => s.ok({ op: 'state', code: s.code, token })));
      if (views[0].status === 'finished') return;
      let acted = false;
      for (const [i, room] of views.entries()) {
        const game = room.game!;
        const token = tokens[i];
        if (game.phase === 'bidding' && game.bids[room.me] === null && !game.hasBid[room.me]) {
          await s.ok({ op: 'bid', code: s.code, token, bid: 0 });
        } else if (game.phase === 'roundEnd' && !room.ready[room.me]) {
          await s.ok({ op: 'ready', code: s.code, token });
        } else if (game.phase === 'playing' && game.currentPlayer === room.me && room.wakeIn! > 30_000) {
          const card = legalCards(game.hand, game.trick.plays)[0];
          const res = await s.call({ op: 'play', code: s.code, token, cardId: card.id, as: card.kind === 'kitsune' ? 'master' : undefined });
          // The table is still holding on the last trick or the bids: a person would be watching it.
          if (!res.ok) s.advance(3000);
        } else continue;
        acted = true;
        break;
      }
      if (acted) continue;
      const wake = views[0].wakeIn;
      expect(wake).not.toBeNull();
      // Never a busy loop, and never so long that the people at the table stall.
      expect(wake!).toBeGreaterThan(0);
      expect(wake!).toBeLessThanOrEqual(61_000);
      const before = views[0].version;
      s.advance(wake!);
      const after = await s.ok({ op: 'state', code: s.code, token: ANA });
      if (wake! < 30_000) expect(after.version).toBeGreaterThan(before);
    }
    throw new Error('game did not finish');
  });
});
