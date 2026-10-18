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

export class Effects {
  constructor(world) {
    this.world = world;
    this.layer = world.transient;
    this.anim = world.anim;
    this.particles = [];
    world.onFrame((dt) => this.step(dt));
  }

  clear() {
    this.particles = [];
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
    const base = { colors, life: [0.8, 1.6], size: [0.01, 0.026] };
    if (kind === 'feather') this.burst(pos, { ...base, count: 26 * power, shape: 'feather', speed: 3.5, up: 2.5, size: [0.03, 0.05], life: [1.6, 2.6] });
    else if (kind === 'fur') this.burst(pos, { ...base, count: 30 * power, shape: 'sphere', speed: 3.5, up: 2.5 });
    else if (kind === 'scale') this.burst(pos, { ...base, count: 30 * power, shape: 'shard', speed: 3.5, up: 2.5 });
    else if (kind === 'water') {
      this.burst(pos, { ...base, count: 34 * power, shape: 'sphere', colors: [0x2a86d8, 0x8fd3ff, 0xffffff], speed: 3, up: 3.5, size: [0.03, 0.07] });
    } else if (kind === 'shard') this.burst(pos, { ...base, count: 28 * power, shape: 'shard', speed: 4, up: 2.5 });
    else this.burst(pos, { ...base, count: 26 * power, shape: 'cube', speed: 3, up: 2 });
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
}
