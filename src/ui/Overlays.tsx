import { motion } from 'motion/react';
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { sfx } from '../app/audio';
import { usePrefs } from '../app/prefs';
import type { KitsuneMode, RoundResult } from '../engine';
import { useI18n } from '../i18n';

const signed = (value: number) => (value > 0 ? `+${value}` : String(value).replace('-', '−'));

function Modal({ children, className = '', testId }: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <div className="overlay">
      <motion.div
        className={`panel ${className}`}
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, scale: 0.92, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      >
        {children}
      </motion.div>
    </div>
  );
}

/** Sits above the hand without covering it: the player needs to see their cards to bid. */
interface BidProps {
  round: number;
  /** Who opens the round's first trick; null when it is this player. */
  leader: string | null;
  onBid: (bid: number) => void;
  /** First-game hint shown in place of the usual one-liner. */
  tip?: string;
  onSkipTutorial?: () => void;
}

export function BidPanel({ round, leader, onBid, tip, onSkipTutorial }: BidProps) {
  const { t } = useI18n();
  return (
    <motion.div
      className="bid"
      data-testid="bid-panel"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h2>{t('bid.title')}</h2>
      {tip ? (
        <p className="tip" data-testid="bid-tip">
          {tip}
        </p>
      ) : (
        <p>{t('bid.hint')}</p>
      )}
      <p className={`bid__lead${leader === null ? ' is-me' : ''}`} data-testid="bid-lead">
        {leader === null ? t('bid.leadMe') : t('bid.lead', { name: leader })}
      </p>
      <div
        className="bid__options"
        style={{ '--n': round + 1, '--half': round + 1 > 6 ? Math.ceil((round + 1) / 2) : round + 1 } as CSSProperties}
      >
        {Array.from({ length: round + 1 }, (_, bid) => (
          <button
            key={bid}
            className="bid__option"
            data-testid={`bid-${bid}`}
            onClick={() => {
              sfx('click');
              onBid(bid);
            }}
          >
            {bid}
          </button>
        ))}
      </div>
      {tip && onSkipTutorial && (
        <button className="btn btn--ghost btn--small" data-testid="coach-skip" onClick={onSkipTutorial}>
          {t('tutorial.skip')}
        </button>
      )}
    </motion.div>
  );
}

export function KitsuneChoice({ onPick, onCancel }: { onPick: (as: KitsuneMode) => void; onCancel: () => void }) {
  const { t } = useI18n();
  return (
    <Modal className="kitsune" testId="kitsune-choice">
      <h2>{t('kitsune.title')}</h2>
      <div className="kitsune__options">
        <button className="kitsune__option" data-testid="kitsune-master" onClick={() => onPick('master')}>
          <span className="kitsune__glyph">忍</span>
          <b>{t('kitsune.master')}</b>
          <small>{t('kitsune.masterHint')}</small>
        </button>
        <button className="kitsune__option" data-testid="kitsune-smokeBomb" onClick={() => onPick('smokeBomb')}>
          <span className="kitsune__glyph">煙</span>
          <b>{t('kitsune.smokeBomb')}</b>
          <small>{t('kitsune.smokeBombHint')}</small>
        </button>
      </div>
      <button className="btn btn--ghost" onClick={onCancel}>
        {t('kitsune.cancel')}
      </button>
    </Modal>
  );
}

interface RoundEndProps {
  result: RoundResult;
  scores: number[];
  names: string[];
  /** This player's seat. */
  me: number;
  last: boolean;
  onNext: () => void;
  /** First-game hint explaining the scoring. */
  tip?: string;
  /** Online: this player is ready and the round starts when everyone is. */
  waiting?: boolean;
}

export function RoundEnd({ result, scores, names, me, last, onNext, tip, waiting }: RoundEndProps) {
  const { t } = useI18n();
  useEffect(() => sfx('roundEnd'), []);
  return (
    <Modal testId="round-end">
      <h2>{t('round.title', { round: result.round })}</h2>
      {tip && (
        <p className="tip" data-testid="score-tip">
          {tip}
        </p>
      )}
      <div className="scroll-x">
        <table className="scores scores--round">
          <thead>
            <tr>
              <th>{t('round.player')}</th>
              <th>{t('round.made')}</th>
              <th>{t('round.points')}</th>
              <th>{t('round.total')}</th>
            </tr>
          </thead>
          <tbody>
            {names.map((name, p) => {
              const made = result.bids[p] === result.tricksWon[p];
              return (
                <tr key={p} className={p === me ? 'is-me' : ''}>
                  <th>{name}</th>
                  <td className={made ? 'good' : 'bad'}>
                    {t('round.madeOf', { won: result.tricksWon[p], bid: result.bids[p] })}
                  </td>
                  <td className={result.delta[p] >= 0 ? 'good' : 'bad'}>
                    {signed(result.delta[p])}
                    {result.bonus[p] > 0 && <small>{t('round.withBonus', { bonus: result.bonus[p] })}</small>}
                  </td>
                  <td>
                    <b>{scores[p]}</b>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {waiting ? (
        <p className="waiting" data-testid="waiting-others">
          {t('online.waitingOthers')}
        </p>
      ) : (
        <button className="btn btn--primary" data-testid="next-round" onClick={onNext}>
          {last ? t('round.finish') : t('round.next')}
        </button>
      )}
    </Modal>
  );
}

interface ScoreboardProps {
  history: RoundResult[];
  scores: number[];
  names: string[];
  me: number;
  onClose: () => void;
}

export function Scoreboard({ history, scores, names, me, onClose }: ScoreboardProps) {
  const { t } = useI18n();
  return (
    <Modal testId="scoreboard">
      <h2>{t('scores.title')}</h2>
      <div className="scroll-x">
        <table className="scores">
          <thead>
            <tr>
              <th />
              {names.map((name, p) => (
                <th key={p} className={p === me ? 'is-me' : ''}>
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.map((r) => (
              <tr key={r.round}>
                <th>{t('scores.round', { round: r.round })}</th>
                {r.delta.map((delta, p) => (
                  <td key={p} className={delta >= 0 ? 'good' : 'bad'}>
                    {signed(delta)}
                    <small>
                      {r.tricksWon[p]}/{r.bids[p]}
                    </small>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>{t('round.total')}</th>
              {scores.map((score, p) => (
                <td key={p}>
                  <b>{score}</b>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <button className="btn btn--primary" onClick={onClose}>
        {t('scores.close')}
      </button>
    </Modal>
  );
}

interface FinalProps {
  scores: number[];
  names: string[];
  me: number;
  onRematch?: () => void;
  rematchLabel?: string;
  onMenu: () => void;
}

export function FinalScreen({ scores, names, me, onRematch, rematchLabel, onMenu }: FinalProps) {
  const { t } = useI18n();
  const best = Math.max(...scores);
  const winners = scores.flatMap((s, p) => (s === best ? [p] : []));
  const ranking = scores.map((score, p) => ({ score, p })).sort((a, b) => b.score - a.score);
  const won = winners.includes(me);
  useEffect(() => sfx(won ? 'victory' : 'defeat'), [won]);
  const headline = !winners.includes(me)
    ? t('final.lose', { name: winners.map((p) => names[p]).join(' & ') })
    : winners.length > 1
      ? t('final.sharedWin')
      : t('final.win');
  return (
    <Modal className="final" testId="final">
      <small>{t('final.title')}</small>
      <h2 data-testid="final-headline">{headline}</h2>
      <ol className="ranking">
        {ranking.map(({ score, p }) => (
          <li key={p} className={`${p === me ? 'is-me' : ''}${score === best ? ' is-winner' : ''}`}>
            <span>{names[p]}</span>
            <b>{score}</b>
          </li>
        ))}
      </ol>
      <div className="panel__actions">
        {onRematch && (
          <button className="btn btn--primary" data-testid="rematch" onClick={onRematch}>
            {rematchLabel ?? t('final.rematch')}
          </button>
        )}
        <button className="btn btn--ghost" onClick={onMenu}>
          {t('final.menu')}
        </button>
      </div>
    </Modal>
  );
}

function Switch({ label, on, onChange, testId }: { label: string; on: boolean; onChange: (on: boolean) => void; testId: string }) {
  const { t } = useI18n();
  return (
    <div className="setting">
      <span>{label}</span>
      <button
        className={`switch${on ? ' is-on' : ''}`}
        role="switch"
        aria-checked={on}
        aria-label={label}
        data-testid={testId}
        onClick={() => onChange(!on)}
      >
        {on ? t('settings.on') : t('settings.off')}
      </button>
    </div>
  );
}

interface SettingsProps {
  onClose: () => void;
  /** Present when opened from a game in progress. */
  onExit?: () => void;
  exitHint?: string;
}

export function SettingsPanel({ onClose, onExit, exitHint }: SettingsProps) {
  const { t, lang, setLang } = useI18n();
  const { prefs, setPrefs } = usePrefs();
  return (
    <Modal className="settings" testId="settings">
      <h2>{t('settings.title')}</h2>
      <Switch label={t('settings.sfx')} on={prefs.sfx} onChange={(sfxOn) => setPrefs({ sfx: sfxOn })} testId="toggle-sfx" />
      <Switch label={t('settings.music')} on={prefs.music} onChange={(music) => setPrefs({ music })} testId="toggle-music" />
      <div className="setting">
        <span>{t('settings.language')}</span>
        <button className="switch is-on" data-testid="toggle-language" onClick={() => setLang(lang === 'es' ? 'en' : 'es')}>
          {t('settings.languageValue')}
        </button>
      </div>
      <div className="setting">
        <span>{t('settings.tutorial')}</span>
        <button
          className={`switch${prefs.tutorialDone ? '' : ' is-on'}`}
          data-testid="replay-tutorial"
          disabled={!prefs.tutorialDone}
          onClick={() => setPrefs({ tutorialDone: false })}
        >
          {prefs.tutorialDone ? t('settings.tutorialReplay') : t('settings.tutorialOn')}
        </button>
      </div>
      {onExit && <p className="settings__hint">{exitHint ?? t('settings.exitHint')}</p>}
      <div className="panel__actions">
        <button className="btn btn--primary" data-testid="settings-close" onClick={onClose}>
          {onExit ? t('settings.resume') : t('settings.close')}
        </button>
        {onExit && (
          <button className="btn btn--ghost" data-testid="exit-game" onClick={onExit}>
            {t('settings.exit')}
          </button>
        )}
      </div>
    </Modal>
  );
}
