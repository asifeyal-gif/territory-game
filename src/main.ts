import Phaser from 'phaser';
import { TerritoryGame, COLS, ROWS, TARGET, STEP_MS, index, vectors, type Direction } from './engine';
import './style.css';

const root = document.querySelector<HTMLDivElement>('#game')!;
root.innerHTML = `
<main class="shell" dir="rtl">
  <header class="topbar"><div class="brand"><span class="brand-icon">◈</span><div><h1>טריטוריה<span> TERRITORY</span></h1><p>צעד קטן. שטח גדול.</p></div></div><button id="sound" class="icon-button" aria-label="הפעל צלילים" aria-pressed="false">♪</button></header>
  <section class="dashboard" aria-label="מצב המשחק">
    <div class="territory-stat"><div class="stat-line"><span>השטח שלכם</span><strong id="percent">0%</strong></div><div class="progress"><div id="progress"></div><span class="target-mark"></span></div><small>יעד ניצחון: ${TARGET}% מהמגרש</small></div>
    <div class="stat"><span>חיים</span><div id="lives" class="lives" role="img"></div></div>
    <div class="stat record"><span>השיא שלכם</span><strong id="best">0%</strong></div>
  </section>
  <section class="arena"><div class="arena-top"><span><i class="dot"></i> השטח הכחול בטוח</span><span class="enemy-legend"><i class="dot"></i> היריבים חותכים שובל</span></div>
    <div id="board" aria-label="מגרש המשחק"><div id="overlay" class="overlay"><div class="overlay-card"><span id="eyebrow">כובשים בדרך שלכם</span><h2 id="overlay-title">כל מסלול הוא הזדמנות.</h2><p id="overlay-description">צאו מהשטח הכחול, צרו מסלול וחזרו אליו.<br>השטח שסגרתם הופך לשלכם. היזהרו מהיריבים!</p><button id="start" class="primary">מתחילים לשחק <span>←</span></button><p class="overlay-note">3 לבבות · חצים או WASD · יעד ${TARGET}%</p></div></div></div>
  </section>
  <footer><div><p id="status" role="status" aria-live="polite">מוכנים לכבוש את המגרש?</p><p class="hint">חזרו לכחול כדי לסגור מסלול · אל תחצו את השובל שלכם · אין סיבוב לאחור</p></div><div class="actions"><button id="pause" class="secondary" disabled>השהיה</button><button id="restart" class="secondary">משחק מחדש</button></div></footer>
  <nav class="touch-controls" aria-label="כיווני תנועה"><button data-direction="left" aria-label="שמאלה">←</button><div><button data-direction="up" aria-label="למעלה">↑</button><button data-direction="down" aria-label="למטה">↓</button></div><button data-direction="right" aria-label="ימינה">→</button></nav>
</main>`;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const startButton = element<HTMLButtonElement>('start');
const pauseButton = element<HTMLButtonElement>('pause');
const overlay = element<HTMLDivElement>('overlay');
const soundButton = element<HTMLButtonElement>('sound');
const CELL = 24, PAD = 16;

class GameScene extends Phaser.Scene {
  model = new TerritoryGame();
  private terrain!: Phaser.GameObjects.Graphics;
  private actors!: Phaser.GameObjects.Graphics;
  private revision = -1;
  private paused = false;
  private inactive = document.hidden || !document.hasFocus();
  private best = 0;
  private audioEnabled = false;
  private audio?: AudioContext;
  constructor() { super('GameScene'); }
  create(): void {
    try { this.best = Number(localStorage.getItem('territory-best')) || 0; } catch { /* Storage can be unavailable. */ }
    this.terrain = this.add.graphics(); this.actors = this.add.graphics();
    this.input.keyboard!.addCapture(['UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE']);
    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
      const mapping: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' };
      const direction = mapping[event.key] || mapping[event.key.toLowerCase()];
      if (direction) this.turn(direction);
      if (event.code === 'Space' && !event.repeat) { event.preventDefault(); if (this.model.phase === 'ready') this.start(); else this.togglePause(); }
    });
    startButton.onclick = () => this.start();
    element<HTMLButtonElement>('restart').onclick = () => { this.model.reset(); this.paused = false; this.revision = -1; this.renderHud(); };
    pauseButton.onclick = () => this.togglePause();
    soundButton.onclick = () => { this.audioEnabled = !this.audioEnabled; soundButton.setAttribute('aria-pressed', String(this.audioEnabled)); soundButton.setAttribute('aria-label', this.audioEnabled ? 'כבה צלילים' : 'הפעל צלילים'); if (this.audioEnabled) this.beep(440); };
    document.querySelectorAll<HTMLButtonElement>('[data-direction]').forEach(button => {
      button.onpointerdown = event => { event.preventDefault(); this.turn(button.dataset.direction as Direction); };
    });
    let touchStart: { x: number; y: number } | undefined;
    const board = element<HTMLDivElement>('board');
    board.onpointerdown = event => { if (!(event.target instanceof HTMLCanvasElement)) return; touchStart = { x: event.clientX, y: event.clientY }; };
    board.onpointerup = event => {
      if (!touchStart) return;
      const dx = event.clientX - touchStart.x, dy = event.clientY - touchStart.y; touchStart = undefined;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return;
      this.turn(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up');
    };
    const sync = () => { this.inactive = document.hidden || !document.hasFocus(); this.renderHud(); };
    document.addEventListener('visibilitychange', sync); window.addEventListener('blur', sync); window.addEventListener('focus', sync);
    this.events.once('shutdown', () => { document.removeEventListener('visibilitychange', sync); window.removeEventListener('blur', sync); window.removeEventListener('focus', sync); });
    this.renderHud();
  }
  private turn(direction: Direction): void { if (!this.paused && !this.inactive) this.model.turn(direction); }
  private start(): void {
    if (this.model.phase === 'won' || this.model.phase === 'lost') this.model.reset();
    this.paused = false; this.model.start(); this.beep(520); this.renderHud();
  }
  private togglePause(): void {
    if (!['playing', 'recovering'].includes(this.model.phase)) return;
    this.paused = !this.paused; this.renderHud();
  }
  private beep(frequency: number): void {
    if (!this.audioEnabled) return;
    try {
      this.audio ??= new AudioContext(); void this.audio.resume();
      const oscillator = this.audio.createOscillator(), gain = this.audio.createGain();
      oscillator.connect(gain); gain.connect(this.audio.destination); oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.06, this.audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, this.audio.currentTime + .15);
      oscillator.start(); oscillator.stop(this.audio.currentTime + .16);
    } catch { /* Audio is optional. */ }
  }
  private renderHud(): void {
    const m = this.model;
    element('percent').textContent = `${m.percent.toFixed(1)}%`;
    element('progress').style.width = `${Math.min(100, m.percent / TARGET * 100)}%`;
    if (m.percent > this.best) { this.best = m.percent; try { localStorage.setItem('territory-best', String(this.best)); } catch { /* Optional storage. */ } }
    element('best').textContent = `${this.best.toFixed(1)}%`;
    element('lives').innerHTML = Array.from({ length: 3 }, (_, i) => `<span class="${i < m.lives ? '' : 'lost'}" aria-hidden="true">♥</span>`).join('');
    element('lives').setAttribute('aria-label', `${m.lives} מתוך 3 לבבות`);
    const finished = m.phase === 'won' || m.phase === 'lost';
    overlay.hidden = !(m.phase === 'ready' || finished || this.paused || this.inactive);
    startButton.hidden = this.inactive && m.phase !== 'ready' && !finished;
    pauseButton.disabled = !['playing', 'recovering'].includes(m.phase);
    pauseButton.textContent = this.paused ? 'המשך' : 'השהיה';
    element('eyebrow').textContent = finished ? m.phase === 'won' ? 'המשימה הושלמה' : 'כל מסלול מלמד משהו' : 'כובשים בדרך שלכם';
    element('overlay-title').textContent = finished ? m.phase === 'won' ? 'המגרש שלכם!' : 'הפעם היריבים ניצחו.' : this.paused || this.inactive ? 'לוקחים נשימה.' : 'כל מסלול הוא הזדמנות.';
    element('overlay-description').textContent = finished ? `כבשתם ${m.percent.toFixed(1)}% מהמגרש ב־${m.captures} מסלולים. מוכנים לסיבוב נוסף?` : this.paused ? 'לחצו על ממשיכים או על מקש רווח כדי לחזור למשחק.' : this.inactive ? 'המשחק נעצר אוטומטית. חזרו ללשונית כדי להמשיך.' : 'צאו מהשטח הכחול, צרו מסלול וחזרו אליו. השטח שסגרתם הופך לשלכם. היזהרו מהיריבים!';
    startButton.textContent = finished ? 'עוד סיבוב ←' : this.paused ? 'ממשיכים ←' : 'מתחילים לשחק ←';
    element('status').textContent = m.phase === 'recovering' ? `${m.message} חוזרים לבסיס בעוד שנייה.` : m.phase === 'ready' ? 'מוכנים לכבוש את המגרש?' : this.paused || this.inactive ? 'המשחק מושהה.' : m.message;
  }
  private drawTerrain(): void {
    const g = this.terrain; g.clear();
    g.fillStyle(0x0e1b2d).fillRoundedRect(0, 0, COLS * CELL + PAD * 2, ROWS * CELL + PAD * 2, 12);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const owned = this.model.owned.has(index({ x, y }));
      g.fillStyle(owned ? (x + y) % 2 ? 0x176c92 : 0x19789e : (x + y) % 2 ? 0x14253a : 0x16283f);
      g.fillRect(PAD + x * CELL + 1, PAD + y * CELL + 1, CELL - 2, CELL - 2);
    }
    g.lineStyle(2, 0x3b5d7c).strokeRect(PAD, PAD, COLS * CELL, ROWS * CELL);
    g.lineStyle(2, 0x6fdcf7, .8).strokeRoundedRect(PAD + 2 * CELL + 2, PAD + 10 * CELL + 2, 5 * CELL - 4, 5 * CELL - 4, 8);
  }
  update(_time: number, delta: number): void {
    const lives = this.model.lives, captures = this.model.captures;
    if (!this.paused && !this.inactive) this.model.tick(Math.min(delta, 100));
    if (lives !== this.model.lives) { this.beep(140); this.cameras.main.shake(130, .003); }
    if (captures !== this.model.captures) { this.beep(740); this.cameras.main.flash(130, 50, 140, 180, false); }
    if (this.revision !== this.model.revision) { this.revision = this.model.revision; this.drawTerrain(); this.renderHud(); }
    const g = this.actors; g.clear();
    for (const p of this.model.trail) {
      g.fillStyle(0x5be1ef, .13).fillRect(PAD + p.x * CELL, PAD + p.y * CELL, CELL, CELL);
      g.fillStyle(0x80f0ff).fillRoundedRect(PAD + p.x * CELL + 7, PAD + p.y * CELL + 7, 10, 10, 3);
    }
    for (const enemy of this.model.enemies) {
      const x = PAD + (enemy.x + .5) * CELL, y = PAD + (enemy.y + .5) * CELL;
      g.fillStyle(0xff6e83, .15).fillCircle(x, y, 15);
      g.fillStyle(0xff7184).fillTriangle(x, y - 9, x - 9, y + 7, x + 9, y + 7);
      g.fillStyle(0xffe0e6).fillCircle(x, y, 2);
    }
    // Render one cell behind the simulation, interpolating between validated cells.
    const fraction = this.model.phase === 'playing' ? Math.min(1, this.model.progress / STEP_MS) : 1;
    const p = this.model.player, prev = this.model.previous;
    const x = PAD + (prev.x + (p.x - prev.x) * fraction + .5) * CELL;
    const y = PAD + (prev.y + (p.y - prev.y) * fraction + .5) * CELL;
    g.fillStyle(0x4baaff, .16).fillCircle(x, y, 16);
    g.fillStyle(0x329bff).fillCircle(x, y, 9);
    g.lineStyle(2, 0xd6f6ff).strokeCircle(x, y, 9);
    const v = vectors[this.model.direction];
    g.fillStyle(0xffffff).fillCircle(x + v.x * 4, y + v.y * 4, 2);
  }
}
export const game = new Phaser.Game({
  type: Phaser.AUTO, parent: 'board', width: COLS * CELL + PAD * 2, height: ROWS * CELL + PAD * 2,
  backgroundColor: '#0e1b2d', fps: { smoothStep: false },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: GameScene,
});
