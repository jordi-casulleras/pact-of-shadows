import { AnimatePresence, motion, type PanInfo } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  SUITS,
  type Card,
  type KitsuneMode,
  type PlayerView,
  type SpecialKind,
  type Trick,
  type TrickResult,
} from '../engine';
import { useI18n } from '../i18n';
import { CardView, cardName } from './CardView';
import { scaled } from '../app/speed';
import { BidPanel, FinalScreen, KitsuneChoice, RoundEnd, Scoreboard, SettingsPanel } from './Overlays';
import { Coach, type Tip } from './Tutorial';

const SPECIAL_ORDER: SpecialKind[] = ['smokeBomb', 'geisha', 'master', 'kitsune', 'shogun'];

function sortKey(card: Card): number {
  if (card.kind === 'number') return SUITS.indexOf(card.suit) * 20 + card.rank;
  return 100 + SPECIAL_ORDER.indexOf(card.kind);
}

interface Offset {
  x: number;
  y: number;
}

/** A beat where the table holds still so the player can read what happened. */
export type Pause = { kind: 'reveal' } | { kind: 'trick'; trick: Trick; result: TrickResult };

export interface TutorialControls {
  tip: Tip | null;
  dismiss: () => void;
  end: () => void;
}

export interface TableProps {
  /** The game as seen from this player's seat. */
  view: PlayerView;
  /** Display name of every seat. */
  names: string[];
  pause: Pause | null;
  /** Cards the player may play right now. */
  legalIds: ReadonlySet<string>;
  onBid: (bid: number) => void;
  onPlay: (cardId: string, as?: KitsuneMode) => void;
  /** Leaving the round summary: next round locally, "ready" online. */
  onNext: () => void;
  /** Shown instead of the button once this player is ready and others are not. */
  waitingForOthers?: boolean;
  onExit: () => void;
  /** Offered on the final screen when present. */
  onRematch?: () => void;
  rematchLabel?: string;
  /** Told when the in-game menu opens or closes, so a local game can freeze. */
  onMenuToggle?: (open: boolean) => void;
  tutorial?: TutorialControls;
  /** Seats whose player has dropped out of an online game. */
  offline?: boolean[];
  /** What leaving means here; the default says a local game is saved. */
  exitHint?: string;
  /** A notice shown in place of the turn status, e.g. while the connection is down. */
  notice?: string;
}

export function Table({
  view,
  names,
  pause,
  legalIds,
  onBid,
  onPlay,
  onNext,
  waitingForOthers,
  onExit,
  onRematch,
  rematchLabel,
  onMenuToggle,
  tutorial,
  offline,
  exitHint,
  notice,
}: TableProps) {
  const { t } = useI18n();
  const game = view;
  const me = view.viewer;
  const tip = tutorial?.tip ?? null;
  const [showMenu, setShowMenu] = useState(false);
  useEffect(() => onMenuToggle?.(showMenu), [onMenuToggle, showMenu]);
  const n = game.config.playerCount;
  /** Rivals in playing order, starting with the one to this player's left. */
  const rivals = useMemo(() => Array.from({ length: n - 1 }, (_, i) => (me + 1 + i) % n), [me, n]);

  const centerRef = useRef<HTMLDivElement>(null);
  const seatRefs = useRef<(HTMLElement | null)[]>([]);
  const dropPoint = useRef<{ cardId: string; at: Offset } | null>(null);
  const draggedAt = useRef(0);
  const isDragging = useRef(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [kitsune, setKitsune] = useState<Card | null>(null);
  const [showScores, setShowScores] = useState(false);
  /** The opponent whose figures are spelled out, if any. */
  const [legend, setLegend] = useState<number | null>(null);
  const [exitTo, setExitTo] = useState<Offset>({ x: 0, y: 0 });

  /** Where a seat sits relative to the middle of the table, for cards flying in and out. */
  const seatOffset = useCallback((player: number): Offset => {
    const seat = seatRefs.current[player]?.getBoundingClientRect();
    const center = centerRef.current?.getBoundingClientRect();
    if (!seat || !center) return { x: 0, y: player === me ? 300 : -300 };
    return {
      x: seat.left + seat.width / 2 - (center.left + center.width / 2),
      y: seat.top + seat.height / 2 - (center.top + center.height / 2),
    };
  }, [me]);

  // Tapping anywhere but a seat puts the legend away.
  useEffect(() => {
    if (legend === null) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.seat')) setLegend(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [legend]);

  const trickPause = pause?.kind === 'trick' ? pause : null;
  useEffect(() => {
    if (trickPause) setExitTo(seatOffset(trickPause.result.winner));
  }, [trickPause, seatOffset]);

  const tablePlays = trickPause ? trickPause.trick.plays : game.trick.plays;
  const hand = useMemo(() => view.hand.slice().sort((a, b) => sortKey(a) - sortKey(b)), [view.hand]);
  const myTurn = !pause && game.phase === 'playing' && game.currentPlayer === me;
  const bidsVisible = game.phase !== 'bidding';

  const requestPlay = (card: Card) => {
    if (!legalIds.has(card.id)) return;
    if (card.kind === 'kitsune') setKitsune(card);
    else onPlay(card.id);
  };

  const onDragEnd = (card: Card, info: PanInfo) => {
    setDragging(null);
    isDragging.current = false;
    draggedAt.current = Date.now();
    const center = centerRef.current?.getBoundingClientRect();
    if (!center) return;
    // Viewport coordinates, to match getBoundingClientRect.
    const x = info.point.x - window.scrollX;
    const y = info.point.y - window.scrollY;
    if (x < center.left || x > center.right || y < center.top || y > center.bottom) return;
    dropPoint.current = {
      cardId: card.id,
      at: { x: x - (center.left + center.width / 2), y: y - (center.top + center.height / 2) },
    };
    requestPlay(card);
  };

  /** A dragged card enters from where it was dropped; any other from its owner's seat. */
  const originOf = (player: number, cardId: string): Offset =>
    dropPoint.current?.cardId === cardId ? dropPoint.current.at : seatOffset(player);

  const myBid = game.bids[me];
  const tricksLeft = game.round - game.completedTricks.length;
  const pactState =
    !bidsVisible || myBid === null
      ? 'open'
      : game.tricksWon[me] > myBid || game.tricksWon[me] + tricksLeft < myBid
        ? 'broken'
        : game.tricksWon[me] === myBid
          ? 'met'
          : 'open';

  let status = '';
  if (myTurn) status = t('hud.yourTurn');
  else if (!pause && game.phase === 'playing' && game.currentPlayer !== null) {
    status = t('hud.waiting', { name: names[game.currentPlayer] });
  } else if (pause?.kind === 'reveal') status = t('bid.revealed');

  // The fan flattens as the hand grows so the outer cards stay on screen.
  const mid = (hand.length - 1) / 2;
  const fanStep = Math.min(2.5, 14 / Math.max(hand.length, 1));
  const fanDrop = mid > 0 ? Math.min(1.2, 8 / (mid * mid)) : 0;

  return (
    <div className="table" style={{ '--players': n } as CSSProperties} data-phase={game.phase}>
      <header className="hud">
        <span className="hud__round" data-testid="round">
          {t('hud.round', { round: game.round, rounds: game.config.rounds })}
        </span>
        <span className="hud__actions">
          <button className="btn btn--ghost" onClick={() => setShowScores(true)}>
            {t('hud.scores')}
          </button>
          <button className="btn btn--ghost" data-testid="open-menu" onClick={() => setShowMenu(true)}>
            {t('hud.menu')}
          </button>
        </span>
      </header>

      <div className={`lantern lantern--left${trickPause ? ' is-lit' : ''}`} aria-hidden="true" />
      <div className={`lantern lantern--right${trickPause ? ' is-lit' : ''}`} aria-hidden="true" />

      <div className="opponents">
        {rivals.map((p, i) => {
          const name = names[p];
          const bid = game.bids[p];
          const away = offline?.[p] ?? false;
          const active = !pause && game.phase === 'playing' && game.currentPlayer === p;
          const won = trickPause?.result.winner === p;
          const pactKnown = bidsVisible && bid !== null;
          return (
            <button
              key={p}
              ref={(el) => {
                seatRefs.current[p] = el;
              }}
              className={`seat${active ? ' is-active' : ''}${won ? ' is-winner' : ''}${legend === p ? ' is-open' : ''}${away ? ' is-away' : ''}`}
              data-testid={`seat-${p}`}
              aria-expanded={legend === p}
              onClick={() => setLegend(legend === p ? null : p)}
            >
              <div className={`avatar avatar--${i + 1}`}>{name[0]?.toUpperCase()}</div>
              <div className="seat__name">{name}</div>
              {away && <div className="seat__away">{t('online.away')}</div>}
              <div className="seat__chips">
                <span className="chip" title={t('seat.cards')}>
                  <HandIcon />
                  {view.handSizes[p]}
                </span>
                <span className="chip chip--pact" title={pactKnown ? t('seat.pact') : t('seat.pactHidden')}>
                  <PactIcon />
                  {pactKnown ? `${game.tricksWon[p]}/${bid}` : view.hasBid[p] ? '✓' : '?'}
                </span>
              </div>
              <div className="seat__score" title={t('seat.score')}>
                {t('seat.points', { points: game.scores[p] })}
              </div>
              <AnimatePresence>
                {trickPause && won && trickPause.result.bonus > 0 && <BonusPop bonus={trickPause.result.bonus} />}
              </AnimatePresence>
            </button>
          );
        })}
        {legend !== null && (
          <div className="legend" data-testid="legend" role="status">
            <strong>{names[legend]}</strong>
            <span>
              <HandIcon />
              {t('seat.cards')}: <b>{view.handSizes[legend]}</b>
            </span>
            <span>
              <PactIcon />
              {bidsVisible && game.bids[legend] !== null ? (
                <>
                  {t('seat.pact')}:{' '}
                  <b>
                    {game.tricksWon[legend]}/{game.bids[legend]}
                  </b>
                </>
              ) : (
                t('seat.pactHidden')
              )}
            </span>
            <span>
              {t('seat.score')}: <b>{game.scores[legend]}</b>
            </span>
          </div>
        )}
      </div>

      <div ref={centerRef} className={`center${dragging ? ' is-drop-target' : ''}`} data-testid="center">
        {dragging && tablePlays.length === 0 && <span className="center__hint">{t('hud.dropHere')}</span>}
        <div className="trick">
          <AnimatePresence custom={exitTo}>
            {tablePlays.map((play, i) => {
              const winner = trickPause && trickPause.result.winningIndex === i;
              const loser = trickPause && !winner;
              return (
                <motion.div
                  key={play.card.id}
                  className={`trick__slot${winner ? ' is-winner' : ''}${loser ? ' is-loser' : ''}`}
                  custom={exitTo}
                  variants={{
                    exit: (to: Offset) => ({
                      x: to.x,
                      y: to.y,
                      scale: 0.25,
                      opacity: 0,
                      transition: { duration: scaled(450) / 1000, ease: 'easeIn' },
                    }),
                  }}
                  initial={{ ...originOf(play.player, play.card.id), scale: 0.7, opacity: 0.4, rotate: play.player === me ? 0 : 12 }}
                  animate={{ x: 0, y: 0, scale: winner ? 1.12 : 1, opacity: 1, rotate: 0 }}
                  exit="exit"
                  transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                >
                  <CardView card={play.card} as={play.as} />
                  <span className="trick__owner">{names[play.player]}</span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
        <AnimatePresence>
          {trickPause && (
            <motion.div
              className="banner"
              data-testid="trick-banner"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0, transition: { delay: scaled(350) / 1000 } }}
              exit={{ opacity: 0 }}
            >
              <strong>
                {trickPause.result.winner === me
                  ? t('trick.youWin')
                  : t('trick.wins', { name: names[trickPause.result.winner] })}
              </strong>
              <span>{t(`reason.${trickPause.result.reason}`)}</span>
              {trickPause.result.bonus > 0 && (
                <em>{t('trick.bonus', { bonus: trickPause.result.bonus })}</em>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <span className={`status${myTurn ? ' is-mine' : ''}`} data-testid="status">
          {notice ?? status}
        </span>
        <AnimatePresence>
          {tutorial && (tip === 'turn' || tip === 'trick') && (
            <Coach key={tip} tip={tip} onOk={tutorial.dismiss} onSkip={tutorial.end} />
          )}
        </AnimatePresence>
      </div>

      <div className="hand" data-testid="hand">
        {hand.map((card, i) => {
          const legal = legalIds.has(card.id);
          const lift = Math.abs(i - mid);
          return (
            <div
              key={card.id}
              className={`hand__slot${dragging === card.id ? ' is-dragging' : ''}`}
              style={{ transform: `rotate(${(i - mid) * fanStep}deg) translateY(${lift * lift * fanDrop}px)` }}
            >
              <motion.div
                className={`hand__card${legal ? ' is-legal' : ''}${myTurn && !legal ? ' is-illegal' : ''}`}
                drag={legal}
                dragSnapToOrigin
                dragElastic={1}
                dragMomentum={false}
                whileDrag={{ scale: 1.12, zIndex: 60 }}
                onDragStart={() => {
                  isDragging.current = true;
                  setDragging(card.id);
                }}
                onDragEnd={(_, info) => onDragEnd(card, info)}
                onClick={() => {
                  // Releasing a drag also fires a click, before or after the drag ends; ignore it.
                  if (!isDragging.current && Date.now() - draggedAt.current > 250) requestPlay(card);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    requestPlay(card);
                  }
                }}
                tabIndex={legal ? 0 : -1}
                role="button"
                aria-label={cardName(card, t)}
                aria-disabled={!legal}
                data-testid={`hand-card${legal ? '-legal' : ''}`}
              >
                <CardView card={card} />
              </motion.div>
            </div>
          );
        })}
      </div>

      <div
        className={`me${myTurn ? ' is-active' : ''}${trickPause?.result.winner === me ? ' is-winner' : ''}`}
        ref={(el) => {
          seatRefs.current[me] = el;
        }}
      >
        <span className={`stat pact pact--${pactState}`} data-testid="pact">
          <small>{t('hud.pact')}</small>
          <b>
            {bidsVisible && myBid !== null ? t('hud.pactValue', { won: game.tricksWon[me], bid: myBid }) : '—'}
          </b>
        </span>
        <span className="stat">
          <small>{t('hud.points')}</small>
          <b>{game.scores[me]}</b>
        </span>
        <AnimatePresence>
          {trickPause && trickPause.result.winner === me && trickPause.result.bonus > 0 && (
            <BonusPop bonus={trickPause.result.bonus} />
          )}
        </AnimatePresence>
      </div>

      {game.phase === 'bidding' && myBid === null && (
        <BidPanel
          round={game.round}
          onBid={onBid}
          tip={tip === 'bid1' || tip === 'bid2' || tip === 'bid3' ? t(`tutorial.${tip}`) : undefined}
          onSkipTutorial={tutorial?.end}
        />
      )}
      {kitsune && (
        <KitsuneChoice
          onPick={(as) => {
            onPlay(kitsune.id, as);
            setKitsune(null);
          }}
          onCancel={() => setKitsune(null)}
        />
      )}
      {game.phase === 'roundEnd' && !pause && (
        <RoundEnd
          result={game.history[game.history.length - 1]}
          scores={game.scores}
          names={names}
          me={me}
          last={game.round >= game.config.rounds}
          onNext={onNext}
          waiting={waitingForOthers}
          tip={tip === 'score' ? t('tutorial.score') : undefined}
        />
      )}
      {game.phase === 'gameOver' && (
        <FinalScreen
          scores={game.scores}
          names={names}
          me={me}
          onRematch={onRematch}
          rematchLabel={rematchLabel}
          onMenu={onExit}
        />
      )}
      {showMenu && <SettingsPanel onClose={() => setShowMenu(false)} onExit={onExit} exitHint={exitHint} />}
      {showScores && (
        <Scoreboard
          history={game.history}
          scores={game.scores}
          names={names}
          me={me}
          onClose={() => setShowScores(false)}
        />
      )}
    </div>
  );
}

function BonusPop({ bonus }: { bonus: number }) {
  return (
    <motion.span
      className="bonus-pop"
      data-testid="bonus-pop"
      initial={{ opacity: 0, y: 10, scale: 0.6 }}
      animate={{ opacity: 1, y: -18, scale: 1 }}
      exit={{ opacity: 0, y: -40 }}
    >
      +{bonus}
    </motion.span>
  );
}

/** A small fan of cards: how many a player still holds. */
function HandIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 20" aria-hidden="true">
      <rect x="3" y="5" width="9" height="13" rx="1.5" transform="rotate(-18 7.5 18)" opacity="0.55" />
      <rect x="7.5" y="3" width="9" height="13" rx="1.5" opacity="0.8" />
      <rect x="12" y="5" width="9" height="13" rx="1.5" transform="rotate(18 16.5 18)" />
    </svg>
  );
}

/** A sealed scroll: the pact. */
function PactIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 20" aria-hidden="true">
      <rect x="5" y="3" width="14" height="14" rx="1" opacity="0.75" />
      <rect x="3" y="1.5" width="18" height="3.5" rx="1.75" />
      <rect x="3" y="15" width="18" height="3.5" rx="1.75" />
      <circle cx="12" cy="10" r="2.6" fill="var(--fire)" />
    </svg>
  );
}
