import test from 'node:test';
import assert from 'node:assert/strict';
import { TerritoryGame, index, STEP_MS, TARGET, COLS, ROWS } from '../src/engine.ts';

const playing = () => { const game = new TerritoryGame(); game.start(); return game; };

test('start gates movement; grid speed traverses 36 cells in ten seconds', () => {
  const game = new TerritoryGame(); game.tick(1000); assert.deepEqual(game.player, { x: 4, y: 12 });
  game.start(); game.tick(STEP_MS - 1); assert.equal(game.player.x, 4);
  game.tick(1); assert.equal(game.player.x, 5);
  assert.equal(STEP_MS * COLS, 10000);
});
test('turns apply at cell boundaries and rapid inputs cannot reverse direction', () => {
  const game = playing(); game.turn('up'); game.turn('left'); game.step();
  assert.equal(game.direction, 'up'); assert.deepEqual(game.player, { x: 4, y: 11 });
  game.turn('down'); game.step(); assert.equal(game.direction, 'up');
});
test('a closed loop captures its interior, preserves enemy regions, and clears the trail', () => {
  const game = playing(); game.enemies = [{ x: 30, y: 20, dx: 1, dy: 1 }];
  for (let i = 0; i < 6; i++) game.step();
  assert(game.trail.length > 0); const before = game.owned.size;
  game.turn('down'); for (let i = 0; i < 5; i++) game.step();
  game.turn('left'); for (let i = 0; i < 6; i++) game.step();
  game.turn('up'); for (let i = 0; i < 3; i++) game.step();
  assert(game.owned.size > before + 20);
  assert(game.owned.has(index({ x: 8, y: 15 })));
  assert(!game.owned.has(index(game.enemies[0])));
  assert.equal(game.trail.length, 0); assert.equal(game.captures, 1);
});
test('all enemy-connected regions remain neutral after a closure', () => {
  const game = playing(); game.owned.clear();
  for (let y = 0; y < ROWS; y++) game.owned.add(index({ x: 18, y }));
  game.enemies = [{ x: 5, y: 5, dx: 1, dy: 1 }, { x: 25, y: 5, dx: 1, dy: 1 }];
  game.trail = [{ x: 18, y: 0 }]; game.capture();
  assert.equal(game.owned.size, ROWS);
});
test('crossing own trail costs one life and keeps previously captured territory', () => {
  const game = playing(); game.player = { x: 12, y: 12 }; game.trail = [{ x: 13, y: 12 }];
  game.step(); assert.equal(game.lives, 2); assert.equal(game.phase, 'recovering');
  assert.equal(game.owned.size, 25); assert.equal(game.trail.length, 0);
  game.tick(999); assert.equal(game.phase, 'recovering'); assert.equal(game.player.x, 4);
  game.tick(1); assert.equal(game.phase, 'playing'); assert.equal(game.player.x, 4);
});
test('enemy hitting a trail fails; owned cells repel enemies', () => {
  const game = playing(); game.enemies = [{ x: 10, y: 3, dx: 1, dy: 1 }];
  game.trail = [{ x: 11, y: 3 }]; game.moveEnemies(); assert.equal(game.lives, 2);
  const safe = playing(); safe.enemies = [{ x: 7, y: 12, dx: -1, dy: 1 }];
  for (let i = 0; i < 100; i++) { safe.moveEnemies(); assert(!safe.owned.has(index(safe.enemies[0]))); }
});
test('three boundary failures end play; reset restores the entire round', () => {
  const game = playing();
  for (let i = 0; i < 3; i++) { game.player = { x: COLS - 1, y: 12 }; game.step(); if (i < 2) game.tick(1000); }
  assert.equal(game.phase, 'lost'); assert.equal(game.lives, 0);
  game.tick(10000); assert.equal(game.player.x, 4);
  game.reset(); assert.equal(game.phase, 'ready'); assert.equal(game.lives, 3);
  assert.equal(game.owned.size, 25); assert.equal(game.progress, 0); assert.equal(game.captures, 0);
  assert.deepEqual(game.enemies[0], { x: 25, y: 6, dx: 1, dy: 1 });
});
test('65 percent territory wins and no movement occurs after victory', () => {
  const game = playing();
  for (let i = 0; i < Math.ceil(COLS * ROWS * TARGET / 100); i++) game.owned.add(i);
  game.trail = [{ x: 1, y: 23 }]; game.capture(); assert.equal(game.phase, 'won');
  const player = { ...game.player }; game.tick(1000); assert.deepEqual(game.player, player);
});

test('a complete round can be won against both moving enemies without changing the board or losing lives', () => {
  const game = playing();
  const loops = [
    [['right', 8], ['up', 8], ['left', 8], ['down', 8]],
    [['down', 8], ['right', 12], ['up', 8], ['left', 12]],
    [['up', 8], ['right', 20], ['down', 8], ['left', 20]],
    [['up', 12], ['right', 20], ['down', 12], ['left', 20]],
    [['down', 8], ['right', 30], ['up', 8], ['left', 30]],
    [['up', 12], ['right', 30], ['down', 12], ['left', 30]],
  ] as const;
  for (const loop of loops) for (const [direction, count] of loop) {
    if (game.phase === 'won') break;
    game.turn(direction);
    for (let frame = 0; frame < count * 5 && game.phase === 'playing'; frame++) game.tick((STEP_MS + .00001) / 5);
    assert.equal(game.lives, 3);
  }
  assert.equal(game.phase, 'won'); assert(game.percent >= TARGET);
  assert(game.captures >= 6);
});

test('player and enemy simulation give the same result across different frame sizes', () => {
  const large = playing(), small = playing();
  large.tick(2000); for (let i = 0; i < 40; i++) small.tick(50);
  assert.deepEqual(large.player, small.player);
  assert.deepEqual(large.enemies, small.enemies);
  assert.deepEqual(large.trail, small.trail);
  assert.equal(large.lives, small.lives);
  assert(Math.abs(large.progress - small.progress) < .0001);
  assert(Math.abs(large.enemyClock - small.enemyClock) < .0001);
});
