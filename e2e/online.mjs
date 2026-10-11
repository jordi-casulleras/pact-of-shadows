// Two browsers play an online game in the same room, with one bot, against the dev server.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:5173';
const shots = 'e2e/shots/online';
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
const errors = [];
const results = {};
const check = (name, ok) => {
  results[name] = ok ? 'ok' : 'FAILED';
};

async function open(label, viewport, path = '/?speed=4&rounds=2') {
  const context = await browser.newContext({ viewport, locale: 'es-ES' });
  await context.addInitScript(() => localStorage.setItem('pact-of-shadows.prefs', JSON.stringify({ tutorialDone: true })));
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`));
  await page.goto(base + path);
  return page;
}
const seen = (page, id) => page.getByTestId(id).first().isVisible();

const host = await open('host', { width: 1280, height: 800 });
const guest = await open('guest', { width: 390, height: 844 });

// --- Create ---
await host.getByTestId('online-open').click();
check('create needs a name', await host.getByTestId('create-room').isDisabled());
await host.getByTestId('player-name').fill('Ana');
await host.getByTestId('create-room').click();
await host.getByTestId('lobby').waitFor();
const code = (await host.getByTestId('room-code').textContent()).trim();
check('host gets a 5-character code', /^[A-Z0-9]{5}$/.test(code));
check('host cannot start alone', await host.getByTestId('start-online').isDisabled());
await host.screenshot({ path: `${shots}/01-lobby-host-alone.png` });

// --- Join: wrong code, then the right one in lower case ---
await guest.getByTestId('online-open').click();
await guest.getByTestId('player-name').fill('Bea');
await guest.getByTestId('room-code-input').fill('ZZZZZ');
await guest.getByTestId('join-room').click();
await guest.waitForFunction(() => document.querySelector('[data-testid="online-error"]')?.textContent?.includes('No existe'));
check('a wrong code is explained', true);
await guest.screenshot({ path: `${shots}/02-join-wrong-code.png` });
await guest.getByTestId('room-code-input').fill(code.toLowerCase());
check('the code field upper-cases input', (await guest.getByTestId('room-code-input').inputValue()) === code);
await guest.getByTestId('join-room').click();
await guest.getByTestId('lobby').waitFor();
check('guest waits for the host', await seen(guest, 'waiting-host'));
check('guest has no host controls', !(await seen(guest, 'start-online')) && !(await seen(guest, 'add-bot')));

// --- Host sees the guest, adds a bot ---
await host.waitForFunction(() => document.querySelector('[data-testid="lobby-seats"]')?.textContent?.includes('Bea'));
check('host sees the guest arrive', true);
await host.getByTestId('add-bot').click();
await guest.waitForFunction(() => document.querySelector('[data-testid="lobby-seats"]')?.textContent?.includes('Aiko'));
check('guest sees the bot the host added', true);
await host.screenshot({ path: `${shots}/03-lobby-host.png` });
await guest.screenshot({ path: `${shots}/03-lobby-guest.png` });

// --- A third browser cannot join after the start; an invitation link pre-fills the code ---
const late = await open('late', { width: 800, height: 700 }, `/?speed=4&room=${code}`);
check('an invitation link opens the join form with the code', (await late.getByTestId('room-code-input').inputValue()) === code);

await host.getByTestId('start-online').click();
await host.getByTestId('bid-panel').waitFor();
await guest.getByTestId('bid-panel').waitFor();
check('both players are dealt in', true);

await late.getByTestId('player-name').fill('Cat');
await late.getByTestId('join-room').click();
await late.waitForFunction(() => document.querySelector('[data-testid="online-error"]')?.textContent?.includes('ya ha empezado'));
check('late joiners are told the game has started', true);
await late.close();

// --- Hidden information: neither page ever holds the other's cards ---
const handIds = (page) => page.$$eval('[data-testid="hand"] .card', (els) => els.map((el) => el.dataset.cardId));
const [hostHand, guestHand] = [await handIds(host), await handIds(guest)];
check('each player has their own hand', hostHand.length === 1 && guestHand.length === 1 && hostHand[0] !== guestHand[0]);

// --- Play the whole game; the guest reloads halfway to prove they get their seat back ---
const stats = { host: 0, guest: 0, reloaded: false, sawWaiting: false, sawAway: false };
const pages = { host, guest };
const deadline = Date.now() + 240_000;
let shotTable = false;

async function act(label) {
  const page = pages[label];
  if (await seen(page, 'final')) return true;
  if (await seen(page, 'waiting-others')) stats.sawWaiting = true;
  if (await seen(page, 'bid-panel')) {
    await page.getByTestId('bid-0').click();
  } else if (await seen(page, 'kitsune-choice')) {
    await page.getByTestId('kitsune-smokeBomb').click();
  } else if (await seen(page, 'next-round')) {
    await page.getByTestId('next-round').click();
  } else if (await seen(page, 'hand-card-legal')) {
    const before = await page.getByTestId('hand').locator('.hand__slot').count();
    if (!shotTable && before >= 2) {
      shotTable = true;
      await host.screenshot({ path: `${shots}/04-table-host.png` });
      await guest.screenshot({ path: `${shots}/04-table-guest.png` });
    }
    await page.getByTestId('hand-card-legal').first().click({ position: { x: 12, y: 30 } });
    await page
      .waitForFunction(
        (n) =>
          document.querySelectorAll('[data-testid="hand"] .hand__slot').length < n ||
          document.querySelector('[data-testid="kitsune-choice"]'),
        before,
        { timeout: 5000 },
      )
      .catch(() => check(`${label}: played card leaves the hand`, false));
    stats[label]++;
    if (label === 'guest' && !stats.reloaded && stats.guest === 1) {
      await page.reload();
      await page.getByTestId('hand').waitFor({ timeout: 10000 });
      stats.reloaded = true;
    }
  }
  return false;
}

let done = false;
while (!done && Date.now() < deadline) {
  const [a, b] = [await act('host'), await act('guest')];
  done = a && b;
  await host.waitForTimeout(40);
}
check('the game finishes for both', done);
check('guest got their seat back after a reload', stats.reloaded);
check('a ready player waits for the other', stats.sawWaiting);

const headline = (page) => page.getByTestId('final-headline').textContent();
const ranking = (page) => page.$$eval('.ranking li', (els) => els.map((el) => el.textContent));
await host.waitForTimeout(500);
await host.screenshot({ path: `${shots}/05-final-host.png` });
await guest.screenshot({ path: `${shots}/05-final-guest.png` });
check('both see the same final ranking', JSON.stringify(await ranking(host)) === JSON.stringify(await ranking(guest)));
check('only the host can send everyone back to the room', (await seen(host, 'rematch')) && !(await seen(guest, 'rematch')));

// --- Back to the lobby, then the guest leaves ---
await host.getByTestId('rematch').click();
await host.getByTestId('lobby').waitFor();
await guest.getByTestId('lobby').waitFor({ timeout: 10000 });
check('everyone returns to the room after the game', true);
await guest.getByTestId('leave-room').click();
await guest.getByTestId('online').waitFor();
await host.waitForFunction(() => !document.querySelector('[data-testid="lobby-seats"]')?.textContent?.includes('Bea'));
check('the host sees a player leave', true);

check('no console errors', errors.length === 0);
console.log(JSON.stringify({ code, results, stats, headlines: [await headline(host).catch(() => null)], errors }, null, 2));
await browser.close();
if (Object.values(results).includes('FAILED')) process.exit(1);
