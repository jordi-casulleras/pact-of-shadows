import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { PlayerView } from '../engine';
import { useI18n } from '../i18n';
import type { Pause } from './Table';

/** One hint per situation the first time it comes up, over the first three rounds. */
export type Tip = 'bid1' | 'bid2' | 'bid3' | 'turn' | 'trick' | 'score';

const BID_TIPS: Record<number, Tip> = { 1: 'bid1', 2: 'bid2', 3: 'bid3' };
const LAST_ROUND = 3;

export function useTutorial(game: PlayerView, pause: Pause | null, enabled: boolean, onDone: () => void) {
  const me = game.viewer;
  const [seen, setSeen] = useState<ReadonlySet<Tip>>(new Set());
  const fresh = (tip: Tip | undefined) => (tip && !seen.has(tip) ? tip : null);

  let tip: Tip | null = null;
  if (enabled) {
    if (game.phase === 'bidding' && game.bids[me] === null) tip = fresh(BID_TIPS[game.round]);
    else if (pause?.kind === 'trick') tip = fresh('trick');
    else if (!pause && game.phase === 'playing' && game.currentPlayer === me) tip = fresh('turn');
    else if (!pause && game.phase === 'roundEnd') tip = fresh('score');
  }

  // A hint counts as seen once its moment has passed, dismissed or not.
  const previous = useRef<Tip | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = tip;
    if (before && before !== tip) setSeen((current) => new Set(current).add(before));
  }, [tip]);

  useEffect(() => {
    if (enabled && game.round > LAST_ROUND) onDone();
  }, [enabled, game.round, onDone]);

  const dismiss = () => {
    if (tip) setSeen((current) => new Set(current).add(tip));
  };
  return { tip, dismiss };
}

export function Coach({ tip, onOk, onSkip }: { tip: Tip; onOk: () => void; onSkip: () => void }) {
  const { t } = useI18n();
  return (
    <motion.div
      className="coach"
      data-testid="coach"
      role="status"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, pointerEvents: 'none' }}
    >
      <p>{t(`tutorial.${tip}`)}</p>
      <div className="coach__actions">
        <button className="btn btn--primary" data-testid="coach-ok" onClick={onOk}>
          {t('tutorial.ok')}
        </button>
        <button className="btn btn--ghost" data-testid="coach-skip" onClick={onSkip}>
          {t('tutorial.skip')}
        </button>
      </div>
    </motion.div>
  );
}
