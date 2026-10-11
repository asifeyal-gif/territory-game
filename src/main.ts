import Phaser from 'phaser';
import './style.css';

const field = { x: 48, y: 32, width: 864, height: 576, cell: 24 };
const spawn = { x: 120, y: 320 };
const radius = 9;
const speed = field.width / 10;
type Direction = 'left' | 'right' | 'up' | 'down';
type Phase = 'ready' | 'moving' | 'recovering' | 'over';
const vectors: Record<Direction, [number, number]> = {
  left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1],
};
const opposite: Record<Direction, Direction> = {
  left: 'right', right: 'left', up: 'down', down: 'up',
};

const root = document.querySelector<HTMLDivElement>('#game')!;
root.innerHTML = `
  <main class="shell" dir="rtl">
    <header><h1>מגרש ותנועה</h1><div id="lives" class="lives" role="img"></div></header>
    <div id="board" aria-label="מגרש המשחק"></div>
    <footer>
      <p id="status" role="status" aria-live="polite"></p>
      <div class="buttons"><button id="start">התחל</button><button id="restart" class="secondary">משחק מחדש</button></div>
      <p class="hint">מקשי החצים משנים כיוון · אין סיבוב לאחור · יציאה מהמגרש עולה בלב</p>
    </footer>
  </main>`;
const startButton = document.querySelector<HTMLButtonElement>('#start')!;
const restartButton = document.querySelector<HTMLButtonElement>('#restart')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const livesDisplay = document.querySelector<HTMLDivElement>('#lives')!;

class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Arc;
  private direction: Direction = 'right';
  private phase: Phase = 'ready';
  private lives = 3;
  private recoveryLeft = 0;
  private inactive = document.hidden || !document.hasFocus();

  constructor() { super('GameScene'); }

  create(): void {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x162238).fillRect(field.x, field.y, field.width, field.height);
    graphics.lineStyle(1, 0x2b3b54);
    for (let x = field.x; x <= field.x + field.width; x += field.cell) {
      graphics.lineBetween(x, field.y, x, field.y + field.height);
    }
    for (let y = field.y; y <= field.y + field.height; y += field.cell) {
      graphics.lineBetween(field.x, y, field.x + field.width, y);
    }
    graphics.lineStyle(3, 0x8da7cc).strokeRect(field.x, field.y, field.width, field.height);
    this.add.rectangle(spawn.x, spawn.y, 72, 72, 0x234876).setStrokeStyle(2, 0x6fa8ef);
    this.player = this.add.circle(spawn.x, spawn.y, radius, 0x3995ff).setStrokeStyle(2, 0xc2e2ff);
    const keyboard = this.input.keyboard!;
    keyboard.addCapture(['UP', 'DOWN', 'LEFT', 'RIGHT']);
    keyboard.on('keydown', (event: KeyboardEvent) => {
      const keys: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
      const next = keys[event.key];
      if (next && this.phase === 'moving' && !this.inactive && next !== opposite[this.direction]) {
        this.direction = next;
      }
    });
    startButton.onclick = () => {
      if (this.phase === 'ready') { this.phase = 'moving'; this.refreshHud(); }
    };
    restartButton.onclick = () => this.reset();
    const syncActivity = () => {
      this.inactive = document.hidden || !document.hasFocus();
      this.refreshHud();
    };
    document.addEventListener('visibilitychange', syncActivity);
    window.addEventListener('blur', syncActivity);
    window.addEventListener('focus', syncActivity);
    this.events.once('shutdown', () => {
      document.removeEventListener('visibilitychange', syncActivity);
      window.removeEventListener('blur', syncActivity);
      window.removeEventListener('focus', syncActivity);
      startButton.onclick = null;
      restartButton.onclick = null;
    });
    this.reset();
  }

  private reset(): void {
    this.lives = 3;
    this.phase = 'ready';
    this.recoveryLeft = 0;
    this.direction = 'right';
    this.player.setPosition(spawn.x, spawn.y);
    this.refreshHud();
  }

  private refreshHud(): void {
    livesDisplay.innerHTML = Array.from({ length: 3 }, (_, index) =>
      `<span class="${index < this.lives ? '' : 'lost'}" aria-hidden="true">♥</span>`).join('');
    livesDisplay.setAttribute('aria-label', `${this.lives} מתוך 3 לבבות`);
    startButton.disabled = this.phase !== 'ready';
    status.textContent = this.phase === 'ready' ? 'מוכנים? לחצו על התחל.'
      : this.phase === 'over' ? 'המשחק נגמר. אפשר להתחיל משחק מחדש.'
      : this.inactive ? 'המשחק מושהה עד לחזרה ללשונית.'
      : this.phase === 'recovering' ? 'פסילה! חוזרים לבסיס — התנועה תתחדש בעוד שנייה.'
      : 'בתנועה — שמרו על גבולות המגרש.';
  }

  update(_time: number, delta: number): void {
    if (this.inactive || this.phase === 'ready' || this.phase === 'over') return;
    let elapsed = Math.min(delta, 100);
    if (this.phase === 'recovering') {
      this.recoveryLeft -= elapsed;
      if (this.recoveryLeft > 0) return;
      elapsed = -this.recoveryLeft;
      this.phase = 'moving';
      this.refreshHud();
    }
    const [dx, dy] = vectors[this.direction];
    const x = this.player.x + dx * speed * elapsed / 1000;
    const y = this.player.y + dy * speed * elapsed / 1000;
    if (x < field.x + radius || x > field.x + field.width - radius ||
        y < field.y + radius || y > field.y + field.height - radius) {
      this.lives -= 1;
      this.player.setPosition(spawn.x, spawn.y);
      this.direction = 'right';
      this.phase = this.lives === 0 ? 'over' : 'recovering';
      this.recoveryLeft = this.lives === 0 ? 0 : 1000;
      this.refreshHud();
      return;
    }
    this.player.setPosition(x, y);
  }
}

export const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'board',
  width: 960,
  height: 640,
  backgroundColor: '#0c1424',
  fps: { smoothStep: false },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: GameScene,
});
