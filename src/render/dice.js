import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Ease, arc, clamp, rand } from '../engine/anim.js';
import { AXES, sampleThrow, throwShowing } from '../engine/dicePhysics.js';
import { DiceTrays, TRAY, trayBounds, trayCenter } from './diceTray.js';

const SIZE = 0.72;
const ROUND = 0.1;
const HOVER = 0.85; // height of the waiting die's centre above the felt
const UP = new THREE.Vector3(0, 1, 0);
// BoxGeometry material order (+x, -x, +y, -y, +z, -z, the same order as AXES). Opposite faces sum to 7.
const FACE_VALUES = [3, 4, 1, 6, 2, 5];

const PIPS = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

// Kids-mode die: candy-coloured pips, a different colour on every face.
const KID_PIP_COLORS = { 1: '#ff4f86', 2: '#ff9a1f', 3: '#2fbf63', 4: '#2f8cff', 5: '#9b5cff', 6: '#ff4747' };

function faceTexture(value, kids = false) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 110, 20, 128, 128, 190);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, kids ? '#fff1dc' : '#e9e4da');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  for (const [x, y] of PIPS[value]) {
    const cx = 64 + x * 64;
    const cy = 64 + y * 64;
    g.beginPath();
    g.arc(cx, cy, kids ? (value === 1 ? 36 : 25) : value === 1 ? 30 : 22, 0, Math.PI * 2);
    g.fillStyle = kids ? KID_PIP_COLORS[value] : value === 1 ? '#d32f2f' : '#1b1b1b';
    g.fill();
    g.beginPath();
    g.arc(cx - 6, cy - 7, kids ? 8 : 6, 0, Math.PI * 2);
    g.fillStyle = kids ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.25)';
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const faceMaterials = (kids) =>
  FACE_VALUES.map((v) => new THREE.MeshStandardMaterial({ map: faceTexture(v, kids), roughness: kids ? 0.3 : 0.35, metalness: 0.0 }));

export class Dice {
  constructor(world, fx, sfx, theme = 'action') {
    this.world = world;
    this.anim = world.anim;
    this.fx = fx;
    this.sfx = sfx;
    this.trays = new DiceTrays(world.scene, theme);
    const geo = new RoundedBoxGeometry(SIZE, SIZE, SIZE, 4, ROUND);
    this.faceMats = { action: faceMaterials(false), kids: null };
    this.mesh = new THREE.Mesh(geo, this.faceMats.action);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    world.scene.add(this.mesh);
    this.mesh.position.copy(trayCenter(0)).setY(TRAY.floor + HOVER);
    this.mesh.visible = false;
    this.seat = 0;
    this.hovering = false;
    this.hoverBase = new THREE.Vector3();
    // While held the die rattles in the hand and follows the pointer; `power` builds with time.
    this.hold = null;
    // The pointer is projected onto this plane to steer the held die.
    this.holdPlane = new THREE.Plane(UP, -(TRAY.floor + HOVER));

    this.glow = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.5, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.visible = false;
    world.scene.add(this.glow);

    const spinAxis = new THREE.Vector3();
    const dq = new THREE.Quaternion();
    world.onFrame((dt, time) => {
      if (this.hold) {
        const h = this.hold;
        h.time += dt;
        h.power = Math.min(1, h.time / 0.9);
        const before = this.mesh.position.clone();
        this.mesh.position.lerp(h.target, 1 - Math.exp(-dt * 18));
        const speed = before.distanceTo(this.mesh.position) / Math.max(dt, 1e-4);
        h.energy += (Math.min(speed, 12) - h.energy) * Math.min(1, dt * 8);
        // rattle: a quick, jittery tumble that gets wilder the harder it is shaken
        spinAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        dq.setFromAxisAngle(spinAxis, dt * (7 + 9 * h.power + h.energy * 1.5));
        this.mesh.quaternion.premultiply(dq);
        const j = 0.012 + 0.02 * h.power;
        this.mesh.position.x += (Math.random() - 0.5) * j;
        this.mesh.position.y += (Math.random() - 0.5) * j;
        this.glow.position.x = this.mesh.position.x;
        this.glow.position.z = this.mesh.position.z;
        const s = 1 + h.power * 0.7 + Math.sin(time * 18) * 0.04 * h.power;
        this.glow.scale.set(s, s, s);
        this.glow.material.opacity = 0.55 + 0.4 * h.power;
        h.rattle -= dt;
        if (h.rattle <= 0) {
          this.sfx?.play('diceRattle', { power: 0.35 + 0.4 * h.power + Math.min(0.3, h.energy / 20) });
          h.rattle = 0.06 + Math.random() * 0.07 - Math.min(0.03, h.energy / 300);
        }
        return;
      }
      if (!this.hovering) return;
      this.mesh.position.copy(this.hoverBase);
      this.mesh.position.y += Math.sin(time * 3) * 0.1;
      this.mesh.rotation.x += dt * 0.9;
      this.mesh.rotation.y += dt * 1.3;
      const s = 1 + Math.sin(time * 5) * 0.08;
      this.glow.scale.set(s, s, s);
    });
    this.setTheme(theme);
  }

  setTheme(theme) {
    const kids = theme === 'kids';
    if (kids) this.faceMats.kids ??= faceMaterials(true);
    this.mesh.material = kids ? this.faceMats.kids : this.faceMats.action;
    // a slightly chunkier, toy-like die for little hands
    this.mesh.scale.setScalar(kids ? 1.12 : 1);
    this.trays.setTheme(theme);
    this.theme = kids ? 'kids' : 'action';
  }

  setSeats(seats) {
    this.trays.setSeats(seats);
  }

  // Let go of the die without throwing it (the game was interrupted).
  drop() {
    this.hold = null;
  }

  hide() {
    this.hovering = false;
    this.hold = null;
    this.glow.visible = false;
    this.mesh.visible = false;
  }

  get size() {
    return SIZE * this.mesh.scale.x;
  }

  get held() {
    return !!this.hold;
  }

  trayCenter(seat = this.seat) {
    return trayCenter(seat);
  }

  // Float the die above the given player's tray, waiting to be thrown.
  async present(seat, colorHex) {
    this.hovering = false;
    this.hold = null;
    const to = trayCenter(seat).setY(TRAY.floor + HOVER);
    if (!this.mesh.visible) {
      this.mesh.visible = true;
      this.mesh.position.copy(to);
    }
    const from = this.mesh.position.clone();
    this.seat = seat;
    this.glow.material.color.setHex(colorHex);
    this.glow.material.opacity = 0.7;
    this.glow.scale.setScalar(1);
    this.glow.position.copy(to).setY(TRAY.floor + 0.01);
    const dist = from.distanceTo(to);
    if (dist > 0.05) {
      this.sfx?.play('whoosh', { dur: 0.3 });
      await this.anim.tween(Math.min(0.75, 0.3 + dist * 0.025), (k) => {
        this.mesh.position.lerpVectors(from, to, k);
        this.mesh.position.y += arc(k, Math.min(3, dist * 0.2));
      }, Ease.inOutCubic);
    }
    this.hoverBase.copy(to);
    this.hovering = true;
    this.glow.visible = true;
  }

  // ---------------------------------------------------------------- the throw
  // Inner zone the held die is kept within, so it always starts the throw over the felt.
  clampToTray(p) {
    const b = trayBounds(this.seat);
    const m = this.size / 2 + 0.12;
    p.x = clamp(p.x, b.minX + m, b.maxX - m);
    p.z = clamp(p.z, b.minZ + m, b.maxZ - m);
    p.y = TRAY.floor + HOVER;
    return p;
  }

  // Pick the die up: it rattles in the hand until released.
  grab() {
    if (this.hold) return;
    this.hovering = false;
    this.glow.visible = true;
    this.hold = { time: 0, power: 0, energy: 0, rattle: 0, target: this.clampToTray(this.mesh.position.clone()), trail: [] };
    this.sfx?.play('diceShake');
  }

  // Move the held die toward a point on the hover plane (from the pointer). The fling is measured
  // from the raw pointer motion, so a flick toward a wall still counts even though the die stops.
  aim(point) {
    if (!this.hold) return;
    this.hold.target.copy(this.clampToTray(point.clone()));
    const now = performance.now() / 1000;
    this.hold.trail.push({ t: now, p: point.clone() });
    while (this.hold.trail.length > 2 && now - this.hold.trail[0].t > 0.12) this.hold.trail.shift();
  }

  // Let go. A flick throws the die the way it was flung; otherwise it is tossed with the
  // strength built up while shaking. Returns the launch state for `throw()`.
  release() {
    const h = this.hold ?? { time: 0, power: 0, energy: 0, trail: [] };
    this.hold = null;
    const tr = h.trail;
    const fling = new THREE.Vector3();
    if (tr.length >= 2) {
      const a = tr[0];
      const b = tr[tr.length - 1];
      const dt = b.t - a.t;
      if (dt > 0.01 && performance.now() / 1000 - b.t < 0.15) fling.subVectors(b.p, a.p).setY(0).divideScalar(dt);
    }
    let dir;
    let speed;
    if (fling.length() > 1.2) {
      dir = fling.clone().normalize();
      speed = clamp(fling.length() * 0.9, 2.4, 8.5);
    } else {
      const ang = rand(0, Math.PI * 2);
      dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
      // a quick tap gets a toss of random strength; otherwise the longer the shake, the harder
      speed = 2.4 + 4.6 * (h.time < 0.15 ? rand(0.25, 0.75) : h.power);
    }
    const pos = this.clampToTray(this.mesh.position.clone());
    const vel = dir.clone().multiplyScalar(speed).setY(rand(0.6, 1.0) + 1.0 * h.power);
    // tumble forward along the throw, with some wobble and the shake's energy on top
    const axis = new THREE.Vector3().crossVectors(UP, dir).add(new THREE.Vector3(rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5))).normalize();
    const spin = axis.multiplyScalar(8 + speed * 1.8 + rand(0, 5) + Math.min(6, h.energy * 0.5));
    return { pos, vel, spin, power: Math.max(h.power, speed / 8.5) };
  }

  // CPU players: a quick shake, then a toss in a random direction.
  async autoThrow() {
    this.grab();
    const c = this.hoverBase.clone();
    const phase = rand(0, Math.PI * 2);
    await this.anim.tween(rand(0.3, 0.45), (k) => {
      const a = phase + k * 14;
      if (this.hold) this.hold.target = this.clampToTray(c.clone().add(new THREE.Vector3(Math.cos(a) * 0.18, 0, Math.sin(a) * 0.18)));
    });
    if (this.hold) this.hold.power = rand(0.4, 0.9);
    return this.release();
  }

  // Throw the die so it comes to rest showing `value`, which was rolled fairly beforehand. The
  // tumble is real physics fitted to that value (see throwShowing): the gesture shapes the throw,
  // never the result.
  async throw(value, spec) {
    this.hovering = false;
    this.hold = null;
    this.glow.visible = false;
    const { sim, label } = throwShowing(AXES[FACE_VALUES.indexOf(value)], {
      size: this.size,
      round: ROUND * this.mesh.scale.x,
      pos: spec.pos,
      vel: spec.vel,
      spin: spec.spin,
      quat: this.mesh.quaternion,
      bounds: trayBounds(this.seat),
    });

    this.sfx?.play('whoosh', { dur: 0.25 });
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    let next = 0;
    let landed = false;
    await this.anim.tween(sim.duration, (_, k) => {
      const t = k * sim.duration;
      sampleThrow(sim, t, p, q);
      this.mesh.position.copy(p);
      this.mesh.quaternion.copy(q).multiply(label);
      while (next < sim.hits.length && sim.hits[next].t <= t) {
        const hit = sim.hits[next++];
        this.sfx?.play(hit.wall ? 'diceWall' : 'diceHit', { power: 0.3 + 0.7 * hit.power });
        if (!hit.wall && !landed) {
          landed = true;
          this.fx.dust(p.clone().setY(TRAY.floor + 0.02), 6, this.theme === 'kids' ? 0xffffff : 0xcfc4ae);
        }
      }
    });
    this.mesh.position.copy(sim.rest.p);
    this.mesh.quaternion.copy(sim.rest.q).multiply(label);
    return value;
  }

  // A little flourish once the die has settled; a six gets the full treatment.
  celebrate(value, colorHex) {
    const at = this.mesh.position.clone();
    const kids = this.theme === 'kids';
    this.fx.ring(at, { color: value === 6 ? 0xffd34d : colorHex, from: 0.3, to: value === 6 ? 2.2 : 1.3, duration: 0.5, y: TRAY.floor + 0.012, opacity: 0.8 });
    if (value === 6) {
      this.fx.sparks(at.clone().setY(at.y + this.size * 0.6), kids ? 0xff79d0 : 0xffd34d, 26, 3.4);
      this.sfx?.play('diceSix');
    } else {
      this.sfx?.play('diceSettle', { value });
    }
  }
}
