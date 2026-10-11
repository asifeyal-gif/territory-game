import test from 'node:test';
import assert from 'node:assert/strict';
import { TerritoryGame, index, STEP_MS, TARGET, COLS, ROWS, PLAYER_BASE, RIVAL_BASE } from '../src/engine.ts';

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
  for (let i = 0; game.owned.size < 565 && i < COLS * ROWS; i++) if (!game.rivalOwned.has(i) && !game.enemies.some(e => index(e) === i)) game.owned.add(i);
  game.trail = [{ x: 1, y: 23 }]; game.capture(); assert.equal(game.phase, 'won');
  const player = { ...game.player }; game.tick(1000); assert.deepEqual(game.player, player);
});

test('the relaxed duel preserves a complete successful capture route', () => {
  const game = new TerritoryGame('relaxed');game.start();
  const loops = [
    [['right', 12], ['up', 12], ['left', 12], ['down', 12]],
    [['down', 8], ['right', 12], ['up', 8], ['left', 12]],
    [['down', 11], ['right', 12], ['up', 11], ['left', 12]],
    [['down', 11], ['right', 25], ['up', 11], ['left', 25]],
    [['down', 5], ['right', 30], ['up', 5], ['left', 30]],
  ] as const;
  for (const loop of loops) for (const [direction, count] of loop) {
    if (game.phase === 'won') break;
    game.turn(direction);
    for (let frame = 0; frame < count * 5 && game.phase === 'playing'; frame++) game.tick((STEP_MS + .00001) / 5);
    assert.equal(game.lives, 3);
  }
  assert.equal(game.phase, 'won'); assert(game.percent >= TARGET);
  assert(game.captures >= 5); assert(game.rivalCaptures > 0);
});

test('player and enemy simulation give the same result across different frame sizes', () => {
  const large = playing(), small = playing();
  large.tick(2000); for (let i = 0; i < 40; i++) small.tick(50);
  assert.deepEqual(large.player, small.player);
  assert.deepEqual(large.enemies, small.enemies);
  assert.deepEqual(large.rival, small.rival);
  assert.deepEqual(large.rivalPlan, small.rivalPlan);
  assert.deepEqual(large.trail, small.trail);
  assert.equal(large.lives, small.lives);
  assert(Math.abs(large.progress - small.progress) < .0001);
  assert(Math.abs(large.enemyClock - small.enemyClock) < .0001);
});

test('the CPU draws closed routes, gains territory and can win while a safe player stays in the base', () => {
  const game = playing();
  for (let round = 0; round < 150 && game.phase === 'playing'; round++) {
    for (const [direction, count] of [['right', 2], ['down', 2], ['left', 2], ['up', 2]] as const) {
      game.turn(direction);
      for (let i = 0; i < count && game.phase === 'playing'; i++) {
        game.tick(STEP_MS + .00001);
        for (const id of game.owned) assert(!game.rivalOwned.has(id), 'ownership is exclusive');
        for (const id of PLAYER_BASE) assert(game.owned.has(id), 'player base remains safe');
        for (const id of RIVAL_BASE) assert(game.rivalOwned.has(id), 'CPU base remains safe');
        for (const enemy of game.enemies) assert(!game.owned.has(index(enemy)) && !game.rivalOwned.has(index(enemy)), 'hazards stay in neutral territory');
      }
    }
  }
  assert.equal(game.phase, 'lost'); assert(game.rivalPercent >= TARGET);
  assert(game.rivalCaptures >= 5); assert.equal(game.lives, 3);
  const rival = { ...game.rival }; game.tick(5000); assert.deepEqual(game.rival, rival);
});

test('cutting the CPU trail sends it to its base, erases its route and allows recovery without losing a player life', () => {
  const game = playing(); game.player = { x: 10, y: 12 }; game.previous = { ...game.player };
  game.rivalTrail = [{ x: 11, y: 12 }]; game.rival = { x: 12, y: 12 };
  game.rivalPlan = [{ x: 12, y: 13 }]; game.step();
  assert.equal(game.rivalFailures, 1); assert.deepEqual(game.rival, { x: 31, y: 12 });
  assert.equal(game.rivalTrail.length, 0); assert.equal(game.rivalPlan.length, 0);
  assert.equal(game.lives, 3); assert.equal(game.rivalOwned.size, 25); assert(game.rivalRecovery > 0);
  game.moveRival(); assert.deepEqual(game.rival, { x: 31, y: 12 });
});

test('the CPU cuts the blue trail, commits its step and continues its route after player recovery', () => {
  const game = playing(); game.rival = { x: 10, y: 12 }; game.rivalDirection = 'right';
  game.rivalPlan = [{ x: 11, y: 12 }, { x: 12, y: 12 }];
  game.player = { x: 14, y: 12 }; game.trail = [{ x: 11, y: 12 }];
  game.moveRival(); assert.equal(game.lives, 2); assert.equal(game.phase, 'recovering');
  assert.equal(game.trail.length, 0); assert.deepEqual(game.rival, { x: 11, y: 12 });
  game.tick(1000); game.moveRival(); assert.deepEqual(game.rival, { x: 12, y: 12 });
  assert.equal(game.rivalFailures, 0);
});

test('each actor is protected inside its own territory during a head collision', () => {
  const blue = playing(); blue.rival = { x: 5, y: 12 }; blue.rivalDirection = 'left'; blue.rivalPlan = [{ x: 4, y: 12 }];
  blue.moveRival(); assert.equal(blue.lives, 3); assert.equal(blue.rivalFailures, 1);
  const red = playing(); red.player = { x: 30, y: 12 }; red.rival = { x: 31, y: 12 };
  red.step(); assert.equal(red.lives, 2); assert.equal(red.rivalFailures, 0);
});

test('both sides can steal enclosed opposing territory while bases stay protected', () => {
  const blue = playing(); const stolenRed = index({ x: 8, y: 15 }); blue.rivalOwned.add(stolenRed);
  for (let i = 0; i < 6; i++) blue.step();
  blue.turn('down'); for (let i = 0; i < 5; i++) blue.step();
  blue.turn('left'); for (let i = 0; i < 6; i++) blue.step();
  blue.turn('up'); for (let i = 0; i < 3; i++) blue.step();
  assert(blue.owned.has(stolenRed)); assert(!blue.rivalOwned.has(stolenRed));
  for (const id of RIVAL_BASE) assert(blue.rivalOwned.has(id));
  const red = playing(); const stolenBlue = index({ x: 24, y: 12 }); red.owned.add(stolenBlue);
  red.rivalTrail = [];
  for (let x = 20; x <= 29; x++) { red.rivalTrail.push({ x, y: 10 }); red.rivalTrail.push({ x, y: 15 }); }
  for (let y = 11; y < 15; y++) { red.rivalTrail.push({ x: 20, y }); red.rivalTrail.push({ x: 29, y }); }
  red.captureRival(); assert(red.rivalOwned.has(stolenBlue)); assert(!red.owned.has(stolenBlue));
  for (const id of PLAYER_BASE) assert(red.owned.has(id));
});

test('neutral hazards can also cut the red trail, and restarting clears all CPU state', () => {
  const game = playing(); game.enemies = [{ x: 10, y: 3, dx: 1, dy: 1 }];
  game.rivalTrail = [{ x: 11, y: 3 }]; game.moveEnemies();
  assert.equal(game.rivalFailures, 1); assert.equal(game.lives, 3);
  game.reset(); assert.equal(game.rivalRecovery, 0); assert.equal(game.rivalClock, 0);
  assert.equal(game.rivalFailures, 0); assert.equal(game.rivalCaptures, 0);
  assert.equal(game.rivalOwned.size, 25); assert.equal(game.rivalTrail.length, 0); assert.equal(game.rivalPlan.length, 0);
});

test('a head-on collision in neutral territory penalizes both sides fairly', () => {
  const game = playing(); game.player = { x: 12, y: 12 }; game.rival = { x: 13, y: 12 };
  game.step(); assert.equal(game.lives, 2); assert.equal(game.rivalFailures, 1);
  assert.equal(game.phase, 'recovering'); assert.deepEqual(game.rival, { x: 31, y: 12 });
  assert.match(game.message, /התנגשתם/);
});

test('victory awards exactly one trophy and opens a harder fresh level with cumulative score', () => {
  const game=playing();const originalInterval=game.rivalInterval;
  for(let id=0;game.owned.size<565&&id<COLS*ROWS;id++)if(!game.rivalOwned.has(id)&&!game.enemies.some(e=>index(e)===id))game.owned.add(id);
  game.trail=[{x:1,y:23}];game.capture();assert.equal(game.trophies,1);assert.equal(game.phase,'won');
  game.capture();assert.equal(game.trophies,1,'duplicate capture cannot award another trophy');
  const score=game.score;assert(game.nextLevel());assert.equal(game.level,2);assert.equal(game.target,67);
  assert.equal(game.phase,'playing');assert.equal(game.lives,3);assert.equal(game.owned.size,25);assert.equal(game.score,score);assert(game.rivalInterval<originalInterval);
  assert(!game.nextLevel());game.fail('בדיקה');game.tick(1000);game.fail('בדיקה');game.tick(1000);game.fail('בדיקה');
  assert.equal(game.phase,'lost');game.reset();assert.equal(game.level,2);assert.equal(game.score,score);assert.equal(game.trophies,1);
  game.restartCampaign();assert.equal(game.level,1);assert.equal(game.score,0);assert.equal(game.trophies,1,'earned trophy collection survives a new campaign');
});
test('a shield protects an exposed trail for three seconds and does not protect against boundaries', () => {
  const game=playing();game.trail=[{x:11,y:3}];game.enemies=[{x:10,y:3,dx:1,dy:1}];
  assert(game.activateShield());assert.equal(game.shieldCharges,0);assert(!game.activateShield());
  game.moveEnemies();assert.equal(game.lives,3);assert.equal(game.trail.length,1);
  const paused=game.shieldRemaining;game.phase='recovering';game.recovery=1000;game.tick(999);assert.equal(game.shieldRemaining,paused);
  game.phase='playing';game.trail=[];game.rivalRecovery=5000;game.tick(3000);assert.equal(game.shieldRemaining,0);
  game.shieldCharges=1;assert(game.activateShield());game.player={x:35,y:12};game.direction=game.queued='right';game.step();assert.equal(game.lives,2);
});
test('CPU telegraphs a reachable trail hunt, follows legal steps and abandons it when the trail is protected', () => {
  const game=playing();game.enemies=[];game.rival={x:15,y:12};game.rivalPrevious={...game.rival};game.rivalDirection='left';
  game.player={x:9,y:8};game.trail=Array.from({length:6},(_,n)=>({x:9,y:9+n}));
  const before={...game.rival};game.moveRival();assert.equal(game.rivalMode,'hunt');assert(game.rivalWarning>0);assert.deepEqual(game.rival,before,'warning gives a reaction window');
  game.rivalWarning=0;game.moveRival();assert.equal(Math.abs(game.rival.x-before.x)+Math.abs(game.rival.y-before.y),1);
  assert(game.activateShield());game.moveRival();assert.notEqual(game.rivalMode,'hunt');assert.equal(game.lives,3);
});
test('reinforcements are announced, avoid safe land and heads, and higher levels start with more hazards', () => {
  const game=playing();game.rivalRecovery=10000;
  for(let id=0;game.owned.size<310&&id<COLS*ROWS;id++)if(!game.rivalOwned.has(id)&&!game.enemies.some(e=>index(e)===id))game.owned.add(id);
  game.tick(1);assert(game.reinforcement);assert.equal(game.enemies.length,2);assert(game.reinforcementDelay>1400);
  const warning={...game.reinforcement};game.tick(1499);assert.equal(game.enemies.length,3);assert(!game.owned.has(index(warning)));assert.equal(game.reinforcement,undefined);
  game.level=5;game.reset();assert.equal(game.enemies.length,4);assert.equal(game.target,73);
});
test('consecutive successful captures multiply score and recharge shields; a failure breaks the chain', () => {
  const game=playing();game.shieldCharges=0;game.enemies=[];
  for(let n=0;n<3;n++){
    // Each explicit boundary closes a real 2x3 neutral rectangle.
    const x=9+n*4;game.trail=[];
    for(let y=2;y<=5;y++){game.trail.push({x,y});game.trail.push({x:x+2,y});}
    game.trail.push({x:x+1,y:2},{x:x+1,y:5});game.capture();
  }
  assert.equal(game.combo,3);assert.equal(game.shieldCharges,1);assert(game.score>360);
  game.fail('בדיקה');assert.equal(game.combo,0);assert(game.score>0);
});
test('shield expiry and reinforcement timing remain identical across different frame sizes', () => {
  const setup=()=>{const g=playing();g.rivalRecovery=10000;for(let id=0;g.owned.size<310&&id<COLS*ROWS;id++)if(!g.rivalOwned.has(id)&&!g.enemies.some(e=>index(e)===id))g.owned.add(id);g.activateShield();return g;};
  const large=setup(),small=setup();large.tick(3000);for(let n=0;n<60;n++)small.tick(50);
  assert.deepEqual(large.enemies,small.enemies);assert.deepEqual(large.player,small.player);assert(Math.abs(large.shieldRemaining-small.shieldRemaining)<.0001);assert(large.shieldRemaining<.0001);
  assert.equal(large.enemies.length,3);assert.equal(large.reinforcement,undefined);
});
test('a competitive campaign level is winnable through legal movement and timely shields against a hunting CPU', () => {
  const game=playing();let shields=0,hunts=0;
  const routes=[
    [['right',12],['up',11],['left',12],['down',11]],
    [['down',11],['right',12],['up',11],['left',12]],
    [['up',3],['right',22],['down',3],['left',22]],
    [['down',5],['right',22],['up',5],['left',22]],
    [['down',11],['right',22],['up',11],['left',22]],
    [['down',1],['right',14],['down',5],['right',11],['up',11],['left',11],['down',11]],
    [['right',5],['up',7],['right',1],['down',1],['right',11],['down',5],['left',11],['up',5]],
  ] as const;
  const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  for(const route of routes)for(const [direction,count] of route){
    if(game.phase==='won')break;game.turn(direction);
    for(let frame=0;frame<count*5&&game.phase==='playing';frame++){
      if(game.trail.some(p=>game.enemies.some(e=>distance(e,p)<=2)||(game.rivalMode==='hunt'&&distance(game.rival,p)<=4))&&game.activateShield())shields++;
      game.tick((STEP_MS+.00001)/5);if(game.rivalMode==='hunt')hunts++;
    }
    assert.equal(game.lives,3);
  }
  assert.equal(game.phase,'won');assert(game.percent>=game.target);assert.equal(game.trophies,1);
  assert(hunts>0);assert(shields>0);assert(game.rivalCaptures>0);assert.equal(game.enemies.length,3);
  assert(game.nextLevel());assert.equal(game.level,2);assert.equal(game.owned.size,25);assert(game.score>1000);
});
