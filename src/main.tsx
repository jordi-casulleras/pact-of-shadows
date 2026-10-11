import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { audioState, unlockAudio } from './app/audio';
import { PrefsProvider } from './app/prefs';
import { I18nProvider } from './i18n';
import { App } from './ui/App';
import './ui/styles.css';

// Browsers only allow sound after a user gesture.
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

// Lets automated checks confirm that sound is actually running.
if (import.meta.env.DEV) Object.assign(window, { __audioState: audioState });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <PrefsProvider>
        <App />
      </PrefsProvider>
    </I18nProvider>
  </StrictMode>,
);
