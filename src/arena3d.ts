import * as T from 'three';
import { TerritoryGame, COLS, ROWS, STEP_MS, RIVAL_STEP_MS, type Point, type Direction } from './engine';

/** Presentation only: the deterministic game model remains independent of WebGL. */
export class Arena3D {
  readonly renderer: T.WebGLRenderer;
  private scene = new T.Scene();
  private camera = new T.OrthographicCamera();
  private tiles: T.InstancedMesh;
  private water: T.ShaderMaterial;
  private ships: T.Group[] = [];
  private mines: T.Group[] = [];
  private trails: T.Mesh[][] = [[], []];
  private matrix = new T.Object3D();
  private heights = new Float32Array(COLS * ROWS);
  private owners = new Uint8Array(COLS * ROWS);
  private observer: ResizeObserver;
  private time = 0;
  private captures = [0,0];
  private pulses: {mesh:T.Mesh;age:number}[] = [];
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private material(color: number, metalness = .25, roughness = .35) { return new T.MeshStandardMaterial({ color, metalness, roughness }); }
  private mesh(geometry: T.BufferGeometry, material: T.Material, parent: T.Object3D, x=0,y=0,z=0) {
    const mesh = new T.Mesh(geometry, material); mesh.position.set(x,y,z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  constructor(board: HTMLElement) {
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.domElement.className = 'arena-3d';
    this.renderer.domElement.setAttribute('aria-label', 'זירת איים תלת־ממדית');
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.35;
    board.append(this.renderer.domElement); board.classList.add('has-3d');
    this.renderer.domElement.addEventListener('webglcontextlost', () => { board.classList.remove('has-3d'); this.renderer.domElement.hidden=true; });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => { board.classList.add('has-3d'); this.renderer.domElement.hidden=false; });
    this.scene.background = new T.Color('#091a29');
    this.scene.add(new T.HemisphereLight(0xb9e8ff, 0x263d50, 2.4));
    const sun = new T.DirectionalLight(0xfff1da, 4); sun.position.set(-12,25,12); sun.castShadow = true;
    sun.shadow.mapSize.set(1024,1024); Object.assign(sun.shadow.camera,{left:-24,right:24,top:24,bottom:-24,near:1,far:65}); sun.shadow.bias=-.0004; sun.shadow.normalBias=.04;
    this.scene.add(sun);
    const rim = new T.DirectionalLight(0x64baff, 2); rim.position.set(15,8,-14); this.scene.add(rim);
    this.camera.position.set(0,32,27); this.camera.lookAt(0,0,0); this.camera.near=.1; this.camera.far=100;
    this.water = new T.ShaderMaterial({ uniforms:{time:{value:0}}, vertexShader:`varying vec3 p; void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`, fragmentShader:`varying vec3 p; uniform float time; void main(){vec2 q=p.xy; float wave=sin(q.x*.7+time*.6)*sin(q.y*.9-time*.4); float caustic=pow(abs(sin(q.x*.44+q.y*.5+wave*.5+time*.12)),18.); vec2 cell=abs(fract(q+vec2(18.,12.))-.5); float grid=smoothstep(.477,.498,max(cell.x,cell.y)); vec3 c=mix(vec3(.025,.12,.19),vec3(.055,.25,.32),wave*.25+.45); c+=vec3(.07,.17,.18)*caustic*.32; c+=vec3(.08,.18,.22)*grid*.22; gl_FragColor=vec4(c,1.);}` });
    const sea=this.mesh(new T.PlaneGeometry(COLS,ROWS),this.water,this.scene,0,0,0); sea.rotation.x=-Math.PI/2; sea.castShadow=false;
    const frame=this.material(0x203c50,.65,.28);
    this.mesh(new T.BoxGeometry(COLS+.8,.5,ROWS+.8),frame,this.scene,0,-.42,0);
    for (const [x,z,w,d] of [[0,-12.2,36.5,.15],[0,12.2,36.5,.15],[-18.2,0,.15,24.5],[18.2,0,.15,24.5]]) this.mesh(new T.BoxGeometry(w,.1,d),this.material(0x80c5d4),this.scene,x,.03,z);
    this.tiles=new T.InstancedMesh(new T.BoxGeometry(.995,1,.995),this.material(0xffffff,.32,.3),COLS*ROWS); this.tiles.castShadow=true; this.tiles.receiveShadow=true; this.tiles.instanceMatrix.setUsage(T.DynamicDrawUsage); this.scene.add(this.tiles);
    for(let n=0;n<2;n++) {
      const color=n?0xff667e:0x39cdf4;
      const pad=this.mesh(new T.CylinderGeometry(1.15,1.25,.15,48),this.material(0x182e40,.7),this.scene,n?13.5:-13.5,.87,.5);
      const ring=this.mesh(new T.TorusGeometry(.85,.035,8,48),new T.MeshBasicMaterial({color}),pad,0,.09,0);ring.rotation.x=-Math.PI/2;
      const ship=this.drone(color);this.ships.push(ship);
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=48;
      const ctx=canvas.getContext('2d')!;ctx.font='bold 25px Arial';ctx.textAlign='center';ctx.fillStyle=n?'#ffc3cd':'#b9f4ff';ctx.shadowColor='#091a29';ctx.shadowBlur=8;ctx.fillText(n?'CPU':'YOU',64,33);
      const label=new T.Sprite(new T.SpriteMaterial({map:new T.CanvasTexture(canvas),depthTest:false,transparent:true}));label.scale.set(1.2,.45,1);label.position.y=.8;ship.add(label);
    }
    for(let n=0;n<2;n++) {
      const mine=new T.Group();this.scene.add(mine);
      this.mesh(new T.IcosahedronGeometry(.28,1),this.material(0xffb94d,.7,.2),mine);
      const ring=this.mesh(new T.TorusGeometry(.43,.035,8,32),new T.MeshBasicMaterial({color:0xffc96b}),mine);ring.rotation.x=Math.PI/3;
      this.mines.push(mine);
    }
    this.observer=new ResizeObserver(()=>this.resize(board));this.observer.observe(board);this.resize(board);
  }
  private drone(color:number) {
    const ship=new T.Group();this.scene.add(ship);
    this.mesh(new T.SphereGeometry(.32,20,12),this.material(color,.65,.22),ship).scale.set(.95,.45,1.45);
    this.mesh(new T.SphereGeometry(.19,16,8),this.material(0x122941,.9,.1),ship,0,.14,-.06).scale.set(.9,.65,1.3);
    for(const x of [-.38,.38]) {
      this.mesh(new T.BoxGeometry(.15,.1,.8),this.material(0xe1f0f2,.6),ship,x,0,0);
      for(const z of [-.28,.28]) {
        const rotor=this.mesh(new T.TorusGeometry(.17,.025,6,20),this.material(0x132937,.6),ship,x,.06,z);rotor.rotation.x=Math.PI/2;
        this.mesh(new T.CylinderGeometry(.11,.11,.02,16),new T.MeshBasicMaterial({color,transparent:true,opacity:.65}),ship,x,.07,z);
      }
      this.mesh(new T.SphereGeometry(.09,10,8),new T.MeshBasicMaterial({color:0xc6faff}),ship,x,-.02,.43);
    }
    return ship;
  }
  private resize(board:HTMLElement) {
    const w=Math.max(1,board.clientWidth),h=Math.max(1,board.clientHeight),aspect=w/h;
    const halfHeight=Math.max(13,19.8/aspect);
    this.camera.left=-halfHeight*aspect;this.camera.right=halfHeight*aspect;this.camera.top=halfHeight;this.camera.bottom=-halfHeight;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h,false);
  }
  private position(previous:Point,current:Point,f:number) {return {x:previous.x+(current.x-previous.x)*f-COLS/2+.5,z:previous.y+(current.y-previous.y)*f-ROWS/2+.5};}
  private trail(team:number,points:Point[],origin:Point,head:{x:number,z:number}) {
    const path=points.length?[origin,...points.slice(0,-1)].map(p=>({x:p.x-COLS/2+.5,z:p.y-ROWS/2+.5})):[]; if(path.length)path.push(head);
    const pool=this.trails[team];
    for(let n=0;n<path.length-1;n++) {
      if(!pool[n])pool[n]=this.mesh(new T.CylinderGeometry(.055,.055,1,8),new T.MeshBasicMaterial({color:team?0xff718d:0x6cecff}),this.scene);
      const a=path[n],b=path[n+1],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
      pool[n].visible=length>.001;pool[n].position.set((a.x+b.x)/2,.32,(a.z+b.z)/2);pool[n].scale.set(1,length,1);
      if(length)pool[n].quaternion.setFromUnitVectors(new T.Vector3(0,1,0),new T.Vector3(dx/length,0,dz/length));
    }
    for(let n=Math.max(0,path.length-1);n<pool.length;n++)pool[n].visible=false;
  }
  render(m:TerritoryGame,delta:number,active:boolean) {
    if(active&&!this.reduced)this.time+=delta/1000;
    this.water.uniforms.time.value=this.time;
    const counts=[m.captures,m.rivalCaptures];
    counts.forEach((count,n)=> {
      if(count>this.captures[n]&&!this.reduced){
        const point=n?m.rival:m.player;
        const pulse=this.mesh(new T.TorusGeometry(.5,.035,8,48),new T.MeshBasicMaterial({color:n?0xff90a7:0x90efff,transparent:true,opacity:1,depthWrite:false}),this.scene,point.x-COLS/2+.5,.92,point.y-ROWS/2+.5);pulse.rotation.x=Math.PI/2;this.pulses.push({mesh:pulse,age:0});
      }
      this.captures[n]=count;
    });
    this.pulses=this.pulses.filter(pulse=>{if(m.phase==='ready')pulse.age=1200;else if(active)pulse.age+=delta;const life=pulse.age/1200;pulse.mesh.scale.setScalar(1+life*8);(pulse.mesh.material as T.MeshBasicMaterial).opacity=Math.max(0,1-life);if(life<1)return true;this.scene.remove(pulse.mesh);pulse.mesh.geometry.dispose();(pulse.mesh.material as T.Material).dispose();return false;});
    for(let id=0;id<COLS*ROWS;id++) {
      const owner=m.owned.has(id)?1:m.rivalOwned.has(id)?2:0;
      if(owner!==this.owners[id]) {this.tiles.setColorAt(id,new T.Color(owner===1?0x319abe:0xd86c82));this.owners[id]=owner;}
      const target=owner ? .8 : 0;
      this.heights[id]=this.reduced || m.phase === 'ready' ? target : this.heights[id]+(target-this.heights[id])*Math.min(1,(active?delta:0)/180);
      const height=Math.max(.001,this.heights[id]);
      this.matrix.position.set(id%COLS-COLS/2+.5,height/2-.05,Math.floor(id/COLS)-ROWS/2+.5);this.matrix.scale.set(owner?1:.001,height,owner?1:.001);this.matrix.updateMatrix();this.tiles.setMatrixAt(id,this.matrix.matrix);
    }
    this.tiles.instanceMatrix.needsUpdate=true;if(this.tiles.instanceColor)this.tiles.instanceColor.needsUpdate=true;
    const playing=m.phase==='playing';
    const p=this.position(m.previous,m.player,playing?Math.min(1,m.progress/STEP_MS):1);
    const r=this.position(m.rivalPrevious,m.rival,playing&&!m.rivalRecovery?Math.min(1,m.rivalClock/RIVAL_STEP_MS):1);
    const directions:Record<Direction,number>={up:0,right:-Math.PI/2,down:Math.PI,left:Math.PI/2};
    [p,r].forEach((pos,n)=> {
      const ship=this.ships[n];ship.position.set(pos.x,1.23+Math.sin(this.time*3+n)*.04,pos.z);
      const target=directions[n?m.rivalDirection:m.direction];let diff=target-ship.rotation.y;diff=Math.atan2(Math.sin(diff),Math.cos(diff));ship.rotation.y+=diff*Math.min(1,(active?delta:0)/110);ship.rotation.z=this.reduced?0:-diff*.08;
      ship.visible=!(n?m.rivalRecovery:m.phase==='recovering')||Math.floor(this.time*8)%2===0;
    });
    this.trail(0,m.trail,m.trailOrigin,p);this.trail(1,m.rivalTrail,m.rivalTrailOrigin,r);
    m.enemies.forEach((enemy,n)=> {const p=this.position(m.enemyPrevious[n]||enemy,enemy,playing?Math.min(1,m.enemyClock/m.enemyInterval):1);const mine=this.mines[n];mine.position.set(p.x,.65+Math.sin(this.time*2+n)*.08,p.z);mine.rotation.y=this.time*.5;});
    this.renderer.render(this.scene,this.camera);
  }
  dispose(){this.observer.disconnect();this.scene.traverse(object=>{if(object instanceof T.Mesh){object.geometry.dispose();const materials=Array.isArray(object.material)?object.material:[object.material];materials.forEach(m=>m.dispose());}});this.renderer.dispose();this.renderer.domElement.remove();}
}
