import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { glowTexture, oceanMaterial, panelTextures } from './materials';
import { TerritoryGame, COLS, ROWS, STEP_MS, RIVAL_STEP_MS, type Point, type Direction } from './engine';

/** Presentation only: the deterministic game model remains independent of WebGL. */
export class Arena3D {
  readonly renderer: T.WebGLRenderer;
  readonly ready: Promise<void>;
  private scene = new T.Scene();
  private camera = new T.OrthographicCamera();
  portrait = false;
  private environment: T.WebGLRenderTarget;
  private territoryPixels = new Uint8Array(COLS * ROWS * 4);
  private territoryTexture = new T.DataTexture(this.territoryPixels, COLS, ROWS);
  private glow = glowTexture();
  private rotors: T.Object3D[] = [];
  private exhausts: T.Sprite[] = [];
  private wakes: T.Mesh[] = [];
  private padRings: T.Mesh[] = [];
  private beforeLives = 3;
  private beforeRivalFailures = 0;
  private particles: { mesh: T.Sprite; velocity: T.Vector3; age: number }[] = [];
  private tiles: T.InstancedMesh;
  private water: T.ShaderMaterial;
  private ships: T.Group[] = [];
  private mines: T.Group[] = [];
  private shieldRing: T.Mesh;
  private warningRing: T.Mesh;
  private trails: T.Mesh[][] = [[], []];
  private matrix = new T.Object3D();
  private heights = new Float32Array(COLS * ROWS);
  private owners = new Uint8Array(COLS * ROWS);
  private observer: ResizeObserver;
  private time = 0;
  private lastFrame = 0;
  private slowFrames = 0;
  private lastRevision = -1;
  private lastPhase = '';
  private needsRender = true;
  private shadowTime = -1;
  private lowQuality = false;
  private warmupFrames = 4;
  private resolveReady!: () => void;
  private readyStarted = false;
  private captures = [0,0];
  private pulses: {mesh:T.Mesh;age:number}[] = [];
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private material(color: number, metalness = .25, roughness = .35) { return new T.MeshStandardMaterial({ color, metalness, roughness }); }
  private mesh(geometry: T.BufferGeometry, material: T.Material, parent: T.Object3D, x=0,y=0,z=0) {
    const mesh = new T.Mesh(geometry, material); mesh.position.set(x,y,z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  constructor(board: HTMLElement) {
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
    this.renderer.domElement.className = 'arena-3d';
    this.renderer.domElement.setAttribute('aria-label', 'זירת איים תלת־ממדית');
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap; this.renderer.shadowMap.autoUpdate = false;
    const glInfo=this.renderer.getContext();
    const debug=glInfo.getExtension('WEBGL_debug_renderer_info');
    if(debug && /swiftshader|llvmpipe|software/i.test(String(glInfo.getParameter(debug.UNMASKED_RENDERER_WEBGL)))) {
      this.lowQuality=true;this.renderer.setPixelRatio(.7);this.renderer.shadowMap.enabled=false;
    }
    this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.1;
    const environmentScene = new RoomEnvironment();
    const pmrem = new T.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(environmentScene, .04, .1, 80);
    this.scene.environment = this.environment.texture; this.scene.environmentIntensity = .6;
    environmentScene.dispose(); pmrem.dispose();
    board.append(this.renderer.domElement); board.classList.add('has-3d');
    this.renderer.domElement.addEventListener('webglcontextlost', () => { board.classList.remove('has-3d'); this.renderer.domElement.hidden=true; });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => { board.classList.add('has-3d'); this.renderer.domElement.hidden=false; });
    this.scene.background = new T.Color('#0c1d27');
    this.scene.add(new T.HemisphereLight(0xc5e8fa, 0x173c46, 1.1));
    const sun = new T.DirectionalLight(0xffe7c2, 3.2);
    sun.position.set(-16, 26, -12); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, {left:-23, right:23, top:23, bottom:-23, near:1, far:65});
    sun.shadow.bias = -.0003; sun.shadow.normalBias = .025;
    this.scene.add(sun);
    const rim = new T.DirectionalLight(0x77c7e7, 1.4); rim.position.set(18, 8, 12); this.scene.add(rim);
    this.camera.position.set(0, 30, 29); this.camera.lookAt(0, 0, 0); this.camera.near = .1; this.camera.far = 120;
    this.territoryTexture.magFilter = this.territoryTexture.minFilter = T.NearestFilter;
    this.territoryTexture.needsUpdate = true;
    this.water = oceanMaterial(this.territoryTexture);
    const sea = this.mesh(new T.PlaneGeometry(95, 70), this.water, this.scene);
    sea.rotation.x = -Math.PI / 2; sea.castShadow = false;
    this.createFrame();
    const panels = panelTextures();
    const panelMaterial = new T.MeshStandardMaterial({color:0xffffff, ...panels, metalness:.52, roughness:.65});
    this.tiles = new T.InstancedMesh(new RoundedBoxGeometry(.993, 1, .993, 1, .045), panelMaterial, COLS * ROWS);
    this.tiles.castShadow = true; this.tiles.receiveShadow = true;
    this.tiles.instanceMatrix.setUsage(T.DynamicDrawUsage); this.scene.add(this.tiles);
    for(let n=0;n<2;n++) {
      const color=n?0xff667e:0x39cdf4;
      const x = n ? 13.5 : -13.5;
      const pad = this.mesh(new T.CylinderGeometry(.94, 1.06, .18, 48), this.material(0x28363d, .8, .3), this.scene, x, .95, .5);
      const ring = this.mesh(new T.TorusGeometry(.86, .025, 8, 48), new T.MeshBasicMaterial({color}), pad, 0, .105, 0);
      ring.rotation.x = -Math.PI/2; this.padRings.push(ring);
      const innerRing = this.mesh(new T.TorusGeometry(.65, .015, 6, 40), this.material(0x90a2aa, .7), pad, 0, .106, 0); innerRing.rotation.x = -Math.PI/2;
      for (const z of [-.22, .22]) this.mesh(new T.BoxGeometry(.5, .008, .035), this.material(0xd5e1e0), pad, 0, .11, z);
      for (const side of [-1, 1]) this.mesh(new T.BoxGeometry(.035, .008, .44), this.material(0xd5e1e0), pad, side * .23, .11, 0);
      const ship=this.drone(color);this.ships.push(ship);
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=48;
      const ctx=canvas.getContext('2d')!;ctx.font='bold 25px Arial';ctx.textAlign='center';ctx.fillStyle=n?'#ffc3cd':'#b9f4ff';ctx.shadowColor='#091a29';ctx.shadowBlur=8;ctx.fillText(n?'CPU':'YOU',64,33);
      const label=new T.Sprite(new T.SpriteMaterial({map:new T.CanvasTexture(canvas),depthTest:false,transparent:true}));label.scale.set(1.2,.45,1);label.position.y=.8;ship.add(label);
    }
    for (let n = 0; n < 4; n++) {
      const mine = new T.Group(); this.scene.add(mine);
      this.mesh(new T.SphereGeometry(.23, 20, 12), this.material(0x27343b, .85, .23), mine);
      const ring = this.mesh(new T.TorusGeometry(.3, .045, 8, 32), this.material(0xd6a051, .7, .22), mine); ring.rotation.x = Math.PI/2;
      const core = this.mesh(new T.SphereGeometry(.115, 14, 10), new T.MeshBasicMaterial({color:0xffd483}), mine, 0, .18, 0);
      this.halo(core, 0xffb64d, 1.15, .5);
      for (const angle of [0, Math.PI/2, Math.PI, Math.PI*1.5]) {
        this.mesh(new T.ConeGeometry(.07, .15, 8), this.material(0xb4a078, .7), mine, Math.cos(angle)*.25, .05, Math.sin(angle)*.25);
      }
      this.mines.push(mine);
    }
    this.shieldRing=this.mesh(new T.TorusGeometry(.7,.025,8,48),new T.MeshBasicMaterial({color:0x79e9ff,transparent:true,opacity:.85}),this.ships[0]);this.shieldRing.rotation.x=Math.PI/2;this.shieldRing.visible=false;
    this.warningRing=this.mesh(new T.TorusGeometry(.55,.04,8,40),new T.MeshBasicMaterial({color:0xffc270}),this.scene);this.warningRing.rotation.x=-Math.PI/2;this.warningRing.visible=false;
    this.observer=new ResizeObserver(()=>this.resize(board));this.observer.observe(board);this.resize(board);
    this.ready=new Promise(resolve=>{this.resolveReady=resolve;});
  }
  private halo(parent: T.Object3D, color: number, size: number, opacity: number) {
    const sprite = new T.Sprite(new T.SpriteMaterial({map:this.glow, color, transparent:true, opacity, blending:T.AdditiveBlending, depthWrite:false}));
    sprite.scale.set(size, size, 1); parent.add(sprite); return sprite;
  }
  private createFrame() {
    const frameGroup=new T.Group();this.scene.add(frameGroup);
    const steel = this.material(0x263b47, .75, .36);
    const edge = this.material(0x687b82, .82, .28);
    // The lip marks the real game boundary; everything outside it is scenery.
    for (const [x,z,w,d] of [[0,-12.3,37.1,.5],[0,12.3,37.1,.5],[-18.3,0,.5,24.1],[18.3,0,.5,24.1]]) {
      this.mesh(new RoundedBoxGeometry(w,.62,d,1,.09), steel, frameGroup,x,.05,z);
      this.mesh(new T.BoxGeometry(w,.025,d*.18), edge, frameGroup,x,.365,z);
    }
    const boltGeometry = new T.CylinderGeometry(.045,.045,.025,8);
    for (let x=-17; x<=17; x+=2) for(const z of [-12.3,12.3]) this.mesh(boltGeometry,edge,frameGroup,x,.39,z);
    for(let z=-11; z<=11; z+=2) for(const x of [-18.3,18.3]) this.mesh(boltGeometry,edge,frameGroup,x,.39,z);
    const amber = new T.MeshBasicMaterial({color:0xe8b776});
    for (const x of [-18.3,18.3]) for(const z of [-12.3,12.3]) {
      this.mesh(new RoundedBoxGeometry(.65,.16,.65,1,.08),edge,frameGroup,x,.48,z);
      const light=this.mesh(new T.BoxGeometry(.35,.025,.06),amber,frameGroup,x,.57,z);
      this.halo(light,0xffba71,1.1,.35);
    }
    // Industrial outriggers and mooring hardware give the arena a believable scale.
    for(const side of [-1,1]) for(const z of [-8,8]) {
      const platform=this.mesh(new RoundedBoxGeometry(1.3,.3,2.4,1,.08),steel,frameGroup,side*19,.1,z);
      this.mesh(new T.CylinderGeometry(.14,.19,.3,16),edge,platform,0,.28,.65);
      this.mesh(new T.CylinderGeometry(.14,.19,.3,16),edge,platform,0,.28,-.65);
      for(let stripe=0;stripe<5;stripe++) {
        const marker=this.mesh(new T.BoxGeometry(.22,.008,.45),this.material(stripe%2?0x27333b:0xc49c51),platform,0,.155,-.55+stripe*.28);
        marker.rotation.y=-.5;
      }
    }
    frameGroup.updateMatrixWorld(true);
    const groups=new Map<T.Material,T.Mesh[]>();
    frameGroup.traverse(object=>{
      if(object instanceof T.Mesh && !Array.isArray(object.material) && !object.children.length) {
        const group=groups.get(object.material)||[];group.push(object);groups.set(object.material,group);
      }
    });
    for(const [material,meshes] of groups) {
      if(meshes.length<2)continue;
      const pieces=meshes.map(mesh=>{const g=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();return g.applyMatrix4(mesh.matrixWorld);});
      const merged=mergeGeometries(pieces);
      if(merged) {meshes.forEach(mesh=>mesh.removeFromParent());this.mesh(merged,material,this.scene);}
      pieces.forEach(geometry=>geometry.dispose());
    }
  }
  private drone(color: number) {
    const ship = new T.Group(); this.scene.add(ship);
    const paint = new T.MeshPhysicalMaterial({color, metalness:.55, roughness:.28, clearcoat:.8, clearcoatRoughness:.2});
    const graphite = this.material(0x172931,.75,.32);
    const metal = this.material(0x9dafb6,.8,.23);
    const hull = this.mesh(new T.SphereGeometry(.33,24,16),paint,ship); hull.scale.set(.9,.55,1.6);
    const glass = new T.MeshPhysicalMaterial({color:0x0b2638, metalness:.5, roughness:.08, clearcoat:1});
    const cockpit = this.mesh(new T.SphereGeometry(.23,20,12),glass,ship,0,.13,-.08); cockpit.scale.set(.8,.65,1.25);
    this.mesh(new T.BoxGeometry(.065,.015,.3),metal,ship,0,.2,.28);
    for(const x of [-.46,.46]) {
      const arm=this.mesh(new RoundedBoxGeometry(.15,.1,.85,1,.04),graphite,ship,x,0,0);
      for(const z of [-.32,.32]) {
        const pod=this.mesh(new T.TorusGeometry(.19,.035,8,24),metal,ship,x,.05,z); pod.rotation.x=Math.PI/2;
        const rotor=new T.Group(); rotor.position.set(x,.07,z); ship.add(rotor); this.rotors.push(rotor);
        this.mesh(new T.CylinderGeometry(.045,.045,.09,12),graphite,rotor);
        for(const rotation of [0,Math.PI/2]) {
          const blade=this.mesh(new T.BoxGeometry(.3,.015,.028),graphite,rotor); blade.rotation.y=rotation;
        }
        this.mesh(new T.CylinderGeometry(.145,.145,.008,24),new T.MeshBasicMaterial({color:0xc2d3d9,transparent:true,opacity:.08,depthWrite:false}),ship,x,.08,z);
      }
      this.mesh(new T.CylinderGeometry(.045,.045,.24,8),metal,arm,0,-.15,.18);
      const headlight=this.mesh(new T.SphereGeometry(.055,10,8),new T.MeshBasicMaterial({color:0xd6f8ff}),ship,x,.02,-.42);
      this.halo(headlight,0xa6e8ff,.48,.35);
      const engine=this.mesh(new T.CylinderGeometry(.08,.1,.16,12),graphite,ship,x,-.04,.45); engine.rotation.x=Math.PI/2;
      const exhaust=this.halo(engine,color,.65,.4); exhaust.position.z=.09; this.exhausts.push(exhaust);
    }
    const lamp=this.mesh(new T.SphereGeometry(.04,8,6),new T.MeshBasicMaterial({color}),ship,0,.19,.38);
    this.halo(lamp,color,.5,.4);
    const wake=this.mesh(new T.RingGeometry(.25,.65,32),new T.MeshBasicMaterial({color:0x91c9cb,transparent:true,opacity:.1,side:T.DoubleSide,depthWrite:false}),this.scene);
    wake.rotation.x=-Math.PI/2; this.wakes.push(wake);
    return ship;
  }
  private sparks(point:T.Vector3,color:number) {
    if(this.reduced)return;
    for(let n=0;n<14;n++) {
      const spark=this.halo(this.scene,color,.22,.9);spark.position.copy(point);
      const angle=n/14*Math.PI*2;
      this.particles.push({mesh:spark,velocity:new T.Vector3(Math.cos(angle)*1.8,.5+(n%3)*.4,Math.sin(angle)*1.8),age:0});
    }
  }
  private captureLabel(point:Point,team:number,percent:number) {
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;
    const ctx=canvas.getContext('2d')!;ctx.font='bold 28px Arial';ctx.textAlign='center';ctx.shadowColor='#06131c';ctx.shadowBlur=7;ctx.fillStyle=team?'#ffc0cc':'#b9f4ff';ctx.fillText(`${percent.toFixed(1)}%`,128,42);
    const label=new T.Sprite(new T.SpriteMaterial({map:new T.CanvasTexture(canvas),transparent:true,depthTest:false,depthWrite:false}));
    label.scale.set(2.5,.625,1);label.position.set(point.x-COLS/2+.5,2.2,point.y-ROWS/2+.5);this.scene.add(label);
    this.particles.push({mesh:label,velocity:new T.Vector3(0,.7,0),age:0});
  }
  private resize(board:HTMLElement) {
    const w=Math.max(1,board.clientWidth),h=Math.max(1,board.clientHeight),aspect=w/h;
    this.portrait=window.innerWidth<=600 && window.innerHeight>window.innerWidth;
    this.camera.up.set(this.portrait?1:0,this.portrait?0:1,0);
    this.camera.position.set(0,this.portrait?40:30,this.portrait?12:29);
    this.camera.lookAt(0,0,0);
    const halfHeight=this.portrait?Math.max(19.5,12.7/aspect):Math.max(12,20.3/aspect);
    this.camera.left=-halfHeight*aspect;this.camera.right=halfHeight*aspect;this.camera.top=halfHeight;this.camera.bottom=-halfHeight;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h,false);this.needsRender=true;
  }
  private position(previous:Point,current:Point,f:number) {return {x:previous.x+(current.x-previous.x)*f-COLS/2+.5,z:previous.y+(current.y-previous.y)*f-ROWS/2+.5};}
  private trail(team:number,points:Point[],origin:Point,head:{x:number,z:number}) {
    const path=points.length?[origin,...points.slice(0,-1)].map(p=>({x:p.x-COLS/2+.5,z:p.y-ROWS/2+.5})):[]; if(path.length)path.push(head);
    const pool=this.trails[team];
    for(let n=0;n<path.length-1;n++) {
      if(!pool[n]) {
        const color=team?0xff718d:0x6cecff;
        pool[n]=this.mesh(new T.CylinderGeometry(.045,.045,1,8),new T.MeshBasicMaterial({color}),this.scene);
        const glow=this.mesh(pool[n].geometry,new T.MeshBasicMaterial({color,transparent:true,opacity:.1,depthWrite:false,blending:T.AdditiveBlending}),pool[n]);glow.scale.set(3,1,3);glow.castShadow=false;pool[n].castShadow=false;
      }
      const a=path[n],b=path[n+1],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
      pool[n].visible=length>.001;pool[n].position.set((a.x+b.x)/2,.96,(a.z+b.z)/2);pool[n].scale.set(1,length,1);
      if(length)pool[n].quaternion.setFromUnitVectors(new T.Vector3(0,1,0),new T.Vector3(dx/length,0,dz/length));
    }
    for(let n=Math.max(0,path.length-1);n<pool.length;n++)pool[n].visible=false;
  }
  render(m:TerritoryGame,delta:number,active:boolean) {
    if(!active && !this.warmupFrames && !this.needsRender && this.lastRevision===m.revision && this.lastPhase===m.phase) { this.lastFrame=0; return; }
    const now=performance.now();
    if(this.lastFrame && now-this.lastFrame>65)this.slowFrames++;else this.slowFrames=Math.max(0,this.slowFrames-1);
    this.lastFrame=now;
    if(this.slowFrames>=4&&!this.lowQuality) {
      this.lowQuality=true;this.renderer.setPixelRatio(.7);this.renderer.shadowMap.enabled=false;
    }
    if(active&&!this.reduced)this.time+=delta/1000;
    this.water.uniforms.time.value=this.time;
    if(m.phase==='ready') {
      this.particles.forEach(p=>{this.scene.remove(p.mesh);if(p.mesh.material.map!==this.glow)p.mesh.material.map?.dispose();p.mesh.material.dispose();});this.particles=[];
    } else {
      if(m.lives<this.beforeLives)this.sparks(this.ships[0].position,0x72eaff);
      if(m.rivalFailures>this.beforeRivalFailures)this.sparks(this.ships[1].position,0xff839e);
    }
    this.beforeLives=m.lives;this.beforeRivalFailures=m.rivalFailures;
    this.particles=this.particles.filter(p=>{
      if(active){p.age+=delta;p.mesh.position.addScaledVector(p.velocity,delta/1000);}
      p.mesh.material.opacity=Math.max(0,1-p.age/1000);
      if(p.age<1000)return true;
      this.scene.remove(p.mesh);if(p.mesh.material.map!==this.glow)p.mesh.material.map?.dispose();p.mesh.material.dispose();return false;
    });
    const counts=[m.captures,m.rivalCaptures];
    counts.forEach((count,n)=> {
      if(count>this.captures[n]&&!this.reduced){
        const point=n?m.rival:m.player;
        this.captureLabel(point,n,n?m.rivalPercent:m.percent);
        const pulse=this.mesh(new T.TorusGeometry(.5,.035,8,48),new T.MeshBasicMaterial({color:n?0xff90a7:0x90efff,transparent:true,opacity:1,depthWrite:false}),this.scene,point.x-COLS/2+.5,1.01,point.y-ROWS/2+.5);pulse.rotation.x=Math.PI/2;this.pulses.push({mesh:pulse,age:0});
      }
      this.captures[n]=count;
    });
    this.pulses=this.pulses.filter(pulse=>{if(m.phase==='ready')pulse.age=1200;else if(active)pulse.age+=delta;const life=pulse.age/1200;pulse.mesh.scale.setScalar(1+life*5);(pulse.mesh.material as T.MeshBasicMaterial).opacity=Math.max(0,1-life);if(life<1)return true;this.scene.remove(pulse.mesh);pulse.mesh.geometry.dispose();(pulse.mesh.material as T.Material).dispose();return false;});
    let slot=0;
    for(let id=0;id<COLS*ROWS;id++) {
      const owner=m.owned.has(id)?1:m.rivalOwned.has(id)?2:0;
      if(owner!==this.owners[id]) {
        this.owners[id]=owner;
        this.territoryPixels[id*4]=owner ? 255 : 0;
        this.territoryPixels[id*4+3]=255;
        this.territoryTexture.needsUpdate=true;
      }
      if(!owner){this.heights[id]=0;continue;}
      const target=.8;
      this.heights[id]=this.reduced || ['ready','won','lost'].includes(m.phase) ? target : this.heights[id]+(target-this.heights[id])*Math.min(1,(active?delta:0)/180);
      const height=Math.max(.001,this.heights[id]);
      this.matrix.position.set(id%COLS-COLS/2+.5,height/2-.05,Math.floor(id/COLS)-ROWS/2+.5);
      this.matrix.scale.set(1,height,1);this.matrix.updateMatrix();this.tiles.setMatrixAt(slot,this.matrix.matrix);
      this.tiles.setColorAt(slot,new T.Color(owner===1?0x348dab:0xb64f64));slot++;
    }
    this.tiles.count=slot;this.tiles.instanceMatrix.needsUpdate=true;
    if(this.tiles.instanceColor)this.tiles.instanceColor.needsUpdate=true;
    for(const rotor of this.rotors) rotor.rotation.y=this.time*48;
    this.exhausts.forEach((exhaust,n)=>{exhaust.material.opacity=.3+Math.sin(this.time*18+n)*.07;});
    this.padRings.forEach((ring,n)=>{(ring.material as T.MeshBasicMaterial).color.set(n?0xff718e:0x70ddf4);});
    const playing=m.phase==='playing';
    const p=this.position(m.previous,m.player,playing?Math.min(1,m.progress/STEP_MS):1);
    const r=this.position(m.rivalPrevious,m.rival,playing&&!m.rivalRecovery?Math.min(1,m.rivalClock/m.rivalInterval):1);
    const directions:Record<Direction,number>={up:0,right:-Math.PI/2,down:Math.PI,left:Math.PI/2};
    [p,r].forEach((pos,n)=> {
      const ship=this.ships[n];ship.position.set(pos.x,1.4+Math.sin(this.time*3+n)*.035,pos.z);
      const target=directions[n?m.rivalDirection:m.direction];let diff=target-ship.rotation.y;diff=Math.atan2(Math.sin(diff),Math.cos(diff));ship.rotation.y=m.phase==='ready'?target:ship.rotation.y+diff*Math.min(1,(active?delta:0)/110);ship.rotation.z=this.reduced?0:-diff*.08;
      this.wakes[n].position.set(pos.x,.018,pos.z); this.wakes[n].scale.setScalar(1+Math.sin(this.time*2+n)*.1);
      ship.visible=!(n?m.rivalRecovery:m.phase==='recovering')||Math.floor(this.time*8)%2===0;
    });
    this.trail(0,m.trail,m.trailOrigin,p);this.trail(1,m.rivalTrail,m.rivalTrailOrigin,r);
    this.shieldRing.visible=m.shieldRemaining>0;
    this.warningRing.visible=!!m.reinforcement;
    if(m.reinforcement){this.warningRing.position.set(m.reinforcement.x-COLS/2+.5,.12,m.reinforcement.y-ROWS/2+.5);this.warningRing.scale.setScalar(1+Math.sin(this.time*8)*.12);}
    this.mines.forEach((mine,n)=>{mine.visible=n<m.enemies.length;});
    m.enemies.forEach((enemy,n)=> {const p=this.position(m.enemyPrevious[n]||enemy,enemy,playing?Math.min(1,m.enemyClock/m.enemyInterval):1);const mine=this.mines[n];mine.position.set(p.x,.65+Math.sin(this.time*2+n)*.08,p.z);mine.rotation.y=this.time*.5;});
    if(this.time-this.shadowTime>.18 || this.lastRevision!==m.revision || this.needsRender) {
      this.renderer.shadowMap.needsUpdate=true;this.shadowTime=this.time;
    }
    this.renderer.render(this.scene,this.camera);
    this.lastRevision=m.revision;this.lastPhase=m.phase;this.needsRender=false;this.warmupFrames=Math.max(0,this.warmupFrames-1);
    if(!this.warmupFrames&&!this.readyStarted) {
      this.readyStarted=true;
      const gl=this.renderer.getContext() as WebGL2RenderingContext;
      const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();
      const wait=()=> {
        if(!fence||gl.isContextLost()){this.resolveReady();return;}
        const status=gl.clientWaitSync(fence,0,0);
        if(status===gl.TIMEOUT_EXPIRED){setTimeout(wait,20);return;}
        gl.deleteSync(fence);this.resolveReady();
      };
      wait();
    }
  }
  dispose(){this.observer.disconnect();this.scene.traverse(object=>{if(object instanceof T.Mesh){object.geometry.dispose();const materials=Array.isArray(object.material)?object.material:[object.material];materials.forEach(m=>m.dispose());}});this.environment.dispose();this.territoryTexture.dispose();this.glow.dispose();
    if(this.tiles.material instanceof T.MeshStandardMaterial){this.tiles.material.map?.dispose();this.tiles.material.roughnessMap?.dispose();}
    this.renderer.dispose();this.renderer.domElement.remove();}
}
