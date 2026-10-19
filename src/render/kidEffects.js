import * as THREE from 'three';
import { Ease, rand, pick } from '../engine/anim.js';
import { BOARD_Y } from './boardMesh.js';
import { getGlowTexture } from './effects.js';

// Cartoon effects for Kids mode: confetti, stars, hearts, soap bubbles, poof clouds, dizzy stars,
// blue water splashes, rainbow sparkle trails, comic words and music notes.
//
// Everything lives in world.transient (wiped when a fight is aborted) and is tagged
// userData.kidFx. Geometries, shared materials and canvas textures are cached at module level;
// per-effect materials (anything that fades) are disposed when the effect ends.

export const RAINBOW = [0xff6f91, 0xff9f2e, 0xffe14d, 0x5fd36a, 0x3fb8ff, 0x8f6bff, 0xff79d0];
export const CONFETTI = [0xff5a6e, 0xffb627, 0xffe14d, 0x63d471, 0x3fb8ff, 0xa77bff, 0xff79d0, 0xffffff];
export const PASTEL = [0xffffff, 0xfff3d6, 0xffd6ea, 0xd9f0ff, 0xe8dcff, 0xfff8b8];
export const HEARTS = [0xff6fae, 0xff8fc8, 0xff4f9a, 0xffb3d9];
export const STARS = [0xffd84a, 0xfff18a, 0xffb627];
export const WATER = [0x3aa8ff, 0x7fd0ff, 0xbfe9ff, 0xffffff, 0x58b9ff];

const FONT = '"Baloo 2", "Fredoka One", "Fredoka", "Comic Sans MS", "Chalkboard SE", "Trebuchet MS", "Arial Rounded MT Bold", system-ui, sans-serif';

// ------------------------------------------------------------------ geometry
const geoCache = new Map();
const geo = (key, make) => {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
};

function starShape(points = 5, outer = 1, inner = 0.5) {
  const s = new THREE.Shape();
  for (let i = 0; i <= points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return s;
}

function heartShape() {
  const h = new THREE.Shape();
  h.moveTo(0, -0.95);
  h.bezierCurveTo(-0.35, -0.62, -1.0, -0.22, -1.0, 0.3);
  h.bezierCurveTo(-1.0, 0.82, -0.42, 1.02, 0, 0.56);
  h.bezierCurveTo(0.42, 1.02, 1.0, 0.82, 1.0, 0.3);
  h.bezierCurveTo(1.0, -0.22, 0.35, -0.62, 0, -0.95);
  return h;
}

const extruded = (shape, depth = 0.34) => {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.12, bevelSegments: 2, curveSegments: 10 });
  g.center();
  return g;
};

const G = {
  star: () => geo('star', () => extruded(starShape())),
  heart: () => geo('heart', () => extruded(heartShape(), 0.3)),
  confetti: () => geo('confetti', () => new THREE.PlaneGeometry(1, 0.55)),
  ball: () => geo('ball', () => new THREE.SphereGeometry(1, 18, 12)),
  drop: () => geo('drop', () => new THREE.IcosahedronGeometry(1, 1)),
  bubble: () => geo('bubble', () => new THREE.SphereGeometry(1, 32, 20)),
  ring: () =>
    geo('ring', () => {
      const g = new THREE.RingGeometry(0.82, 1, 48);
      g.rotateX(-Math.PI / 2);
      return g;
    }),
  disc: () =>
    geo('disc', () => {
      const g = new THREE.CircleGeometry(1, 48);
      g.rotateX(-Math.PI / 2);
      return g;
    }),
  crown: () => geo('crown', () => new THREE.CylinderGeometry(1, 0.55, 1, 28, 1, true).translate(0, 0.5, 0)),
  column: () => geo('column', () => new THREE.CylinderGeometry(0.75, 1, 1, 24, 4, true).translate(0, 0.5, 0)),
  feather: () =>
    geo('feather', () => {
      const f = new THREE.Shape();
      f.moveTo(0, -1);
      f.bezierCurveTo(0.5, -0.55, 0.42, 0.55, 0, 1);
      f.bezierCurveTo(-0.42, 0.55, -0.5, -0.55, 0, -1);
      return new THREE.ShapeGeometry(f, 10);
    }),
};

// ------------------------------------------------------------------ materials
const matCache = new Map();
// Glossy candy colours (lit, a touch of self-glow so they stay bright in shade).
export function candy(color, glow = 0.22) {
  const key = `c${color}:${glow}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0, emissive: color, emissiveIntensity: glow, side: THREE.DoubleSide }));
  }
  return matCache.get(key);
}

const BubbleShader = {
  uniforms: { time: { value: 0 }, opacity: { value: 1 } },
  vertexShader: /* glsl */ `
    varying vec3 vN; varying vec3 vV; varying vec3 vO;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      vO = normal;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float time; uniform float opacity;
    varying vec3 vN; varying vec3 vV; varying vec3 vO;
    vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
    void main() {
      vec3 n = normalize(vN);
      if (!gl_FrontFacing) n = -n;
      float f = 1.0 - abs(dot(n, normalize(vV)));
      float rim = pow(f, 2.0);
      vec3 film = hue(f * 1.3 + vO.y * 0.3 + vO.x * 0.15 + time * 0.15);
      vec3 col = mix(vec3(1.0), film, 0.62);
      float g1 = pow(max(dot(n, normalize(vec3(-0.45, 0.62, 0.64))), 0.0), 70.0);
      float g2 = pow(max(dot(n, normalize(vec3(0.5, -0.35, 0.8))), 0.0), 120.0) * 0.6;
      float glint = g1 + g2;
      float a = (0.07 + rim * 0.8 + glint) * opacity;
      gl_FragColor = vec4(col * (0.85 + rim * 0.5) + vec3(glint), clamp(a, 0.0, 1.0));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

const makeBubbleMat = () =>
  new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(BubbleShader.uniforms),
    vertexShader: BubbleShader.vertexShader,
    fragmentShader: BubbleShader.fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
let sharedBubbleMat = null;
const bubbleMat = () => (sharedBubbleMat ??= makeBubbleMat());

// ------------------------------------------------------------------ canvas textures
const texCache = new Map();
function canvasTexture(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.aspect = w / h;
  texCache.set(key, tex);
  return tex;
}

// Four-pointed twinkle.
const sparkleTexture = () =>
  canvasTexture('sparkle', 128, 128, (g) => {
    g.translate(64, 64);
    const glow = g.createRadialGradient(0, 0, 0, 0, 0, 40);
    glow.addColorStop(0, 'rgba(255,255,255,0.9)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow;
    g.fillRect(-64, -64, 128, 128);
    g.fillStyle = '#ffffff';
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 ? 9 : 62;
      const a = (i / 8) * Math.PI * 2;
      if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  });

const noteTexture = () =>
  canvasTexture('note', 96, 128, (g) => {
    g.lineJoin = 'round';
    const path = () => {
      g.beginPath();
      g.ellipse(32, 98, 20, 15, -0.4, 0, Math.PI * 2);
      g.moveTo(48, 96);
      g.lineTo(48, 18);
      g.lineTo(78, 34);
      g.lineTo(78, 50);
      g.lineTo(54, 38);
      g.lineTo(54, 96);
    };
    g.strokeStyle = '#2b1d4d';
    g.lineWidth = 12;
    path();
    g.stroke();
    g.fillStyle = '#ffffff';
    path();
    g.fill();
  });

function wordTexture(text) {
  const size = 104;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `900 ${size}px ${FONT}`;
  const w = Math.ceil(probe.measureText(text).width + size * 0.7);
  const h = Math.ceil(size * 1.45);
  return canvasTexture(`word:${text}`, w, h, (g) => {
    g.font = `900 ${size}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    const x = w / 2;
    const y = h / 2 + size * 0.04;
    g.strokeStyle = '#2b1d4d';
    g.lineWidth = size * 0.26;
    g.strokeText(text, x, y + size * 0.06);
    g.strokeText(text, x, y);
    g.strokeStyle = '#ffffff';
    g.lineWidth = size * 0.1;
    g.strokeText(text, x, y);
    // white fill; the sprite colour tints it
    g.fillStyle = '#ffffff';
    g.fillText(text, x, y);
  });
}

// ------------------------------------------------------------------ the effect system
function floorAt(x, z) {
  return Math.abs(x) < 7.85 && Math.abs(z) < 7.85 ? BOARD_Y : -0.02;
}

// Grow in, hold, shrink out.
const envelope = (k, inT, outT) => (k < inT ? Ease.outBack(k / inT) : k > 1 - outT ? Math.max(0, (1 - k) / outT) : 1);

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _u = new THREE.Vector3();

class KidFx {
  constructor(world) {
    this.world = world;
    this.anim = world.anim;
    this.layer = world.transient;
    this.items = [];
    this.time = 0;
    world.onFrame((dt) => this.step(dt));
  }

  add(obj) {
    obj.userData.kidFx = true;
    this.layer.add(obj);
    return obj;
  }

  // Remove an object from the scene and dispose what it owns (never shared/cached resources).
  release(obj) {
    obj.removeFromParent();
    obj.traverse((o) => {
      if (o.userData.ownMaterial) o.material.dispose();
    });
  }

  spawn(obj, o) {
    this.add(obj);
    const p = {
      obj,
      vel: o.vel ?? new THREE.Vector3(),
      spin: o.spin ?? new THREE.Vector3(),
      age: 0,
      life: o.life ?? 1,
      gravity: o.gravity ?? 0,
      drag: o.drag ?? 0,
      floor: o.floor ?? false,
      size: o.size ?? 0.05,
      env: o.env ?? [0.12, 0.25],
      sway: o.sway ?? 0,
      seed: Math.random() * 100,
      billboard: o.billboard ?? false,
      tilt: o.tilt ?? 0,
      fade: o.fade ?? null,
      twinkle: o.twinkle ?? false,
      onDone: o.onDone ?? null,
      stretch: o.stretch ?? null,
      rest: false,
    };
    obj.scale.setScalar(0.0001);
    this.items.push(p);
    return p;
  }

  step(dt) {
    if (dt <= 0) return;
    this.time += dt;
    if (sharedBubbleMat) sharedBubbleMat.uniforms.time.value = this.time;
    const cam = this.world.camera;
    const keep = [];
    const placed = [];
    for (const p of this.items) {
      const o = p.obj;
      if (o.parent !== this.layer) {
        // wiped by an aborted fight
        this.release(o);
        continue;
      }
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        this.release(o);
        p.onDone?.(o.position.clone());
        continue;
      }
      if (!p.rest) {
        p.vel.y -= p.gravity * dt;
        p.vel.multiplyScalar(Math.exp(-p.drag * dt));
        o.position.addScaledVector(p.vel, dt);
        if (p.sway) {
          o.position.x += Math.sin(p.age * 5 + p.seed) * p.sway * dt;
          o.position.z += Math.cos(p.age * 4 + p.seed) * p.sway * dt;
        }
        if (p.floor) {
          const f = floorAt(o.position.x, o.position.z) + p.size * 0.4;
          if (o.position.y < f) {
            o.position.y = f;
            if (Math.abs(p.vel.y) < 0.4) {
              p.rest = true;
              o.rotation.x = -Math.PI / 2;
            }
            p.vel.y *= -0.35;
            p.vel.x *= 0.5;
            p.vel.z *= 0.5;
          }
        }
        if (p.billboard) {
          o.quaternion.copy(cam.quaternion);
          o.rotateZ(p.tilt + Math.sin(p.age * 6 + p.seed) * 0.25);
        } else if (o.isSprite) {
          o.material.rotation += p.spin.z * dt;
        } else {
          o.rotation.x += p.spin.x * dt;
          o.rotation.y += p.spin.y * dt;
          o.rotation.z += p.spin.z * dt;
        }
      }
      let s = p.size * (p.twinkle ? Math.sin(Math.PI * Math.min(1, k)) : envelope(k, p.env[0], p.env[1]));
      if (p.stretch) {
        const sp = p.vel.length();
        o.scale.set(s, s * (1 + Math.min(1.5, sp * p.stretch)), s);
      } else if (o.isSprite && o.userData.aspect) {
        o.scale.set(s * o.userData.aspect, s, 1);
      } else {
        o.scale.setScalar(Math.max(s, 0.0001));
      }
      if (p.fade) o.material.opacity = p.fade * Math.min(1, (1 - k) * 4);
      if (p.onScreen) this.keepOnScreen(p, placed);
      keep.push(p);
    }
    this.items = keep;
  }

  // Comic words follow their (rising) anchor but are kept inside the frame (so a cut never crops
  // them), at most ~13% of the screen tall, and pushed down below older words they would cover.
  keepOnScreen(p, placed) {
    const o = p.obj;
    if (!p.anchor) p.anchor = o.position.clone();
    else p.anchor.add(_v.copy(o.position).sub(p.shown));
    const cam = this.world.camera;
    if (this.world.cinematic) cam.lookAt(this.world.controls.target);
    cam.updateMatrixWorld();
    const ndc = _w.copy(p.anchor).project(cam);
    if (ndc.z > -1 && ndc.z < 1) {
      const depth = _u.copy(p.anchor).applyMatrix4(cam.matrixWorldInverse).z * -1;
      const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
      let halfH = (o.scale.y * 0.5) / Math.max(0.05, depth * tanH);
      if (halfH > 0.13) {
        o.scale.multiplyScalar(0.13 / halfH);
        halfH = 0.13;
      }
      const halfW = (o.scale.x * 0.5) / Math.max(0.05, depth * tanH * cam.aspect);
      const mx = Math.max(0, 0.96 - halfW);
      const my = Math.max(0, 0.94 - halfH);
      ndc.x = THREE.MathUtils.clamp(ndc.x, -mx, mx);
      ndc.y = THREE.MathUtils.clamp(ndc.y, -my, my);
      for (const r of placed) {
        if (Math.abs(ndc.x - r.x) < halfW + r.w && Math.abs(ndc.y - r.y) < halfH + r.h) ndc.y = Math.max(-my, r.y - r.h - halfH - 0.01);
      }
      placed.push({ x: ndc.x, y: ndc.y, w: halfW, h: halfH });
      o.position.copy(ndc.unproject(cam));
    } else {
      o.position.copy(p.anchor);
    }
    p.shown = (p.shown ?? new THREE.Vector3()).copy(o.position);
  }

  sprite(tex, color, { additive = true, opacity = 1, onTop = false } = {}) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: !onTop,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const s = new THREE.Sprite(mat);
    s.userData.ownMaterial = true;
    if (onTop) s.renderOrder = 20;
    return s;
  }

  // ---------------------------------------------------------------- particles
  confetti(pos, { count = 40, speed = 2.2, up = 2.6, size = [0.03, 0.05], life = [1.6, 2.6], colors = CONFETTI, spread = 0.1 } = {}) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(G.confetti(), candy(pick(colors), 0.3));
      m.position.copy(pos).add(_v.set(rand(-spread, spread), rand(-spread, spread) * 0.5, rand(-spread, spread)));
      m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      const v = new THREE.Vector3(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.3, 1));
      v.y += up * rand(0.5, 1.1);
      this.spawn(m, { vel: v, spin: new THREE.Vector3(rand(-14, 14), rand(-14, 14), rand(-14, 14)), life: rand(...life), gravity: 3.2, drag: 2.0, sway: 0.7, floor: true, size: rand(...size), env: [0.05, 0.2] });
    }
  }

  starBurst(pos, { count = 10, colors = STARS, speed = 2.0, up = 0.8, size = [0.03, 0.055], life = [0.6, 1.0], gravity = 2 } = {}) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(G.star(), candy(pick(colors), 0.55));
      m.position.copy(pos);
      const v = new THREE.Vector3(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.5, 1));
      v.y += up * rand(0.4, 1);
      this.spawn(m, { vel: v, spin: new THREE.Vector3(rand(-3, 3), rand(-6, 6), rand(-9, 9)), life: rand(...life), gravity, drag: 2.2, size: rand(...size), env: [0.15, 0.35] });
    }
  }

  hearts(pos, { count = 6, spread = 0.22, rise = 0.55, size = [0.045, 0.075], life = [1.0, 1.6], colors = HEARTS } = {}) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(G.heart(), candy(pick(colors), 0.4));
      m.position.copy(pos).add(_v.set(rand(-spread, spread), rand(-spread, spread) * 0.6, rand(-spread, spread)));
      const v = new THREE.Vector3(rand(-0.3, 0.3), rise * rand(0.7, 1.3), rand(-0.3, 0.3));
      this.spawn(m, { vel: v, life: rand(...life), drag: 0.8, sway: 0.35, size: rand(...size), billboard: true, tilt: rand(-0.3, 0.3), env: [0.22, 0.3] });
    }
  }

  bubbles(pos, { count = 8, spread = 0.25, rise = 0.5, size = [0.025, 0.06], life = [1.0, 2.0], pops = true } = {}) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(G.bubble(), bubbleMat());
      m.position.copy(pos).add(_v.set(rand(-spread, spread), rand(-spread, spread) * 0.4, rand(-spread, spread)));
      const v = new THREE.Vector3(rand(-0.15, 0.15), rise * rand(0.6, 1.3), rand(-0.15, 0.15));
      const sz = rand(...size);
      this.spawn(m, {
        vel: v,
        life: rand(...life),
        gravity: -0.12,
        drag: 0.9,
        sway: 0.4,
        size: sz,
        env: [0.25, 0.02],
        onDone: pops ? (at) => this.sparkles(at, { count: 2, spread: sz * 0.5, size: [sz * 1.2, sz * 2], life: [0.18, 0.3], colors: [0xffffff, 0xbfe9ff] }) : null,
      });
    }
  }

  sparkles(pos, { count = 10, spread = 0.3, size = [0.06, 0.13], life = [0.35, 0.75], colors = RAINBOW, rise = 0.15 } = {}) {
    for (let i = 0; i < count; i++) {
      const s = this.sprite(sparkleTexture(), pick(colors));
      s.position.copy(pos).add(_v.set(rand(-spread, spread), rand(-spread, spread), rand(-spread, spread)));
      this.spawn(s, { vel: new THREE.Vector3(0, rise * rand(0.3, 1), 0), spin: new THREE.Vector3(0, 0, rand(-4, 4)), life: rand(...life), size: rand(...size), twinkle: true });
    }
  }

  // Rainbow sparkles streaming from a moving point. Returns stop().
  trail(getPos, { rate = 45, size = [0.05, 0.11], life = [0.4, 0.75], spread = 0.05, colors = RAINBOW } = {}) {
    let acc = 0;
    let hue = 0;
    return this.anim.every((dt) => {
      acc += dt * rate;
      const at = getPos();
      while (acc >= 1) {
        acc -= 1;
        const s = this.sprite(sparkleTexture(), colors[hue++ % colors.length]);
        s.position.copy(at).add(_v.set(rand(-spread, spread), rand(-spread, spread), rand(-spread, spread)));
        this.spawn(s, { vel: new THREE.Vector3(rand(-0.1, 0.1), rand(-0.25, 0.05), rand(-0.1, 0.1)), spin: new THREE.Vector3(0, 0, rand(-3, 3)), life: rand(...life), size: rand(...size), twinkle: true });
      }
    });
  }

  // Blue water droplets thrown from a point.
  droplets(pos, { count = 30, speed = 1.6, up = 2.4, size = [0.012, 0.028], life = [0.6, 1.1], horizontal = false, spread = 0.05 } = {}) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(G.drop(), candy(pick(WATER), 0.3));
      m.position.copy(pos).add(_v.set(rand(-spread, spread), rand(-spread, spread), rand(-spread, spread)));
      const v = horizontal
        ? new THREE.Vector3(Math.cos((i / count) * Math.PI * 2 + rand(-0.2, 0.2)), rand(0.1, 0.5), Math.sin((i / count) * Math.PI * 2 + rand(-0.2, 0.2))).multiplyScalar(speed * rand(0.6, 1.1))
        : new THREE.Vector3(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.3, 1)).add(_v.set(0, up * rand(0.5, 1.1), 0));
      this.spawn(m, { vel: v, life: rand(...life), gravity: 7, drag: 0.5, floor: true, size: rand(...size), env: [0.05, 0.3], stretch: 0.12 });
    }
  }

  // Soft glowing puffs (mist, steam).
  puffs(pos, { count = 5, color = 0xe8f6ff, size = [0.18, 0.3], spread = 0.12, rise = 0.25, life = [0.5, 0.9], opacity = 0.5 } = {}) {
    for (let i = 0; i < count; i++) {
      const s = this.sprite(getGlowTexture(), color, { additive: false, opacity });
      s.position.copy(pos).add(_v.set(rand(-spread, spread), rand(0, spread), rand(-spread, spread)));
      this.spawn(s, { vel: new THREE.Vector3(rand(-0.2, 0.2), rise, rand(-0.2, 0.2)), life: rand(...life), drag: 1.5, size: rand(...size), fade: opacity, env: [0.4, 0.05] });
    }
  }

  // Comic word ("BOING!") popping up; always drawn on top.
  word(pos, text, { color = 0xffd23a, size = 0.3, rise = 0.18, life = 1.1, tilt = rand(-0.18, 0.18) } = {}) {
    const tex = wordTexture(text);
    const s = this.sprite(tex, color, { additive: false, onTop: true });
    s.userData.aspect = tex.userData.aspect;
    s.material.rotation = tilt;
    s.position.copy(pos);
    const p = this.spawn(s, { vel: new THREE.Vector3(0, rise, 0), life, drag: 1.2, size, env: [0.22, 0.18] });
    p.onScreen = true;
    return s;
  }

  notes(pos, { count = 3, spread = 0.15, rise = 0.45, size = [0.07, 0.1], life = [0.9, 1.4], colors = [0xff79d0, 0x3fb8ff, 0xffd23a, 0x63d471, 0xa77bff] } = {}) {
    for (let i = 0; i < count; i++) {
      const s = this.sprite(noteTexture(), pick(colors), { additive: false });
      s.userData.aspect = 0.75;
      s.material.rotation = rand(-0.3, 0.3);
      s.position.copy(pos).add(_v.set(rand(-spread, spread), rand(0, spread), rand(-spread, spread)));
      this.spawn(s, { vel: new THREE.Vector3(rand(-0.1, 0.1), rise * rand(0.7, 1.2), rand(-0.1, 0.1)), spin: new THREE.Vector3(0, 0, rand(-0.8, 0.8)), life: rand(...life), drag: 0.6, sway: 0.5, size: rand(...size), env: [0.2, 0.3] });
    }
  }

  // Feathers drifting down (pastel).
  feathers(pos, { count = 16, speed = 1.6, up = 1.8, size = [0.04, 0.07], life = [1.6, 2.6], colors = PASTEL } = {}) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(G.feather(), candy(pick(colors), 0.15));
      m.position.copy(pos);
      m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      const v = new THREE.Vector3(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.3, 1));
      v.y += up * rand(0.5, 1.1);
      this.spawn(m, { vel: v, spin: new THREE.Vector3(rand(-4, 4), rand(-4, 4), rand(-4, 4)), life: rand(...life), gravity: 1.6, drag: 2.6, sway: 0.9, floor: true, size: rand(...size), env: [0.05, 0.25] });
    }
  }

  // ---------------------------------------------------------------- one-shot effects
  ring(pos, { color = 0xffffff, from = 0.15, to = 1.2, duration = 0.5, y = BOARD_Y + 0.02, opacity = 0.85 } = {}) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(G.ring(), mat);
    m.userData.ownMaterial = true;
    m.position.copy(pos).setY(y);
    this.add(m);
    return this.anim
      .tween(duration, (k) => {
        const s = from + (to - from) * k;
        m.scale.set(s, 1, s);
        mat.opacity = opacity * (1 - k);
      }, Ease.outCubic)
      .then(() => this.release(m));
  }

  rainbowRings(pos, { to = 1.2, duration = 0.6, colors = [0xff5a6e, 0xffe14d, 0x3fb8ff], gap = 0.07 } = {}) {
    colors.forEach((color, i) => this.anim.wait(i * gap).then(() => this.ring(pos, { color, to: to * (1 - i * 0.12), duration, opacity: 0.9 })));
  }

  // Cartoon "poof" cloud. Resolves when it has blown away. `hold` keeps it boiling (e.g. a dog-pile).
  async poof(pos, { size = 0.4, hold = 0, color = 0xffffff, count = 10, stars = true, squash = 0.75 } = {}) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95, emissive: color, emissiveIntensity: 0.18, transparent: true, opacity: 1 });
    const group = this.add(new THREE.Group());
    group.position.copy(pos);
    const balls = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(G.ball(), mat);
      const a = (i / count) * Math.PI * 2 + rand(-0.3, 0.3);
      const r = i === 0 ? 0 : size * rand(0.45, 0.8);
      m.position.set(Math.cos(a) * r, rand(-0.25, 0.35) * size * squash, Math.sin(a) * r);
      const s = size * (i === 0 ? 0.8 : rand(0.42, 0.62));
      m.userData.s = s;
      m.userData.ph = rand(0, 6);
      m.scale.setScalar(0.001);
      group.add(m);
      balls.push(m);
    }
    if (stars) this.starBurst(pos, { count: 8, speed: 2.4, size: [0.03, 0.05] });
    await this.anim.tween(0.16, (k) => balls.forEach((b) => b.scale.setScalar(b.userData.s * Ease.outBack(k))));
    if (hold > 0) {
      let next = 0;
      await this.anim.tween(hold, (k, raw) => {
        const t = raw * hold;
        balls.forEach((b) => b.scale.setScalar(b.userData.s * (1 + 0.14 * Math.sin(t * 16 + b.userData.ph))));
        group.rotation.y = Math.sin(t * 5) * 0.2;
        if (stars && t > next) {
          next = t + 0.16;
          const b = pick(balls);
          this.starBurst(group.localToWorld(b.position.clone()), { count: 2, speed: 1.6, size: [0.025, 0.045] });
        }
      });
    }
    await this.anim.tween(0.38, (k) => {
      balls.forEach((b) => b.scale.setScalar(b.userData.s * (1 + 0.35 * k)));
      mat.opacity = 1 - Ease.inQuad(k);
      group.position.y = pos.y + k * 0.12;
    });
    group.removeFromParent();
    mat.dispose();
  }

  // Stars circling a head. `at` is an Object3D or a function returning a world position.
  dizzy(at, { radius = 0.17, count = 5, size = 0.05, speed = 6, lift = 0.14 } = {}) {
    const group = this.add(new THREE.Group());
    const center = typeof at === 'function' ? at : () => at.getWorldPosition(new THREE.Vector3());
    const stars = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(G.star(), candy(i % 2 ? 0xfff18a : 0xffd84a, 0.6));
      m.scale.setScalar(size);
      group.add(m);
      stars.push(m);
    }
    let t = 0;
    let scale = 0;
    let target = 1;
    const update = (dt) => {
      t += dt;
      scale += (target - scale) * (1 - Math.exp(-dt * 14));
      group.position.copy(center()).add(_v.set(0, lift, 0));
      group.scale.setScalar(Math.max(0.001, scale));
      stars.forEach((m, i) => {
        const a = t * speed + (i / count) * Math.PI * 2;
        m.position.set(Math.cos(a) * radius, Math.sin(a * 2 + i) * 0.025, Math.sin(a) * radius);
        m.rotation.set(0, -a, t * 5);
      });
    };
    update(0);
    const stopUpdate = this.anim.every(update);
    return {
      stop: async () => {
        target = 0;
        await this.anim.wait(0.25);
        stopUpdate();
        group.removeFromParent();
      },
    };
  }

  // Bright blue splash: droplets, a crown of water, a ring and spray mist.
  splash(pos, { power = 1, crown = true } = {}) {
    const p = pos.clone();
    this.droplets(p.clone().setY(BOARD_Y + 0.08), { count: Math.round(45 * power), speed: 1.7 * power, up: 2.6 * power, size: [0.014, 0.03] });
    this.puffs(p.clone().setY(BOARD_Y + 0.15), { count: Math.round(4 * power), size: [0.25 * power, 0.4 * power], rise: 0.4 });
    this.ring(p, { color: 0xbfe9ff, from: 0.2, to: 0.9 * power, duration: 0.6, opacity: 0.9 });
    if (!crown) return;
    const mat = new THREE.MeshStandardMaterial({ color: 0x6cc8ff, emissive: 0x2d8fe0, emissiveIntensity: 0.25, roughness: 0.1, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });
    const m = new THREE.Mesh(G.crown(), mat);
    m.userData.ownMaterial = true;
    m.position.copy(p).setY(BOARD_Y);
    this.add(m);
    this.anim
      .tween(0.65, (k) => {
        const r = (0.18 + 0.42 * Ease.outCubic(k)) * power;
        m.scale.set(r, Math.sin(Math.min(1, k * 1.4) * Math.PI) * 0.42 * power + 0.001, r);
        mat.opacity = 0.75 * (1 - k * k);
      })
      .then(() => this.release(m));
  }

  // A water spout shooting up from a point. Returns { mesh, setHeight(h), done() }.
  spout(pos, radius = 0.22) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x7fd0ff, emissive: 0x2a88d8, emissiveIntensity: 0.35, roughness: 0.05, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
    const m = new THREE.Mesh(G.column(), mat);
    m.userData.ownMaterial = true;
    m.position.copy(pos).setY(BOARD_Y);
    m.scale.set(radius, 0.001, radius);
    this.add(m);
    return {
      mesh: m,
      material: mat,
      setHeight: (h, wob = 0) => {
        m.scale.set(radius * (1 + wob), Math.max(0.001, h), radius * (1 - wob));
      },
      done: () => this.release(m),
    };
  }

  // A flat coloured puddle on the board (caller animates scale, then calls done()).
  puddle(pos, { radius = 0.6, color = 0x2f9bff } = {}) {
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.92 });
    const m = new THREE.Mesh(G.disc(), mat);
    m.userData.ownMaterial = true;
    m.position.copy(pos).setY(BOARD_Y + 0.012);
    m.scale.set(radius * 0.01, 1, radius * 0.01);
    this.add(m);
    return {
      mesh: m,
      material: mat,
      setSize: (k) => m.scale.set(Math.max(0.001, radius * k), 1, Math.max(0.001, radius * k)),
      done: () => this.release(m),
    };
  }

  // Emits droplets falling from a moving point (a soaked animal). Returns stop().
  drips(getPos, { rate = 12, spread = 0.12 } = {}) {
    let acc = 0;
    return this.anim.every((dt) => {
      acc += dt * rate;
      const at = getPos();
      while (acc >= 1) {
        acc -= 1;
        const m = new THREE.Mesh(G.drop(), candy(pick(WATER), 0.3));
        m.position.copy(at).add(_v.set(rand(-spread, spread), rand(-0.05, 0.05), rand(-spread, spread)));
        this.spawn(m, { vel: new THREE.Vector3(0, -0.2, 0), life: 0.6, gravity: 6, floor: true, size: rand(0.01, 0.018), env: [0.1, 0.3], stretch: 0.15 });
      }
    });
  }

  // A soft mound of pillow-puffs and feathers to land in. Returns { group, show(), hide() }.
  featherPile(pos, { radius = 0.42 } = {}) {
    const group = this.add(new THREE.Group());
    group.position.copy(pos).setY(BOARD_Y);
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = i === 0 ? 0 : radius * (i % 2 ? 0.55 : 0.82);
      const m = new THREE.Mesh(G.ball(), candy(PASTEL[i % PASTEL.length], 0.1));
      m.position.set(Math.cos(a) * r, 0.04, Math.sin(a) * r);
      const s = radius * (i === 0 ? 0.5 : rand(0.28, 0.36));
      m.scale.set(s, s * 0.55, s);
      group.add(m);
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      const m = new THREE.Mesh(G.feather(), candy(pick([0xffffff, 0xffd6ea, 0xd9f0ff, 0xfff3d6]), 0.15));
      m.position.set(Math.cos(a) * radius * 0.75, 0.12, Math.sin(a) * radius * 0.75);
      // feather tilted outwards and up from the mound
      m.rotation.order = 'YXZ';
      m.rotation.set(-0.7, Math.PI / 2 - a, 0);
      m.scale.setScalar(rand(0.08, 0.11));
      group.add(m);
    }
    group.scale.setScalar(0.001);
    return {
      group,
      show: () => this.anim.tween(0.35, (k) => group.scale.setScalar(Math.max(0.001, Ease.outBack(k)))),
      squish: (amt) => group.scale.set(1 + amt * 0.25, Math.max(0.05, 1 - amt * 0.5), 1 + amt * 0.25),
      hide: async () => {
        const at = group.position.clone().setY(BOARD_Y + 0.12);
        const cloud = this.poof(at, { size: radius * 0.8, stars: false });
        await this.anim.wait(0.12);
        group.removeFromParent();
        await cloud;
      },
    };
  }

  // A big shiny soap bubble (own material). Dispose with release(mesh).
  bigBubble(radius) {
    const mat = makeBubbleMat();
    const m = new THREE.Mesh(G.bubble(), mat);
    m.userData.ownMaterial = true;
    m.userData.radius = radius;
    m.renderOrder = 5;
    m.scale.setScalar(0.001);
    this.add(m);
    const tick = this.anim.every((dt) => {
      mat.uniforms.time.value += dt;
      if (!m.parent) return false;
    });
    m.userData.stopTick = tick;
    return m;
  }
}

const instances = new WeakMap();
export function kidFx(world) {
  let k = instances.get(world);
  if (!k) {
    k = new KidFx(world);
    instances.set(world, k);
  }
  return k;
}
