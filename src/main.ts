import Phaser from 'phaser';
import { bindSwipe } from './swipe';
import { Arena3D } from './arena3d';
import { TerritoryGame, COLS, ROWS, TARGET, STEP_MS, RIVAL_STEP_MS, index, vectors, type Direction, type Point } from './engine';
import './style.css';

const root = document.querySelector<HTMLDivElement>('#game')!;
root.innerHTML = `
<main class="shell" dir="rtl">
  <header class="topbar"><div class="brand"><span class="brand-icon">◈</span><div><h1>טריטוריה<span> DUEL</span></h1><p>שני כובשים. מגרש אחד.</p></div></div><div class="header-actions"><span class="best-badge">🏆 <strong id="trophies">0</strong> גביעים · שיא <strong id="best">0%</strong></span><button id="sound" class="icon-button" aria-label="הפעל צלילים" aria-pressed="false">♪</button></div></header>
  <section class="dashboard" aria-label="מצב המשחק">
    <div class="territory-stat player-stat"><div class="stat-line"><span><i class="team-icon"></i> אתם</span><strong id="percent">0%</strong></div><div class="progress"><div id="progress"></div></div><small id="target-note">הראשון שכובש ${TARGET}% מנצח</small></div>
    <div class="territory-stat rival-stat"><div class="stat-line"><span><i class="team-icon"></i> המחשב</span><strong id="rival-percent">0%</strong></div><div class="progress"><div id="rival-progress"></div></div><small id="rival-status">מוכן לצאת מהבסיס</small></div>
    <div class="stat"><span>חיים</span><div id="lives" class="lives" role="img"></div></div>
  </section>
  <section class="missionbar" aria-label="התקדמות בשלבים"><div><strong id="level">שלב 1</strong><span id="pressure">פתיחה</span></div><div class="scoreboard"><span>ניקוד <strong id="score">0</strong></span><span id="combo">רצף ×1</span></div><button id="shield" class="shield-button" disabled>מגן · E <strong id="charges">1</strong></button></section>
  <section class="arena"><div class="arena-top"><div class="legend"><span><i class="dot"></i> השטח שלכם</span><span class="enemy-legend"><i class="dot"></i> המחשב כובש באדום</span><span class="hazard-legend"><i class="dot"></i> מוקשי אנרגיה</span></div><span class="arena-label">LIVE ARENA <i></i></span></div>
    <div id="board" aria-label="מגרש המשחק"><button id="pause" class="board-pause" disabled aria-pressed="false">השהיה</button><div id="overlay" class="overlay"><div class="overlay-card"><div class="duel-emblem"><span>◈</span><i>×</i><span>◈</span></div><span id="eyebrow">השטח הבא שלכם</span><h2 id="overlay-title">כובשים. חותכים. מנצחים.</h2><p id="overlay-description"></p><button id="start" class="primary">מתחילים לשחק ←</button><p class="overlay-note">בטלפון: החליקו קצר והרימו אצבע · במחשב: חצים / WASD</p></div></div></div>
  </section>
  <footer><div><p id="status" role="status" aria-live="polite">מוכנים לתחרות?</p><p class="hint">החליקו על המגרש כדי לפנות · כל החלקה = פנייה אחת; לפנייה הבאה מרימים ומחליקים שוב · מגן מציל שובל בסכנה</p></div><div class="actions"><button id="control-mode" class="secondary" aria-pressed="false" aria-controls="direction-controls">הצג חצים</button><button id="restart" class="secondary">משחק מחדש</button></div></footer>
  <nav id="direction-controls" class="touch-controls" aria-label="כיווני תנועה"><button data-direction="left" aria-label="שמאלה">←</button><div><button data-direction="up" aria-label="למעלה">↑</button><button data-direction="down" aria-label="למטה">↓</button></div><button data-direction="right" aria-label="ימינה">→</button></nav>
</main>`;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const startButton = element<HTMLButtonElement>('start');
const pauseButton = element<HTMLButtonElement>('pause');
const overlay = element<HTMLDivElement>('overlay');
const soundButton = element<HTMLButtonElement>('sound');
const CELL = 24, PAD = 16;
const WIDTH = COLS * CELL + PAD * 2, HEIGHT = ROWS * CELL + PAD * 2;
const BLUE = 0x77e6ff, RED = 0xff8b91;
type Burst = { x: number; y: number; age: number; color: number; cells: number[]; label?: Phaser.GameObjects.Text };
const screenPoint = (p: Point): Point => ({ x: PAD + (p.x + .5) * CELL, y: PAD + (p.y + .5) * CELL });

class GameScene extends Phaser.Scene {
  model = new TerritoryGame();
  private arena3d?: Arena3D;
  private cancelSwipe?: () => void;
  private terrain!: Phaser.GameObjects.Graphics;
  private surfaces: { texture: Phaser.Textures.CanvasTexture; top: string; bottom: string; highlight: string }[] = [];
  private landVersion = '';
  private actors!: Phaser.GameObjects.Graphics;
  private revision = -1;
  private bursts: Burst[] = [];
  private visualTime = 0;
  private playerLabel!: Phaser.GameObjects.Text;
  private rivalLabel!: Phaser.GameObjects.Text;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private paused = false;
  private inactive = document.hidden;
  private best = 0;
  private savedTrophies = 0;
  private audioEnabled = false;
  private audio?: AudioContext;
  constructor() { super('GameScene'); }
  create(): void {
    try { this.best = Number(localStorage.getItem('territory-best')) || 0;const bank=Number(localStorage.getItem('territory-trophies'));this.model.trophies=Number.isFinite(bank)?Math.max(0,Math.floor(bank)):0;this.savedTrophies=this.model.trophies; } catch { /* Storage can be unavailable. */ }
    this.createOcean();
    this.terrain = this.add.graphics(); this.actors = this.add.graphics();
    this.playerLabel = this.add.text(0, 0, 'YOU', { fontFamily: 'Arial', fontSize: '9px', fontStyle: 'bold', color: '#a5f1ff' }).setOrigin(.5).setDepth(5);
    this.rivalLabel = this.add.text(0, 0, 'CPU', { fontFamily: 'Arial', fontSize: '9px', fontStyle: 'bold', color: '#ffc3c5' }).setOrigin(.5).setDepth(5);
    this.input.keyboard!.addCapture(['UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE']);
    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
      const mapping: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' };
      const direction = mapping[event.key] || mapping[event.key.toLowerCase()];
      if (direction) this.turn(direction);
      if(event.code==='KeyE'&&!event.repeat)this.shield();
      if (event.code === 'Space' && !event.repeat) { event.preventDefault(); if (this.model.phase === 'ready') this.start(); else this.togglePause(); }
    });
    startButton.onclick = () => this.start();
    element<HTMLButtonElement>('restart').onclick = () => { this.cancelSwipe?.();this.model.restartCampaign(); this.clearBursts(); this.paused = false; this.revision = -1; this.renderHud(); };
    element<HTMLButtonElement>('shield').onclick=()=>this.shield();
    pauseButton.onclick = () => this.togglePause();
    soundButton.onclick = () => { this.audioEnabled = !this.audioEnabled; soundButton.setAttribute('aria-pressed', String(this.audioEnabled)); soundButton.setAttribute('aria-label', this.audioEnabled ? 'כבה צלילים' : 'הפעל צלילים'); if (this.audioEnabled) this.beep(440); };
    document.querySelectorAll<HTMLButtonElement>('[data-direction]').forEach(button => {
      button.onpointerdown = event => { event.preventDefault(); this.turn(button.dataset.direction as Direction); };
    });
    const board = element<HTMLDivElement>('board');
    const stopSwipes = bindSwipe(board, direction => this.turn(direction), () => !this.paused && !this.inactive && this.model.phase === 'playing');
    const preventPagePan=(event:TouchEvent)=> {
      if(event.target instanceof Element&&!event.target.closest('.overlay-card')&&event.cancelable)event.preventDefault();
    };
    root.addEventListener('touchmove',preventPagePan,{passive:false});
    this.events.once('shutdown',()=>root.removeEventListener('touchmove',preventPagePan));
    this.cancelSwipe=stopSwipes.cancel;
    this.events.once('shutdown', stopSwipes.dispose);
    const controlsButton = element<HTMLButtonElement>('control-mode');
    controlsButton.onclick = () => {
      const show = controlsButton.getAttribute('aria-pressed') !== 'true';
      controlsButton.setAttribute('aria-pressed', String(show));
      controlsButton.textContent = show ? 'הסתר חצים' : 'הצג חצים';
      element('direction-controls').classList.toggle('visible', show);
    };
    const sync = () => { this.inactive = document.hidden; this.renderHud(); };
    document.addEventListener('visibilitychange', sync);
    this.events.once('shutdown', () => { document.removeEventListener('visibilitychange', sync); });
    try {
      this.arena3d = new Arena3D(board);
      startButton.disabled=true;board.setAttribute("aria-busy","true");
      this.arena3d.ready.then(()=>{startButton.disabled=false;board.removeAttribute("aria-busy");}).catch(()=>{
        this.arena3d?.dispose();this.arena3d=undefined;board.classList.remove('has-3d');board.removeAttribute('aria-busy');startButton.disabled=false;
      });
    } catch (error) { console.info("3D unavailable; using the compatible 2D arena.", error); board.classList.remove("has-3d"); board.querySelector(".arena-3d")?.remove(); }
    this.events.once("shutdown", () => this.arena3d?.dispose());
    this.renderHud();
  }
  private turn(direction: Direction): void {
    if(this.paused||this.inactive)return;
    const portrait:Record<Direction,Direction>={up:'right',right:'down',down:'left',left:'up'};
    this.model.turn(this.arena3d?.portrait ? portrait[direction] : direction);
  }
  private start(): void {
    if(this.model.phase==='ready'&&startButton.disabled)return;
    if(this.model.phase==='won'){this.model.nextLevel();this.clearBursts();}else if(this.model.phase==='lost'){this.model.reset();this.clearBursts();}
    this.paused = false; this.model.start(); this.beep(520); this.renderHud();
  }
  private shield(): void {
    if(!this.paused&&!this.inactive&&this.model.activateShield()){this.beep(620);this.renderHud();}
  }
  private togglePause(): void {
    if (!['playing', 'recovering'].includes(this.model.phase)) return;
    this.cancelSwipe?.();this.paused = !this.paused; this.renderHud();
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
    element('level').textContent=`שלב ${m.level}`;
    element('pressure').textContent=['פתיחה','לחץ עולה','מצור','הכרעה'][m.pressure];
    element('score').textContent=m.score.toLocaleString('he-IL');
    element('combo').textContent=`רצף ×${Math.max(1,Math.min(5,m.combo))}`;
    element('trophies').textContent=String(m.trophies);
    if(m.trophies!==this.savedTrophies){this.savedTrophies=m.trophies;try{localStorage.setItem('territory-trophies',String(m.trophies));}catch{/* Optional storage. */}}
    element('target-note').textContent=`הראשון שכובש ${m.target}% מנצח`;
    const shield=element<HTMLButtonElement>('shield');shield.disabled=this.paused||this.inactive||m.phase!=='playing'||!m.shieldCharges||m.shieldRemaining>0;
    shield.classList.toggle('shield-active',m.shieldRemaining>0);
    element('charges').textContent=m.shieldRemaining>0?'פעיל':String(m.shieldCharges);
    element('percent').textContent = `${m.percent.toFixed(1)}%`;
    element('progress').style.width = `${Math.min(100, m.percent / m.target * 100)}%`;
    element('rival-percent').textContent = `${m.rivalPercent.toFixed(1)}%`;
    element('rival-progress').style.width = `${Math.min(100, m.rivalPercent / m.target * 100)}%`;
    element('rival-status').textContent = m.phase === 'ready' ? 'מוכן לצאת מהבסיס' : m.rivalMode==='hunt' ? 'מכוון לשובל שלכם — סגרו מסלול!' : m.rivalRecovery > 0 ? 'השובל נחתך — חוזר לבסיס' : m.rivalTrail.length ? 'סוגר מסלול וכובש שטח' : 'מתכנן את הכיבוש הבא';
    if (m.percent > this.best) { this.best = m.percent; try { localStorage.setItem('territory-best', String(this.best)); } catch { /* Optional storage. */ } }
    element('best').textContent = `${this.best.toFixed(1)}%`;
    element('lives').innerHTML = Array.from({ length: 3 }, (_, i) => `<span class="${i < m.lives ? '' : 'lost'}" aria-hidden="true">♥</span>`).join('');
    element('lives').setAttribute('aria-label', `${m.lives} מתוך 3 לבבות`);
    const finished = m.phase === 'won' || m.phase === 'lost';
    overlay.hidden = !(m.phase === 'ready' || finished);
    startButton.hidden = false;
    pauseButton.disabled = !['playing', 'recovering'].includes(m.phase);pauseButton.hidden=m.phase==='ready'||finished;
    pauseButton.textContent = this.paused ? 'המשך' : 'השהיה';pauseButton.setAttribute('aria-pressed',String(this.paused));
    document.querySelector('.duel-emblem')!.innerHTML=finished&&m.phase==='won'?'<span class="trophy-emblem">🏆</span>':'<span>◈</span><i>×</i><span>◈</span>';
    element('eyebrow').textContent = finished ? m.phase === 'won' ? `🏆 גביע ${m.trophies} — שלב ${m.level+1} נפתח` : 'כל מסלול מלמד משהו' : 'כובשים בדרך שלכם';
    element('overlay-title').textContent = finished ? m.phase === 'won' ? `ניצחתם את שלב ${m.level}!` : m.rivalPercent >= m.target ? 'המחשב הקדים אתכם.' : 'נגמרו הלבבות.' : 'כובשים. חותכים. מנצחים.';
    element('overlay-description').textContent = finished ? `אתם: ${m.percent.toFixed(1)}% · המחשב: ${m.rivalPercent.toFixed(1)}%. ${m.phase === 'won' ? 'המגרש שלכם!' : m.message} מוכנים לסיבוב נוסף?` : this.paused ? 'לחצו על ממשיכים או על מקש רווח כדי לחזור למשחק.' : this.inactive ? 'המשחק נעצר אוטומטית. חזרו ללשונית כדי להמשיך.' : `שלב ${m.level}: הגיעו ל־${m.target}% לפני המחשב. לכל פנייה: החליקו קצר והרימו את האצבע. מסלול ארוך מושך התקפה! כפתור המגן נותן 3 שניות הגנה. כל ניצחון מעניק גביע ופותח שלב קשה יותר.`;
    startButton.textContent = finished ? m.phase==='won'?`לשלב ${m.level+1} ←`:`עוד סיבוב — שלב ${m.level} ←` : this.paused ? 'ממשיכים ←' : 'מתחילים לשחק ←';
    element('status').textContent = m.phase === 'recovering' ? `${m.message} חוזרים לבסיס בעוד שנייה.` : m.phase === 'ready' ? 'מוכנים לתחרות על המגרש?' : this.paused ? 'המשחק מושהה. לחצו על המשך בצד המגרש.' : this.inactive ? 'המשחק מושהה כשהלשונית אינה פעילה.' : m.message;
  }
  private createOcean(): void {
    const texture = this.textures.createCanvas('ocean', WIDTH * 2, HEIGHT * 2)!;
    const ctx = texture.getContext(); ctx.scale(2, 2);
    const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    background.addColorStop(0, '#15364a'); background.addColorStop(.5, '#0d2338'); background.addColorStop(1, '#16293b');
    ctx.fillStyle = background; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const light = ctx.createRadialGradient(WIDTH * .45, HEIGHT * .25, 0, WIDTH * .45, HEIGHT * .25, WIDTH * .8);
    light.addColorStop(0, '#447b8b30'); light.addColorStop(1, '#06122300'); ctx.fillStyle = light; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    // Contour lines and soft caustics give the field depth without external images.
    for (let row = 0; row < 18; row++) {
      ctx.strokeStyle = row % 3 ? '#7596a408' : '#99cfdf10'; ctx.lineWidth = row % 3 ? 1 : 2;
      ctx.beginPath();
      for (let x = -30; x <= WIDTH + 30; x += 8) {
        const y = row * 43 + Math.sin(x / 130 + row * .5) * 23 + Math.cos(x / 75 - row) * 8;
        if (x === -30) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = '#8faeb313'; ctx.lineWidth = .5;
    for (let x = PAD; x <= WIDTH - PAD; x += CELL) { ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, HEIGHT - PAD); ctx.stroke(); }
    for (let y = PAD; y <= HEIGHT - PAD; y += CELL) { ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(WIDTH - PAD, y); ctx.stroke(); }
    ctx.strokeStyle = '#62879b66'; ctx.lineWidth = 1; ctx.strokeRect(PAD, PAD, COLS * CELL, ROWS * CELL);
    texture.refresh(); this.add.image(WIDTH / 2, HEIGHT / 2, 'ocean').setDisplaySize(WIDTH, HEIGHT);
    for (const [key, top, bottom, highlight] of [
      ['blue-surface', '#398ead', '#1e5475', '#a1e2f0'],
      ['red-surface', '#ba6d7b', '#80435b', '#f6bdc1'],
    ]) {
      const surface = this.textures.createCanvas(key, WIDTH * 2, HEIGHT * 2)!;
      surface.getContext().scale(2, 2);
      this.surfaces.push({ texture: surface, top, bottom, highlight });
      this.add.image(WIDTH / 2, HEIGHT / 2, key).setDisplaySize(WIDTH, HEIGHT);
    }
  }
  private paintSurface(cells: Set<number>, surface: typeof this.surfaces[number]): void {
    // Bake transparent territory into the texture, compatible with both WebGL and Canvas.
    const paint = surface.texture.getContext(); paint.clearRect(0, 0, WIDTH, HEIGHT);
    paint.save(); paint.beginPath();
    for (const id of cells) paint.rect(PAD + id % COLS * CELL, PAD + Math.floor(id / COLS) * CELL, CELL, CELL);
    paint.clip();
    const gradient = paint.createLinearGradient(0, 0, WIDTH * .4, HEIGHT);
    gradient.addColorStop(0, surface.top); gradient.addColorStop(1, surface.bottom);
    paint.fillStyle = gradient; paint.fillRect(0, 0, WIDTH, HEIGHT);
    const sheen = paint.createRadialGradient(WIDTH * .6, -HEIGHT * .2, 0, WIDTH * .6, -HEIGHT * .2, WIDTH);
    sheen.addColorStop(0, `${surface.highlight}65`); sheen.addColorStop(1, `${surface.highlight}00`);
    paint.fillStyle = sheen; paint.fillRect(0, 0, WIDTH, HEIGHT);
    for (let row = 0; row < 20; row++) {
      paint.strokeStyle = `${surface.highlight}0a`; paint.lineWidth = 1;
      paint.beginPath(); paint.moveTo(0, row * 40);
      paint.bezierCurveTo(WIDTH * .3, row * 40 - 25, WIDTH * .7, row * 40 + 25, WIDTH, row * 40); paint.stroke();
    }
    paint.restore(); surface.texture.refresh();
  }

  private clearBursts(): void { for (const burst of this.bursts) burst.label?.destroy(); this.bursts = []; }
  private burst(point: Point, color: number, cells: number[] = [], text?: string): void {
    const p = screenPoint(point);
    const label = text ? this.add.text(p.x, p.y - 20, text, { fontFamily: 'Arial', fontSize: '17px', fontStyle: 'bold', color: color === BLUE ? '#b6f3ff' : '#ffc2c5', stroke: '#0b2034', strokeThickness: 4 }).setOrigin(.5).setDepth(6) : undefined;
    this.bursts.push({ ...p, age: 0, color, cells, label });
  }
  private drawTerrain(): void {
    const m = this.model;
    const version = `${m.captures}:${m.rivalCaptures}:${m.owned.size}:${m.rivalOwned.size}`;
    if (version === this.landVersion) return;
    this.landVersion = version;
    this.paintSurface(m.owned, this.surfaces[0]); this.paintSurface(m.rivalOwned, this.surfaces[1]);
    const g = this.terrain; g.clear();
    for (const [cells, color] of [[m.owned, BLUE], [m.rivalOwned, RED]] as const) {
      const borders: [number, number, number, number][] = [];
      for (const id of cells) {
        const x = id % COLS, y = Math.floor(id / COLS), px = PAD + x * CELL, py = PAD + y * CELL;
        if (x === 0 || !cells.has(id - 1)) borders.push([px, py, px, py + CELL]);
        if (x === COLS - 1 || !cells.has(id + 1)) borders.push([px + CELL, py, px + CELL, py + CELL]);
        if (y === 0 || !cells.has(id - COLS)) borders.push([px, py, px + CELL, py]);
        if (y === ROWS - 1 || !cells.has(id + COLS)) borders.push([px, py + CELL, px + CELL, py + CELL]);
      }
      for (const [width, alpha] of [[10, .035], [5, .09], [1.5, .8]]) {
        g.lineStyle(width, color, alpha); for (const edge of borders) g.lineBetween(...edge);
      }
    }
    // Small landing pads stay recognisable as the surrounding territory grows.
    for (const [x, color] of [[4, BLUE], [31, RED]]) {
      const p = screenPoint({ x, y: 12 });
      g.fillStyle(0x102739, .7).fillRoundedRect(p.x - 22, p.y - 22, 44, 44, 12);
      g.lineStyle(1, color, .55).strokeRoundedRect(p.x - 22, p.y - 22, 44, 44, 12);
      g.lineStyle(1, color, .22).strokeCircle(p.x, p.y, 16);
    }
  }
  private drawTrail(points: Point[], head: Point, color: number, origin: Point): void {
    if (!points.length) return;
    const path = [origin, ...points.slice(0, -1)].map(screenPoint); path.push(head);
    if (path.length === 1) { this.actors.fillStyle(color, .8).fillCircle(head.x, head.y, 3); return; }
    for (const [width, alpha] of [[13, .05], [7, .13], [3, .95], [1, .65]]) {
      this.actors.lineStyle(width, width === 1 ? 0xffffff : color, alpha);
      this.actors.strokePoints(path.map(p => new Phaser.Math.Vector2(p.x, p.y)), false);
    }
    for (let n = 0; n < path.length - 1; n++) {
      const a = path[n], b = path[n + 1], phase = (this.visualTime / 650 + n * .27) % 1;
      this.actors.fillStyle(0xffffff, .65).fillCircle(a.x + (b.x - a.x) * phase, a.y + (b.y - a.y) * phase, 1.4);
    }
  }
  private drawShip(p: Point, direction: Direction, color: number, recovering: boolean): void {
    const g = this.actors, v = vectors[direction];
    const local = (forward: number, side: number): Point => ({ x: p.x + v.x * forward - v.y * side, y: p.y + v.y * forward + v.x * side });
    const glow = recovering ? .08 : .16;
    g.fillStyle(0x000714, .3).fillEllipse(p.x, p.y + 7, 27, 15);
    g.fillStyle(color, glow).fillCircle(p.x, p.y, 20);
    const exhaust = local(-12, 0);
    if (this.model.phase === 'playing' && !recovering) {
      g.fillStyle(color, .14).fillCircle(exhaust.x, exhaust.y, 8);
      g.fillStyle(0xdafcff, .8).fillCircle(exhaust.x, exhaust.y, 2.2 + Math.sin(this.visualTime / 65) * .4);
    }
    const shape = [local(12, 0), local(-7, -9), local(-4, 0), local(-7, 9)].map(p => new Phaser.Math.Vector2(p.x, p.y));
    g.fillStyle(color, recovering ? .5 : 1).fillPoints(shape, true);
    g.lineStyle(1, 0xffffff, .7).strokePoints(shape, true);
    const cockpit = local(2, 0);
    g.fillStyle(0x112a43).fillCircle(cockpit.x, cockpit.y, 3.7);
    g.fillStyle(0xffffff, .9).fillCircle(cockpit.x + 1, cockpit.y - 1, 1.3);
  }
  update(_time: number, delta: number): void {
    const m = this.model, lives = m.lives, captures = m.captures, redCaptures = m.rivalCaptures, redFailures = m.rivalFailures;
    const beforeBlue = new Set(m.owned), beforeRed = new Set(m.rivalOwned);
    const oldPlayer = { ...m.player }, oldRival = { ...m.rival };
    const active = !this.paused && !this.inactive;
    const elapsed = Math.min(delta, 250);
    if (active) { m.tick(elapsed); if (m.phase === 'playing' || m.phase === 'recovering') this.visualTime += elapsed; }
    if(!active||m.phase!=='playing')this.cancelSwipe?.();
    if (lives !== m.lives) { this.beep(140); this.burst(oldPlayer, BLUE); if (!this.reducedMotion) this.cameras.main.shake(100, .002); }
    if (captures !== m.captures) {
      this.beep(740); const cells = [...m.owned].filter(id => !beforeBlue.has(id));
      this.burst(m.player, BLUE, cells, `+${cells.length}`);
    }
    if (redCaptures !== m.rivalCaptures) {
      const cells = [...m.rivalOwned].filter(id => !beforeRed.has(id)); this.burst(m.rival, RED, cells, `+${cells.length}`);
    }
    if (redFailures !== m.rivalFailures) this.burst(oldRival, RED, [], '×');
    if (this.revision !== m.revision) { this.revision = m.revision; this.drawTerrain(); this.renderHud(); }
    this.arena3d?.render(m, elapsed, active && ["playing", "recovering"].includes(m.phase));
    const g = this.actors; g.clear();
    const interpolate = (from: Point, to: Point, fraction: number): Point => screenPoint({ x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction });
    const playerPoint = interpolate(m.previous, m.player, m.phase === 'playing' ? Math.min(1, m.progress / STEP_MS) : 1);
    const rivalPoint = interpolate(m.rivalPrevious, m.rival, m.phase === 'playing' && !m.rivalRecovery ? Math.min(1, m.rivalClock / m.rivalInterval) : 1);
    this.drawTrail(m.trail, playerPoint, BLUE, m.trailOrigin); this.drawTrail(m.rivalTrail, rivalPoint, RED, m.rivalTrailOrigin);
    m.enemies.forEach((enemy, n) => {
      const p = interpolate(m.enemyPrevious[n] || enemy, enemy, m.phase === 'playing' ? Math.min(1, m.enemyClock / m.enemyInterval) : 1);
      const pulse = this.reducedMotion ? 1 : 1 + Math.sin(this.visualTime / 300 + n) * .08;
      g.fillStyle(0xffc07a, .06).fillCircle(p.x, p.y, 20 * pulse);
      g.lineStyle(1, 0xffc37f, .27).strokeCircle(p.x, p.y, 12 * pulse);
      g.fillStyle(0x70482b).fillCircle(p.x, p.y, 7);
      g.fillStyle(0xffbb72).fillCircle(p.x, p.y, 4);
      g.fillStyle(0xffefcf).fillCircle(p.x - 1, p.y - 1, 1.7);
    });
    if(m.shieldRemaining>0)g.lineStyle(2,BLUE,.8).strokeCircle(playerPoint.x,playerPoint.y,19);
    if(m.reinforcement){const p=screenPoint(m.reinforcement);g.lineStyle(2,0xffbd71,.85).strokeCircle(p.x,p.y,16);g.lineBetween(p.x-6,p.y,p.x+6,p.y);}
    this.drawShip(playerPoint, m.direction, BLUE, m.phase === 'recovering');
    this.drawShip(rivalPoint, m.rivalDirection, RED, m.rivalRecovery > 0);
    this.playerLabel.setPosition(playerPoint.x, playerPoint.y - 24);
    this.rivalLabel.setPosition(rivalPoint.x, rivalPoint.y - 24);
    for (const burst of this.bursts) {
      if (active) burst.age += elapsed;
      const life = Math.max(0, 1 - burst.age / 1000);
      if (!this.reducedMotion) {
        g.lineStyle(2, burst.color, life * .5).strokeCircle(burst.x, burst.y, 12 + (1 - life) * 65);
        for (let n = 0; n < 12; n++) {
          const angle = n / 12 * Math.PI * 2, radius = 8 + (1 - life) * (30 + n % 3 * 12);
          g.fillStyle(burst.color, life).fillCircle(burst.x + Math.cos(angle) * radius, burst.y + Math.sin(angle) * radius, life * 2);
        }
      }
      for (const id of burst.cells) g.fillStyle(burst.color, life * .25).fillRect(PAD + id % COLS * CELL, PAD + Math.floor(id / COLS) * CELL, CELL, CELL);
      burst.label?.setPosition(burst.x, burst.y - 25 - (1 - life) * 30).setAlpha(life);
    }
    this.bursts = this.bursts.filter(burst => { if (burst.age < 1000) return true; burst.label?.destroy(); return false; });
  }
}
export const game = new Phaser.Game({
  type: Phaser.CANVAS, parent: 'board', width: WIDTH, height: HEIGHT,
  backgroundColor: '#102538', antialias: true, pixelArt: false, fps: { smoothStep: false },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: GameScene,
});
