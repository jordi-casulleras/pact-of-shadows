import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { configureAudio } from './audio';
import { load, save } from './storage';

export interface Prefs {
  sfx: boolean;
  music: boolean;
  /** Set once the first-game tutorial has been finished or skipped. */
  tutorialDone: boolean;
}

const DEFAULTS: Prefs = { sfx: true, music: true, tutorialDone: false };

interface PrefsContextValue {
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setState] = useState<Prefs>(() => ({ ...DEFAULTS, ...load<Partial<Prefs>>('prefs') }));

  useEffect(() => {
    save('prefs', prefs);
    configureAudio({ sfx: prefs.sfx, music: prefs.music });
  }, [prefs]);

  const setPrefs = useCallback((patch: Partial<Prefs>) => setState((current) => ({ ...current, ...patch })), []);
  const value = useMemo(() => ({ prefs, setPrefs }), [prefs, setPrefs]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used inside PrefsProvider');
  return ctx;
}
