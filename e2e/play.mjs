// Plays a full game in a real browser against the dev server and fails on any error.
// Usage: node e2e/play.mjs [desktop|mobile] [bots] [level] [seed]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [profile = 'desktop', bots = '3', level = 'warrior', seed = '7'] = process.argv.slice(2);
const base = process.env.BASE_URL ?? 'http://localhost:5173';
const shots = `e2e/shots/${profile}`;
mkdirSync(shots, { recursive: true });

const viewport = profile === 'mobile' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport,
  hasTouch: profile === 'mobile',
  isMobile: profile === 'mobile',
  locale: 'es-ES',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
});

const taken = new Set();
const shot = async (name, settle = 0) => {
  if (taken.has(name)) return;
  taken.add(name);
  if (settle) await page.waitForTimeout(settle);
  await page.screenshot({ path: `${shots}/${name}.png` });
};
const visible = (testId) => page.getByTestId(testId).first().isVisible();
const fail = async (message) => {
  await page.screenshot({ path: `${shots}/FAILED.png` });
  console.error(`FAILED: ${message}`);
  console.error(errors.join('\n'));
  await browser.close();
  process.exit(1);
};

await page.goto(`${base}/?speed=6&seed=${seed}`);
await shot('01-menu');
await page.getByTestId('how-to').click();
await page.getByTestId('how-to-screen').waitFor();
await shot('02-how-to');
await page.getByRole('button', { name: 'Volver' }).click();
await page.getByTestId('play').click();
await page.getByTestId(`bots-${bots}`).click();
await page.getByTestId(`level-${level}`).click();
await shot('03-setup');
await page.getByTestId('start').click();

const stats = { tips: 0, bids: 0, clicks: 0, drags: 0, kitsune: 0, rounds: 0, banners: 0, bonus: 0 };
let idle = 0;
const deadline = Date.now() + 240_000;

while (!(await visible('final'))) {
  if (Date.now() > deadline) await fail('game did not finish in time');
  if (idle > 400) await fail(`stuck: nothing to do (status "${await page.getByTestId('status').textContent()}")`);

  if (await visible('trick-banner')) {
    stats.banners++;
    await shot('06-trick-won');
    if (await visible('bonus-pop')) {
      stats.bonus++;
      await shot('07-bonus');
    }
  }

  if (await visible('coach-ok')) {
    await shot(`12-tutorial-${stats.tips}`, 300);
    await page.getByTestId('coach-ok').click();
    // The hint fades out; wait until it is gone so it is not counted twice.
    await page.getByTestId('coach').waitFor({ state: 'detached' });
    stats.tips++;
    idle = 0;
    continue;
  }
  if (stats.rounds === 1 && (await visible('score-tip'))) await shot('12-tutorial-score', 300);

  if (await visible('bid-panel')) {
    const round = Number((await page.getByTestId('round').textContent()).match(/\d+/)[0]);
    if (round === 1) await shot('04-bid-round-1');
    if (round === 10) await shot('04-bid-round-10', 400);
    await page.getByTestId(`bid-${Math.min(round, Math.round(round / Number(bots) / 1.3))}`).click();
    stats.bids++;
    idle = 0;
  } else if (await visible('kitsune-choice')) {
    await shot('08-kitsune', 400);
    await page.getByTestId(stats.kitsune % 2 ? 'kitsune-smokeBomb' : 'kitsune-master').click();
    stats.kitsune++;
    idle = 0;
  } else if (await visible('next-round')) {
    stats.rounds++;
    if (stats.rounds === 1) await shot('09-round-end-1', 400);
    if (stats.rounds === 10) await shot('09-round-end-10', 400);
    await page.getByTestId('next-round').click();
    idle = 0;
  } else if (await visible('hand-card-legal')) {
    const before = await page.getByTestId('hand').locator('.hand__slot').count();
    if (before >= 5) await shot('05-my-turn');
    const card = page.getByTestId('hand-card-legal').first();
    // Alternate between dragging to the centre and clicking/tapping.
    if (profile !== 'mobile' && stats.clicks > stats.drags) {
      const from = await card.boundingBox();
      const to = await page.getByTestId('center').boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 3);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
      if (before >= 3) await shot('05b-dragging');
      await page.mouse.up();
      stats.drags++;
    } else if (profile === 'mobile') {
      // In a crowded hand only the left edge of a card is uncovered.
      await card.tap({ position: { x: 12, y: 30 } });
      stats.clicks++;
    } else {
      await card.click({ position: { x: 12, y: 30 } });
      stats.clicks++;
    }
    // The card must leave the hand, unless it opened the Kitsune choice.
    await page.waitForFunction(
      (n) =>
        document.querySelectorAll('[data-testid="hand"] .hand__slot').length < n ||
        document.querySelector('[data-testid="kitsune-choice"]'),
      before,
      { timeout: 3000 },
    ).catch(() => fail('played card did not leave the hand'));
    idle = 0;
  } else {
    idle++;
    await page.waitForTimeout(25);
  }

  // Nothing on the table may spill past the viewport (the fan's rotation gets a little slack).
  const spill = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.hud, .seat, .me, .hand__slot, .bid')) {
      const r = el.getBoundingClientRect();
      if (r.left < -12 || r.right > innerWidth + 12 || r.top < -2 || r.bottom > innerHeight + 12) {
        out.push(`${el.className} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
      }
    }
    return out;
  });
  if (spill.length) await fail(`layout spills out of the viewport: ${spill.slice(0, 3).join(' | ')}`);
}

await shot('10-final', 400);
const headline = await page.getByTestId('final-headline').textContent();
await page.getByTestId('rematch').click();
await page.getByTestId('bid-panel').waitFor();
await shot('11-rematch');

console.log(JSON.stringify({ profile, bots, level, seed, headline, ...stats, errors }, null, 2));
await browser.close();

if (errors.length) process.exit(1);
if (stats.rounds !== 10 || stats.bids !== 10) process.exit(1);
// A fresh browser profile gets the first-game tutorial. The first-turn hint can be missed if this
// script plays before it shows, but the first-trick hint freezes the table until it is dismissed.
if (stats.tips < 1 || stats.tips > 2) process.exit(1);
