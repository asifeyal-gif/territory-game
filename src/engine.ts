export type Direction = 'left' | 'right' | 'up' | 'down';
export type Phase = 'ready' | 'playing' | 'recovering' | 'won' | 'lost';
export type Point = { x: number; y: number };
export const COLS = 36;
export const ROWS = 24;
export const TARGET = 65;
export const STEP_MS = 10000 / COLS;
export const vectors: Record<Direction, Point> = {
  left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
};
const opposite: Record<Direction, Direction> = { left: 'right', right: 'left', up: 'down', down: 'up' };
export const index = (p: Point): number => p.y * COLS + p.x;
export const inside = (p: Point): boolean => p.x >= 0 && p.x < COLS && p.y >= 0 && p.y < ROWS;
const spawn = (): Point => ({ x: 4, y: 12 });
export type Enemy = Point & { dx: number; dy: number };

export class TerritoryGame {
  owned = new Set<number>();
  trail: Point[] = [];
  player = spawn();
  previous = spawn();
  enemies: Enemy[] = [];
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
  reset(): void {
    this.owned.clear();
    for (let y = 10; y <= 14; y++) for (let x = 2; x <= 6; x++) this.owned.add(index({ x, y }));
    this.trail = [];
    this.player = spawn(); this.previous = spawn();
    this.enemies = [{ x: 25, y: 6, dx: 1, dy: 1 }, { x: 28, y: 18, dx: -1, dy: -1 }];
    this.direction = this.queued = 'right';
    this.phase = 'ready'; this.lives = 3; this.captures = 0;
    this.progress = this.recovery = this.enemyClock = 0;
    this.message = 'צאו מהבסיס וסגרו מסלול כדי לכבוש שטח.';
    this.revision++;
  }
  start(): void { if (this.phase === 'ready') { this.phase = 'playing'; this.revision++; } }
  turn(next: Direction): void {
    if (this.phase === 'playing' && next !== opposite[this.direction]) this.queued = next;
  }
  fail(message: string): void {
    if (this.phase !== 'playing') return;
    this.lives--;
    this.trail = [];
    this.player = spawn(); this.previous = spawn();
    this.direction = this.queued = 'right';
    this.progress = this.enemyClock = 0;
    this.recovery = 1000;
    this.phase = this.lives ? 'recovering' : 'lost';
    this.message = message;
    this.revision++;
  }
  tick(delta: number): void {
    if (this.phase === 'recovering') {
      this.recovery -= delta;
      if (this.recovery > 0) return;
      delta = -this.recovery;
      this.phase = 'playing'; this.message = 'חזרתם לבסיס. מתחילים מסלול חדש.'; this.revision++;
    }
    if (this.phase !== 'playing') return;
    // Advance to the next player/enemy event in time order, independent of frame rate.
    while (delta > 0 && this.phase === 'playing') {
      const duration = Math.max(0, Math.min(delta, STEP_MS - this.progress, this.enemyInterval - this.enemyClock));
      this.progress += duration; this.enemyClock += duration; delta -= duration;
      if (this.progress + 1e-7 >= STEP_MS) {
        this.progress = Math.max(0, this.progress - STEP_MS);
        this.step();
      }
      if (this.phase !== 'playing') return;
      const interval = this.enemyInterval;
      if (this.enemyClock + 1e-7 >= interval) {
        this.enemyClock = Math.max(0, this.enemyClock - interval);
        this.moveEnemies();
      }
    }
  }
  get enemyInterval(): number { return Math.max(150, 260 - this.percent); }

  step(): void {
    if (this.phase !== 'playing') return;
    this.direction = this.queued;
    const v = vectors[this.direction];
    const next = { x: this.player.x + v.x, y: this.player.y + v.y };
    if (!inside(next)) { this.fail('יצאתם מגבולות המגרש.'); return; }
    if (this.trail.some(p => index(p) === index(next))) { this.fail('נגעתם בשובל של עצמכם.'); return; }
    this.previous = { ...this.player }; this.player = next;
    if (this.owned.has(index(next))) {
      if (this.trail.length) this.capture();
    } else {
      this.trail.push({ ...next }); this.revision++;
      if (this.enemies.some(e => index(e) === index(next))) this.fail('היריב פגע בכם מחוץ לשטח הבטוח.');
    }
  }
  capture(): void {
    // Flood from every enemy. Anything disconnected by the new boundary becomes safe territory.
    const wall = new Set([...this.owned, ...this.trail.map(index)]);
    const reachable = new Set<number>();
    const queue: Point[] = [];
    for (const enemy of this.enemies) if (!wall.has(index(enemy))) {
      reachable.add(index(enemy)); queue.push(enemy);
    }
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i];
      for (const v of Object.values(vectors)) {
        const n = { x: p.x + v.x, y: p.y + v.y }; const id = index(n);
        if (inside(n) && !wall.has(id) && !reachable.has(id)) { reachable.add(id); queue.push(n); }
      }
    }
    const before = this.owned.size;
    for (let id = 0; id < COLS * ROWS; id++) if (!reachable.has(id)) this.owned.add(id);
    this.trail = []; this.captures++;
    this.message = `סגרתם מסלול! נוספו ${this.owned.size - before} משבצות לשטח שלכם.`;
    if (this.percent >= TARGET) { this.phase = 'won'; this.message = 'כל הכבוד! המגרש שלכם.'; }
    this.revision++;
  }
  moveEnemies(): void {
    for (const enemy of this.enemies) {
      const free = (x: number, y: number) => inside({ x, y }) && !this.owned.has(index({ x, y }));
      if (!free(enemy.x + enemy.dx, enemy.y)) enemy.dx *= -1;
      if (free(enemy.x + enemy.dx, enemy.y)) enemy.x += enemy.dx;
      if (this.hitEnemy(enemy)) return;
      if (!free(enemy.x, enemy.y + enemy.dy)) enemy.dy *= -1;
      if (free(enemy.x, enemy.y + enemy.dy)) enemy.y += enemy.dy;
      if (this.hitEnemy(enemy)) return;
    }
  }
  private hitEnemy(enemy: Enemy): boolean {
    if (this.trail.some(p => index(p) === index(enemy)) ||
        (index(enemy) === index(this.player) && !this.owned.has(index(this.player)))) {
      this.fail('היריב חתך את השובל. נסו מסלול קצר יותר.'); return true;
    }
    return false;
  }
}
