import * as THREE from 'three';
import { Ease } from '../engine/anim.js';
import { BOARD_Y, yardSpot } from './boardMesh.js';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
// Every shot is framed wider than its choreography asks, so the fight's action stays in view:
// distances are scaled up and the lens never gets narrower than MIN_FOV.
const FRAMING = { action: 1.4, kids: 1.2 };
const MIN_FOV = 34;
// How much of the frame a fitted group may fill (the action letterbox trims the top and bottom).
const FIT_MARGIN_V = 0.74;
const FIT_MARGIN_H = 0.85;
// How far a line of sight keeps from a blocker (the subject is not a point, nor is the frame).
const CLEARANCE = 0.2;
// Yaw / pitch nudges (degrees) tried, smallest first, when something stands between a shot and its subject.
const DODGES = [15, -15, 30, -30, 45, -45, 60, -60, 80, -80].map((y) => [y, 0]).concat([[0, 14], [20, 14], [-20, 14], [0, 28], [40, 28], [-40, 28]]);

// Shot language for battles, expressed in the fight's own frame:
//   yaw 0 = side-on, +90 = from beyond the victim looking back, -90 = over the attacker's shoulder.
//   pitch = elevation in degrees, dist = distance to the subject, lift = subject height above the board.
export class Director {
  constructor(world) {
    this.world = world;
    this.anim = world.anim;
    this.scale = 1;
  }

  // `scale` pushes every shot further out for bulky animals (on top of the mode's framing).
  begin(A, V, scale = 1, look = 'action') {
    this.scale = scale * (FRAMING[look] ?? 1);
    this.look = look;
    this.A = A.clone();
    this.V = V.clone();
    this.f = V.clone().sub(A).setY(0);
    if (this.f.lengthSq() < 1e-6) this.f.set(0, 0, 1);
    this.f.normalize();
    this.r = new THREE.Vector3(-this.f.z, 0, this.f.x);
    const toCam = this.world.camera.position.clone().sub(A).setY(0);
    if (this.r.dot(toCam) < 0) this.r.negate();
    this.mid = A.clone().add(V).multiplyScalar(0.5);
    this.blockers = this.findBlockers();
    this.world.setCinematicLook(true, this.mid, look);
  }

  // Things a shot must not look through, as vertical cylinders: the cages round the yards, the gem
  // in the middle of the board and every other piece standing on it.
  findBlockers() {
    const list = [{ x: 0, z: 0, r: 0.4, top: BOARD_Y + 1.0 }];
    const p = new THREE.Vector3();
    for (let seat = 0; seat < 4; seat++) {
      for (let i = 0; i < 4; i++) {
        yardSpot(seat, i, p);
        list.push({ x: p.x, z: p.z, r: 0.52, top: BOARD_Y + 1.45 });
      }
    }
    for (const o of this.world.scene.children) {
      if (!o.userData.tokenView || !o.visible) continue;
      const far = (q) => Math.hypot(o.position.x - q.x, o.position.z - q.z) > 0.3;
      if (far(this.A) && far(this.V)) list.push({ x: o.position.x, z: o.position.z, r: 0.34 * o.scale.x, top: o.position.y + 0.8 * o.scale.x });
    }
    return list;
  }

  // Whether the line from a shot's subject to the camera runs through one of the blockers.
  blocked({ pos, target }) {
    if (!this.blockers) return false;
    const len = pos.distanceTo(target);
    const q = new THREE.Vector3();
    for (let s = 0.3; s <= len + 0.05; s += 0.08) {
      q.lerpVectors(target, pos, Math.min(1, s / len));
      for (const b of this.blockers) {
        if (q.y < b.top && (q.x - b.x) ** 2 + (q.z - b.z) ** 2 < (b.r + CLEARANCE) ** 2) return true;
      }
    }
    return false;
  }

  // The shot itself, or the nearest variation of it (swung round and/or raised) with a clear view.
  dodge(spec) {
    if (!this.blocked(this.pose(spec))) return spec;
    const yaw = spec.yaw ?? 0;
    const pitch = spec.pitch ?? 18;
    for (const [dy, dp] of DODGES) {
      const alt = { ...spec, yaw: yaw + dy, pitch: Math.min(70, pitch + dp) };
      if (!this.blocked(this.pose(alt))) return alt;
    }
    return spec;
  }

  end() {
    this.world.setCinematicLook(false);
    const f0 = this.world.camera.fov;
    const f1 = this.world.baseFov;
    if (Math.abs(f0 - f1) > 0.1) this.anim.tween(0.6, (k) => this.world.setFov(f0 + (f1 - f0) * k), Ease.inOutCubic);
  }

  // Board-level anchor points in the fight frame.
  at(name) {
    if (name === 'A') return this.A.clone();
    if (name === 'V') return this.V.clone();
    return this.mid.clone();
  }

  // `fit: [a, b, ...]` (points or functions returning points) frames a group instead of `at`: the
  // shot aims at their centre and backs off as far as it takes to keep every one of them in frame.
  pose({ at = this.mid, yaw = 0, pitch = 18, dist = 3, lift = 0.4, fit = null, fov = null } = {}) {
    const pts = fit?.map((q) => (typeof q === 'function' ? q() : q).clone());
    const p = pts ? pts.reduce((s, q) => s.add(q), new THREE.Vector3()).divideScalar(pts.length) : typeof at === 'function' ? at() : at.clone();
    const y = yaw * DEG;
    const pt = pitch * DEG;
    const dir = this.r
      .clone()
      .multiplyScalar(Math.cos(y) * Math.cos(pt))
      .addScaledVector(this.f, Math.sin(y) * Math.cos(pt))
      .addScaledVector(UP, Math.sin(pt));
    const target = p.add(UP.clone().multiplyScalar(lift));
    let d = dist * this.scale;
    if (pts) {
      const cam = this.world.camera;
      const tv = Math.tan(Math.max(MIN_FOV, fov ?? cam.fov) * DEG * 0.5);
      // keep inside the letterbox, with a margin round the edges
      const tanV = tv * FIT_MARGIN_V;
      const tanH = tv * cam.aspect * FIT_MARGIN_H;
      const right = UP.clone().cross(dir).normalize();
      const up = dir.clone().cross(right);
      for (const q of pts) {
        const rel = q.sub(target);
        const along = rel.dot(dir);
        d = Math.max(d, along + Math.abs(rel.dot(right)) / tanH, along + Math.abs(rel.dot(up)) / tanV);
      }
    }
    const pos = target.clone().addScaledVector(dir, d);
    pos.y = Math.max(pos.y, BOARD_Y + 0.06); // never under the board
    return { pos, target };
  }

  // Hard cut.
  cut(spec) {
    const { pos, target } = this.pose(this.dodge(spec));
    this.world.camera.position.copy(pos);
    this.world.controls.target.copy(target);
    if (spec.fov) this.world.setFov(Math.max(MIN_FOV, spec.fov));
  }

  // Smooth camera move to a new shot.
  move(spec, duration = 0.6, ease = Ease.inOutCubic) {
    const { pos, target } = this.pose(this.dodge(spec));
    if (spec.fov) {
      const f0 = this.world.camera.fov;
      const f1 = Math.max(MIN_FOV, spec.fov);
      this.anim.tween(duration, (k) => this.world.setFov(f0 + (f1 - f0) * k), ease);
    }
    return this.world.cameraTo(pos, target, duration, ease);
  }

  // Keep re-framing a (moving) subject every frame until the returned stop() is called.
  // (The angle is chosen once, from where the subject starts, so the shot never jumps.)
  track(spec, rate = 7) {
    const shot = this.dodge(spec);
    return this.anim.every((dt) => this.world.follow(this.pose(shot), dt, rate));
  }

  // Swing around the subject from yawFrom to yawTo. If the sweep would pass behind a cage or the
  // gem, it swings the other way round, a shorter way, or from higher up instead.
  orbit(spec, yawTo, duration = 1.2, ease = Ease.inOutSine) {
    const y0 = spec.yaw ?? 0;
    const sweep = yawTo - y0;
    const clear = (s, from, by) => {
      for (let i = 0; i <= 12; i++) if (this.blocked(this.pose({ ...s, yaw: from + (by * i) / 12 }))) return false;
      return true;
    };
    const options = [
      [spec, y0, sweep],
      [spec, y0, -sweep],
      [spec, y0, sweep * 0.5],
      [spec, y0, -sweep * 0.5],
      [{ ...spec, pitch: (spec.pitch ?? 18) + 18 }, y0, sweep],
      [{ ...spec, pitch: (spec.pitch ?? 18) + 18 }, y0, -sweep],
    ];
    const [s, from, by] = options.find(([o, f, b]) => clear(o, f, b)) ?? options[0];
    return this.anim.tween(duration, (k) => {
      const { pos, target } = this.pose({ ...s, yaw: from + by * k });
      this.world.camera.position.copy(pos);
      this.world.controls.target.copy(target);
    }, ease);
  }

  // Kids battles keep slow motion light and playful.
  slowmo(factor = 0.2, hold = 0.9) {
    if (this.look === 'kids') this.world.slowmo(Math.max(0.4, factor), Math.min(hold, 0.7));
    else this.world.slowmo(factor, hold);
  }

  // Action: a red flash (kept fairly soft) and a jolt. Kids: a soft sunny pop and a little wobble.
  impact(power = 1) {
    const kids = this.look === 'kids';
    this.world.flash((kids ? 0.35 : 0.3) * power);
    this.world.shake((kids ? 0.07 : 0.12) * power);
  }
}
