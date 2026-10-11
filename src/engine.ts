export type Direction = 'left' | 'right' | 'up' | 'down';
export type Phase = 'ready' | 'playing' | 'recovering' | 'won' | 'lost';
export type Point = { x: number; y: number };
export const COLS = 36;
export const ROWS = 24;
export const TARGET = 65;
export const STEP_MS = 10000 / COLS;
export const RIVAL_STEP_MS = 360;
export const vectors: Record<Direction, Point> = {
  left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
};
const opposite: Record<Direction, Direction> = { left: 'right', right: 'left', up: 'down', down: 'up' };
export const index = (p: Point): number => p.y * COLS + p.x;
export const inside = (p: Point): boolean => p.x >= 0 && p.x < COLS && p.y >= 0 && p.y < ROWS;
const spawn = (): Point => ({ x: 4, y: 12 });
const rivalSpawn = (): Point => ({ x: 31, y: 12 });
export type Enemy = Point & { dx: number; dy: number };
const base = (center: Point): Set<number> => {
  const cells = new Set<number>();
  for (let y = center.y - 2; y <= center.y + 2; y++) for (let x = center.x - 2; x <= center.x + 2; x++) cells.add(index({ x, y }));
  return cells;
};
export const PLAYER_BASE = base(spawn());
export const RIVAL_BASE = base(rivalSpawn());
const directionTo = (from: Point, to: Point): Direction => to.x > from.x ? 'right' : to.x < from.x ? 'left' : to.y > from.y ? 'down' : 'up';
const same = (a: Point, b: Point): boolean => index(a) === index(b);

export class TerritoryGame {
  owned = new Set<number>();
  rivalOwned = new Set<number>();
  trail: Point[] = [];
  rivalTrail: Point[] = [];
  trailOrigin = spawn();
  rivalTrailOrigin = rivalSpawn();
  player = spawn();
  previous = spawn();
  rival = rivalSpawn();
  rivalPrevious = rivalSpawn();
  rivalDirection: Direction = 'left';
  rivalPlan: Point[] = [];
  rivalClock = 0;
  rivalRecovery = 0;
  rivalCaptures = 0;
  rivalFailures = 0;
  enemies: Enemy[] = [];
  enemyPrevious: Point[] = [];
  direction: Direction = 'right';
  queued: Direction = 'right';
  phase: Phase = 'ready';
  lives = 3;
  captures = 0;
  revision = 0;
  message = '';
  progress = 0;
  recovery = 0;
  enemyClock = 0;
  constructor() { this.reset(); }
  get percent(): number { return this.owned.size / (COLS * ROWS) * 100; }
  get rivalPercent(): number { return this.rivalOwned.size / (COLS * ROWS) * 100; }
  reset(): void {
    this.owned = new Set(PLAYER_BASE); this.rivalOwned = new Set(RIVAL_BASE);
    this.trail = []; this.rivalTrail = []; this.rivalPlan = [];
    this.trailOrigin = spawn(); this.rivalTrailOrigin = rivalSpawn();
    this.player = spawn(); this.previous = spawn();
    this.rival = rivalSpawn(); this.rivalPrevious = rivalSpawn(); this.rivalDirection = 'left';
    this.enemies = [{ x: 25, y: 6, dx: 1, dy: 1 }, { x: 28, y: 18, dx: -1, dy: -1 }];
    this.enemyPrevious = this.enemies.map(e => ({ x: e.x, y: e.y }));
    this.direction = this.queued = 'right';
    this.phase = 'ready'; this.lives = 3; this.captures = this.rivalCaptures = this.rivalFailures = 0;
    this.progress = this.recovery = this.enemyClock = this.rivalClock = this.rivalRecovery = 0;
    this.message = 'סגרו מסלול בכחול. חתכו שובל אדום כדי לעצור את המחשב.';
    this.revision++;
  }
  start(): void { if (this.phase === 'ready') { this.phase = 'playing'; this.revision++; } }
  turn(next: Direction): void {
    if (this.phase === 'playing' && next !== opposite[this.direction]) this.queued = next;
  }
  fail(message: string): void {
    if (this.phase !== 'playing') return;
    this.lives--; this.trail = []; this.trailOrigin = spawn();
    this.player = spawn(); this.previous = spawn();
    this.direction = this.queued = 'right'; this.progress = 0;
    this.recovery = 1000; this.phase = this.lives ? 'recovering' : 'lost';
    this.message = message; this.revision++;
  }
  stunRival(): void {
    this.rivalTrail = []; this.rivalPlan = []; this.rivalTrailOrigin = rivalSpawn();
    this.rival = rivalSpawn(); this.rivalPrevious = rivalSpawn(); this.rivalDirection = 'left';
    this.rivalClock = 0; this.rivalRecovery = 1200; this.rivalFailures++;
    if (this.phase === 'playing') this.message = 'השובל האדום נחתך! המחשב חוזר לבסיס.'; this.revision++;
  }
  tick(delta: number): void {
    if (this.phase === 'recovering') {
      this.recovery -= delta;
      if (this.recovery > 0) return;
      delta = -this.recovery;
      this.phase = 'playing'; this.message = 'חזרתם לבסיס. מתחילים מסלול חדש.'; this.revision++;
    }
    if (this.phase !== 'playing') return;
    // Resolve player, CPU and hazard events in time order, independent of rendering frames.
    while (delta > 0 && this.phase === 'playing') {
      const duration = Math.max(0, Math.min(delta, STEP_MS - this.progress, this.enemyInterval - this.enemyClock, RIVAL_STEP_MS - this.rivalClock));
      this.progress += duration; this.enemyClock += duration; this.rivalClock += duration;
      this.rivalRecovery = Math.max(0, this.rivalRecovery - duration); delta -= duration;
      if (this.progress + 1e-7 >= STEP_MS) {
        this.progress = Math.max(0, this.progress - STEP_MS); this.step();
      }
      if (this.phase !== 'playing') return;
      if (this.rivalClock + 1e-7 >= RIVAL_STEP_MS) {
        this.rivalClock = Math.max(0, this.rivalClock - RIVAL_STEP_MS); this.moveRival();
      }
      if (this.phase !== 'playing') return;
      const interval = this.enemyInterval;
      if (this.enemyClock + 1e-7 >= interval) {
        this.enemyClock = Math.max(0, this.enemyClock - interval); this.moveEnemies();
      }
    }
  }
  get enemyInterval(): number { return Math.max(190, 300 - Math.max(this.percent, this.rivalPercent) * .7); }
  step(): void {
    if (this.phase !== 'playing') return;
    this.direction = this.queued;
    const v = vectors[this.direction];
    const next = { x: this.player.x + v.x, y: this.player.y + v.y };
    if (!inside(next)) { this.fail('יצאתם מגבולות המגרש.'); return; }
    if (this.trail.some(p => same(p, next))) { this.fail('נגעתם בשובל של עצמכם.'); return; }
    if (this.rivalTrail.some(p => same(p, next))) this.stunRival();
    this.previous = { ...this.player }; this.player = next;
    if (same(this.rival, next)) {
      if (this.owned.has(index(next))) this.stunRival();
      else { const safeRival = this.rivalOwned.has(index(next)); this.fail('התנגשתם במחשב מחוץ לשטח שלכם.'); if (!safeRival) this.stunRival(); return; }
    }
    if (this.owned.has(index(next))) {
      if (this.trail.length) this.capture();
    } else {
      if (!this.trail.length) this.trailOrigin = { ...this.previous };
      this.trail.push({ ...next }); this.revision++;
      if (this.enemies.some(e => same(e, next))) this.fail('נפגעתם ממוקש אנרגיה מחוץ לשטח הבטוח.');
    }
  }
  private enclosed(owner: Set<number>, trail: Point[], seeds: Point[], protectedBase: Set<number>): Set<number> {
    const wall = new Set([...owner, ...trail.map(index)]);
    const reachable = new Set<number>(); const queue: Point[] = [];
    for (const seed of [...seeds, ...Array.from(protectedBase, id => ({ x: id % COLS, y: Math.floor(id / COLS) }))]) {
      if (inside(seed) && !wall.has(index(seed)) && !reachable.has(index(seed))) { reachable.add(index(seed)); queue.push(seed); }
    }
    for (let i = 0; i < queue.length; i++) for (const v of Object.values(vectors)) {
      const n = { x: queue[i].x + v.x, y: queue[i].y + v.y }; const id = index(n);
      if (inside(n) && !wall.has(id) && !reachable.has(id)) { reachable.add(id); queue.push(n); }
    }
    const cells = new Set<number>();
    for (let id = 0; id < COLS * ROWS; id++) if (!reachable.has(id) && !protectedBase.has(id)) cells.add(id);
    return cells;
  }
  capture(): void {
    const before = this.owned.size;
    const cells = this.enclosed(this.owned, this.trail, [...this.enemies, this.rival], RIVAL_BASE);
    for (const id of cells) { this.owned.add(id); this.rivalOwned.delete(id); }
    // A closed capture can also cut the exposed opposing trail.
    if (this.rivalTrail.some(p => cells.has(index(p)))) this.stunRival();
    this.trail = []; this.captures++;
    this.message = `כיבוש מוצלח! נוספו ${this.owned.size - before} משבצות לכחול.`;
    if (this.percent >= TARGET) { this.phase = 'won'; this.message = 'ניצחתם בתחרות על המגרש!'; }
    this.revision++;
  }
  captureRival(): void {
    const before = this.rivalOwned.size;
    const cells = this.enclosed(this.rivalOwned, this.rivalTrail, [...this.enemies, this.player], PLAYER_BASE);
    for (const id of cells) { this.rivalOwned.add(id); this.owned.delete(id); }
    this.rivalTrail = []; this.rivalCaptures++;
    this.message = `המחשב סגר מסלול וכבש ${this.rivalOwned.size - before} משבצות. אפשר לחתוך את השובל שלו!`;
    if (this.trail.some(p => cells.has(index(p)))) { this.fail('המחשב כבש את השובל שלכם.'); }
    if (this.rivalPercent >= TARGET) { this.phase = 'lost'; this.message = 'המחשב הגיע ל־65% כיבוש לפני שהספקתם.'; }
    this.revision++;
  }
  moveRival(): void {
    if (this.phase !== 'playing' || this.rivalRecovery > 0) return;
    if (!this.rivalPlan.length) this.planRival();
    const next = this.rivalPlan.shift();
    if (!next) return;
    if (directionTo(this.rival, next) === opposite[this.rivalDirection] || !inside(next) || Math.abs(next.x - this.rival.x) + Math.abs(next.y - this.rival.y) !== 1 || this.rivalTrail.some(p => same(p, next))) { this.stunRival(); return; }
    if (this.trail.some(p => same(p, next))) this.fail('המחשב חתך את השובל שלכם.');
    if (same(next, this.player)) {
      if (this.owned.has(index(next))) { this.stunRival(); return; }
      this.fail('המחשב פגע בכם מחוץ לשטח הכחול.');
      if (!this.rivalOwned.has(index(next))) { this.stunRival(); return; }
    }
    this.rivalDirection = directionTo(this.rival, next);
    this.rivalPrevious = { ...this.rival }; this.rival = next;
    if (this.rivalOwned.has(index(next))) {
      if (this.rivalTrail.length) this.captureRival();
    } else {
      if (!this.rivalTrail.length) this.rivalTrailOrigin = { ...this.rivalPrevious };
      this.rivalTrail.push({ ...next });
      if (this.enemies.some(e => same(e, next))) { this.stunRival(); return; }
    }
    this.revision++;
  }
  private safeRoutes(): Map<number, Point[]> {
    // BFS over (cell, heading), so the CPU follows the same no-reversal rule as the player.
    const routes = new Map<number, Point[]>();
    const queue = [{ p: this.rival, direction: this.rivalDirection, path: [] as Point[] }];
    const visited = new Set<string>();
    for (let i = 0; i < queue.length; i++) {
      const { p, direction, path } = queue[i];
      if (!routes.has(index(p))) routes.set(index(p), path);
      for (const [nextDirection, v] of Object.entries(vectors) as [Direction, Point][]) {
        if (nextDirection === opposite[direction]) continue;
        const next = { x: p.x + v.x, y: p.y + v.y }; const key = `${index(next)}:${nextDirection}`;
        if (inside(next) && this.rivalOwned.has(index(next)) && !visited.has(key)) {
          visited.add(key); queue.push({ p: next, direction: nextDirection, path: [...path, next] });
        }
      }
    }
    return routes;
  }
  private returnToSafety(): Point[] {
    const queue = [{ p: this.rival, direction: this.rivalDirection, path: [] as Point[] }];
    const visited = new Set<string>(); const blocked = new Set(this.rivalTrail.map(index));
    for (let i = 0; i < queue.length; i++) {
      const { p, direction, path } = queue[i];
      if (path.length && this.rivalOwned.has(index(p))) return path;
      for (const [nextDirection, v] of Object.entries(vectors) as [Direction, Point][]) {
        const next = { x: p.x + v.x, y: p.y + v.y }; const key = `${index(next)}:${nextDirection}`;
        if (nextDirection !== opposite[direction] && inside(next) && !blocked.has(index(next)) && !visited.has(key)) {
          visited.add(key); queue.push({ p: next, direction: nextDirection, path: [...path, next] });
        }
      }
    }
    return [];
  }
  private planRival(): void {
    if (!this.rivalOwned.has(index(this.rival))) {
      this.rivalPlan = this.returnToSafety(); if (!this.rivalPlan.length) this.stunRival(); return;
    }
    const routes = this.safeRoutes();
    // Predict the moving hazards before selecting a route; short safe loops beat blind long ones.
    const prediction: Set<number>[] = [];
    const hazards = this.enemies.map(enemy => ({ ...enemy }));
    let hazardTime = this.enemyClock;
    const horizon = Math.max(...[...routes.values()].map(path => path.length), 0) + 29;
    const free = (p: Point) => inside(p) && !this.owned.has(index(p)) && !this.rivalOwned.has(index(p));
    for (let step = 0; step < horizon; step++) {
      const danger = new Set(hazards.map(index)); hazardTime += RIVAL_STEP_MS;
      while (hazardTime >= this.enemyInterval) {
        hazardTime -= this.enemyInterval;
        for (const hazard of hazards) {
          if (!free({ x: hazard.x + hazard.dx, y: hazard.y })) hazard.dx *= -1;
          if (free({ x: hazard.x + hazard.dx, y: hazard.y })) hazard.x += hazard.dx;
          danger.add(index(hazard));
          if (!free({ x: hazard.x, y: hazard.y + hazard.dy })) hazard.dy *= -1;
          if (free({ x: hazard.x, y: hazard.y + hazard.dy })) hazard.y += hazard.dy;
          danger.add(index(hazard));
        }
      }
      prediction.push(danger);
    }
    let best = -Infinity; let plan: Point[] = [];
    for (const [id, approach] of routes) {
      const anchor = { x: id % COLS, y: Math.floor(id / COLS) };
      if (Object.values(vectors).every(v => this.rivalOwned.has(index({ x: anchor.x + v.x, y: anchor.y + v.y })))) continue;
      for (const width of [3, 5, 7]) for (const height of [3, 5, 7]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const corner = { x: anchor.x + sx * width, y: anchor.y + sy * height };
        if (!inside(corner)) continue;
        const minX = Math.min(anchor.x, corner.x), maxX = Math.max(anchor.x, corner.x);
        const minY = Math.min(anchor.y, corner.y), maxY = Math.max(anchor.y, corner.y);
        const within = (p: Point) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
        if (this.enemies.some(within) || within(this.player)) continue;
        let gain = 0;
        for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
          const cell = index({ x, y });
          if (!this.rivalOwned.has(cell) && !PLAYER_BASE.has(cell)) gain += this.owned.has(cell) ? 1.35 : 1;
        }
        if (!gain) continue;
        for (const verticalFirst of [false, true]) {
          const directions: Direction[] = verticalFirst
            ? [sy > 0 ? 'down' : 'up', sx > 0 ? 'right' : 'left', sy > 0 ? 'up' : 'down', sx > 0 ? 'left' : 'right']
            : [sx > 0 ? 'right' : 'left', sy > 0 ? 'down' : 'up', sx > 0 ? 'left' : 'right', sy > 0 ? 'up' : 'down'];
          const heading = approach.length ? directionTo(approach.length > 1 ? approach[approach.length - 2] : this.rival, anchor) : this.rivalDirection;
          if (directions[0] === opposite[heading]) continue;
          const steps = verticalFirst ? [height, width, height, width] : [width, height, width, height];
          const loop: Point[] = []; let p = { ...anchor };
          for (let side = 0; side < 4; side++) for (let n = 0; n < steps[side]; n++) {
            const v = vectors[directions[side]]; p = { x: p.x + v.x, y: p.y + v.y }; loop.push(p);
          }
          if (loop.some(cell => PLAYER_BASE.has(index(cell)))) continue;
          const route = [...approach, ...loop]; let risk = 0; const exposed = new Set<number>();
          for (let step = 0; step < route.length; step++) {
            const cell = index(route[step]);
            if (this.rivalOwned.has(cell)) exposed.clear(); else exposed.add(cell);
            if ([...(prediction[step] || [])].some(danger => exposed.has(danger))) risk++;
          }
          const score = gain / route.length - risk * .75 - this.trail.filter(within).length * .03;
          if (score > best) { best = score; plan = [...approach, ...loop]; }
        }
      }
    }
    this.rivalPlan = plan;
    // When boxed in, patrol safe territory and reconsider as hazards/player move.
    if (!plan.length) for (const [direction, v] of Object.entries(vectors) as [Direction, Point][]) {
      const next = { x: this.rival.x + v.x, y: this.rival.y + v.y };
      if (direction !== opposite[this.rivalDirection] && inside(next) && this.rivalOwned.has(index(next))) { this.rivalPlan = [next]; break; }
    }
  }
  moveEnemies(): void {
    this.enemyPrevious = this.enemies.map(e => ({ x: e.x, y: e.y }));
    for (const enemy of this.enemies) {
      const free = (x: number, y: number) => inside({ x, y }) && !this.owned.has(index({ x, y })) && !this.rivalOwned.has(index({ x, y }));
      if (!free(enemy.x + enemy.dx, enemy.y)) enemy.dx *= -1;
      if (free(enemy.x + enemy.dx, enemy.y)) enemy.x += enemy.dx;
      if (this.hitEnemy(enemy)) return;
      if (!free(enemy.x, enemy.y + enemy.dy)) enemy.dy *= -1;
      if (free(enemy.x, enemy.y + enemy.dy)) enemy.y += enemy.dy;
      if (this.hitEnemy(enemy)) return;
    }
  }
  private hitEnemy(enemy: Enemy): boolean {
    if (this.rivalTrail.some(p => same(p, enemy)) || (same(enemy, this.rival) && !this.rivalOwned.has(index(this.rival)))) this.stunRival();
    if (this.trail.some(p => same(p, enemy)) || (same(enemy, this.player) && !this.owned.has(index(this.player)))) {
      this.fail('מוקש אנרגיה חתך את השובל. נסו מסלול קצר יותר.'); return true;
    }
    return false;
  }
}
