// Screenshots every card design for art review.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

mkdirSync('e2e/shots', { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${process.env.BASE_URL ?? 'http://localhost:5173'}/?gallery=1`);
await page.getByTestId('gallery').waitFor();
await page.screenshot({ path: 'e2e/shots/gallery.png' });
console.log(JSON.stringify({ cards: await page.locator('.card').count(), errors }));
await browser.close();
if (errors.length) process.exit(1);
