import type { GameState } from '../engine';
import type { Settings } from '../ui/useGame';

const PREFIX = 'pact-of-shadows.';

/** localStorage can throw (private mode, quota); every access degrades to "nothing stored". */
export function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Not persisted; the app keeps working for this session.
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // Nothing to remove.
  }
}

const SAVE_KEY = 'save';
const SAVE_VERSION = 1;

export interface SavedGame {
  settings: Settings;
  game: GameState;
}

export function saveGame(saved: SavedGame): void {
  save(SAVE_KEY, { v: SAVE_VERSION, ...saved });
}

export function clearSavedGame(): void {
  remove(SAVE_KEY);
}

/** The game in progress, or null if there is none or it does not look like one of ours. */
export function loadSavedGame(): SavedGame | null {
  const data = load<Partial<SavedGame> & { v?: number }>(SAVE_KEY);
  const game = data?.game;
  const settings = data?.settings;
  if (!data || data.v !== SAVE_VERSION || !game || !settings) return null;
  const players = game.config?.playerCount;
  const sound =
    game.phase !== 'gameOver' &&
    Number.isInteger(players) &&
    players === settings.bots + 1 &&
    Array.isArray(game.hands) &&
    game.hands.length === players &&
    Array.isArray(game.scores) &&
    Array.isArray(game.completedTricks) &&
    Array.isArray(game.trick?.plays);
  return sound ? { settings, game } : null;
}
