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
    return { player: m.player, direction: m.direction, queued: m.queued, phase: m.phase, lives: m.lives, owned: m.owned.size, captures: m.captures, progress: m.progress, recovery: m.recovery, enemyClock: m.enemyClock, enemies: m.enemies, rival: m.rival, rivalOwned: m.rivalOwned.size, rivalTrail: m.rivalTrail, rivalClock: m.rivalClock, rivalRecovery: m.rivalRecovery, rivalCaptures: m.rivalCaptures, visualTime: window.scene.arena3d?.time, level:m.level,trophies:m.trophies,score:m.score,combo:m.combo,shieldCharges:m.shieldCharges,shieldRemaining:m.shieldRemaining,rivalMode:m.rivalMode,rivalWarning:m.rivalWarning,reinforcement:m.reinforcement,reinforcementDelay:m.reinforcementDelay };
  });
  await mkdir('test-results', { recursive: true });
  await page.waitForSelector('canvas.arena-3d');
  await page.waitForTimeout(500);
  const threeColors = await page.evaluate(() => {
    const arena = window.scene.arena3d;
    arena.renderer.render(arena.scene,arena.camera);
    const gl = arena.renderer.getContext();
    const pixels = [];
    for (const [x,z] of [[-15.5,.5],[11.5,.5],[0,.5]]) {
      const point = arena.ships[0].position.clone().set(x,.75,z).project(arena.camera);
      const rgba = new Uint8Array(4);
      gl.readPixels(Math.floor((point.x+1)*gl.drawingBufferWidth/2), Math.floor((point.y+1)*gl.drawingBufferHeight/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
      pixels.push([...rgba]);
    }
    return pixels;
  });
  assert(threeColors[0][2] > threeColors[0][0], '3D player island is blue');
  assert(threeColors[1][0] > threeColors[1][2], '3D rival island is coral');
  assert(threeColors[2][2] > threeColors[2][0], '3D ocean remains visible');
  assert(await page.evaluate(() => {
    const arena=window.scene.arena3d;
    return [-18.4,18.4].every(x=>[-12.4,12.4].every(z=>{
      const p=arena.ships[0].position.clone().set(x,0,z).project(arena.camera);
      return Math.abs(p.x)<1 && Math.abs(p.y)<1;
    }));
  }), 'all four 3D arena corners fit the fixed camera');

  const sampleColors = async target => target.evaluate(async () => {
    const colors = [];
    for (const [x, y] of [[76, 268], [724, 268], [388, 316]]) {
      const color = await new Promise(resolve => window.testGame.renderer.snapshotPixel(x, y, resolve));
      colors.push({ r: color.r, g: color.g, b: color.b });
    }
    return colors;
  });
  const verifyColors = colors => {
    const [blue, red, neutral] = colors;
    assert(blue.b > blue.r * 1.3 && blue.g > blue.r, 'player land renders blue');
    assert(red.r > red.b * 1.2, 'CPU land renders coral');
    assert(neutral.r < 80 && neutral.g < 100 && neutral.b < 140, 'territory textures do not cover neutral land');
  };
  verifyColors(await sampleColors(page));
  await page.screenshot({ path: 'test-results/desktop-start.png' });
  await page.waitForTimeout(300); assert.equal((await state()).player.x, 4);
  await page.getByRole('button', { name: 'מתחילים לשחק' }).click();
  await page.waitForTimeout(1200);
  assert((await state()).player.x >= 7, 'automatic rightward movement');
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(100); assert.equal((await state()).queued, 'right');
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(350); assert.equal((await state()).direction, 'up');
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100); assert.equal((await state()).queued, 'up');
  assert.equal(await page.evaluate(() => scrollY), 0);
  await page.keyboard.press('KeyE');assert((await state()).shieldRemaining>0);assert.equal((await state()).shieldCharges,0);assert.match(await page.locator('#charges').innerText(),/פעיל/);
  await page.getByRole('button', { name: 'השהיה', exact: true }).click();
  assert(await page.locator('#overlay').evaluate(node=>node.hidden),'manual pause keeps the field visible');
  const paused = await state(); await page.waitForTimeout(400); assert.deepEqual(await state(), paused);
  await page.getByRole('button', { name: 'המשך', exact: true }).click();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hidden = await state(); await page.waitForTimeout(400); assert.deepEqual(await state(), hidden);
  assert(await page.locator('#overlay').evaluate(node=>node.hidden),'hidden tab freezes without an intrusive modal');
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
  // Let the actual AI plan, draw and close routes while the player circles safely in the base.
  await page.evaluate(() => {
    const s = window.scene; s.paused = true; const m = s.model; m.reset(); m.start();
    for (let round = 0; round < 40 && m.rivalCaptures < 2 && m.phase === 'playing'; round++) {
      for (const [direction, count] of [['right', 2], ['down', 2], ['left', 2], ['up', 2]]) {
        m.turn(direction); for (let i = 0; i < count; i++) m.tick(10000 / 36 + .00001);
      }
    }
    s.paused = false; s.renderHud();
  });
  await page.waitForTimeout(100);
  const duel = await state(); assert(duel.rivalCaptures >= 2); assert(duel.rivalOwned > 70);
  assert.equal(duel.lives, 3); assert.notEqual(await page.locator('#rival-percent').innerText(), '2.9%');
  await page.screenshot({ path: 'test-results/desktop-duel.png' });
  await page.evaluate(() => {
    const s = window.scene; s.paused = true; const m = s.model; m.reset(); m.start();
    for (let round = 0; round < 120 && m.phase === 'playing'; round++) for (const [direction, count] of [['right', 2], ['down', 2], ['left', 2], ['up', 2]]) {
      m.turn(direction); for (let i = 0; i < count && m.phase === 'playing'; i++) m.tick(10000 / 36 + .00001);
    }
    s.paused = false; s.renderHud();
  });
  await page.waitForTimeout(100); assert.equal((await state()).phase, 'lost'); assert.equal((await state()).lives, 3);
  assert.match(await page.locator('#overlay-title').innerText(), /המחשב הקדים/);
  await page.screenshot({ path: 'test-results/desktop-cpu-win.png' });
  await page.getByRole('button', { name: 'עוד סיבוב' }).click();
  assert.equal((await state()).rivalOwned, 25); assert.equal((await state()).rivalCaptures, 0);
  // Test the ability to cut the CPU's exposed trail in the running scene.
  await page.evaluate(() => {
    const m = window.scene.model; m.player = { x: 10, y: 12 }; m.previous = { ...m.player };
    m.direction = m.queued = 'right'; m.trail = []; m.rivalTrail = [{ x: 11, y: 12 }]; m.step();
  });
  await page.waitForTimeout(100); assert((await state()).rivalRecovery > 0); assert.equal((await state()).lives, 3);
  await page.getByRole('button', { name: 'משחק מחדש', exact: true }).click();
  await page.getByRole('button', { name: 'מתחילים לשחק' }).click();
  await page.evaluate(() => {
    const m = window.scene.model; m.rival = { x: 10, y: 12 }; m.rivalDirection = 'right';
    m.rivalPlan = [{ x: 11, y: 12 }, { x: 12, y: 12 }];
    m.player = { x: 14, y: 12 }; m.trail = [{ x: 11, y: 12 }]; m.moveRival();
  });
  await page.waitForTimeout(400); assert.equal((await state()).phase, 'recovering'); assert.equal((await state()).player.x, 4);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const recovering = await state(); await page.waitForTimeout(400); assert.deepEqual(await state(), recovering);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(800); assert.equal((await state()).phase, 'playing');
  await page.evaluate(() => { const m = window.scene.model; m.fail('בדיקת פסילה'); m.tick(1000); m.fail('בדיקת פסילה'); });
  await page.waitForTimeout(100); assert.equal((await state()).phase, 'lost'); assert.equal((await state()).lives, 0);
  assert.match(await page.locator('#overlay-title').innerText(), /נגמרו הלבבות/);
  await page.getByRole('button', { name: 'עוד סיבוב' }).click(); assert.equal((await state()).lives, 3);
  await page.evaluate(() => { const m = window.scene.model; for (let i = 0; m.owned.size < 565 && i < 864; i++) if (!m.rivalOwned.has(i) && !m.enemies.some(e => e.y * 36 + e.x === i)) m.owned.add(i); m.trail = [{ x: 1, y: 23 }]; m.capture(); });
  await page.waitForTimeout(100); assert.equal((await state()).phase, 'won'); assert.match(await page.locator('#overlay-title').innerText(), /ניצחתם את שלב/);
  await page.screenshot({ path: 'test-results/desktop-win.png' });
  assert.equal((await state()).trophies,1);assert.equal(await page.locator('#trophies').innerText(),'1');
  const wonScore=(await state()).score;
  await page.getByRole('button',{name:'לשלב 2'}).click();
  assert.equal((await state()).level,2);assert.equal((await state()).phase,'playing');assert.equal((await state()).score,wonScore);
  assert.match(await page.locator('#target-note').innerText(),/67%/);assert.equal((await state()).lives,3);
  await page.evaluate(()=>{const m=window.scene.model;for(let i=0;i<3;i++){m.fail('בדיקת שלב');if(i<2)m.tick(1000);}});
  await page.waitForTimeout(100);await page.getByRole('button',{name:'עוד סיבוב'}).click();
  assert.equal((await state()).level,2);assert.equal((await state()).trophies,1);

  await page.getByRole('button', { name: 'משחק מחדש', exact: true }).click();
  assert.equal((await state()).level,1);assert.equal((await state()).trophies,1);
  await page.reload();await page.bringToFront();
  await page.waitForFunction(()=>window.testGame?.scene.getScene('GameScene')?.model);
  await page.evaluate(()=>window.scene=window.testGame.scene.getScene('GameScene'));
  assert.equal((await state()).trophies,1,'trophy collection persists after reloading');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-results/mobile-start.png' });
  await page.getByRole('button', { name: 'מתחילים לשחק' }).click();
  assert.equal(await page.locator('#direction-controls').isVisible(),false,'swipe mode has no arrow pad by default');
  const touch=await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
  const boardBox=await page.locator('canvas.arena-3d').boundingBox();
  const finger={x:Math.round(boardBox.x+boardBox.width*.5),y:Math.round(boardBox.y+boardBox.height*.5),id:0};
  await page.evaluate(()=>document.querySelector('canvas.arena-3d').addEventListener('pointerdown',e=>window.swipePointer=e.pointerId,{once:true}));
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger]});
  finger.x+=24;await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[finger]});
  assert.equal((await state()).queued,'down','swipe acts before lifting the finger');
  await page.waitForFunction(()=>window.scene.model.direction==='down');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  assert.equal(await page.evaluate(()=>window.scene.inactive),false,'visible-page blur does not pause an iPhone gesture');
  assert(await page.locator('#overlay').evaluate(node=>node.hidden));
  finger.y-=24;await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[finger]});
  assert.equal((await state()).queued,'down','holding after a swipe does not create accidental extra turns');
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger]});
  finger.y-=24;await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[finger]});
  assert.equal((await state()).queued,'right','a new short swipe turns again');
  await page.waitForFunction(()=>window.scene.model.direction==='right');
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger]});
  finger.y+=24;await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[finger]});
  assert.equal((await state()).queued,'right','swipes cannot immediately reverse the player');
  await touch.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await page.locator('canvas.arena-3d').evaluate((canvas,p)=>canvas.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'touch',pointerId:window.swipePointer,isPrimary:true,clientX:p.x,clientY:p.y-30})),finger);
  assert.equal((await state()).queued,'right','cancelled gestures cannot turn later');
  assert.equal(await page.evaluate(()=>scrollY),0,'touch movement does not scroll the page');
  assert(await page.evaluate(()=>getComputedStyle(document.getElementById('game')).position==='fixed'),'game viewport is anchored');
  assert(await page.evaluate(()=>{
    const e=new TouchEvent('touchmove',{bubbles:true,cancelable:true});document.querySelector('footer').dispatchEvent(e);return e.defaultPrevented;
  }),'touch drags over HUD are prevented from panning Safari');

  await page.getByRole('button',{name:'משחק מחדש',exact:true}).click();
  await page.getByRole('button',{name:'מתחילים לשחק'}).click();
  await page.getByRole('button',{name:'הצג חצים'}).click();
  assert(await page.locator('#direction-controls').isVisible());
  await page.getByRole('button', { name: 'ימינה', exact: true }).dispatchEvent('pointerdown'); await page.waitForTimeout(400);
  assert.equal((await state()).direction, 'down');
  for (const size of [{ width: 390, height: 844 }, { width: 390, height: 667 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size); await page.waitForTimeout(150);
    assert(await page.evaluate(() => {
      const canvas = document.querySelector('canvas.arena-3d').getBoundingClientRect();
      const controls = document.querySelector('footer').getBoundingClientRect();
      return canvas.top >= 0 && canvas.bottom <= innerHeight && canvas.left >= 0 && canvas.right <= innerWidth && controls.bottom <= innerHeight;
    }), `full board and footer visible at ${size.width}x${size.height}`);
    assert(await page.evaluate(()=>{
      const a=window.scene.arena3d;
      const points=[[-18.4,-12.4],[-18.4,12.4],[18.4,-12.4],[18.4,12.4]].map(([x,z])=>a.ships[0].position.clone().set(x,0,z).project(a.camera));
      return points.every(p=>Math.abs(p.x)<1&&Math.abs(p.y)<1);
    }),'rotated phone camera still shows all four corners');

  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(150);
  await page.getByRole('button',{name:'הסתר חצים'}).click();
  assert.equal(await page.locator('#direction-controls').isVisible(),false);
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
  assert(await offline.locator('#overlay').evaluate(node=>node.hidden));
  await offline.getByRole('button', { name: 'המשך',exact:true }).click();
  assert(await offline.locator('#overlay').evaluate(node => node.hidden));
  assert.deepEqual(offlineRequests, [], 'offline export never requests the network');
  assert.deepEqual(offlineErrors, []);
  await offline.screenshot({ path: 'test-results/offline-playing.png' });
  await offline.close();
  const fallback = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const fallbackErrors = []; fallback.on('pageerror', error => fallbackErrors.push(error.message));
  await fallback.route('**/src/main.ts*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({ response, body: `${source}\nwindow.testGame = game;` });
  });
  await fallback.route('**/src/arena3d.ts*', route => route.fulfill({ contentType: 'text/javascript', body: 'export class Arena3D { constructor() { throw new Error("Simulated unavailable WebGL"); } }' }));
  await fallback.goto(base); await fallback.bringToFront();
  await fallback.waitForFunction(() => window.testGame?.scene.getScene('GameScene')?.model);
  assert.equal(await fallback.evaluate(() => window.testGame.renderer.type), 1, 'Canvas fallback is actually selected');
  assert.equal(await fallback.locator('#board').evaluate(board => board.classList.contains('has-3d')), false, 'unavailable 3D leaves visible 2D fallback');
  verifyColors(await sampleColors(fallback));
  await fallback.getByRole('button', { name: 'מתחילים לשחק' }).click(); await fallback.waitForTimeout(1000);
  assert(await fallback.evaluate(() => window.testGame.scene.getScene('GameScene').model.player.x >= 7));
  assert.deepEqual(fallbackErrors, []); await fallback.close();
  // Exercise the full lighting tier once, even when Chromium reports a software GPU.
  const quality = await browser.newPage({viewport:{width:1280,height:900}});
  const qualityErrors=[]; quality.on('pageerror',error=>qualityErrors.push(error.message));
  await quality.route('**/src/main.ts*',async route=>{
    const response=await route.fetch();await route.fulfill({response,body:`${await response.text()}\nwindow.testGame=game;`});
  });
  await quality.goto(base);await quality.bringToFront();
  await quality.waitForFunction(()=>window.testGame?.scene.getScene('GameScene')?.arena3d?.readyStarted);
  await quality.getByRole('button',{name:'מתחילים לשחק'}).click();
  const fullQuality=await quality.evaluate(()=>{
    const s=window.testGame.scene.getScene('GameScene'),m=s.model,a=s.arena3d;
    s.paused=true;m.reset();m.start();
    for(let round=0;round<40&&m.rivalCaptures<2&&m.phase==='playing';round++){
      for(const [direction,count] of [['right',2],['down',2],['left',2],['up',2]]){
        m.turn(direction);for(let n=0;n<count;n++)m.tick(10000/36+.00001);
      }
    }
    s.revision=m.revision;s.drawTerrain();s.renderHud();document.getElementById('overlay').hidden=true;
    a.renderer.setPixelRatio(1);a.renderer.shadowMap.enabled=true;a.renderer.shadowMap.needsUpdate=true;
    a.render(m,250,true);
    return {environment:!!a.scene.environment,shadow:a.scene.children.some(light=>light.isDirectionalLight&&light.shadow?.map),tiles:a.tiles.count,land:m.owned.size+m.rivalOwned.size};
  });
  assert(fullQuality.environment&&fullQuality.shadow,'full quality generates environment reflections and a shadow map');
  assert.equal(fullQuality.tiles,fullQuality.land,'only occupied terrain instances are drawn');
  await quality.screenshot({path:'test-results/desktop-quality.png'});
  assert.deepEqual(qualityErrors,[]);await quality.close();
  assert.deepEqual(errors, []);
  console.log('PASS browser: start, automatic movement, turns/reversal, blue/CPU capture and HUD, CPU victory, bidirectional trail cutting, 3D island/ocean colors, 2D fallback territory colors, pause, hidden-tab pause including recovery, life loss, game over, win/replay, restart, deliberate one-turn touch swipes, visible-page blur regression, unobstructed manual pause, portrait camera, cancellation, no reversal/scroll, optional arrow controls, desktop/mobile/landscape layout; standalone HTML launches without network requests; full lighting tier, compact terrain instances, shields, level progression, trophy rewards/reload; no JS errors.');
} finally {
  await browser?.close(); server.kill('SIGTERM');
}
