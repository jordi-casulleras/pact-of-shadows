import { useCallback, useMemo, useState } from 'react';
import { usePrefs } from '../app/prefs';
import { playerView, type GameState } from '../engine';
import { useI18n } from '../i18n';
import { Table } from './Table';
import { useTutorial } from './Tutorial';
import { HUMAN, useGame, type Settings } from './useGame';

const BOT_NAMES = ['Aiko', 'Kenji', 'Hana', 'Ryu', 'Sora'];

interface Props {
  settings: Settings;
  /** A saved game to resume. */
  initial?: GameState;
  onExit: () => void;
  onRematch: () => void;
}

/** A game against bots that runs entirely in this browser. */
export function LocalTable({ settings, initial, onExit, onRematch }: Props) {
  const { t } = useI18n();
  const { prefs, setPrefs } = usePrefs();
  const [menuOpen, setMenuOpen] = useState(false);
  const [tipHolds, setTipHolds] = useState(false);
  // The table waits while the menu is open or a hint about the finished trick is on screen.
  const { game, pause, legalIds, placeBid, playCard, nextRound } = useGame(settings, {
    initial,
    held: menuOpen || tipHolds,
  });
  const view = useMemo(() => playerView(game, HUMAN), [game]);
  const end = useCallback(() => setPrefs({ tutorialDone: true }), [setPrefs]);
  const { tip, dismiss } = useTutorial(view, pause, !prefs.tutorialDone, end);
  if (tipHolds !== (tip === 'trick')) setTipHolds(tip === 'trick');
  const names = useMemo(() => [t('player.you'), ...BOT_NAMES.slice(0, settings.bots)], [settings.bots, t]);

  return (
    <Table
      view={view}
      names={names}
      pause={pause}
      legalIds={legalIds}
      onBid={placeBid}
      onPlay={playCard}
      onNext={nextRound}
      onExit={onExit}
      onRematch={onRematch}
      onMenuToggle={setMenuOpen}
      tutorial={{ tip, dismiss, end }}
    />
  );
}
