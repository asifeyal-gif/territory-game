import * as T from 'three';

/** Generated assets keep the downloadable game completely self-contained. */
export function panelTextures() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#d2d6d8'; ctx.fillRect(0, 0, 256, 256);
  let seed = 731;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let n = 0; n < 1800; n++) {
    const brightness = 150 + Math.floor(random() * 80);
    ctx.strokeStyle = `rgba(${brightness},${brightness},${brightness},.13)`;
    const y = random() * 256;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke();
  }
  ctx.strokeStyle = '#78848a'; ctx.lineWidth = 2; ctx.strokeRect(9, 9, 238, 238);
  ctx.strokeStyle = '#f5f7f7'; ctx.lineWidth = 1; ctx.strokeRect(12, 12, 232, 232);
  for (const x of [22, 234]) for (const y of [22, 234]) {
    ctx.fillStyle = '#63747b'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#e4ecee'; ctx.beginPath(); ctx.moveTo(x - 2, y - 1); ctx.lineTo(x + 2, y - 1); ctx.stroke();
  }
  ctx.fillStyle = '#b6bec2'; ctx.fillRect(94, 232, 68, 3);
  const map = new T.CanvasTexture(canvas); map.colorSpace = T.SRGBColorSpace; map.anisotropy = 4;
  const roughCanvas = document.createElement('canvas'); roughCanvas.width = roughCanvas.height = 128;
  const rough = roughCanvas.getContext('2d')!;
  rough.fillStyle = '#969696'; rough.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y++) {
    const v = 110 + Math.floor(random() * 65); rough.fillStyle = `rgb(${v},${v},${v})`; rough.fillRect(0, y, 128, 1);
  }
  const roughnessMap = new T.CanvasTexture(roughCanvas);
  return { map, roughnessMap };
}

export function glowTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, '#ffffffff'); glow.addColorStop(.15, '#ffffffaa');
  glow.addColorStop(.4, '#ffffff25'); glow.addColorStop(1, '#ffffff00');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, 64, 64);
  return new T.CanvasTexture(canvas);
}

export function oceanMaterial(territory: T.DataTexture) {
  return new T.ShaderMaterial({
    uniforms: { time: { value: 0 }, territory: { value: territory }, sunDirection: { value: new T.Vector3(-.45, .8, -.3).normalize() } },
    vertexShader: `
      varying vec3 worldPosition;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.);
        worldPosition = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      varying vec3 worldPosition;
      uniform float time;
      uniform sampler2D territory;
      uniform vec3 sunDirection;
      float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p) {
        vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);
      }
      float ripples(vec2 p) {
        p+=vec2(sin(p.y*.32),cos(p.x*.29))*.8;
        return sin(p.x*2.1+p.y*1.5+time*1.25)*.006
          +sin(p.x*3.7-p.y*2.8-time*1.6)*.004
          +sin(p.x*7.1+p.y*4.3+time*2.1)*.0015;
      }
      float land(vec2 uv) {
        if (uv.x<0. || uv.x>1. || uv.y<0. || uv.y>1.) return 0.;
        return texture2D(territory,uv).r;
      }
      void main() {
        vec2 p=worldPosition.xz;
        float slopeX=(ripples(p+vec2(.03,0.))-ripples(p-vec2(.03,0.)))/.06;
        float slopeZ=(ripples(p+vec2(0.,.03))-ripples(p-vec2(0.,.03)))/.06;
        vec3 n=normalize(vec3(-slopeX,1.,-slopeZ));
        vec3 viewDir=normalize(cameraPosition-worldPosition);
        vec3 reflection=reflect(-viewDir,n);
        float fresnel=.025+.18*pow(1.-max(dot(viewDir,n),0.),4.);
        float clouds=noise(reflection.xz*7.+time*.018)*.6+noise(reflection.xz*17.)*.4;
        vec3 sky=mix(vec3(.14,.26,.37),vec3(.65,.73,.73),smoothstep(.28,.85,clouds));
        float depth=noise(p*.12)*.65+noise(p*.31)*.35;
        vec3 deep=mix(vec3(.012,.068,.09),vec3(.015,.13,.17),depth);
        float caustic=pow(abs(sin(p.x*.85+p.y*.6+sin(p.y*.75-time*.22)*.8)),22.);
        deep+=vec3(.006,.018,.016)*caustic;
        float spec=pow(max(dot(n,normalize(sunDirection+viewDir)),0.),230.)*(.1+noise(p*2.7+time*.2)*.3);
        vec3 color=mix(deep,sky,fresnel)+vec3(1.,.83,.59)*spec*.2;
        vec2 uv=(p+vec2(18.,12.))/vec2(36.,24.);
        vec2 texel=1./vec2(36.,24.);
        float shore=0.;
        shore+=land(uv+vec2(texel.x*.35,0.)); shore+=land(uv-vec2(texel.x*.35,0.));
        shore+=land(uv+vec2(0.,texel.y*.35)); shore+=land(uv-vec2(0.,texel.y*.35));
        color+=vec3(.09,.24,.22)*shore*.09;
        if(abs(p.x)<18. && abs(p.y)<12.) {
          vec2 cell=abs(fract(p+vec2(18.,12.))-.5);
          float grid=smoothstep(.485,.5,max(cell.x,cell.y));
          color+=vec3(.035,.06,.065)*grid*.24;
        }
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
