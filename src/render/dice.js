import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Ease, arc, rand } from '../engine/anim.js';
import { BOARD_Y, yardCenter } from './boardMesh.js';

const SIZE = 0.72;
// BoxGeometry material order: +x, -x, +y, -y, +z, -z. Opposite faces sum to 7.
const FACE_VALUES = [3, 4, 1, 6, 2, 5];
const FACE_NORMALS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];

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
    const geo = new RoundedBoxGeometry(SIZE, SIZE, SIZE, 4, 0.1);
    this.faceMats = { action: faceMaterials(false), kids: null };
    this.mesh = new THREE.Mesh(geo, this.faceMats.action);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    world.scene.add(this.mesh);
    this.mesh.position.set(0, BOARD_Y + SIZE / 2 + 1.0, 0);
    this.mesh.visible = false;
    this.hovering = false;
    this.hoverBase = new THREE.Vector3();
    this.seat = null;

    this.glow = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.5, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.visible = false;
    world.scene.add(this.glow);

    world.onFrame((dt, time) => {
      if (!this.hovering) return;
      this.mesh.position.copy(this.hoverBase);
      this.mesh.position.y += Math.sin(time * 3) * 0.12;
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
    this.theme = kids ? 'kids' : 'action';
  }

  hide() {
    this.hovering = false;
    this.glow.visible = false;
    this.mesh.visible = false;
  }

  restPosition(seat) {
    return yardCenter(seat).setY(BOARD_Y + (SIZE * this.mesh.scale.y) / 2);
  }

  // Float the die above the given player's yard, waiting to be rolled.
  async present(seat, colorHex) {
    this.hovering = false;
    if (!this.mesh.visible) {
      this.mesh.visible = true;
      this.mesh.position.copy(this.restPosition(seat)).setY(BOARD_Y + 1.25);
    }
    const from = this.mesh.position.clone();
    const to = this.restPosition(seat).setY(BOARD_Y + 1.25);
    this.seat = seat;
    this.glow.material.color.setHex(colorHex);
    this.glow.position.copy(this.restPosition(seat)).setY(BOARD_Y + 0.02);
    const dist = from.distanceTo(to);
    if (dist > 0.05) {
      await this.anim.tween(Math.min(0.7, 0.25 + dist * 0.04), (k) => {
        this.mesh.position.lerpVectors(from, to, k);
        this.mesh.position.y += arc(k, Math.min(3, dist * 0.3));
      }, Ease.inOutCubic);
    }
    this.hoverBase.copy(to);
    this.hovering = true;
    this.glow.visible = true;
  }

  orientationFor(value) {
    const idx = FACE_VALUES.indexOf(value);
    const q = new THREE.Quaternion().setFromUnitVectors(FACE_NORMALS[idx], new THREE.Vector3(0, 1, 0));
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(0, Math.PI * 2));
    return yaw.multiply(q);
  }

  // Throw the die; it tumbles, bounces and settles showing `value`.
  async roll(value) {
    this.hovering = false;
    this.glow.visible = false;
    const seat = this.seat ?? 0;
    const rest = this.restPosition(seat).add(new THREE.Vector3(rand(-0.25, 0.25), 0, rand(-0.25, 0.25)));
    const start = this.mesh.position.clone();
    start.y += 0.6;
    const qEnd = this.orientationFor(value);
    const axis = new THREE.Vector3(rand(-1, 1), rand(-0.3, 0.3), rand(-1, 1)).normalize();
    const spin = Math.PI * 2 * Math.round(rand(3, 5)) + rand(0, Math.PI);
    const g = 20;
    const h0 = start.y - rest.y;
    const bounces = [0.55, 0.2, 0.06];
    const segs = [{ t: Math.sqrt((2 * h0) / g), kind: 'fall' }];
    for (const h of bounces) segs.push({ t: 2 * Math.sqrt((2 * h) / g), h, kind: 'bounce' });
    const total = segs.reduce((s, x) => s + x.t, 0) + 0.15;
    this.sfx?.play('diceShake');
    let lastSeg = -1;
    const qTmp = new THREE.Quaternion();
    await this.anim.tween(total, (_, k) => {
      const t = k * total;
      // vertical position from the bounce schedule
      let acc = 0;
      let y = 0;
      let segIndex = segs.length;
      for (let i = 0; i < segs.length; i++) {
        if (t < acc + segs[i].t) {
          const lt = t - acc;
          segIndex = i;
          if (segs[i].kind === 'fall') y = h0 - 0.5 * g * lt * lt;
          else y = arc(lt / segs[i].t, segs[i].h);
          break;
        }
        acc += segs[i].t;
      }
      if (segIndex !== lastSeg && segIndex > 0) {
        const power = segIndex < segs.length ? 1 / segIndex : 0.2;
        this.sfx?.play('diceHit', { power });
        if (segIndex === 1) this.fx.dust(rest.clone(), 6, 0xdcd3c0);
      }
      lastSeg = segIndex;
      const hk = Ease.outQuad(Math.min(1, k * 1.15));
      this.mesh.position.lerpVectors(start, rest, hk);
      this.mesh.position.y = rest.y + Math.max(0, y);
      const remaining = spin * Math.pow(1 - Math.min(1, k * 1.08), 2.2);
      qTmp.setFromAxisAngle(axis, remaining);
      this.mesh.quaternion.copy(qEnd).multiply(qTmp);
    });
    this.mesh.position.copy(rest);
    this.mesh.quaternion.copy(qEnd);
    return value;
  }
}
