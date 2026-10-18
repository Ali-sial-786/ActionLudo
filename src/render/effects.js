import * as THREE from 'three';
import { Ease, rand, pick } from '../engine/anim.js';
import { BOARD_Y } from './boardMesh.js';

const SHAPES = {
  cube: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.IcosahedronGeometry(1, 0),
  feather: (() => {
    const g = new THREE.PlaneGeometry(1, 0.3);
    return g;
  })(),
  shard: new THREE.TetrahedronGeometry(1),
  ring: new THREE.RingGeometry(0.86, 1, 48),
};
SHAPES.ring.rotateX(-Math.PI / 2);

const matCache = new Map();
function particleMat(color, glow) {
  const key = `${color}:${glow}`;
  if (!matCache.has(key)) {
    matCache.set(
      key,
      glow
        ? new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
        : new THREE.MeshStandardMaterial({ color, roughness: 0.6, flatShading: true, side: THREE.DoubleSide }),
    );
  }
  return matCache.get(key);
}

let glowTexture = null;
export function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

function floorAt(x, z) {
  return Math.abs(x) < 7.85 && Math.abs(z) < 7.85 ? BOARD_Y : -0.02;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();

export class Effects {
  constructor(world) {
    this.world = world;
    this.layer = world.transient;
    this.stoppers = new Set();
    this.anim = world.anim;
    this.particles = [];
    this.debrisSets = new Set();
    world.onFrame((dt) => this.step(dt));
  }

  clear() {
    for (const stop of [...this.stoppers]) stop();
    this.particles = [];
    this.debrisSets.clear();
    this.world.clearTransient();
  }

  // ------------------------------------------------------------ particles
  burst(pos, o = {}) {
    const {
      count = 20,
      colors = [0xffffff],
      shape = 'cube',
      speed = 3,
      up = 2,
      gravity = 9,
      size = [0.04, 0.09],
      life = [0.6, 1.2],
      drag = 0.6,
      glow = false,
      dir = null,
      dirSpeed = 0,
      flutter = shape === 'feather',
      spread = 1,
      floor = true,
      grow = 0,
    } = o;
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(SHAPES[shape], particleMat(pick(colors), glow));
      const s = rand(size[0], size[1]);
      mesh.scale.setScalar(s);
      if (shape === 'feather') mesh.scale.set(s * 2.4, s * 2.4, s * 2.4);
      mesh.position.copy(pos);
      mesh.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      mesh.castShadow = !glow && s > 0.05;
      const v = new THREE.Vector3(rand(-1, 1), rand(-1, 1) * spread, rand(-1, 1));
      if (v.lengthSq() < 1e-4) v.set(0, 1, 0);
      v.normalize().multiplyScalar(speed * rand(0.35, 1));
      v.y += up * rand(0.5, 1.2);
      if (dir) v.addScaledVector(dir, dirSpeed * rand(0.6, 1.2));
      const maxLife = rand(life[0], life[1]);
      this.particles.push({
        mesh,
        vel: v,
        ang: new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12)),
        life: maxLife,
        maxLife,
        gravity: flutter ? gravity * 0.12 : gravity,
        drag: flutter ? 2.5 : drag,
        flutter,
        size: mesh.scale.x,
        floor,
        grow,
      });
      this.layer.add(mesh);
    }
  }

  dust(pos, count = 14, color = 0xd9ccb0) {
    this.burst(pos, {
      count,
      colors: [color, 0xece4d2, 0xf5f0e6],
      shape: 'sphere',
      speed: 1.6,
      up: 0.6,
      gravity: -0.6,
      size: [0.03, 0.07],
      life: [0.35, 0.65],
      drag: 3.5,
      spread: 0.2,
      grow: 1.4,
    });
  }

  sparks(pos, color = 0xffd34d, count = 18, speed = 4) {
    this.burst(pos, { count, colors: [color, 0xffffff], shape: 'cube', speed, up: 1.5, size: [0.025, 0.05], life: [0.3, 0.7], glow: true, gravity: 6 });
  }

  victimBurst(pos, debris, power = 1) {
    const { kind, colors } = debris;
    const base = { colors, life: [0.8, 1.6] };
    if (kind === 'feather') this.burst(pos, { ...base, count: 26 * power, shape: 'feather', speed: 3.5, up: 2.5, size: [0.04, 0.07], life: [1.6, 2.6] });
    else if (kind === 'fur') this.burst(pos, { ...base, count: 30 * power, shape: 'sphere', speed: 3.5, up: 2.5, size: [0.03, 0.07] });
    else if (kind === 'scale') this.burst(pos, { ...base, count: 30 * power, shape: 'shard', speed: 3.5, up: 2.5, size: [0.03, 0.06] });
    else if (kind === 'water') {
      this.burst(pos, { ...base, count: 34 * power, shape: 'sphere', colors: [0x2a86d8, 0x8fd3ff, 0xffffff], speed: 3, up: 3.5, size: [0.03, 0.07] });
    } else if (kind === 'shard') this.burst(pos, { ...base, count: 28 * power, shape: 'shard', speed: 4, up: 2.5, size: [0.03, 0.07] });
    else this.burst(pos, { ...base, count: 26 * power, shape: 'cube', speed: 3, up: 2, size: [0.03, 0.07] });
  }

  step(dt) {
    if (dt <= 0) return;
    const keep = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) {
        this.layer.remove(p.mesh);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.flutter) {
        p.mesh.position.x += Math.sin(p.life * 7 + p.size * 100) * dt * 0.6;
      }
      const f = p.floor ? floorAt(p.mesh.position.x, p.mesh.position.z) + 0.01 : -Infinity;
      if (p.mesh.position.y < f) {
        p.mesh.position.y = f;
        p.vel.y *= -0.3;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
        p.ang.multiplyScalar(0.5);
      }
      _e.set(p.ang.x * dt, p.ang.y * dt, p.ang.z * dt);
      p.mesh.quaternion.multiply(_q.setFromEuler(_e));
      const k = p.life / p.maxLife;
      const fade = k < 0.3 ? k / 0.3 : 1;
      const g = p.grow ? 1 + (1 - k) * p.grow : 1;
      p.mesh.scale.setScalar(p.size * fade * g);
      keep.push(p);
    }
    this.particles = keep;

    for (const set of this.debrisSets) this.stepDebris(set, dt);
  }

  // ------------------------------------------------------------ one-shot effects
  async ring(pos, { color = 0xffffff, from = 0.2, to = 2.5, duration = 0.5, y = BOARD_Y + 0.02, opacity = 0.9 } = {}) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(SHAPES.ring, mat);
    mesh.position.copy(pos).setY(y);
    this.layer.add(mesh);
    await this.anim.tween(
      duration,
      (k) => {
        const s = from + (to - from) * k;
        mesh.scale.set(s, 1, s);
        mat.opacity = opacity * (1 - k);
      },
      Ease.outCubic,
    );
    this.layer.remove(mesh);
    mat.dispose();
  }

  async flash(pos, { color = 0xffffff, size = 2, duration = 0.35 } = {}) {
    const mat = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(pos);
    this.layer.add(sprite);
    await this.anim.tween(duration, (k) => {
      sprite.scale.setScalar(size * (0.4 + k * 0.8));
      mat.opacity = 1 - k;
    });
    this.layer.remove(sprite);
    mat.dispose();
  }

  // Comic-book text popup in 3D.
  async text(pos, str, { color = '#ffdd33', stroke = '#2a0a00', size = 1.2, hold = 0.5 } = {}) {
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    const font = 'italic 900 96px "Bangers", "Impact", "Arial Black", sans-serif';
    g.font = font;
    const w = Math.ceil(g.measureText(str).width) + 60;
    c.width = w;
    c.height = 140;
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 16;
    g.strokeStyle = stroke;
    g.strokeText(str, w / 2, 72);
    g.fillStyle = color;
    g.fillText(str, w / 2, 72);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 10;
    sprite.position.copy(pos);
    const aspect = w / 140;
    this.layer.add(sprite);
    const tilt = rand(-0.25, 0.25);
    mat.rotation = tilt;
    await this.anim.tween(0.22, (k) => sprite.scale.set(size * aspect * 0.3 * k, size * 0.3 * k, 1), Ease.outBack);
    await this.anim.wait(hold);
    const y0 = sprite.position.y;
    await this.anim.tween(0.35, (k) => {
      sprite.position.y = y0 + k * 0.5;
      mat.opacity = 1 - k;
    });
    this.layer.remove(sprite);
    mat.dispose();
    tex.dispose();
  }

  // Three glowing claw marks raked across a point, facing the camera.
  async slashes(pos, { color = 0xff4040, angle = rand(-0.6, 0.6), size = 0.9 } = {}) {
    const group = new THREE.Group();
    group.position.copy(pos);
    group.lookAt(this.world.camera.position);
    const streaks = [];
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, 0.05), mat);
      m.position.set(0, (i - 1) * 0.15, 0.3);
      m.rotation.z = angle - 0.8;
      m.renderOrder = 9;
      m.scale.x = 0.01;
      group.add(m);
      streaks.push(m);
    }
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false });
    for (const s of streaks) {
      const core = new THREE.Mesh(new THREE.PlaneGeometry(size, 0.016), white);
      core.renderOrder = 10;
      s.add(core);
    }
    this.layer.add(group);
    await this.anim.tween(0.1, (k) => streaks.forEach((s) => (s.scale.x = k)), Ease.outCubic);
    await this.anim.tween(0.35, (k) => {
      streaks.forEach((s) => (s.material.opacity = 1 - k));
      white.opacity = 1 - k;
    });
    this.layer.remove(group);
    group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
  }

  // Cartoon "dizzy stars" orbiting above an object. Returns a stop function.
  dizzy(target, height = 0.75) {
    const group = new THREE.Group();
    const geo = new THREE.OctahedronGeometry(0.06, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe14d });
    const stars = [];
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(geo, mat);
      group.add(s);
      stars.push(s);
    }
    this.layer.add(group);
    let t = 0;
    const tmp = new THREE.Vector3();
    const stop = this.world.onFrame((dt) => {
      t += dt;
      target.getWorldPosition(tmp);
      group.position.set(tmp.x, tmp.y + height, tmp.z);
      stars.forEach((s, i) => {
        const a = t * 5 + (i * Math.PI * 2) / 3;
        s.position.set(Math.cos(a) * 0.28, Math.sin(a * 2) * 0.04, Math.sin(a) * 0.28);
        s.rotation.y = t * 8;
      });
    });
    const remove = () => {
      stop();
      this.stoppers.delete(remove);
      this.layer.remove(group);
      geo.dispose();
      mat.dispose();
    };
    this.stoppers.add(remove);
    return remove;
  }

  // ------------------------------------------------------------ tearing animals apart
  // Detaches every mesh of a token's model into world space and throws the pieces around.
  ripApart(view, { power = 3, up = 2.5, dir = null, dirPower = 0, spin = 12, gravity = 9.8 } = {}) {
    view.isolateMaterials();
    const center = new THREE.Vector3();
    view.model.getWorldPosition(center);
    center.y += 0.25;
    const meshes = view.meshes();
    const pieces = [];
    view.root.updateMatrixWorld(true);
    for (const mesh of meshes) {
      const parent = mesh.parent;
      this.layer.attach(mesh);
      const out = mesh.position.clone().sub(center);
      out.y = Math.max(out.y, 0) * 0.5;
      if (out.lengthSq() < 1e-4) out.set(rand(-1, 1), 0, rand(-1, 1));
      out.normalize();
      const vel = out.multiplyScalar(power * rand(0.5, 1.3)).add(new THREE.Vector3(rand(-0.8, 0.8), up * rand(0.6, 1.4), rand(-0.8, 0.8)));
      if (dir) vel.addScaledVector(dir, dirPower * rand(0.6, 1.3));
      pieces.push({
        mesh,
        parent,
        vel,
        ang: new THREE.Vector3(rand(-spin, spin), rand(-spin, spin), rand(-spin, spin)),
        gravity,
        rest: false,
      });
    }
    const set = { pieces, view };
    view.debris = set;
    this.debrisSets.add(set);
    return set;
  }

  stepDebris(set, dt) {
    for (const p of set.pieces) {
      if (p.rest) continue;
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const s = p.mesh.scale;
      const half = Math.min(s.x, s.y, s.z) * 0.8;
      const f = floorAt(p.mesh.position.x, p.mesh.position.z) + half;
      if (p.mesh.position.y < f) {
        p.mesh.position.y = f;
        if (Math.abs(p.vel.y) < 0.6) {
          p.vel.set(0, 0, 0);
          p.rest = true;
        } else {
          p.vel.y *= -0.35;
          p.vel.x *= 0.55;
          p.vel.z *= 0.55;
          p.ang.multiplyScalar(0.5);
        }
      }
      _e.set(p.ang.x * dt, p.ang.y * dt, p.ang.z * dt);
      p.mesh.quaternion.multiply(_q.setFromEuler(_e));
    }
  }

  // Pull the debris back together onto the (already reset) model.
  async reassemble(view, duration = 0.9) {
    const set = view.debris;
    if (!set) return;
    this.debrisSets.delete(set);
    view.root.updateMatrixWorld(true);
    const jobs = set.pieces.map((p) => {
      const r = p.mesh.userData.rest;
      _m.compose(r.position, r.quaternion, r.scale).premultiply(p.parent.matrixWorld);
      const tPos = new THREE.Vector3();
      const tQuat = new THREE.Quaternion();
      const tScale = new THREE.Vector3();
      _m.decompose(tPos, tQuat, tScale);
      return {
        ...p,
        p0: p.mesh.position.clone(),
        q0: p.mesh.quaternion.clone(),
        s0: p.mesh.scale.clone(),
        tPos,
        tQuat,
        tScale,
        delay: Math.random() * 0.35,
      };
    });
    await this.anim.tween(duration, (k) => {
      for (const j of jobs) {
        const t = Ease.inOutCubic(Math.min(1, Math.max(0, (k - j.delay) / (1 - j.delay))));
        j.mesh.position.lerpVectors(j.p0, j.tPos, t);
        j.mesh.position.y += Math.sin(t * Math.PI) * 0.6;
        j.mesh.quaternion.slerpQuaternions(j.q0, j.tQuat, t);
        j.mesh.scale.lerpVectors(j.s0, j.tScale, t);
      }
    });
    for (const j of jobs) {
      j.parent.attach(j.mesh);
      const r = j.mesh.userData.rest;
      j.mesh.position.copy(r.position);
      j.mesh.quaternion.copy(r.quaternion);
      j.mesh.scale.copy(r.scale);
    }
    view.debris = null;
  }
}
