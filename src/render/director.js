import * as THREE from 'three';
import { Ease } from '../engine/anim.js';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

// Shot language for battles, expressed in the fight's own frame:
//   yaw 0 = side-on, +90 = from beyond the victim looking back, -90 = over the attacker's shoulder.
//   pitch = elevation in degrees, dist = distance to the subject, lift = subject height above the board.
export class Director {
  constructor(world) {
    this.world = world;
    this.anim = world.anim;
    this.scale = 1;
  }

  // `scale` pushes every shot further out for bulky animals.
  begin(A, V, scale = 1, look = 'action') {
    this.scale = scale;
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
    this.world.setCinematicLook(true, this.mid, look);
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

  pose({ at = this.mid, yaw = 0, pitch = 18, dist = 3, lift = 0.4 } = {}) {
    const p = typeof at === 'function' ? at() : at.clone();
    const y = yaw * DEG;
    const pt = pitch * DEG;
    const dir = this.r
      .clone()
      .multiplyScalar(Math.cos(y) * Math.cos(pt))
      .addScaledVector(this.f, Math.sin(y) * Math.cos(pt))
      .addScaledVector(UP, Math.sin(pt));
    const target = p.add(UP.clone().multiplyScalar(lift));
    return { pos: target.clone().addScaledVector(dir, dist * this.scale), target };
  }

  // Hard cut.
  cut(spec) {
    const { pos, target } = this.pose(spec);
    this.world.camera.position.copy(pos);
    this.world.controls.target.copy(target);
    if (spec.fov) this.world.setFov(spec.fov);
  }

  // Smooth camera move to a new shot.
  move(spec, duration = 0.6, ease = Ease.inOutCubic) {
    const { pos, target } = this.pose(spec);
    if (spec.fov) {
      const f0 = this.world.camera.fov;
      this.anim.tween(duration, (k) => this.world.setFov(f0 + (spec.fov - f0) * k), ease);
    }
    return this.world.cameraTo(pos, target, duration, ease);
  }

  // Keep re-framing a (moving) subject every frame until the returned stop() is called.
  track(spec, rate = 7) {
    return this.anim.every((dt) => this.world.follow(this.pose(spec), dt, rate));
  }

  // Swing around the subject from yawFrom to yawTo.
  orbit(spec, yawTo, duration = 1.2, ease = Ease.inOutSine) {
    const y0 = spec.yaw ?? 0;
    return this.anim.tween(duration, (k) => this.cut({ ...spec, yaw: y0 + (yawTo - y0) * k, fov: undefined }), ease);
  }

  // Kids battles keep slow motion light and playful.
  slowmo(factor = 0.2, hold = 0.9) {
    if (this.look === 'kids') this.world.slowmo(Math.max(0.4, factor), Math.min(hold, 0.7));
    else this.world.slowmo(factor, hold);
  }

  // Action: a hard red flash and a jolt. Kids: a soft sunny pop and a little wobble.
  impact(power = 1) {
    const kids = this.look === 'kids';
    this.world.flash((kids ? 0.35 : 0.6) * power);
    this.world.shake((kids ? 0.07 : 0.12) * power);
  }
}
