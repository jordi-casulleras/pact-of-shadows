// Targeted browser checks that the full-game runs do not cover.
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:5173';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-ES' })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const results = {};
const check = (name, ok) => {
  results[name] = ok ? 'ok' : 'FAILED';
};
const seen = (testId) => page.getByTestId(testId).first().isVisible();
const handCount = () => page.getByTestId('hand').locator('.hand__slot').count();
const audio = () => page.evaluate(() => window.__audioState());
const roundLabel = () => page.getByTestId('round').textContent();
const leftHand = (before) =>
  page.waitForFunction(
    (n) =>
      document.querySelectorAll('[data-testid="hand"] .hand__slot').length < n ||
      document.querySelector('[data-testid="kitsune-choice"]'),
    before,
    { timeout: 4000 },
  );

await page.goto(`${base}/?speed=6&seed=21`);

// --- Language ---
check('starts in Spanish', (await page.getByTestId('play').textContent()) === 'Jugar');
await page.getByTestId('language').click();
check('switches to English', (await page.getByTestId('play').textContent()) === 'Play');
await page.reload();
check('language is remembered', (await page.getByTestId('play').textContent()) === 'Play');
check('no saved game on a fresh profile', !(await seen('continue')));

// --- Settings and audio ---
await page.getByTestId('settings-open').click();
let state = await audio();
check('audio runs after the first click', state.running && state.musicPlaying);
await page.getByTestId('toggle-music').click();
check('music can be turned off', !(await audio()).musicPlaying);
await page.getByTestId('toggle-sfx').click();
check('sound effects can be turned off', !(await audio()).sfxOn);
check('tutorial starts enabled', await page.getByTestId('replay-tutorial').isDisabled());
await page.getByTestId('settings-close').click();
await page.reload();
await page.getByTestId('settings-open').click();
check(
  'audio settings are remembered',
  (await page.getByTestId('toggle-music').getAttribute('aria-checked')) === 'false' &&
    (await page.getByTestId('toggle-sfx').getAttribute('aria-checked')) === 'false',
);
await page.getByTestId('toggle-music').click();
await page.getByTestId('toggle-sfx').click();
state = await audio();
check('audio can be turned back on', state.sfxOn && state.musicPlaying);
await page.getByTestId('settings-close').click();

// --- Tutorial ---
await page.getByTestId('play').click();
await page.getByTestId('bots-2').click();
await page.getByTestId('start').click();
await page.getByTestId('bid-panel').waitFor();
check('tutorial explains the first bid', await seen('bid-tip'));
await page.getByTestId('bid-1').click();
await page.getByTestId('coach').waitFor({ timeout: 15000 });
check('tutorial hint appears during play', true);
await page.getByTestId('coach-skip').click();
await page.waitForTimeout(400);
check('skipping hides the tutorial', !(await seen('coach')));

// --- Play: illegal cards, drag back, keyboard ---
let sawIllegal = false;
let droppedOutside = false;
let usedKeyboard = false;
const deadline = Date.now() + 120_000;
const roundOf = async () => Number((await roundLabel()).match(/\d+/)[0]);

while (!(sawIllegal && droppedOutside && usedKeyboard && (await roundOf()) >= 3) && Date.now() < deadline) {
  if (await seen('final')) break;
  if (await seen('coach')) check('no tutorial after skipping', false);
  if (await seen('bid-panel')) {
    if (await seen('bid-tip')) check('no tutorial after skipping', false);
    await page.getByTestId('bid-1').click();
  } else if (await seen('kitsune-choice')) {
    await page.getByTestId('kitsune-master').click();
  } else if (await seen('next-round')) {
    await page.getByTestId('next-round').click();
  } else if (await seen('hand-card-legal')) {
    const before = await handCount();
    const card = page.getByTestId('hand-card-legal').first();

    const illegal = page.locator('.hand__card.is-illegal').first();
    if (!sawIllegal && (await illegal.count())) {
      await page.waitForTimeout(350);
      const filter = await illegal.locator('.card').evaluate((el) => getComputedStyle(el).filter);
      await illegal.click({ position: { x: 12, y: 30 }, force: true });
      await page.waitForTimeout(150);
      check('illegal cards are dimmed', filter.includes('brightness'));
      check('illegal cards cannot be played', (await handCount()) === before);
      sawIllegal = true;
    }

    if (!droppedOutside) {
      const from = await card.boundingBox();
      await page.mouse.move(from.x + 20, from.y + 30);
      await page.mouse.down();
      await page.mouse.move(from.x + 60, from.y - 20, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(1200);
      const after = await card.boundingBox();
      check('a short drag does not play the card', (await handCount()) === before);
      check('the card snaps back', Math.abs(after.x - from.x) < 3 && Math.abs(after.y - from.y) < 3);
      droppedOutside = true;
    }

    if (!usedKeyboard) {
      await card.focus();
      await page.keyboard.press('Enter');
      await leftHand(before).then(
        () => check('Enter plays the focused card', true),
        () => check('Enter plays the focused card', false),
      );
      usedKeyboard = true;
    } else {
      await card.click({ position: { x: 12, y: 30 } });
      await leftHand(before).catch(() => check('card leaves the hand', false));
    }
  } else {
    await page.waitForTimeout(25);
  }
}
check('saw an unplayable card', sawIllegal);
results['no tutorial after skipping'] ??= 'ok';

// --- Opponent legend ---
await page.getByTestId('seat-1').click();
check('tapping a rival explains their figures', (await seen('legend')) && /Cards in hand/.test(await page.getByTestId('legend').textContent()));
await page.getByTestId('round').click();
check('tapping elsewhere hides the legend', !(await seen('legend')));

// --- Scoreboard ---
await page.getByRole('button', { name: 'Scores' }).click();
check('scoreboard opens', await seen('scoreboard'));
await page.getByRole('button', { name: 'Close' }).click();
check('scoreboard closes', !(await seen('scoreboard')));

// --- Save and continue ---
// Wait for a quiet moment in the hand so the snapshot is stable.
await page.getByTestId('hand-card-legal').first().waitFor({ timeout: 20000 }).catch(() => {});
const before = { round: await roundLabel(), hand: await handCount(), pact: await page.getByTestId('pact').textContent() };
await page.getByTestId('open-menu').click();
await page.getByTestId('exit-game').click();
check('menu offers to continue', await seen('continue'));
await page.reload();
check('the saved game survives a reload', await seen('continue'));
await page.getByTestId('continue').click();
await page.getByTestId('hand').waitFor();
const after = { round: await roundLabel(), hand: await handCount(), pact: await page.getByTestId('pact').textContent() };
check('continuing restores round, hand and pact', JSON.stringify(before) === JSON.stringify(after));

// The tutorial can be replayed from the in-game menu.
await page.getByTestId('open-menu').click();
check('tutorial can be replayed', await page.getByTestId('replay-tutorial').isEnabled());
await page.getByTestId('settings-close').click();

check('no console errors', errors.length === 0);
console.log(JSON.stringify({ results, before, after, errors }, null, 2));
await browser.close();
if (Object.values(results).includes('FAILED')) process.exit(1);
