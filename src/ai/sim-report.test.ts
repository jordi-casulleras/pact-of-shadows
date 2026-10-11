import { it } from 'vitest';
import { runMatchup } from './tournament.js';
import type { Level } from './bots.js';

// Run with `npm run sim`; skipped in the normal test run.
const games = Number(process.env.SIM_GAMES ?? 0);

it.skipIf(games === 0)('prints bot matchups', { timeout: 0 }, () => {
  const pairs: [Level, Level][] = [
    ['warrior', 'apprentice'],
    ['master', 'apprentice'],
    ['master', 'warrior'],
  ];
  for (const [a, b] of pairs) {
    const t = Date.now();
    const r = runMatchup(a, b, games);
    console.log(
      `${a} vs ${b}: mean ${r.mean[0].toFixed(1)} vs ${r.mean[1].toFixed(1)}, wins ${r.wins[0]}-${r.wins[1]} of ${r.games} (${((Date.now() - t) / games).toFixed(0)} ms/game)`,
    );
  }
});
