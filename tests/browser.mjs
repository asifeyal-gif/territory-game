import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const base = 'http://127.0.0.1:5174';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], { stdio: 'pipe' });
let serverOutput = ''; server.stdout.on('data', x => serverOutput += x); server.stderr.on('data', x => serverOutput += x);
let browser;
try {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(serverOutput);
    try { if ((await fetch(base)).ok) break; } catch { /* Wait for Vite readiness. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  let executablePath = process.env.CHROMIUM_PATH;
  if (!executablePath) { try { await access('/usr/bin/chromium'); executablePath = '/usr/bin/chromium'; } catch { /* Use Playwright's installed browser. */ } }
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  // Expose the existing instance only in this test response; production has no window test hooks.
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.testGame = game;` });
  });
  await page.goto(base); await page.bringToFront();
  await page.waitForFunction(() => window.testGame?.scene.getScene('GameScene')?.model);
  await page.evaluate(() => window.scene = window.testGame.scene.getScene('GameScene'));
  const state = () => page.evaluate(() => {
    const m = window.scene.model;
    return { player: m.player, direction: m.direction, queued: m.queued, phase: m.phase, lives: m.lives, owned: m.owned.size, captures: m.captures, progress: m.progress, recovery: m.recovery, enemyClock: m.enemyClock, enemies: m.enemies };
  });
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/desktop-start.png' });
  await page.waitForTimeout(300); assert.equal((await state()).player.x, 4);
  await page.getByRole('button', { name: 'מתחילים לשחק' }).click();
  await page.waitForTimeout(1200);
  assert((await state()).player.x >= 7, 'automatic rightward movement');
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(100); assert.equal((await state()).queued, 'right');
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(350); assert.equal((await state()).direction, 'up');
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100); assert.equal((await state()).queued, 'up');
  assert.equal(await page.evaluate(() => scrollY), 0);
  await page.getByRole('button', { name: 'השהיה', exact: true }).click();
  const paused = await state(); await page.waitForTimeout(400); assert.deepEqual(await state(), paused);
  await page.getByRole('button', { name: 'המשך', exact: true }).click();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hidden = await state(); await page.waitForTimeout(400); assert.deepEqual(await state(), hidden);
  assert.match(await page.locator('#overlay-description').innerText(), /אוטומטית/);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.getByRole('button', { name: 'משחק מחדש', exact: true }).click();
  assert.equal((await state()).phase, 'ready'); assert.equal((await state()).owned, 25);
  await page.getByRole('button', { name: 'מתחילים לשחק' }).click();
  // Deterministic fast-forward of a complete closure in the real scene, while rendering continues.
  await page.evaluate(() => {
    const s = window.scene; s.paused = true;
    const m = s.model; m.enemies = [{ x: 30, y: 20, dx: 1, dy: 1 }];
    for (let i = 0; i < 6; i++) m.step();
    m.turn('down'); for (let i = 0; i < 5; i++) m.step();
    m.turn('left'); for (let i = 0; i < 6; i++) m.step();
    m.turn('up'); for (let i = 0; i < 3; i++) m.step();
  });
  await page.waitForTimeout(100); assert.equal((await state()).captures, 1); assert((await state()).owned > 45);
  assert.notEqual(await page.locator('#percent').innerText(), '2.9%');
  await page.evaluate(() => { window.scene.paused = false; window.scene.renderHud(); });
  await page.screenshot({ path: 'test-results/desktop-playing.png' });
  await page.evaluate(() => window.scene.model.fail('בדיקת פסילה'));
  await page.waitForTimeout(400); assert.equal((await state()).phase, 'recovering'); assert.equal((await state()).player.x, 4);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const recovering = await state(); await page.waitForTimeout(400); assert.deepEqual(await state(), recovering);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(800); assert.equal((await state()).phase, 'playing');
  await page.evaluate(() => { const m = window.scene.model; m.fail('בדיקת פסילה'); m.tick(1000); m.fail('בדיקת פסילה'); });
  await page.waitForTimeout(100); assert.equal((await state()).phase, 'lost'); assert.equal((await state()).lives, 0);
  assert.match(await page.locator('#overlay-title').innerText(), /היריבים ניצחו/);
  await page.getByRole('button', { name: 'עוד סיבוב' }).click(); assert.equal((await state()).lives, 3);
  await page.evaluate(() => { const m = window.scene.model; for (let i = 0; i < 565; i++) m.owned.add(i); m.trail = [{ x: 1, y: 23 }]; m.capture(); });
  await page.waitForTimeout(100); assert.equal((await state()).phase, 'won'); assert.match(await page.locator('#overlay-title').innerText(), /המגרש שלכם/);
  await page.screenshot({ path: 'test-results/desktop-win.png' });
  await page.getByRole('button', { name: 'משחק מחדש', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-results/mobile-start.png' });
  await page.getByRole('button', { name: 'מתחילים לשחק' }).click();
  await page.getByRole('button', { name: 'למטה', exact: true }).dispatchEvent('pointerdown'); await page.waitForTimeout(400);
  assert.equal((await state()).direction, 'down');
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size); await page.waitForTimeout(150);
    assert(await page.evaluate(() => {
      const canvas = document.querySelector('canvas').getBoundingClientRect();
      const controls = document.querySelector('footer').getBoundingClientRect();
      return canvas.top >= 0 && canvas.bottom <= innerHeight && canvas.left >= 0 && canvas.right <= innerWidth && controls.bottom <= innerHeight;
    }), `full board and footer visible at ${size.width}x${size.height}`);
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-results/mobile-playing.png' });
  let offline = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const offlineRequests = [], offlineErrors = [];
  offline.on('request', request => { if (/^https?:/.test(request.url())) offlineRequests.push(request.url()); });
  offline.on('pageerror', error => offlineErrors.push(error.message));
  try {
    await offline.goto(pathToFileURL(resolve('play.html')).href);
  } catch (error) {
    if (!String(error).includes('ERR_BLOCKED_BY_ADMINISTRATOR')) throw error;
    console.log('NOTE: this environment blocks file:// navigation. Testing the same standalone HTML inline with no network; direct file opening remains unverified here.');
    await offline.close();
    offline = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    offline.on('request', request => { if (/^https?:/.test(request.url())) offlineRequests.push(request.url()); });
    offline.on('pageerror', error => offlineErrors.push(error.message));
    await offline.setContent(await readFile('play.html', 'utf8'), { waitUntil: 'load' });
  }
  await offline.bringToFront();
  await offline.waitForSelector('canvas');
  await offline.getByRole('button', { name: 'מתחילים לשחק' }).click(); await offline.waitForTimeout(600);
  assert(await offline.locator('#overlay').evaluate(node => node.hidden));
  assert.equal(await offline.locator('#pause').isEnabled(), true);
  await offline.getByRole('button', { name: 'השהיה', exact: true }).click();
  assert(await offline.getByRole('button', { name: 'ממשיכים' }).isVisible());
  await offline.getByRole('button', { name: 'ממשיכים' }).click();
  assert(await offline.locator('#overlay').evaluate(node => node.hidden));
  assert.deepEqual(offlineRequests, [], 'offline export never requests the network');
  assert.deepEqual(offlineErrors, []);
  await offline.screenshot({ path: 'test-results/offline-playing.png' });
  await offline.close();
  assert.deepEqual(errors, []);
  console.log('PASS browser: start, automatic movement, turns/reversal, capture and HUD, pause, hidden-tab pause including recovery, life loss, game over, win/replay, restart, touch controls, desktop/mobile/landscape layout; standalone HTML launches without network requests; no JS errors.');
} finally {
  await browser?.close(); server.kill('SIGTERM');
}
