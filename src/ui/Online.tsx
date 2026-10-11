import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LEVELS, type Level } from '../ai/bots';
import { sfx } from '../app/audio';
import { scaled } from '../app/speed';
import { load, remove, save } from '../app/storage';
import { legalCards, type KitsuneMode } from '../engine';
import { useI18n, type Key } from '../i18n';
import { ApiError, api, subscribe } from '../net/client';
import { CODE_LENGTH, MAX_SEATS, MIN_SEATS, NAME_MAX, type ApiRequest, type RoomView } from '../net/protocol';
import { Table, type Pause } from './Table';

/** Matches the server's holds, so the table is never ahead of what the server accepts. */
const REVEAL_PAUSE = 1800;
const TRICK_PAUSE = 2600;
/** With nothing else to ask, each browser still checks in this often: it is how the server knows it is there. */
const HEARTBEAT = 20_000;
/** Everyone knows when the server's next move is due; they ask in seat order, this far apart, so one request does. */
const WAKE_STAGGER = 800;
const WAKE_MARGIN = 100;
const RETRY = 2000;

const params = new URLSearchParams(window.location.search);
/** `?rounds=2` shortens online games; used by automated checks. */
const TEST_ROUNDS = Number(params.get('rounds')) || undefined;
const TEST_SPEED = Number(params.get('speed')) || undefined;
/** `?room=ABCDE` opens the join form with the code filled in. */
export const INVITE_CODE = (params.get('room') ?? '').toUpperCase().slice(0, CODE_LENGTH);

type Without<T, K extends string> = T extends unknown ? Omit<T, K> : never;
type Send = (request: Without<ApiRequest, 'token' | 'code'>) => Promise<boolean>;

function errorKey(e: unknown): Key {
  const code = e instanceof ApiError ? e.code : 'other';
  const known = ['notFound', 'full', 'alreadyStarted', 'notInRoom', 'network', 'storage', 'auth'] as const;
  return `online.error.${(known as readonly string[]).includes(code) ? (code as (typeof known)[number]) : 'other'}`;
}

export function Online({ onExit }: { onExit: () => void }) {
  const { t } = useI18n();
  const [room, setRoom] = useState<RoomView | null>(null);
  const [name, setName] = useState(() => load<string>('name') ?? '');
  const [code, setCode] = useState(INVITE_CODE);
  const [error, setError] = useState<Key | null>(null);
  const [busy, setBusy] = useState(false);

  const enter = useCallback(async (request: Without<ApiRequest, 'token'>, quiet = false) => {
    setBusy(true);
    setError(null);
    try {
      const joined = await api(request);
      if (joined) {
        save('room', joined.code);
        setRoom(joined);
      }
    } catch (e) {
      remove('room');
      if (!quiet) setError(errorKey(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // A reload, or coming back later, returns to the room this browser was in.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const last = load<string>('room');
    if (last && !INVITE_CODE) void enter({ op: 'join', code: last, name: load<string>('name') ?? '' }, true);
  }, [enter]);

  const gone = useCallback((reason?: Key) => {
    remove('room');
    setRoom(null);
    setError(reason ?? null);
  }, []);

  if (room) return <Room initial={room} onGone={gone} />;

  const cleanName = name.trim();
  const submit = (request: Without<ApiRequest, 'token'>) => {
    save('name', cleanName);
    void enter(request);
  };

  return (
    <main className="screen">
      <div className="panel panel--wide online" data-testid="online">
        <h2>{t('online.title')}</h2>
        <label className="field">
          <span>{t('online.name')}</span>
          <input
            className="input"
            data-testid="player-name"
            value={name}
            maxLength={NAME_MAX}
            autoComplete="nickname"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <button
          className="btn btn--primary btn--big"
          data-testid="create-room"
          disabled={busy || !cleanName}
          onClick={() => submit({ op: 'create', name: cleanName, rounds: TEST_ROUNDS, speed: TEST_SPEED })}
        >
          {t('online.create')}
          <small>{t('online.createHint')}</small>
        </button>

        <div className="divider">{t('online.or')}</div>

        <form
          className="join"
          onSubmit={(e) => {
            e.preventDefault();
            submit({ op: 'join', code, name: cleanName });
          }}
        >
          <label className="field">
            <span>{t('online.code')}</span>
            <input
              className="input input--code"
              data-testid="room-code-input"
              value={code}
              maxLength={CODE_LENGTH}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="ABCDE"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
          </label>
          <button
            className="btn btn--big"
            data-testid="join-room"
            disabled={busy || !cleanName || code.length !== CODE_LENGTH}
          >
            {t('online.join')}
          </button>
        </form>

        <p className={`online__message${error ? ' is-error' : ''}`} data-testid="online-error" role="status">
          {error ? t(error) : busy ? t('online.connecting') : ''}
        </p>
        <button className="btn btn--ghost" onClick={onExit}>
          {t('online.back')}
        </button>
      </div>
    </main>
  );
}

/**
 * Keeps a room in step with the server. The server pushes this player's view whenever the room
 * changes; requests are only made to act, to check in, and to wake the server when a move of its own is due.
 */
function useRoom(initial: RoomView, onGone: (reason?: Key) => void) {
  const [room, setRoom] = useState(initial);
  const [offline, setOffline] = useState(false);
  /** Counts finished requests, so the timer below is set again even when one changed nothing. */
  const [asked, setAsked] = useState(0);
  const code = initial.code;
  /** When this browser last called the server, which is what the server counts as being there. */
  const lastAsked = useRef(Date.now());

  const accept = useCallback((next: RoomView) => {
    setRoom((current) => (next.version >= current.version ? next : current));
    setOffline(false);
  }, []);

  const sync = useCallback(async () => {
    lastAsked.current = Date.now();
    try {
      const next = await api({ op: 'state', code });
      if (next) accept(next);
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'notFound' || e.code === 'notInRoom')) return onGone(errorKey(e));
      setOffline(true);
    }
    setAsked((n) => n + 1);
  }, [accept, code, onGone]);

  useEffect(() => {
    let stopped = false;
    const stop = subscribe(
      code,
      (push) => {
        if (stopped) return;
        if (push.room) accept(push.room);
        else onGone('online.error.notInRoom');
      },
      // Whatever was pushed while the connection was down is lost: catch up.
      () => void sync(),
    );
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      stop();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [accept, code, onGone, sync]);

  useEffect(() => {
    // Those ahead of this player in the queue to wake the server: the people at the table before them.
    const ahead = room.seats.filter((s, i) => i < room.me && s.kind === 'human' && s.online).length;
    const wake = room.wakeIn === null ? Infinity : room.wakeIn + WAKE_MARGIN + scaled(ahead * WAKE_STAGGER);
    // The heartbeat runs from this browser's last request, not from the last push: a busy table must not postpone it.
    const heartbeat = Math.max(0, HEARTBEAT - (Date.now() - lastAsked.current));
    const id = setTimeout(sync, offline ? RETRY : Math.min(heartbeat, wake));
    return () => clearTimeout(id);
  }, [asked, offline, room, sync]);

  /** Sends an action; resolves to whether the server accepted it. */
  const send: Send = useCallback(
    async (request) => {
      lastAsked.current = Date.now();
      try {
        const next = await api({ ...request, code } as Without<ApiRequest, 'token'>);
        if (next) accept(next);
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'network') setOffline(true);
        return false;
      }
    },
    [accept, code],
  );

  return { room, offline, send };
}

function Room({ initial, onGone }: { initial: RoomView; onGone: (reason?: Key) => void }) {
  const { room, offline, send } = useRoom(initial, onGone);
  const leave = useCallback(async () => {
    await send({ op: 'leave' });
    onGone();
  }, [onGone, send]);

  if (room.status === 'lobby' || !room.game) return <Lobby room={room} send={send} onLeave={leave} offline={offline} />;
  return <OnlineTable room={room} send={send} onLeave={leave} offline={offline} />;
}

interface RoomProps {
  room: RoomView;
  send: Send;
  onLeave: () => void;
  offline: boolean;
}

function Lobby({ room, send, onLeave, offline }: RoomProps) {
  const { t } = useI18n();
  const [level, setLevel] = useState<Level>('warrior');
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const full = room.seats.length >= MAX_SEATS;

  const copy = async (what: 'code' | 'link') => {
    const text = what === 'code' ? room.code : `${window.location.origin}${window.location.pathname}?room=${room.code}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard access can be refused; the code is on screen to copy by hand.
    }
  };

  return (
    <main className="screen">
      <div className="panel panel--wide lobby" data-testid="lobby">
        <small>{t('online.roomCode')}</small>
        <div className="lobby__code" data-testid="room-code">
          {room.code}
        </div>
        <div className="panel__actions">
          <button className="btn btn--ghost btn--small" data-testid="copy-code" onClick={() => copy('code')}>
            {copied === 'code' ? t('online.copied') : t('online.copyCode')}
          </button>
          <button className="btn btn--ghost btn--small" onClick={() => copy('link')}>
            {copied === 'link' ? t('online.copied') : t('online.copyLink')}
          </button>
        </div>
        <p className="lobby__hint">{t('online.shareHint')}</p>

        <h3>{t('online.players', { count: room.seats.length, max: MAX_SEATS })}</h3>
        <ul className="lobby__seats" data-testid="lobby-seats">
          {room.seats.map((seat, i) => {
            return (
              <li key={i} className={`${i === room.me ? 'is-me' : ''}${seat.online ? '' : ' is-away'}`}>
                <span className="lobby__name">{seat.name}</span>
                <span className="lobby__tags">
                  {i === room.me && <em>{t('online.you')}</em>}
                  {seat.host && <em>{t('online.host')}</em>}
                  {seat.kind === 'bot' && seat.level && <em>{t('online.bot', { level: t(`level.${seat.level}`) })}</em>}
                  {!seat.online && <em>{t('online.away')}</em>}
                </span>
                {room.isHost && i !== room.me && (
                  <button
                    className="btn btn--ghost btn--small"
                    data-testid={`remove-seat-${i}`}
                    onClick={() => send({ op: 'removeSeat', seat: i })}
                  >
                    {t('online.remove')}
                  </button>
                )}
              </li>
            );
          })}
          {!full && (
            <li className="is-empty">{t('online.emptySeats', { count: MAX_SEATS - room.seats.length })}</li>
          )}
        </ul>

        {room.isHost ? (
          <>
            <div className="lobby__bots">
              <div className="segmented">
                {LEVELS.map((option) => (
                  <button
                    key={option}
                    className={option === level ? 'is-on' : ''}
                    aria-pressed={option === level}
                    onClick={() => setLevel(option)}
                  >
                    {t(`level.${option}`)}
                  </button>
                ))}
              </div>
              <button className="btn" data-testid="add-bot" disabled={full} onClick={() => send({ op: 'addBot', level })}>
                {t('online.addBot')}
              </button>
            </div>
            <button
              className="btn btn--primary btn--big"
              data-testid="start-online"
              disabled={room.seats.length < MIN_SEATS}
              onClick={() => send({ op: 'start' })}
            >
              {t('online.start')}
              {room.seats.length < MIN_SEATS && <small>{t('online.needTwo')}</small>}
            </button>
          </>
        ) : (
          <p className="waiting" data-testid="waiting-host">
            {t('online.waitingHost')}
          </p>
        )}
        <p className="online__message is-error" role="status">
          {offline ? t('online.reconnecting') : ''}
        </p>
        <button className="btn btn--ghost" data-testid="leave-room" onClick={onLeave}>
          {t('online.leave')}
        </button>
      </div>
    </main>
  );
}

function OnlineTable({ room, send, onLeave, offline }: RoomProps) {
  const { t } = useI18n();
  const view = room.game!;
  const me = room.me;
  const [pause, setPause] = useState<Pause | null>(null);

  // The server sends states, not events: a new completed trick or a finished bidding round shows up
  // as a change between two of them, and that change is what the table pauses on.
  const trickKey = `${view.round}:${view.completedTricks.length}`;
  const lastTrickKey = useRef(trickKey);
  const bidding = view.phase === 'bidding';
  const wasBidding = useRef({ round: view.round, bidding });
  useEffect(() => {
    if (lastTrickKey.current !== trickKey) {
      lastTrickKey.current = trickKey;
      if (view.completedTricks.length > 0 && view.lastTrick) {
        setPause({ kind: 'trick', trick: view.lastTrick, result: view.lastTrick.result });
      }
    }
    const before = wasBidding.current;
    wasBidding.current = { round: view.round, bidding };
    if (before.bidding && !bidding && before.round === view.round) {
      setPause({ kind: 'reveal' });
      sfx('reveal');
    }
  }, [bidding, trickKey, view.completedTricks.length, view.lastTrick, view.round]);

  useEffect(() => {
    if (!pause) return;
    const id = setTimeout(() => setPause(null), scaled(pause.kind === 'trick' ? TRICK_PAUSE : REVEAL_PAUSE));
    return () => clearTimeout(id);
  }, [pause]);

  useEffect(() => {
    if (pause?.kind !== 'trick') return;
    const { winner, bonus } = pause.result;
    const id = setTimeout(() => sfx(bonus > 0 ? 'capture' : winner === me ? 'win' : 'trick'), scaled(350));
    return () => clearTimeout(id);
  }, [me, pause]);

  // The server takes a moment to answer: a card, a bid or a "ready" shows at once, and is taken back if refused.
  const [played, setPlayed] = useState<{ cardId: string; as?: KitsuneMode } | null>(null);
  const [sent, setSent] = useState<{ round: number; bid?: number; ready?: boolean }>({ round: view.round });
  const mine = sent.round === view.round ? sent : null;
  const shown = useMemo(() => {
    let next = view;
    if (mine?.bid !== undefined && view.phase === 'bidding' && view.bids[me] === null) {
      next = {
        ...next,
        bids: view.bids.map((b, p) => (p === me ? mine.bid! : b)),
        hasBid: view.hasBid.map((b, p) => p === me || b),
      };
    }
    const card = played && view.hand.find((c) => c.id === played.cardId);
    if (card && view.phase === 'playing' && view.currentPlayer === me) {
      const plays = [...view.trick.plays, played.as ? { player: me, card, as: played.as } : { player: me, card }];
      const players = view.config.playerCount;
      next = {
        ...next,
        hand: view.hand.filter((c) => c !== card),
        handSizes: view.handSizes.map((size, p) => (p === me ? size - 1 : size)),
        trick: { ...view.trick, plays },
        // When this card completes the trick, who leads next is the server's to say.
        currentPlayer: plays.length < players ? (me + 1) % players : null,
      };
    }
    return next;
  }, [me, mine?.bid, played, view]);

  const cardsPlayed = shown.completedTricks.length * shown.config.playerCount + shown.trick.plays.length;
  const lastCardsPlayed = useRef(cardsPlayed);
  useEffect(() => {
    if (cardsPlayed > lastCardsPlayed.current) sfx('card');
    lastCardsPlayed.current = cardsPlayed;
  }, [cardsPlayed]);

  const myTurn = !pause && shown.phase === 'playing' && shown.currentPlayer === me;
  useEffect(() => {
    if (myTurn) sfx('turn');
  }, [myTurn]);

  const legalIds = useMemo(
    () => new Set(myTurn ? legalCards(shown.hand, shown.trick.plays).map((c) => c.id) : []),
    [myTurn, shown.hand, shown.trick.plays],
  );

  const play = useCallback(
    async (cardId: string, as?: KitsuneMode) => {
      setPlayed({ cardId, as });
      // If this browser's clock ran a little ahead of the server's hold, wait and try again.
      for (let attempt = 0; attempt < 6; attempt++) {
        if (await send({ op: 'play', cardId, as })) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      // Accepted, the card has left the hand the server sends; refused, it goes back to it.
      setPlayed(null);
    },
    [send],
  );

  const act = useCallback(
    async (change: { bid: number } | { ready: true }) => {
      const round = view.round;
      setSent((current) => ({ ...(current.round === round ? current : {}), round, ...change }));
      const ok = await send('bid' in change ? { op: 'bid', bid: change.bid } : { op: 'ready' });
      if (!ok) setSent({ round });
    },
    [send, view.round],
  );

  const names = useMemo(() => room.seats.map((s) => s.name), [room.seats]);
  const away = useMemo(() => room.seats.map((s) => !s.online), [room.seats]);

  return (
    <Table
      view={shown}
      names={names}
      pause={pause}
      legalIds={legalIds}
      onBid={(bid) => void act({ bid })}
      onPlay={(cardId, as) => void play(cardId, as)}
      onNext={() => void act({ ready: true })}
      waitingForOthers={room.ready[me] || (mine?.ready ?? false)}
      onExit={onLeave}
      onRematch={room.isHost ? () => void send({ op: 'backToLobby' }) : undefined}
      rematchLabel={t('online.backToLobby')}
      offline={away}
      exitHint={t('online.exitHint')}
      notice={offline ? t('online.reconnecting') : undefined}
    />
  );
}
