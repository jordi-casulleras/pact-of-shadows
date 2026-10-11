import { useState } from 'react';
import { LEVELS, type Level } from '../ai/bots';
import { load, loadSavedGame } from '../app/storage';
import { createDeck, type Card, type GameState } from '../engine';
import { useI18n } from '../i18n';
import { CardBack, CardView } from './CardView';
import { SettingsPanel } from './Overlays';
import { LocalTable } from './LocalTable';
import { INVITE_CODE, Online } from './Online';
import type { Settings } from './useGame';

type Screen = 'menu' | 'setup' | 'howTo' | 'game' | 'online';

/** `?seed=123` in the URL fixes the deal; used by automated checks. */
function newSeed(): number {
  const fixed = Number(new URLSearchParams(window.location.search).get('seed'));
  if (Number.isInteger(fixed) && fixed > 0) return fixed;
  return Math.floor(Math.random() * 0x7fffffff);
}

/** `?gallery=1` shows every card at once, for reviewing the art. */
const GALLERY = new URLSearchParams(window.location.search).has('gallery');

function Gallery() {
  const seen = new Set<string>();
  const cards = createDeck().filter((card) => {
    if (card.kind === 'number') return [1, 7, 14].includes(card.rank);
    if (seen.has(card.kind)) return false;
    seen.add(card.kind);
    return true;
  });
  return (
    <main className="screen screen--scroll gallery" data-testid="gallery">
      {cards.map((card) => (
        <CardView key={card.id} card={card} />
      ))}
      {cards
        .filter((card) => card.kind === 'kitsune')
        .flatMap((card) => [
          <CardView key="as-master" card={card} as="master" />,
          <CardView key="as-smokeBomb" card={card} as="smokeBomb" />,
        ])}
      <CardBack />
    </main>
  );
}

export function App() {
  const { t, lang, setLang } = useI18n();
  // An invitation link goes straight to the join form; so does a reload while in a room.
  const [screen, setScreen] = useState<Screen>(() => (INVITE_CODE || load<string>('room') ? 'online' : 'menu'));
  const [bots, setBots] = useState(3);
  const [level, setLevel] = useState<Level>('warrior');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [resumed, setResumed] = useState<GameState | undefined>();
  const [gameId, setGameId] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  const start = () => {
    setSettings({ bots, level, seed: newSeed() });
    setResumed(undefined);
    setGameId((id) => id + 1);
    setScreen('game');
  };

  if (GALLERY) return <Gallery />;

  if (screen === 'game' && settings) {
    return (
      <LocalTable
        key={gameId}
        settings={settings}
        initial={resumed}
        onExit={() => setScreen('menu')}
        onRematch={() => {
          setSettings({ ...settings, seed: newSeed() });
          setResumed(undefined);
          setGameId((id) => id + 1);
        }}
      />
    );
  }

  if (screen === 'online') return <Online onExit={() => setScreen('menu')} />;

  if (screen === 'howTo') return <HowTo onBack={() => setScreen('menu')} />;

  if (screen === 'setup') {
    return (
      <main className="screen">
        <div className="panel panel--wide" data-testid="setup">
          <h2>{t('setup.title')}</h2>
          <fieldset className="field">
            <legend>{t('setup.rivals')}</legend>
            <div className="segmented">
              {[1, 2, 3, 4, 5].map((count) => (
                <button
                  key={count}
                  className={count === bots ? 'is-on' : ''}
                  aria-pressed={count === bots}
                  data-testid={`bots-${count}`}
                  onClick={() => setBots(count)}
                >
                  {count}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="field">
            <legend>{t('setup.level')}</legend>
            <div className="segmented">
              {LEVELS.map((option) => (
                <button
                  key={option}
                  className={option === level ? 'is-on' : ''}
                  aria-pressed={option === level}
                  data-testid={`level-${option}`}
                  onClick={() => setLevel(option)}
                >
                  {t(`level.${option}`)}
                </button>
              ))}
            </div>
            <p className="field__hint">{t(`level.${level}.hint`)}</p>
          </fieldset>
          <div className="panel__actions">
            <button className="btn btn--primary" data-testid="start" onClick={start}>
              {t('setup.start')}
            </button>
            <button className="btn btn--ghost" onClick={() => setScreen('menu')}>
              {t('setup.back')}
            </button>
          </div>
        </div>
      </main>
    );
  }

  // Read on every visit to the menu, so it reflects the game just left.
  const saved = loadSavedGame();
  const resume = () => {
    if (!saved) return;
    setSettings(saved.settings);
    setResumed(saved.game);
    setGameId((id) => id + 1);
    setScreen('game');
  };

  return (
    <main className="screen screen--menu">
      <div className="title">
        <span className="title__seal">影</span>
        <h1>Pact of Shadows</h1>
        <p>{t('menu.tagline')}</p>
      </div>
      <nav className="menu">
        {saved && (
          <button className="btn btn--primary btn--big" data-testid="continue" onClick={resume}>
            {t('menu.continue')}
            <small>{t('hud.round', { round: saved.game.round, rounds: saved.game.config.rounds })}</small>
          </button>
        )}
        <button
          className={`btn btn--big${saved ? '' : ' btn--primary'}`}
          data-testid="play"
          onClick={() => setScreen('setup')}
        >
          {t('menu.play')}
        </button>
        <button className="btn btn--big" data-testid="online-open" onClick={() => setScreen('online')}>
          {t('menu.online')}
        </button>
        <button className="btn btn--big" data-testid="how-to" onClick={() => setScreen('howTo')}>
          {t('menu.howTo')}
        </button>
        <div className="menu__row">
          <button className="btn btn--ghost" data-testid="settings-open" onClick={() => setShowSettings(true)}>
            {t('menu.settings')}
          </button>
          <button className="btn btn--ghost" data-testid="language" onClick={() => setLang(lang === 'es' ? 'en' : 'es')}>
            {t('menu.language')}
          </button>
        </div>
      </nav>
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </main>
  );
}

const EXAMPLES: { card: Card; key: 'numbers' | 'smokeBomb' | 'master' | 'geisha' | 'shogun' | 'kitsune' }[] = [
  { card: { id: 'ex-shadow', kind: 'number', suit: 'shadow', rank: 14 }, key: 'numbers' },
  { card: { id: 'ex-bomb', kind: 'smokeBomb' }, key: 'smokeBomb' },
  { card: { id: 'ex-master', kind: 'master' }, key: 'master' },
  { card: { id: 'ex-geisha', kind: 'geisha' }, key: 'geisha' },
  { card: { id: 'ex-shogun', kind: 'shogun' }, key: 'shogun' },
  { card: { id: 'ex-kitsune', kind: 'kitsune' }, key: 'kitsune' },
];

function HowTo({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  return (
    <main className="screen screen--scroll">
      <div className="panel panel--wide howto" data-testid="how-to-screen">
        <h2>{t('how.title')}</h2>
        <h3>{t('how.goal.title')}</h3>
        <p>{t('how.goal.body')}</p>
        <h3>{t('how.play.title')}</h3>
        <p>{t('how.play.body')}</p>
        <h3>{t('how.cards.title')}</h3>
        <ul className="howto__cards">
          {EXAMPLES.map(({ card, key }) => (
            <li key={key}>
              <CardView card={card} />
              <span>{t(`how.cards.${key}`)}</span>
            </li>
          ))}
        </ul>
        <h3>{t('how.score.title')}</h3>
        <ul className="howto__list">
          <li>{t('how.score.made')}</li>
          <li>{t('how.score.missed')}</li>
          <li>{t('how.score.zero')}</li>
          <li>{t('how.score.bonus')}</li>
        </ul>
        <button className="btn btn--primary" onClick={onBack}>
          {t('how.back')}
        </button>
      </div>
    </main>
  );
}
