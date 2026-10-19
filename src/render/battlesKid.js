import * as THREE from 'three';
import { Ease, arc, clamp, lerp } from '../engine/anim.js';
import { BOARD_Y } from './boardMesh.js';
import { createAnimal } from './animals.js';
import { kidFx, candy } from './kidEffects.js';
import '../engine/kidSounds.js';

// Kids mode: playful, bloodless "capture" battles — bonks, tickles, splashes, hugs and bounces.
//
// Contract (same ctx as battles.js / makeContext):
//   KID_ATTACKS[animal](ctx)  one choreography per attacking animal. Never uses ctx.gore.
//     End state: attacker model at local (0, 0.07, ctx.dist) with rotation (0, 0, 0) (standing on the
//     victim's square), victim upright and visible a little beyond ctx.V, materials restored.
//   kidVictimReacts(ctx)      a startled little hop with a "!" before the attack.
//   kidFloatHome({ world, anim, fx, sfx, vic, spot })
//     wraps the victim in a soap bubble that floats over the board to `spot` (its yard spot) and pops;
//     resolves with vic.root exactly at spot. The controller then closes the cage.
//
// Frames: the attacker's model offsets are in its root's frame (+z towards the victim, so (0, y, dist)
// is the victim's square). The victim is moved with vic.root (world, on the board) and posed with
// vpose(), which rotates/squashes its model about the body's centre while keeping it on the board.

const UP = new THREE.Vector3(0, 1, 0);
const I = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);
const VIC_REST = new THREE.Vector3(0, 0.07, 0);
const YARD_SCALE = 0.86; // matches the controller's yard scale, so there is no jump when it takes over

const wpos = (obj, out = new THREE.Vector3()) => obj.getWorldPosition(out);
const lifted = (v, y) => v.clone().add(new THREE.Vector3(0, y, 0));
const along = (ctx, a, s = 0) => ctx.V.clone().addScaledVector(ctx.dir, a).addScaledVector(sideOf(ctx), s).setY(BOARD_Y);
const sideOf = (ctx) => new THREE.Vector3(-ctx.dir.z, 0, ctx.dir.x);
const endPos = (ctx) => new THREE.Vector3(0, 0.07, ctx.dist);
// How far beyond the square the loser ends up, so the two noses don't bump: near V, yet clear of the winner.
const restGap = (ctx) => clamp(dims(ctx.atk).front + dims(ctx.vic).front + 0.1, 0.62, 1.15);
const endSpot = (ctx, s = 0) => along(ctx, restGap(ctx), s);

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const Q = (x = 0, y = 0, z = 0) => new THREE.Quaternion().setFromEuler(_e.set(x, y, z, 'YXZ'));
// Volume-preserving squash (sy < 1) / stretch (sy > 1).
const squash = (sy) => new THREE.Vector3(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));

// Fires fn at most once per `interval` seconds of a tween's own clock.
function every(interval, fn, start = 0) {
  let next = start;
  return (t) => {
    if (t >= next) {
      next = t + interval;
      fn(t);
    }
  };
}

// ------------------------------------------------------------------ measuring and posing models
const dimCache = new WeakMap();
// Rest-pose bounding box of a view's model, in its root's frame (relative to the model origin).
function dims(view) {
  let d = dimCache.get(view);
  if (d) return d;
  const root = view.root;
  const m = view.model;
  const saved = [root.position.clone(), root.quaternion.clone(), root.scale.clone(), m.position.clone(), m.quaternion.clone(), m.scale.clone()];
  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.scale.set(1, 1, 1);
  m.position.set(0, 0, 0);
  m.quaternion.identity();
  m.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  const inv = root.parent ? root.parent.matrixWorld.clone().invert() : new THREE.Matrix4();
  const box = new THREE.Box3().setFromObject(m, true).applyMatrix4(inv);
  root.position.copy(saved[0]);
  root.quaternion.copy(saved[1]);
  root.scale.copy(saved[2]);
  m.position.copy(saved[3]);
  m.quaternion.copy(saved[4]);
  m.scale.copy(saved[5]);
  root.updateMatrixWorld(true);
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.15, 0, -0.3), new THREE.Vector3(0.15, 0.45, 0.3));
  d = {
    hx: (box.max.x - box.min.x) / 2,
    hy: (box.max.y - box.min.y) / 2,
    hz: (box.max.z - box.min.z) / 2,
    cy: (box.min.y + box.max.y) / 2,
    cz: (box.min.z + box.max.z) / 2,
    top: box.max.y,
    front: box.max.z,
    back: -box.min.z,
  };
  dimCache.set(view, d);
  return d;
}

const _m4 = new THREE.Matrix4();
const _c = new THREE.Vector3();
// Rotate (and scale) a model about its body centre so it rests on the board, `up` above it.
// `cy` instead pins the centre's height (root frame) directly.
function vpose(view, q = I, { scale = ONE, up = 0, cy = null } = {}) {
  const d = dims(view);
  _m4.makeRotationFromQuaternion(q);
  const e = _m4.elements;
  const support = Math.abs(e[1]) * d.hx * scale.x + Math.abs(e[5]) * d.hy * scale.y + Math.abs(e[9]) * d.hz * scale.z;
  const c = _c.set(0, d.cy, d.cz).multiply(scale).applyQuaternion(q);
  view.model.quaternion.copy(q);
  view.model.scale.copy(scale);
  view.model.position.set(0, cy ?? 0.07 + support + up, d.cz).sub(c);
}
const restCy = (view) => 0.07 + dims(view).hy;

const centerPoint = (view) => view.model.localToWorld(new THREE.Vector3(0, dims(view).cy, dims(view).cz));
const topPoint = (view) => {
  const d = dims(view);
  return view.model.localToWorld(new THREE.Vector3(0, d.cy + d.hy, d.cz));
};
function headPoint(view) {
  if (view.parts.head) return wpos(view.parts.head);
  const d = dims(view);
  return view.model.localToWorld(new THREE.Vector3(0, d.cy + d.hy * 0.5, d.cz + d.hz * 0.6));
}

// Set a part's rotation relative to its rest pose.
function poseRel(obj, x = 0, y = 0, z = 0) {
  if (!obj) return;
  const r = obj.userData.rest;
  if (!r) {
    obj.rotation.set(x, y, z);
    return;
  }
  obj.quaternion.copy(r.quaternion).multiply(_q.setFromEuler(_e.set(x, y, z, 'XYZ')));
}

// Ease every part back to its rest pose and the model to `modelPos` (unrotated, unscaled).
function settle(anim, view, dur, modelPos, { hop = 0, ease = Ease.inOutQuad } = {}) {
  const nodes = [];
  view.model.traverse((o) => {
    if (o !== view.model && o.userData.rest) nodes.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]);
  });
  const mp = view.model.position.clone();
  const mq = view.model.quaternion.clone();
  const ms = view.model.scale.clone();
  const target = modelPos.clone();
  return anim.tween(
    dur,
    (k, raw) => {
      for (const [o, p, q, s] of nodes) {
        const r = o.userData.rest;
        o.position.lerpVectors(p, r.position, k);
        o.quaternion.slerpQuaternions(q, r.quaternion, k);
        o.scale.lerpVectors(s, r.scale, k);
      }
      view.model.position.lerpVectors(mp, target, k);
      view.model.position.y += arc(raw, hop);
      view.model.quaternion.slerpQuaternions(mq, I, k);
      view.model.scale.lerpVectors(ms, ONE, k);
    },
    ease,
  );
}

function setZ(view, z, y = null) {
  view.model.position.z = z;
  if (y !== null) view.model.position.y = 0.07 + y;
}

const _rq = new THREE.Quaternion();
// Rotate the model about X while keeping a model-space point (e.g. the hind feet) planted.
function rotateAbout(view, rotX, pivot, scale, base) {
  view.model.rotation.set(rotX, 0, 0);
  view.model.scale.setScalar(scale);
  _rq.setFromEuler(_e.set(rotX, 0, 0));
  const moved = pivot.clone().multiplyScalar(scale).applyQuaternion(_rq);
  view.model.position.copy(base).add(pivot).sub(moved);
}

const LIMB_NAMES = ['legFL', 'legFR', 'legBL', 'legBR', 'armL', 'armR', 'legL', 'legR', 'wingL', 'wingR', 'clawL', 'clawR'];
function limbsOf(view) {
  const p = view.parts;
  return LIMB_NAMES.map((n) => p[n]).filter(Boolean).concat(p.legs ?? []);
}

// Happy paddling legs, a laughing jaw and a bobbing head.
function kick(view, t, a = 1) {
  limbsOf(view).forEach((l, i) => poseRel(l, Math.sin(t * 19 + i * 1.7) * 0.5 * a, 0, 0));
  const p = view.parts;
  if (p.jaw) poseRel(p.jaw, Math.abs(Math.sin(t * 15)) * 0.4 * a, 0, 0);
  if (p.head) poseRel(p.head, Math.sin(t * 13) * 0.14 * a, Math.sin(t * 8) * 0.22 * a, 0);
  if (p.tail && !Array.isArray(p.tail)) poseRel(p.tail, 0, Math.sin(t * 18) * 0.5 * a, 0);
  if (Array.isArray(p.tail)) p.tail.forEach((seg, i) => poseRel(seg, 0, Math.sin(t * 14 - i) * 0.15 * a, 0));
}

// Quadruped running gait.
function gait(p, t, amp = 0.6) {
  if (!p.legFL || !p.legBR) return;
  const s = Math.sin(t);
  p.legFL.rotation.x = p.legBR.rotation.x = s * amp;
  p.legFR.rotation.x = p.legBL.rotation.x = -s * amp;
}

function wagTail(p, t, amp = 0.6) {
  if (p.tail && !Array.isArray(p.tail)) p.tail.rotation.y = Math.sin(t * 30) * amp;
}

// Put a victim that was parented to an attacker part back where it belongs: upright root on the
// board under its body centre, the model keeping its exact world pose. Returns the model's
// relative rotation and centre height, to animate from.
function detach(ctx) {
  const { vic } = ctx;
  const d = dims(vic);
  const home = ctx.kid.home;
  const c = centerPoint(vic);
  const qWorld = vic.model.getWorldQuaternion(new THREE.Quaternion());
  if (vic.root.parent !== home) home.attach(vic.root);
  const yaw = new THREE.Euler().setFromQuaternion(vic.root.quaternion, 'YXZ').y;
  vic.root.quaternion.setFromEuler(_e.set(0, yaw, 0, 'YXZ'));
  vic.root.scale.setScalar(1);
  const offset = new THREE.Vector3(0, 0, d.cz).applyQuaternion(vic.root.quaternion);
  vic.root.position.set(c.x - offset.x, BOARD_Y, c.z - offset.z);
  vic.root.updateMatrixWorld(true);
  const q = vic.root.quaternion.clone().invert().multiply(qWorld);
  const cy = c.y - BOARD_Y;
  vpose(vic, q, { cy });
  return { q, cy };
}

// The victim ends dizzy: stars circle its head while it sways, then it straightens up.
async function dizzyEnd(ctx, dur = 1.2, { cam = true } = {}) {
  const { vic, anim, sfx } = ctx;
  const K = kidFx(ctx.world);
  const d = dims(vic);
  if (cam) {
    // a two-shot: the winner on the square, the dizzy loser just beyond it
    const vp = vic.root.position.clone();
    const sep = Math.hypot(vp.x - ctx.V.x, vp.z - ctx.V.z);
    ctx.D.move({ at: ctx.V.clone().lerp(vp, 0.5), yaw: 24, pitch: 14, dist: 1.9 + sep * 0.6, lift: 0.4, fov: 36 }, 0.5);
  }
  const stars = K.dizzy(() => headPoint(vic), { radius: clamp(d.hx * 1.0, 0.15, 0.24), lift: 0.15 });
  sfx.play('wobble', { dur: dur * 0.8 });
  sfx.play('tweet', { delay: dur * 0.45 });
  const head = vic.parts.head;
  await anim.tween(dur, (k, raw) => {
    const t = raw * dur;
    const a = 1 - 0.5 * k;
    vpose(vic, Q(-0.08, Math.sin(t * 3) * 0.1 * a, Math.sin(t * 6) * 0.12 * a));
    if (head) poseRel(head, 0.1 * a, Math.sin(t * 6 + 1) * 0.2 * a, Math.sin(t * 6 + 1.5) * 0.25 * a);
    if (vic.parts.jaw) poseRel(vic.parts.jaw, 0.15 * a, 0, 0);
  });
  await Promise.all([stars.stop(), settle(anim, vic, 0.3, VIC_REST)]);
}

// A soft cartoon landing: quick squash and recover.
function plop(ctx, amount = 0.3, dur = 0.24) {
  return ctx.anim.tween(dur, (k) => vpose(ctx.vic, I, { scale: squash(1 - amount * Math.sin(k * Math.PI)) }));
}

// Extra puppies for the wolf's dog-pile, cached per model style so repeat fights reuse them.
const palCache = new Map();
function puppyPals(style) {
  if (!palCache.has(style)) palCache.set(style, [createAnimal('wolf', style), createAnimal('wolf', style)]);
  const pals = palCache.get(style);
  for (const g of pals) {
    g.model.traverse((o) => {
      const r = o.userData.rest;
      if (!r) return;
      o.position.copy(r.position);
      o.quaternion.copy(r.quaternion);
      o.scale.copy(r.scale);
      o.visible = true;
    });
    g.model.userData.kidFx = true;
  }
  return pals;
}

// A fluffy pink tickle feather that follows a part (lives in world.transient).
function tickleFeather(ctx, part) {
  const K = kidFx(ctx.world);
  const group = K.add(new THREE.Group());
  const vane = new THREE.Mesh(new THREE.ShapeGeometry(featherShape(), 10), candy(0xff5fb4, 0.45));
  vane.userData.ownGeometry = true;
  vane.scale.set(0.09, 0.16, 0.09);
  vane.position.y = 0.17;
  group.add(vane);
  const fluff = new THREE.Mesh(new THREE.ShapeGeometry(featherShape(), 10), candy(0xffc2e3, 0.4));
  fluff.userData.ownGeometry = true;
  fluff.scale.set(0.06, 0.11, 0.06);
  fluff.position.set(0, 0.16, 0.004);
  fluff.rotation.y = 0.5;
  group.add(fluff);
  const quill = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.004, 0.32, 6), candy(0xffffff, 0.2));
  quill.userData.ownGeometry = true;
  quill.position.y = 0.14;
  group.add(quill);
  group.scale.setScalar(0.001);
  // stick out of the tail tip, pointing on along the tail and up
  const local = new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(0, 0.6, -1).normalize());
  const wq = new THREE.Quaternion();
  let scale = 0;
  let target = 1;
  const stop = ctx.anim.every((dt) => {
    scale += (target - scale) * (1 - Math.exp(-dt * 12));
    part.getWorldPosition(group.position);
    part.getWorldQuaternion(wq);
    group.quaternion.copy(wq).multiply(local);
    group.scale.setScalar(Math.max(0.001, scale * 1.9));
  });
  return {
    group,
    tip: () => group.localToWorld(new THREE.Vector3(0, 0.28, 0)),
    remove: async () => {
      const at = group.localToWorld(new THREE.Vector3(0, 0.18, 0));
      K.poof(at, { size: 0.1, count: 6 });
      ctx.sfx.play('poof');
      target = 0;
      await ctx.anim.wait(0.15);
      stop();
      group.removeFromParent();
      group.traverse((o) => o.userData.ownGeometry && o.geometry.dispose());
    },
  };
}

function featherShape() {
  const f = new THREE.Shape();
  f.moveTo(0, -1);
  f.bezierCurveTo(0.55, -0.5, 0.5, 0.6, 0, 1);
  f.bezierCurveTo(-0.5, 0.6, -0.55, -0.5, 0, -1);
  return f;
}

// ------------------------------------------------------------------ EAGLE: Swoop & Scoop
async function eagle(ctx) {
  const { anim, atk, vic, sfx, dist, D, world } = ctx;
  const K = kidFx(world);
  const p = atk.parts;
  const wings = p.setWings ?? (() => {});
  const talons = p.talons ?? p.body ?? atk.model;
  const vd = dims(vic);
  // a proud little cheep, wings out
  await D.move({ at: ctx.A, yaw: -40, pitch: 10, dist: 1.6, lift: 0.45, fov: 36 }, 0.45);
  sfx.play('tweet', { n: 3 });
  K.notes(lifted(headPoint(atk), 0.18), { count: 2 });
  await anim.tween(0.55, (k) => {
    wings(Ease.outCubic(k), Math.sin(k * Math.PI * 4) * 0.25 * k);
    if (p.head) p.head.rotation.x = -0.35 * Math.sin(k * Math.PI);
    atk.model.position.y = 0.07 + arc(k, 0.08);
  });
  // up, up and away
  sfx.play('flap', { n: 5 });
  sfx.play('slideUp', { dur: 0.6 });
  const climb = D.track({ at: () => wpos(atk.model).setY(Math.min(wpos(atk.model).y, BOARD_Y + 1.3)), yaw: -20, pitch: 0, dist: 2.4, lift: 0.3 }, 6);
  await anim.tween(0.6, (k) => {
    wings(1, Math.sin(k * 28) * 0.6);
    setZ(atk, lerp(0, -1.0, k), Ease.inQuad(k) * 3.4);
    atk.model.rotation.x = -0.45 * k;
  });
  climb();
  // where did it go?
  D.cut({ at: ctx.V, yaw: -30, pitch: 6, dist: 1.8, lift: 0.42, fov: 34 });
  K.word(lifted(headPoint(vic), 0.3), '?', { color: 0x7fd0ff, size: 0.3 });
  sfx.play('squeak', { pitch: 0.8 });
  await anim.tween(0.7, (k) => {
    if (vic.parts.head) poseRel(vic.parts.head, -0.4 * Ease.inQuad(k), 0.55 * Math.sin(k * Math.PI * 2), 0);
  });
  // SWOOP!
  const grabY = Math.max(0.2, vd.top - 0.07);
  sfx.play('slideDown', { dur: 0.45 });
  D.cut({ at: ctx.V, yaw: 18, pitch: 12, dist: 2.0, lift: 0.45, fov: 36 });
  atk.model.rotation.set(0.9, 0, 0);
  await anim.tween(0.45, (k) => {
    wings(0.7 + 0.3 * k, Math.sin(k * 10) * 0.2);
    setZ(atk, lerp(dist - 2.2, dist, Ease.inQuad(k)), lerp(3.2, grabY, Ease.outQuad(k)));
    atk.model.rotation.x = lerp(0.9, -0.3, Ease.inQuad(k));
    talons.rotation.x = -0.6 * k;
  });
  // ... and SCOOP!
  sfx.play('zip');
  sfx.play('squeak', { delay: 0.05 });
  K.starBurst(topPoint(vic), { count: 9 });
  K.word(lifted(topPoint(vic), 0.42), 'SCOOP!', { color: 0xffd23a, size: 0.34 });
  D.slowmo(0.4, 0.35);
  if (vic.parts.head) poseRel(vic.parts.head, 0, 0, 0);
  talons.attach(vic.root);
  // whee! up into a loop-the-loop, a rainbow trailing behind
  const R = 0.62;
  const c = new THREE.Vector3(0, grabY + R + 0.4, dist + 0.25);
  const cw = atk.root.localToWorld(c.clone());
  const pileAt = endSpot(ctx);
  const pile = K.featherPile(pileAt, { radius: clamp(Math.max(vd.hx, vd.hz) * 0.85, 0.3, 0.48) });
  sfx.play('whee');
  D.move({ at: cw.clone().setY(BOARD_Y), yaw: 4, pitch: 4, dist: 3.4, lift: c.y, fov: 40 }, 0.5);
  await anim.tween(0.4, (k, raw) => {
    wings(1, Math.sin(k * 24) * 0.6);
    setZ(atk, lerp(dist, c.z, k), lerp(grabY, c.y - R, Ease.inOutQuad(k)));
    atk.model.rotation.x = lerp(-0.3, 0, k);
    kick(vic, raw * 0.4, 0.7);
  });
  const stopTrail = K.trail(() => centerPoint(vic));
  pile.show();
  sfx.play('flap', { n: 9 });
  sfx.play('slideUp', { delay: 0.1, dur: 0.6 });
  sfx.play('slideDown', { delay: 0.75, dur: 0.6 });
  sfx.play('giggle', { delay: 0.5, pitch: 1.1 });
  await anim.tween(1.35, (k, raw) => {
    const th = Ease.inOutSine(k) * Math.PI * 2;
    atk.model.position.set(0, 0.07 + c.y - Math.cos(th) * R, c.z + Math.sin(th) * R);
    atk.model.rotation.x = -th;
    wings(1, Math.sin(k * 34) * 0.5);
    kick(vic, raw * 1.35 + 1, 0.8);
  });
  atk.model.rotation.x = 0;
  // over the feather pile ...
  const dropZ = dist + 0.66;
  await anim.tween(0.42, (k, raw) => {
    wings(1, Math.sin(k * 24) * 0.6);
    setZ(atk, lerp(c.z, dropZ, k), lerp(c.y - R, c.y + 0.15, Ease.outQuad(k)));
    kick(vic, raw * 0.42 + 2.4, 0.8);
  });
  stopTrail();
  // ... and drop!
  const st = detach(ctx);
  sfx.play('slideDown', { dur: 0.55 });
  D.cut({ at: pileAt, yaw: 28, pitch: 16, dist: 1.9, lift: 0.4, fov: 36 });
  const from = vic.root.position.clone();
  const to = pileAt.clone().sub(new THREE.Vector3(0, 0, dims(vic).cz).applyQuaternion(vic.root.quaternion)).setY(BOARD_Y);
  const yA = atk.model.position.y;
  await anim.tween(0.55, (k, raw) => {
    vic.root.position.lerpVectors(from, to, k);
    const q = st.q.clone().slerp(I, Ease.outQuad(k)).multiply(Q(-Math.PI * 2 * Ease.inQuad(k)));
    vpose(vic, q, { cy: lerp(st.cy, restCy(vic) + 0.07, Ease.inQuad(k)) });
    kick(vic, raw * 0.55, 1 - k);
    setZ(atk, dropZ + k * 0.6, yA - 0.07 + k * 1.4);
    wings(1, Math.sin(k * 24) * 0.6);
  });
  // FLUMP! into the feathers
  sfx.play('poof');
  sfx.play('boing', { delay: 0.04 });
  K.feathers(lifted(pileAt, 0.2), { count: 24 });
  K.word(lifted(pileAt, 0.8), 'FLUMP!', { color: 0xff8fc8, size: 0.34 });
  D.slowmo(0.35, 0.55);
  ctx.onKill?.();
  await anim.tween(0.3, (k) => {
    const s = Math.sin(k * Math.PI);
    pile.squish(s);
    vpose(vic, I, { scale: squash(1 - 0.25 * s), up: 0.07 - 0.04 * s });
  });
  // the eagle swoops round and lands on the square
  D.cut({ at: along(ctx, 0.3), yaw: 22, pitch: 16, dist: 2.5, lift: 0.35, fov: 38 });
  atk.model.position.set(0, 0.07 + 1.7, dist - 1.5);
  atk.model.rotation.set(0.35, 0, 0);
  talons.rotation.x = 0;
  sfx.play('flap', { n: 4 });
  sfx.play('tweet', { delay: 0.6 });
  await Promise.all([
    anim.tween(0.85, (k) => {
      wings(1, Math.sin(k * 18) * 0.45 * (1 - k));
      setZ(atk, lerp(dist - 1.5, dist, Ease.outQuad(k)), lerp(1.7, 0, Ease.inOutCubic(k)));
      atk.model.rotation.x = lerp(0.35, 0, k);
    }),
    (async () => {
      const stars = K.dizzy(() => headPoint(vic), { radius: clamp(vd.hx * 1.0, 0.15, 0.24), lift: 0.15 });
      sfx.play('wobble', { dur: 0.8 });
      await anim.tween(0.9, (k, raw) => {
        const t = raw * 0.9;
        vpose(vic, Q(-0.1, 0, Math.sin(t * 6) * 0.12), { up: 0.07 });
        if (vic.parts.head) poseRel(vic.parts.head, 0, Math.sin(t * 6 + 1) * 0.2, Math.sin(t * 6 + 1.5) * 0.25);
      });
      await stars.stop();
    })(),
  ]);
  await anim.tween(0.3, (k) => wings(1 - k));
  // the pile poofs away
  const hide = pile.hide();
  await anim.tween(0.25, (k) => vpose(vic, I, { up: 0.07 * (1 - k) }));
  sfx.play('poof');
  await Promise.all([hide, settle(anim, vic, 0.3, VIC_REST), settle(anim, atk, 0.3, endPos(ctx))]);
}

// ------------------------------------------------------------------ TIGER: Pounce Tickle
async function tiger(ctx) {
  const { anim, atk, vic, sfx, dist, D, world } = ctx;
  const K = kidFx(world);
  const p = atk.parts;
  // wiggle-butt crouch
  const stalk = D.track({ at: () => wpos(atk.model), yaw: -62, pitch: 8, dist: 1.6, lift: 0.3 }, 5);
  world.setFov(34);
  sfx.play('tiptoe', { n: 6 });
  const z1 = dist * 0.22;
  await anim.tween(1.2, (k, raw) => {
    const t = raw * 1.2;
    const c = Math.min(1, k * 3);
    atk.model.position.set(0, 0.07 - 0.04 * c, lerp(0, z1, Ease.inOutQuad(k)));
    atk.model.rotation.set(0.16 * c, Math.sin(t * 22) * 0.13 * c, Math.sin(t * 22) * 0.05 * c);
    if (p.head) p.head.rotation.set(-0.2 * c, -Math.sin(t * 22) * 0.13 * c, 0);
    if (p.tail) p.tail.rotation.y = Math.sin(t * 16) * 0.7;
    if (p.tail2) p.tail2.rotation.y = Math.sin(t * 16 - 1) * 0.5;
    if (p.legBL && p.legBR) {
      p.legBL.rotation.x = Math.sin(t * 22) * 0.18 * c;
      p.legBR.rotation.x = -Math.sin(t * 22) * 0.18 * c;
    }
  });
  stalk();
  // the victim, humming away, hasn't noticed a thing
  D.cut({ at: ctx.V, yaw: -28, pitch: 8, dist: 1.8, lift: 0.42, fov: 34 });
  sfx.play('flute');
  const hum = every(0.25, () => K.notes(lifted(headPoint(vic), 0.12), { count: 1 }));
  await anim.tween(0.7, (k, raw) => {
    hum(raw * 0.7);
    if (vic.parts.head) poseRel(vic.parts.head, 0, 0, Math.sin(raw * 0.7 * 9) * 0.2);
  });
  // POUNCE! (in slow motion)
  D.cut({ at: ctx.mid, yaw: 0, pitch: 6, dist: 2.2, lift: 0.45, fov: 36 });
  D.slowmo(0.35, 0.55);
  sfx.play('rawr');
  sfx.play('boing', { delay: 0.05 });
  const land = dist - 0.4;
  await anim.tween(0.45, (k) => {
    atk.model.position.set(0, 0.07 + arc(k, 0.55) - 0.04 * (1 - k), lerp(z1, land, k));
    atk.model.rotation.set(lerp(-0.45, 0.15, k), 0, 0);
    if (p.head) p.head.rotation.set(0, 0, 0);
    if (p.legFL && p.legFR) p.legFL.rotation.x = p.legFR.rotation.x = -1.3 * Math.sin(k * Math.PI);
    if (p.legBL && p.legBR) p.legBL.rotation.x = p.legBR.rotation.x = 0.8 * Math.sin(k * Math.PI);
    if (vic.parts.head) poseRel(vic.parts.head, -0.3 * k, 0, 0);
  });
  sfx.play('bonk');
  sfx.play('squeak', { delay: 0.06 });
  K.starBurst(centerPoint(vic), { count: 9 });
  K.word(lifted(topPoint(vic), 0.4), 'POUNCE!', { color: 0xffb627, life: 0.8 });
  // bowled over onto its back, paws in the air
  const roll = (th, up = 0) => vpose(vic, Q(0, 0, th), { up });
  await anim.tween(0.3, (k) => roll(Math.PI * 0.92 * Ease.outBack(k)));
  // TICKLE TICKLE!
  D.cut({ at: ctx.V, yaw: 46, pitch: 20, dist: 1.85, lift: 0.32, fov: 32 });
  const hind = new THREE.Vector3(0, 0.02, -0.2);
  const base = new THREE.Vector3(0, 0.07, land);
  const tickle = every(0.3, () => sfx.play('tickle'));
  let g = 0;
  const giggle = every(0.5, () => sfx.play('giggle', { pitch: 1 + (g++ % 3) * 0.08 }), 0.15);
  const words = [
    [0.55, 'TICKLE TICKLE!', 0xff79d0],
    [1.15, 'HEE HEE!', 0xffd23a],
    [1.65, 'HA HA!', 0x7fd0ff],
  ];
  const sparkle = every(0.18, () => K.sparkles(centerPoint(vic), { count: 2, spread: 0.15 }));
  await anim.tween(1.9, (k, raw) => {
    const t = raw * 1.9;
    rotateAbout(atk, -0.32 * Math.min(1, k * 4), hind, 1, base);
    if (p.legFL && p.legFR) {
      p.legFL.rotation.set(-1.1 + Math.sin(t * 34) * 0.45, 0, 0.2 * Math.sin(t * 17));
      p.legFR.rotation.set(-1.1 + Math.sin(t * 34 + Math.PI) * 0.45, 0, -0.2 * Math.sin(t * 17 + 1));
    }
    if (p.head) p.head.rotation.set(0.35, Math.sin(t * 9) * 0.3, 0);
    if (p.tail) p.tail.rotation.y = Math.sin(t * 20) * 0.6;
    roll(Math.PI * 0.92 + Math.sin(t * 11) * 0.3, Math.abs(Math.sin(t * 13)) * 0.03);
    kick(vic, t, 1);
    tickle(t);
    giggle(t);
    sparkle(t);
    while (words.length && t >= words[0][0]) {
      const [, text, color] = words.shift();
      K.word(lifted(centerPoint(vic), 0.45 + Math.random() * 0.15), text, { color, size: 0.26 });
    }
  });
  // laughing so hard it rolls right over
  ctx.onKill?.();
  sfx.play('laugh');
  sfx.play('yay', { delay: 0.35 });
  const r0 = vic.root.position.clone();
  const r1 = endSpot(ctx, -0.12);
  D.move({ at: r0.clone().lerp(r1, 0.5), yaw: 32, pitch: 18, dist: 1.9, lift: 0.25, fov: 36 }, 0.5);
  await anim.tween(0.9, (k, raw) => {
    const t = 1.9 + raw * 0.9;
    rotateAbout(atk, -0.32 * (1 - k), hind, 1, base);
    if (p.legFL && p.legFR) {
      p.legFL.rotation.set(-1.1 * (1 - k), 0, 0);
      p.legFR.rotation.set(-1.1 * (1 - k), 0, 0);
    }
    vic.root.position.lerpVectors(r0, r1, Ease.outQuad(k));
    roll(Math.PI * 0.92 + Math.PI * 1.08 * Ease.outQuad(k));
    kick(vic, t, 1 - k);
  });
  await Promise.all([settle(anim, atk, 0.6, endPos(ctx), { hop: 0.06 }), dizzyEnd(ctx, 1.1)]);
}

// ------------------------------------------------------------------ WOLF: Puppy Pile
async function wolf(ctx) {
  const { anim, atk, vic, sfx, dist, D, world } = ctx;
  const K = kidFx(world);
  const p = atk.parts;
  const vd = dims(vic);
  const side = sideOf(ctx);
  // a happy howl
  D.cut({ at: ctx.A, yaw: 42, pitch: 6, dist: 1.6, lift: 0.5, fov: 32 });
  sfx.play('awoo');
  K.word(lifted(headPoint(atk), 0.38), 'AWOO!', { color: 0x9fd8ff, size: 0.3 });
  const notes = every(0.3, () => K.notes(lifted(headPoint(atk), 0.15), { count: 1 }), 0.3);
  await anim.tween(1.0, (k, raw) => {
    const h = Math.sin(Math.min(1, k * 1.2) * Math.PI);
    if (p.head) p.head.rotation.x = -0.95 * h;
    if (p.jaw) p.jaw.rotation.x = 0.35 * h;
    wagTail(p, raw * 1.3);
    atk.model.rotation.x = -0.1 * h;
    notes(raw);
  });
  // two puppy pals come bounding in
  const pals = puppyPals(atk.style).map((g, i) => {
    const s = i ? -1 : 1;
    const from = along(ctx, 1.3, s * 1.7);
    const near = along(ctx, 0.15, s * 0.62);
    g.model.position.copy(from);
    g.model.scale.setScalar(0.7);
    g.model.lookAt(near.x, from.y, near.z);
    world.transient.add(g.model);
    return { ...g, from, near, s };
  });
  D.cut({ at: ctx.V, yaw: 10, pitch: 26, dist: 2.8, lift: 0.3, fov: 38 });
  [0, 0.16, 0.38, 0.55].forEach((delay, i) => sfx.play('yip', { delay, pitch: 1.2 + (i % 2) * 0.15 }));
  await anim.tween(0.9, (k, raw) => {
    const t = raw * 0.9;
    for (const g of pals) {
      g.model.position.lerpVectors(g.from, g.near, k);
      g.model.position.y = BOARD_Y + Math.abs(Math.sin(k * Math.PI * 3)) * 0.22;
      gait(g.parts, t * 30, 0.5);
      wagTail(g.parts, t + g.s);
    }
    setZ(atk, lerp(0, dist - 0.62, k), Math.abs(Math.sin(k * Math.PI * 2)) * 0.15);
    gait(p, t * 30, 0.5);
    if (p.head) p.head.rotation.x = 0;
    if (p.jaw) p.jaw.rotation.x = 0.2;
  });
  for (const g of pals) gait(g.parts, 0, 0);
  gait(p, 0, 0);
  // DOG PILE! one, two... three!
  D.cut({ at: ctx.V, yaw: 28, pitch: 12, dist: 2.5, lift: 0.65, fov: 36 });
  const palH = new THREE.Box3().setFromObject(pals[0].model).max.y - BOARD_Y;
  const top = (sy) => BOARD_Y + 0.07 + vd.top * sy - 0.07;
  const squashes = [0.82, 0.7];
  // where each pal sits on the pile when the victim is squashed to sy
  const level = (i, sy) => top(sy) + i * palH * 0.62;
  for (const [i, g] of pals.entries()) {
    const from = g.model.position.clone();
    const to = ctx.V.clone().addScaledVector(side, (i ? -1 : 1) * 0.05).setY(level(i, i ? squashes[0] : 1));
    const r0 = g.model.rotation.y;
    const r1 = r0 + (i ? -1.2 : 1.0);
    sfx.play('yip', { pitch: 1.3 });
    await anim.tween(0.32, (k) => {
      g.model.position.lerpVectors(from, to, k);
      g.model.position.y += arc(k, 0.45);
      g.model.rotation.y = lerp(r0, r1, k);
      g.model.rotation.z = 0.22 * k * (i ? -1 : 1);
    });
    sfx.play('boing', { pitch: 1 + i * 0.15 });
    sfx.play('squeak', { pitch: 0.9 + i * 0.2, delay: 0.04 });
    K.starBurst(to, { count: 6 });
    const sy0 = i ? squashes[0] : 1;
    await anim.tween(0.14, (k) => {
      const sy = lerp(sy0, squashes[i], k);
      vpose(vic, I, { scale: squash(sy) });
      for (let j = 0; j <= i; j++) pals[j].model.position.y = level(j, sy);
    });
  }
  // ...and the big wolf jumps on top
  D.slowmo(0.4, 0.45);
  sfx.play('awoo', { pitch: 1.2 });
  const pileTop = level(2, squashes[1]);
  await anim.tween(0.42, (k) => {
    setZ(atk, lerp(dist - 0.62, dist, k), arc(k, 0.5) + (pileTop - BOARD_Y - 0.07) * Ease.inOutQuad(k));
    atk.model.rotation.z = -0.3 * k;
    if (p.legFL && p.legFR) p.legFL.rotation.x = p.legFR.rotation.x = -0.9 * Math.sin(k * Math.PI);
  });
  sfx.play('boing', { pitch: 1.4 });
  vpose(vic, I, { scale: squash(0.62) });
  pals.forEach((g, j) => (g.model.position.y = level(j, 0.62)));
  setZ(atk, dist, level(2, 0.62) - BOARD_Y - 0.07);
  // POOF — a big tumbling cartoon cloud
  ctx.onKill?.();
  sfx.play('poof');
  K.word(lifted(ctx.V, Math.min(pileTop - BOARD_Y + 0.35, 1.15)), 'PUPPY PILE!', { color: 0xffb627, size: 0.34, life: 1.6 });
  D.move({ at: ctx.V, yaw: 22, pitch: 12, dist: 3.1, lift: 0.55, fov: 38 }, 0.35);
  const cloud = K.poof(lifted(ctx.V, (pileTop - BOARD_Y) * 0.45 + 0.05), { size: 0.42 + (pileTop - BOARD_Y) * 0.22, hold: 1.1, count: 14 });
  const dog = ['giggle', 'yip', 'squeak', 'bonk', 'yip', 'giggle'];
  dog.forEach((name, i) => sfx.play(name, { delay: 0.18 + i * 0.17, pitch: 1 + (i % 3) * 0.12 }));
  await anim.wait(0.2);
  // while nobody can see: everyone tumbles into place
  for (const [i, g] of pals.entries()) {
    g.model.position.copy(along(ctx, -0.05, (i ? -1 : 1) * 0.62));
    g.model.rotation.set(0, 0, 0);
    g.model.lookAt(along(ctx, 0.6, 0));
  }
  atk.model.position.copy(endPos(ctx));
  atk.model.rotation.set(0, 0, 0);
  vpose(vic, I, { scale: squash(0.8) });
  // as the cloud blows away, the victim tumbles out of it
  await anim.wait(1.05);
  const from = vic.root.position.clone();
  const out = endSpot(ctx);
  sfx.play('boing', { pitch: 1.2 });
  sfx.play('whee', { pitch: 1.2 });
  await anim.tween(0.5, (k, raw) => {
    vic.root.position.lerpVectors(from, out, k);
    vpose(vic, Q(-Math.PI * 2 * Ease.inOutQuad(k)), { up: arc(k, 0.45), scale: squash(lerp(0.8, 1, k)) });
    kick(vic, raw * 0.5, 1 - k);
  });
  await plop(ctx, 0.25, 0.18);
  await cloud;
  // the cloud clears: one dizzy victim, three happy wolves
  const wag = anim.every((dt, time) => {
    for (const g of pals) wagTail(g.parts, time * 1.4 + g.s);
    wagTail(p, time * 1.2);
  });
  await dizzyEnd(ctx, 1.0);
  // the pals bound away, waving their tails
  for (const g of pals) {
    g.start = g.model.position.clone();
    g.away = g.start.clone().addScaledVector(side, g.s * 1.4).addScaledVector(ctx.dir, -0.4);
  }
  sfx.play('yip', { pitch: 1.3 });
  sfx.play('yip', { pitch: 1.45, delay: 0.12 });
  await anim.tween(0.6, (k, raw) => {
    for (const g of pals) {
      g.model.position.lerpVectors(g.start, g.away, k);
      g.model.position.y = BOARD_Y + Math.abs(Math.sin(k * Math.PI * 2)) * 0.18;
      g.model.lookAt(g.away.x, g.model.position.y, g.away.z);
      gait(g.parts, raw * 25, 0.5);
      g.model.scale.setScalar(0.7 * (1 - Ease.inQuad(k)));
    }
  });
  for (const g of pals) K.poof(g.model.position.clone().setY(BOARD_Y + 0.15), { size: 0.18, count: 6, stars: false });
  sfx.play('poof');
  wag();
  for (const g of pals) g.model.removeFromParent();
  await settle(anim, atk, 0.25, endPos(ctx));
}

// ------------------------------------------------------------------ BEAR: Bear Hug
async function bear(ctx) {
  const { anim, atk, vic, sfx, dist, D, world } = ctx;
  const K = kidFx(world);
  const p = atk.parts;
  const stand = dist - 0.62;
  sfx.play('tiptoe', { n: 3 });
  await anim.tween(0.5, (k, raw) => {
    setZ(atk, lerp(0, stand, k));
    gait(p, raw * 14, 0.3);
  });
  gait(p, 0, 0);
  const hind = new THREE.Vector3(0, 0.02, -0.22);
  const base = new THREE.Vector3(0, 0.07, stand);
  // rears up, arms open wide
  D.cut({ at: ctx.mid, yaw: 14, pitch: 4, dist: 1.9, lift: 0.55, fov: 38 });
  sfx.play('rawr', { pitch: 0.75 });
  sfx.play('aww', { delay: 0.45 });
  K.word(lifted(headPoint(atk), 0.75), 'HUGS!', { color: 0xff8fc8, size: 0.32 });
  K.hearts(lifted(headPoint(atk), 0.5), { count: 3 });
  const arms = (x, z) => {
    if (p.legFL) p.legFL.rotation.set(x, 0, z);
    if (p.legFR) p.legFR.rotation.set(x, 0, -z);
  };
  await anim.tween(0.8, (k) => {
    rotateAbout(atk, -1.05 * Ease.outBack(k), hind, 1 + 0.18 * k, base);
    arms(-1.0 * k, 1.0 * k);
    if (p.head) p.head.rotation.x = 0.6 * k;
    if (p.jaw) p.jaw.rotation.x = 0.3 * Math.sin(k * Math.PI);
  });
  // the big, squishy hug
  const v0 = vic.root.position.clone();
  const hugAt = along(ctx, -0.12);
  D.cut({ at: ctx.V, yaw: 30, pitch: 12, dist: 1.9, lift: 0.5, fov: 34 });
  sfx.play('squish');
  await anim.tween(0.35, (k) => {
    rotateAbout(atk, lerp(-1.05, -0.62, k), hind, 1.18, base);
    arms(lerp(-1.0, -1.5, k), lerp(1.0, -0.35, k));
    vic.root.position.lerpVectors(v0, hugAt, k);
    vpose(vic, I, { up: 0.1 * k });
  });
  K.hearts(lifted(centerPoint(vic), 0.3), { count: 5 });
  const orbit = D.orbit({ at: ctx.V, yaw: 30, pitch: 12, dist: 1.9, lift: 0.5 }, 2, 1.35);
  for (let i = 0; i < 3; i++) {
    sfx.play('squeak', { pitch: 1 + i * 0.12 });
    K.hearts(lifted(centerPoint(vic), 0.25), { count: 3, spread: 0.3 });
    await anim.tween(0.42, (k) => {
      const s = Math.sin(k * Math.PI);
      vpose(vic, Q(0, 0, s * 0.08 * (i % 2 ? 1 : -1)), { scale: new THREE.Vector3(1 - 0.28 * s, 1 + 0.22 * s, 1 - 0.1 * s), up: 0.1 });
      rotateAbout(atk, -0.62, hind, 1.18, base);
      atk.model.rotation.z = Math.sin((i + k) * Math.PI) * 0.12;
      arms(-1.5, -0.35 - 0.15 * s);
      if (p.head) p.head.rotation.z = Math.sin((i + k) * Math.PI) * -0.15;
    });
  }
  await orbit;
  // the BIGGEST squeeze (slow-mo)
  D.cut({ at: ctx.V, yaw: 10, pitch: 10, dist: 1.7, lift: 0.5, fov: 34 });
  D.slowmo(0.35, 0.6);
  sfx.play('squish');
  sfx.play('squeak', { pitch: 1.5 });
  sfx.play('aww', { delay: 0.1 });
  K.word(lifted(topPoint(vic), 0.42), 'SQUEEZE!', { color: 0xff6fae, size: 0.32 });
  K.hearts(lifted(centerPoint(vic), 0.2), { count: 9, spread: 0.35 });
  ctx.onKill?.();
  await anim.tween(0.45, (k) => {
    const s = Math.sin(k * Math.PI);
    vpose(vic, I, { scale: new THREE.Vector3(1 - 0.4 * s, 1 + 0.35 * s, 1 - 0.15 * s), up: 0.1 });
    arms(-1.5, -0.35 - 0.25 * s);
  });
  // POP! out it shoots like a cork
  sfx.play('bubblePop');
  sfx.play('boing', { delay: 0.04 });
  sfx.play('slideUp', { dur: 0.35 });
  K.starBurst(topPoint(vic), { count: 10 });
  const out = endSpot(ctx);
  const from = vic.root.position.clone();
  D.move({ at: ctx.V.clone().lerp(out, 0.5), yaw: 40, pitch: 14, dist: 2.3, lift: 0.4, fov: 36 }, 0.4);
  await anim.tween(0.75, (k) => {
    vic.root.position.lerpVectors(from, out, k);
    vpose(vic, Q(-Math.PI * 2 * k), { up: 0.1 * (1 - k) + arc(k, 0.9), scale: squash(1 + 0.25 * Math.sin(Math.min(1, k * 2) * Math.PI)) });
    kick(vic, k * 0.75, 0.8);
    rotateAbout(atk, lerp(-0.62, 0, k), hind, lerp(1.18, 1, k), base);
    atk.model.rotation.z = 0;
    arms(lerp(-1.5, 0, k), lerp(-0.35, 0, k));
  });
  sfx.play('thump');
  await plop(ctx, 0.3);
  await Promise.all([settle(anim, atk, 0.55, endPos(ctx), { hop: 0.05 }), dizzyEnd(ctx, 1.1)]);
}

// ------------------------------------------------------------------ COBRA: Twisty Twirl
async function cobra(ctx) {
  const { anim, atk, vic, sfx, dist, D, world } = ctx;
  const K = kidFx(world);
  const p = atk.parts;
  const vd = dims(vic);
  const neck = p.neck ?? [];
  const neckRest = neck.map((seg) => seg.rotation.clone());
  const sway = (t, amp) => neck.forEach((seg, i) => (seg.rotation.z = neckRest[i].z + Math.sin(t * 9 - i * 0.7) * amp));
  // a little snake-charmer dance
  D.cut({ at: ctx.A, yaw: 46, pitch: 8, dist: 1.55, lift: 0.5, fov: 32 });
  sfx.play('flute');
  const notes = every(0.3, () => K.notes(lifted(headPoint(atk), 0.12), { count: 1 }));
  await anim.tween(1.0, (k, raw) => {
    const t = raw * 1.0;
    sway(t, 0.22);
    if (p.hood) p.hood.scale.set(1 + 0.35 * Ease.outBack(Math.min(1, k * 2)), 1 + 0.15 * Math.min(1, k * 2), 1);
    if (p.tongue) p.tongue.scale.z = Math.sin(t * 20) > 0.3 ? 1 : 0.01;
    notes(t);
  });
  // slithers up close
  await anim.tween(0.6, (k, raw) => {
    setZ(atk, lerp(0, dist - 0.5, Ease.inOutQuad(k)), 0);
    sway(1 + raw * 0.6, 0.18);
    atk.model.rotation.y = Math.sin(raw * 0.6 * 14) * 0.15 * (1 - k);
  });
  atk.model.rotation.y = 0;
  // wraps around the victim like a cosy scarf
  D.cut({ at: ctx.V, yaw: 38, pitch: 14, dist: 1.75, lift: 0.42, fov: 32 });
  const scarfMat = neck[1]?.children.find((c) => c.isMesh)?.material ?? p.body?.children.find((c) => c.isMesh)?.material ?? candy(0x6fcf6a, 0.1);
  const hp = headPoint(vic);
  const cp = centerPoint(vic);
  const vq = vic.root.quaternion.clone();
  const tube = 0.045;
  const specs = [
    { at: hp.clone().lerp(cp, 0.45), r: clamp(vd.hx * 0.95, 0.11, 0.22), q: vq.clone().multiply(Q(Math.PI / 2 - 0.25, 0, 0)) },
    { at: cp.clone(), r: clamp(Math.max(vd.hx, vd.hy) * 1.0, 0.13, 0.32), q: vq.clone() },
  ];
  const coils = specs.map((s) => {
    const m = K.add(new THREE.Mesh(new THREE.TorusGeometry(s.r, tube, 12, 36), scarfMat));
    m.userData.ownGeometry = true;
    m.position.copy(s.at);
    m.quaternion.copy(s.q);
    m.scale.setScalar(0.001);
    m.castShadow = true;
    return { m, ...s };
  });
  for (const c of coils) {
    sfx.play('zip');
    await anim.tween(0.26, (k) => {
      const s = lerp(2.2, 1, Ease.outBack(k));
      c.m.scale.set(s, s, 1);
      c.m.quaternion.copy(c.q).multiply(Q(0, 0, k * 4));
      sway(2 + k, 0.1);
    });
  }
  // boop!
  const lean = neckRest.map((r) => r.x);
  await anim.tween(0.25, (k) => neck.forEach((seg, i) => (seg.rotation.x = lerp(lean[i], lean[i] + 0.18, k))));
  sfx.play('boing', { pitch: 1.6 });
  K.word(lifted(hp, 0.32), 'BOOP!', { color: 0xff79d0, size: 0.28 });
  K.hearts(lifted(hp, 0.12), { count: 3, spread: 0.1 });
  await anim.tween(0.4, (k, raw) => {
    kick(vic, raw * 0.4, 0.4);
    if (p.tongue) p.tongue.scale.z = Math.sin(raw * 30) > 0 ? 1 : 0.01;
  });
  // ...and UNWINDS — spinning the victim like a top!
  ctx.onKill?.();
  sfx.play('whirl', { dur: 1.6 });
  sfx.play('zip', { dur: 0.3 });
  sfx.play('giggle', { delay: 0.6, pitch: 1.15 });
  K.word(lifted(topPoint(vic), 0.55), 'TWIRL!', { color: 0x63d471, size: 0.3 });
  D.cut({ at: ctx.V, yaw: 28, pitch: 9, dist: 2.0, lift: 0.32, fov: 34 });
  const follow = D.track({ at: () => ctx.V.clone().lerp(vic.root.position, 0.6), yaw: 28, pitch: 9, dist: 2.0, lift: 0.32 }, 4);
  const from = vic.root.position.clone();
  const to = endSpot(ctx);
  const total = Math.PI * 2 * 6;
  let ri = 0;
  const rings = every(0.12, () =>
    K.ring(vic.root.position, { color: [0xff79d0, 0xffe14d, 0x3fb8ff, 0x63d471][ri++ % 4], from: Math.max(vd.hx, vd.hz) * 0.9, to: Math.max(vd.hx, vd.hz) * 1.6, duration: 0.35, opacity: 0.85, y: centerPoint(vic).y - vd.hy * 0.3 }),
  );
  const sparks = every(0.1, () => K.sparkles(centerPoint(vic), { count: 2, spread: vd.hx * 1.5 }));
  const axis = new THREE.Vector3();
  const D1 = 1.7;
  await anim.tween(D1, (k, raw) => {
    const t = raw * D1;
    // the coils fly off spinning
    coils.forEach((c, i) => {
      const u = Math.min(1, k * 2.2);
      c.m.position.copy(c.at).addScaledVector(UP, u * (0.5 + i * 0.25));
      c.m.quaternion.copy(c.q).multiply(Q(Math.sin(t * 20) * 0.3 * u, 0, t * 18));
      const s = (1 + u * 0.8) * (1 - Ease.inQuad(u));
      c.m.scale.setScalar(Math.max(0.001, s));
    });
    neck.forEach((seg, i) => (seg.rotation.x = lerp(lean[i] + 0.18, lean[i], Math.min(1, k * 3))));
    sway(3 + t, 0.15);
    // spin like a top, wobbling more as it slows down
    const spin = total * (1 - Math.pow(1 - k, 2));
    const tilt = 0.05 + 0.3 * k * k;
    axis.set(Math.cos(spin * 0.2 + t * 3), 0, Math.sin(spin * 0.2 + t * 3));
    const q = new THREE.Quaternion().setFromAxisAngle(axis, tilt).multiply(Q(0, spin, 0));
    vpose(vic, q, { up: 0.06 * Math.sin(Math.min(1, k * 4) * Math.PI * 0.5) * (1 - k) });
    const drift = from.clone().lerp(to, Ease.inOutSine(k));
    drift.x += Math.cos(t * 6) * 0.06 * (1 - k);
    drift.z += Math.sin(t * 6) * 0.06 * (1 - k);
    vic.root.position.copy(drift);
    kick(vic, t, 0.35);
    rings(t);
    sparks(t);
  });
  follow();
  for (const c of coils) {
    c.m.removeFromParent();
    c.m.geometry.dispose();
  }
  // a last wobble... and plop
  const qEnd = vic.model.quaternion.clone();
  sfx.play('thump');
  await anim.tween(0.35, (k) => vpose(vic, qEnd.clone().slerp(Q(0, Math.PI * 2 * 6, 0), Ease.outBack(k))));
  await Promise.all([
    settle(anim, atk, 0.6, endPos(ctx), { hop: 0.04 }).then(() => p.hood && p.hood.scale.set(1, 1, 1)),
    dizzyEnd(ctx, 1.1),
  ]);
}

// ------------------------------------------------------------------ SHARK: Splash Attack
async function shark(ctx) {
  const { anim, atk, vic, sfx, dist, D, world } = ctx;
  const K = kidFx(world);
  const p = atk.parts;
  const vd = dims(vic);
  const bodyY0 = p.body?.position.y ?? 0.19;
  // a cheeky grin and a fin wiggle... then dive!
  D.cut({ at: ctx.A, yaw: 40, pitch: 12, dist: 1.5, lift: 0.25, fov: 34 });
  sfx.play('bubble', { n: 3 });
  await anim.tween(0.6, (k, raw) => {
    const t = raw * 0.6;
    if (p.fin) p.fin.rotation.z = Math.sin(t * 18) * 0.3;
    if (p.tail) p.tail.rotation.y = Math.sin(t * 14) * 0.5;
    if (p.body) p.body.rotation.z = Math.sin(t * 9) * 0.12;
  });
  sfx.play('splashKid', { power: 0.7 });
  K.splash(ctx.A, { power: 0.6, crown: false });
  await anim.tween(0.45, (k) => {
    if (!p.body) return;
    p.body.rotation.set(0.9 * k, 0, 0);
    p.body.position.y = bodyY0 - 0.8 * k;
  }, Ease.inQuad);
  if (p.body) p.body.visible = false;
  // a bubbly blue puddle opens under the victim
  const radius = clamp(Math.max(vd.hx, vd.hz) * 1.15, 0.42, 0.66);
  const pool = K.puddle(ctx.V, { radius });
  D.cut({ at: ctx.V, yaw: 50, pitch: 16, dist: 2.0, lift: 0.4, fov: 36 });
  sfx.play('bubble', { n: 4 });
  await anim.tween(0.4, (k) => pool.setSize(Ease.outBack(k)));
  K.word(lifted(headPoint(vic), 0.3), '?', { color: 0x7fd0ff, size: 0.3 });
  const blub = every(0.07, () => K.bubbles(ctx.V.clone().setY(BOARD_Y + 0.03), { count: 1, spread: radius * 0.75, rise: 0.45, size: [0.02, 0.04], life: [0.5, 0.9] }));
  const ripple = every(0.25, () => K.ring(ctx.V, { color: 0xd8f3ff, from: 0.1, to: radius, duration: 0.6, y: BOARD_Y + 0.02, opacity: 0.7 }));
  const blubSound = every(0.3, () => sfx.play('bubble', { n: 2 }));
  await anim.tween(0.85, (k, raw) => {
    const t = raw * 0.85;
    blub(t);
    ripple(t);
    blubSound(t);
    if (vic.parts.head) poseRel(vic.parts.head, 0.4 * Ease.outQuad(k), Math.sin(t * 7) * 0.3, 0);
  });
  // SPLOOSH! up it pops, right underneath
  if (p.body) {
    p.body.visible = true;
    p.body.position.y = bodyY0;
    p.body.rotation.set(0, 0, 0);
  }
  if (p.water) p.water.visible = false;
  if (p.foam) p.foam.visible = false;
  if (p.jaw) p.jaw.rotation.x = 0;
  setZ(atk, dist, -0.9);
  atk.model.rotation.set(-Math.PI / 2, 0, 0);
  D.cut({ at: ctx.V, yaw: 35, pitch: 6, dist: 2.6, lift: 0.9, fov: 40 });
  D.slowmo(0.4, 0.9);
  sfx.play('splashKid', { power: 1.4 });
  sfx.play('boing', { delay: 0.05 });
  sfx.play('whee', { delay: 0.15 });
  K.splash(ctx.V, { power: 1.5 });
  const spout = K.spout(ctx.V, 0.2);
  const spray = every(0.05, () => K.droplets(lifted(ctx.V, spout.mesh.scale.y), { count: 3, speed: 0.9, up: 0.6, size: [0.012, 0.022] }));
  await anim.tween(0.5, (k, raw) => {
    atk.model.position.y = lerp(-0.9, 0.4, Ease.outQuad(k));
    spout.setHeight(lerp(0, 1.45, Ease.outQuad(k)), Math.sin(k * 20) * 0.08);
    vpose(vic, Q(-Math.PI * k), { up: 1.5 * Ease.outQuad(k) });
    kick(vic, raw * 0.5, 0.8);
    spray(raw * 0.5);
  });
  K.word(lifted(ctx.V, 2.15), 'SPLOOSH!', { color: 0x7fd0ff, size: 0.42 });
  ctx.onKill?.();
  // ...and down it comes, soaked
  const land = endSpot(ctx);
  const from = vic.root.position.clone();
  sfx.play('slideDown', { dur: 0.5 });
  await anim.tween(0.62, (k, raw) => {
    vic.root.position.lerpVectors(from, land, k);
    vpose(vic, Q(-Math.PI * (1 + k)), { up: 1.5 * (1 - Ease.inQuad(k)) });
    kick(vic, 0.5 + raw * 0.62, 0.8);
    spout.setHeight(1.45 * (1 - Ease.inQuad(k)), Math.sin(k * 20) * 0.08);
    atk.model.position.y = lerp(0.4, -0.9, Ease.inQuad(k));
    atk.model.rotation.x = lerp(-Math.PI / 2, Math.PI * 0.45, k);
    vic.tint(0x6ec3ff, 0.45 * k);
  });
  spout.done();
  if (p.body) p.body.visible = false;
  sfx.play('splashKid', { power: 0.6 });
  sfx.play('squish', { delay: 0.04 });
  K.splash(land, { power: 0.55, crown: false });
  K.splash(ctx.V, { power: 0.7, crown: true });
  await plop(ctx, 0.3);
  // drip, drip... aaah... CHOO!
  D.cut({ at: land, yaw: -35, pitch: 10, dist: 1.8, lift: 0.36, fov: 34 });
  const stopDrips = K.drips(() => centerPoint(vic), { rate: 14, spread: vd.hx * 0.8 });
  sfx.play('achoo');
  const head = vic.parts.head;
  await anim.tween(0.42, (k) => {
    if (head) poseRel(head, -0.45 * Ease.inQuad(k), 0, 0);
    vpose(vic, Q(-0.15 * k));
  });
  K.word(lifted(headPoint(vic), 0.35), 'ACHOO!', { color: 0xbfe9ff, size: 0.32 });
  const nose = headPoint(vic).addScaledVector(ctx.dir, -0.12);
  K.puffs(nose, { count: 4, color: 0xdff4ff, size: [0.15, 0.25], rise: 0.1 });
  K.droplets(nose, { count: 12, speed: 1.1, up: 0.5 });
  await anim.tween(0.25, (k) => {
    if (head) poseRel(head, lerp(-0.45, 0.35, Ease.outQuad(k)), 0, 0);
    vpose(vic, Q(lerp(-0.15, 0.18, k)), { up: arc(k, 0.08) });
  });
  // shake it all off!
  sfx.play('rattle', { n: 12 });
  sfx.play('splashKid', { power: 0.35, delay: 0.1 });
  const shake = every(0.08, () => K.droplets(centerPoint(vic), { count: 7, horizontal: true, speed: 2.0, size: [0.01, 0.02], spread: vd.hx * 0.5 }));
  await anim.tween(0.85, (k, raw) => {
    const t = raw * 0.85;
    const a = Math.sin(k * Math.PI);
    vpose(vic, Q(0.18 * (1 - k), Math.sin(t * 40) * 0.5 * a, Math.sin(t * 40 + 1) * 0.08 * a));
    if (head) poseRel(head, 0.35 * (1 - k), Math.sin(t * 40 + 0.5) * 0.5 * a, 0);
    vic.tint(0x6ec3ff, 0.45 * (1 - k));
    shake(t);
  });
  stopDrips();
  vic.restoreMaterials();
  // the shark bobs back up on the square
  atk.model.rotation.set(0, 0, 0);
  setZ(atk, dist, -0.55);
  if (p.body) {
    p.body.visible = true;
    p.body.position.y = bodyY0;
    p.body.rotation.set(0, 0, 0);
  }
  if (p.water) p.water.visible = true;
  if (p.foam) p.foam.visible = true;
  D.move({ at: ctx.V.clone().lerp(land, 0.5), yaw: 35, pitch: 16, dist: 2.2, lift: 0.3, fov: 36 }, 0.4);
  sfx.play('splashKid', { power: 0.5 });
  sfx.play('yay', { delay: 0.3 });
  K.splash(ctx.V, { power: 0.45, crown: false });
  await Promise.all([
    anim.tween(0.55, (k) => {
      atk.model.position.y = lerp(-0.55, 0.07, Ease.outBack(k));
      pool.setSize(1 - k);
    }),
    settle(anim, vic, 0.55, VIC_REST),
  ]);
  pool.done();
  await settle(anim, atk, 0.3, endPos(ctx));
}

// ------------------------------------------------------------------ GORILLA: Trampoline Thump
async function gorilla(ctx) {
  const { anim, atk, vic, sfx, dist, D, world } = ctx;
  const K = kidFx(world);
  const p = atk.parts;
  // chest-drum boogie
  D.cut({ at: ctx.A, yaw: 40, pitch: 4, dist: 1.75, lift: 0.5, fov: 34 });
  for (let i = 0; i < 6; i++) {
    const arm = i % 2 ? p.armR : p.armL;
    const s = i % 2 ? 1 : -1;
    sfx.play('bongo', { pitch: i % 2 ? 1.25 : 1 });
    if (i % 2 === 0) K.notes(lifted(headPoint(atk), 0.2), { count: 1 });
    await anim.tween(0.2, (k) => {
      const b = Math.sin(k * Math.PI);
      if (arm) {
        // fist swings in across the chest: thump!
        arm.rotation.x = -0.75 * b;
        arm.rotation.z = s * 1.25 * b;
      }
      atk.model.position.y = 0.07 + Math.abs(Math.sin((i + k) * Math.PI)) * 0.06;
      atk.model.rotation.z = Math.sin((i + k) * Math.PI) * 0.1;
      if (p.head) p.head.rotation.set(0.2 * Math.abs(Math.sin((i + k) * Math.PI)), 0, -Math.sin((i + k) * Math.PI) * 0.15);
    });
  }
  // arms up — yeah!
  sfx.play('yay');
  K.word(lifted(headPoint(atk), 0.45), 'BOOGIE!', { color: 0xa77bff, size: 0.3 });
  await anim.tween(0.3, (k) => {
    for (const arm of [p.armL, p.armR]) if (arm) arm.rotation.set(-2.8 * Ease.outBack(k), 0, 0);
    if (p.jaw) p.jaw.rotation.x = 0.35 * k;
    atk.model.rotation.z = 0;
    atk.model.position.y = 0.07;
  });
  // up... and THUMP!
  D.cut({ at: ctx.mid, yaw: 6, pitch: 10, dist: 2.5, lift: 0.5, fov: 38 });
  sfx.play('slideUp', { dur: 0.45 });
  const landZ = dist - 0.62;
  await anim.tween(0.55, (k) => {
    setZ(atk, lerp(0, landZ, k), arc(k, 0.9));
    atk.model.rotation.x = lerp(-0.2, 0.25, k);
  });
  await anim.tween(0.09, (k) => {
    for (const arm of [p.armL, p.armR]) if (arm) arm.rotation.x = lerp(-2.8, -1.0, k);
  }, Ease.inQuad);
  sfx.play('thump');
  sfx.play('boing', { delay: 0.03 });
  world.shake(0.15);
  const impact = along(ctx, -0.3);
  K.rainbowRings(impact, { to: 1.5 });
  ctx.fx.dust(impact.clone().setY(BOARD_Y + 0.03), 10, 0xf2e6cc);
  K.word(lifted(impact, 0.55), 'THUMP!', { color: 0xffb627, size: 0.32 });
  // the board goes BOING like a trampoline
  await anim.tween(0.1, (k) => vpose(vic, I, { scale: squash(1 - 0.35 * k) }));
  sfx.play('boing', { pitch: 1.3 });
  sfx.play('whee', { delay: 0.1 });
  const ride = D.track({ at: () => centerPoint(vic), yaw: 18, pitch: -2, dist: 2.6, lift: 0 }, 5);
  await anim.tween(0.6, (k, raw) => {
    vpose(vic, Q(-Math.PI * 1.2 * k), { scale: squash(1 + 0.3 * (1 - k)), up: 2.0 * Ease.outQuad(k) });
    kick(vic, raw * 0.6, 1);
    atk.model.rotation.x = lerp(0.25, 0, k);
    if (p.head) p.head.rotation.x = -0.6 * k;
  });
  // weee! (slow-mo at the top)
  D.slowmo(0.3, 0.7);
  K.word(lifted(centerPoint(vic), 0.45), 'BOING!', { color: 0x63d471, size: 0.36 });
  K.starBurst(centerPoint(vic), { count: 10 });
  K.confetti(centerPoint(vic), { count: 36, speed: 1.6, up: 0.8 });
  sfx.play('yay', { delay: 0.1 });
  ctx.onKill?.();
  await anim.tween(0.15, (k, raw) => kick(vic, 0.6 + raw * 0.15, 1));
  ride();
  // boing, boing, boing — bouncing to a stop
  D.move({ at: along(ctx, 0.4), yaw: 25, pitch: 14, dist: 2.5, lift: 0.4, fov: 38 }, 0.5);
  const g = restGap(ctx);
  const hops = [
    { a: g * 0.38, h0: 2.0, h: 0, d: 0.55, r0: -1.2, r1: -2 },
    { a: g * 0.76, h: 0.55, d: 0.42, r0: -2, r1: -2 },
    { a: g, h: 0.2, d: 0.28, r0: -2, r1: -2 },
  ];
  let a0 = 0;
  for (const [i, h] of hops.entries()) {
    const f = along(ctx, a0);
    const t = along(ctx, h.a);
    await anim.tween(h.d, (k, raw) => {
      vic.root.position.lerpVectors(f, t, k);
      const up = i === 0 ? h.h0 * (1 - Ease.inQuad(k)) : arc(k, h.h);
      vpose(vic, Q(Math.PI * lerp(h.r0, h.r1, k)), { up, scale: squash(1 + 0.15 * Math.sin(k * Math.PI)) });
      kick(vic, 0.8 + i + raw * h.d, 0.7);
      if (p.head) p.head.rotation.x = -0.6 * (1 - k * (i === 2 ? 1 : 0));
    });
    sfx.play('boing', { pitch: 1.1 + i * 0.25 });
    K.starBurst(t.clone().setY(BOARD_Y + 0.08), { count: 3, speed: 1.2 });
    await plop(ctx, 0.3 - i * 0.07, 0.14);
    a0 = h.a;
  }
  await Promise.all([settle(anim, atk, 0.6, endPos(ctx), { hop: 0.05 }), dizzyEnd(ctx, 1.1)]);
}

// ------------------------------------------------------------------ RHINO: Bumper Bash
async function rhino(ctx) {
  const { anim, atk, vic, sfx, dist, D, world } = ctx;
  const K = kidFx(world);
  const p = atk.parts;
  const vd = dims(vic);
  const ad = dims(atk);
  // back up for a run-up
  await anim.tween(0.45, (k, raw) => {
    setZ(atk, -0.55 * Ease.outQuad(k), 0);
    gait(p, -raw * 12, 0.3);
  });
  gait(p, 0, 0);
  D.cut({ at: ctx.A, yaw: -150, pitch: 8, dist: 1.5, lift: 0.5, fov: 34 });
  for (let i = 0; i < 3; i++) {
    sfx.play('snortKid');
    const nose = atk.model.localToWorld(new THREE.Vector3(0, ad.cy + ad.hy * 0.4, ad.front));
    K.puffs(nose, { count: 3, color: 0xffffff, size: [0.12, 0.2], rise: 0.15, opacity: 0.6 });
    await anim.tween(0.26, (k) => {
      if (p.legFL) p.legFL.rotation.x = -0.7 * Math.sin(k * Math.PI);
      if (p.head) p.head.rotation.x = 0.3 * Math.sin(k * Math.PI);
    });
    ctx.fx.dust(atk.model.localToWorld(new THREE.Vector3(0.1, 0.03, 0.2)), 6, 0xeadfc8);
  }
  // the victim braces itself
  D.cut({ at: ctx.V, yaw: -30, pitch: 8, dist: 1.8, lift: 0.42, fov: 34 });
  K.word(lifted(headPoint(vic), 0.3), 'GULP!', { color: 0x9fd8ff, size: 0.26 });
  sfx.play('squeak', { pitch: 0.7 });
  await anim.tween(0.45, (k) => vpose(vic, I, { scale: squash(1 - 0.12 * Math.sin(k * Math.PI)) }));
  // CHARGE!
  sfx.play('zip', { dur: 0.5 });
  const gallop = every(0.11, () => sfx.play('bongo', { pitch: 0.75 }));
  const stop = D.track({ at: () => wpos(atk.model), yaw: 15, pitch: 6, dist: 2.0, lift: 0.3 }, 8);
  const hitZ = dist - vd.front - ad.front + 0.06;
  let lastDust = 0;
  await anim.tween(0.5, (k, raw) => {
    setZ(atk, lerp(-0.55, hitZ, k), Math.abs(Math.sin(raw * 30)) * 0.05);
    if (p.head) p.head.rotation.x = 0.3;
    gait(p, raw * 40, 0.7);
    gallop(raw * 0.5);
    if (raw - lastDust > 0.12) {
      lastDust = raw;
      ctx.fx.dust(atk.model.localToWorld(new THREE.Vector3(0, 0.03, -0.2)), 5, 0xeadfc8);
    }
  }, Ease.inQuad);
  stop();
  gait(p, 0, 0);
  // BONK!
  D.cut({ at: ctx.V, yaw: 58, pitch: 8, dist: 1.6, lift: 0.3, fov: 32 });
  D.slowmo(0.3, 0.5);
  sfx.play('bonk');
  sfx.play('boing', { delay: 0.05 });
  const contact = ctx.V.clone().addScaledVector(ctx.dir, -vd.front).setY(BOARD_Y + 0.07 + vd.cy);
  K.starBurst(contact, { count: 12 });
  K.word(lifted(contact, 0.5), 'BONK!', { color: 0xffb627, size: 0.36 });
  world.shake(0.1);
  ctx.onKill?.();
  await anim.tween(0.12, (k) => {
    if (p.head) p.head.rotation.x = lerp(0.3, -0.45, k);
    vpose(vic, I, { scale: new THREE.Vector3(1 + 0.25 * k, 1 - 0.1 * k, 1 - 0.4 * k) });
  });
  // ...and away it bounces like a rubber ball
  D.move({ at: along(ctx, 0.45), yaw: 32, pitch: 14, dist: 2.4, lift: 0.4, fov: 38 }, 0.4);
  const g = Math.max(restGap(ctx), 0.85);
  const hops = [
    { a: g * 0.55, h: 0.75, d: 0.5, spin: 2 },
    { a: g * 0.85, h: 0.35, d: 0.36, spin: 1.5 },
    { a: g, h: 0.13, d: 0.24, spin: 0.5 },
  ];
  let a0 = 0;
  let rot = 0;
  const z0 = hitZ;
  for (const [i, h] of hops.entries()) {
    const f = along(ctx, a0);
    const t = along(ctx, h.a);
    sfx.play('boing', { pitch: 1 + i * 0.22 });
    await anim.tween(h.d, (k, raw) => {
      vic.root.position.lerpVectors(f, t, k);
      vpose(vic, Q(rot - h.spin * Math.PI * k), { up: arc(k, h.h), scale: i === 0 ? new THREE.Vector3(lerp(1.25, 1, Math.min(1, k * 4)), lerp(0.9, 1, Math.min(1, k * 4)), lerp(0.6, 1, Math.min(1, k * 4))) : ONE });
      kick(vic, i + raw * h.d, 0.6);
      if (i === 0) {
        // the rhino skids to a stop on the square
        setZ(atk, lerp(z0, dist, Ease.outQuad(k)), 0);
        if (p.head) p.head.rotation.x = lerp(-0.45, 0, k);
        if (Math.random() < 0.3) ctx.fx.dust(atk.model.localToWorld(new THREE.Vector3(0, 0.03, 0.15)), 4, 0xeadfc8);
      }
    });
    rot -= h.spin * Math.PI;
    K.starBurst(t.clone().setY(BOARD_Y + 0.06), { count: 3, speed: 1.2 });
    a0 = h.a;
  }
  sfx.play('squeak', { pitch: 1.2 });
  await plop(ctx, 0.2, 0.18);
  await Promise.all([
    settle(anim, atk, 0.5, endPos(ctx)).then(() => sfx.play('snortKid')),
    dizzyEnd(ctx, 1.2),
  ]);
}

// ------------------------------------------------------------------ SCORPION: Tickle Tail
async function scorpion(ctx) {
  const { anim, atk, vic, sfx, dist, D, world } = ctx;
  const K = kidFx(world);
  const p = atk.parts;
  const vd = dims(vic);
  const tail = p.tail ?? [];
  const tailRest = tail.map((s) => s.rotation.clone());
  // scuttles up, waving hello
  const follow = D.track({ at: () => wpos(atk.model), yaw: 48, pitch: 8, dist: 1.45, lift: 0.25 }, 6);
  world.setFov(32);
  sfx.play('tiptoe', { n: 5 });
  const stand = dist - 0.6;
  await anim.tween(0.85, (k, raw) => {
    const t = raw * 0.85;
    setZ(atk, lerp(0, stand, k), 0);
    p.legs?.forEach((leg, i) => (leg.rotation.x = Math.sin(t * 40 + i * 1.3) * 0.3));
    if (p.clawL && p.clawR) {
      p.clawL.rotation.x = -0.6 + Math.sin(t * 14) * 0.3;
      p.clawR.rotation.x = -0.6 + Math.sin(t * 14 + Math.PI) * 0.3;
    }
    if (p.fingerL && p.fingerR) {
      p.fingerL.rotation.y = 0.15 + Math.abs(Math.sin(t * 16)) * 0.5;
      p.fingerR.rotation.y = -0.15 - Math.abs(Math.sin(t * 16)) * 0.5;
    }
  });
  follow();
  p.legs?.forEach((leg) => (leg.rotation.x = 0));
  // ta-da! a fluffy tickle feather
  const tip = p.stinger ?? tail[tail.length - 1] ?? atk.model;
  const feather = tickleFeather(ctx, tip);
  D.cut({ at: ctx.mid, yaw: 30, pitch: 10, dist: 1.7, lift: 0.4, fov: 34 });
  sfx.play('tada');
  await anim.tween(0.55, (k) => {
    tail.forEach((seg, j) => (seg.rotation.x = lerp(tailRest[j].x, j === 0 ? 1.45 : 0.55, Ease.inOutQuad(k))));
    if (k > 0.5 && !feather.shown) {
      feather.shown = true;
      K.sparkles(feather.tip(), { count: 8, spread: 0.12 });
    }
  });
  K.word(lifted(feather.tip(), 0.2), 'TA-DA!', { color: 0xff79d0, size: 0.26, life: 0.8 });
  // tickle, tickle, tickle
  D.cut({ at: ctx.V, yaw: 42, pitch: 14, dist: 1.75, lift: 0.4, fov: 32 });
  const tickle = every(0.28, () => sfx.play('tickle'));
  let g = 0;
  const giggle = every(0.45, () => sfx.play('giggle', { pitch: 1 + (g++ % 3) * 0.1 }), 0.2);
  const words = [
    [0.2, 'TICKLE TICKLE!', 0xff79d0],
    [0.95, 'HEE HEE!', 0xffd23a],
  ];
  const fluff = every(0.15, () => K.sparkles(feather.tip(), { count: 1, spread: 0.05, colors: [0xff8fc8, 0xffffff] }));
  const D2 = 1.7;
  await anim.tween(D2, (k, raw) => {
    const t = raw * D2;
    tail.forEach((seg, j) => {
      const base = j === 0 ? 1.45 : 0.55;
      seg.rotation.x = base + (j >= 2 ? Math.sin(t * 13 + j) * 0.12 : 0);
      seg.rotation.y = tailRest[j].y + (j >= 3 ? Math.sin(t * 26 + j) * 0.35 : 0);
    });
    if (p.clawL && p.clawR) {
      p.clawL.rotation.set(-0.2, -0.2 + Math.sin(t * 30) * 0.2, 0);
      p.clawR.rotation.set(-0.2, 0.2 - Math.sin(t * 30 + 1) * 0.2, 0);
    }
    vpose(vic, Q(0, Math.sin(t * 10) * 0.12, Math.sin(t * 13) * 0.1), { up: Math.abs(Math.sin(t * 12)) * 0.04 * k });
    kick(vic, t, 0.4 + 0.6 * k);
    tickle(t);
    giggle(t);
    fluff(t);
    while (words.length && t >= words[0][0]) {
      const [, text, color] = words.shift();
      K.word(lifted(topPoint(vic), 0.35 + Math.random() * 0.15), text, { color, size: 0.25 });
    }
  });
  // laughing so hard it floats away on a stream of bubbles
  ctx.onKill?.();
  sfx.play('laugh', { pitch: 1.15 });
  sfx.play('harp', { delay: 0.2 });
  sfx.play('bubble', { n: 6, delay: 0.1 });
  K.word(lifted(topPoint(vic), 0.5), 'HA HA HA!', { color: 0xffd23a, size: 0.34, life: 1.4 });
  D.move({ at: along(ctx, 0.35), yaw: 30, pitch: 2, dist: 2.6, lift: 0.85, fov: 38 }, 0.8);
  D.slowmo(0.55, 0.6);
  const from = vic.root.position.clone();
  const to = endSpot(ctx);
  const stream = every(0.06, () => K.bubbles(lifted(centerPoint(vic), -vd.hy * 0.6), { count: 2, spread: Math.max(vd.hx, 0.15) * 1.2, rise: 0.55, size: [0.03, 0.07] }));
  const blub = every(0.35, () => sfx.play('bubble', { n: 2 }));
  const laugh = every(0.6, () => sfx.play('giggle', { pitch: 1.2 }), 0.4);
  const D3 = 1.45;
  await anim.tween(D3, (k, raw) => {
    const t = raw * D3;
    vic.root.position.lerpVectors(from, to, k);
    vpose(vic, Q(Math.sin(t * 3) * 0.15, Math.sin(t * 1.5) * 0.4, Math.sin(t * 4) * 0.15), { up: 0.8 * Ease.inOutSine(Math.min(1, k * 1.3)) });
    kick(vic, D2 + t, 0.9);
    tail.forEach((seg, j) => (seg.rotation.x = lerp(j === 0 ? 1.45 : 0.55, tailRest[j].x, Math.min(1, k * 2))));
    stream(t);
    blub(t);
    laugh(t);
  });
  // pop! ... and down it drops
  sfx.play('bubblePop');
  sfx.play('slideDown', { dur: 0.3 });
  K.sparkles(centerPoint(vic), { count: 10, spread: 0.3, colors: [0xffffff, 0xbfe9ff, 0xff8fc8] });
  const removing = feather.remove();
  await anim.tween(0.32, (k) => vpose(vic, Q(0, Math.sin(1.5 * D3) * 0.4 * (1 - k), 0), { up: 0.8 * (1 - Ease.inQuad(k)) }));
  sfx.play('boing', { pitch: 1.2 });
  await plop(ctx, 0.28);
  await Promise.all([removing, settle(anim, atk, 0.6, endPos(ctx)), dizzyEnd(ctx, 1.0)]);
}

// ------------------------------------------------------------------ CROCODILE: Spin-a-Roo
async function crocodile(ctx) {
  const { anim, atk, vic, sfx, dist, D, world } = ctx;
  const K = kidFx(world);
  const p = atk.parts;
  const vd = dims(vic);
  const ad = dims(atk);
  const tailRest = (p.tail ?? []).map((s) => s.rotation.clone());
  // waddles up with a big friendly grin
  const follow = D.track({ at: () => wpos(p.head ?? atk.model), yaw: 52, pitch: 6, dist: 1.6, lift: 0.15 }, 6);
  world.setFov(32);
  sfx.play('tiptoe', { n: 5 });
  const stand = Math.max(0.1, dist - vd.front - ad.front + 0.14);
  await anim.tween(1.0, (k, raw) => {
    const t = raw * 1.0;
    setZ(atk, lerp(0, stand, k), 0);
    p.legs?.forEach((leg, i) => (leg.rotation.y = Math.sin(t * 14 + i * 1.6) * 0.35));
    p.tail?.forEach((seg, i) => (seg.rotation.y = tailRest[i].y + Math.sin(t * 8 - i) * 0.25));
    atk.model.rotation.z = Math.sin(t * 14) * 0.05;
    if (p.jaw) p.jaw.rotation.x = 0.15 + Math.sin(t * 6) * 0.04;
  });
  follow();
  atk.model.rotation.z = 0;
  p.legs?.forEach((leg) => (leg.rotation.y = 0));
  // open wiiide...
  D.cut({ at: ctx.mid, yaw: 8, pitch: 10, dist: 2.0, lift: 0.3, fov: 36 });
  sfx.play('slideUp', { dur: 0.4 });
  await anim.tween(0.45, (k) => {
    if (p.jaw) p.jaw.rotation.x = lerp(0.15, 0.75, Ease.outQuad(k));
    if (p.head) p.head.rotation.x = -0.25 * k;
  });
  // ...and a soft, gummy NOM
  await anim.tween(0.22, (k) => {
    setZ(atk, lerp(stand, stand + 0.1, k), 0);
    if (p.jaw) p.jaw.rotation.x = lerp(0.75, 0.25, Ease.inQuad(k));
    if (p.head) p.head.rotation.x = lerp(-0.25, 0, k);
  });
  sfx.play('munch');
  K.word(lifted(headPoint(atk), 0.45), 'NOM!', { color: 0x63d471, size: 0.32 });
  K.starBurst(lifted(headPoint(atk), 0.1), { count: 6, speed: 1.4 });
  await anim.tween(0.25, (k, raw) => {
    vpose(vic, I, { up: 0.08 * Ease.outQuad(k) });
    kick(vic, raw * 0.25, 0.8);
  });
  (p.head ?? atk.model).attach(vic.root);
  // spin dance!
  const m0 = atk.model.position.clone();
  const P = new THREE.Vector3(0, 0, (m0.z + dist) / 2);
  D.cut({ at: atk.root.localToWorld(P.clone()).setY(BOARD_Y), yaw: 30, pitch: 18, dist: 2.2, lift: 0.3, fov: 36 });
  sfx.play('whirl', { dur: 1.7 });
  sfx.play('flute', { delay: 0.15 });
  sfx.play('giggle', { delay: 0.8 });
  const notes = every(0.22, () => K.notes(lifted(atk.root.localToWorld(P.clone()), 0.5), { count: 1, spread: 0.4 }));
  const sparks = every(0.12, () => K.sparkles(centerPoint(vic), { count: 2, spread: 0.2 }));
  const D1 = 1.8;
  await anim.tween(D1, (k, raw) => {
    const t = raw * D1;
    const phi = Ease.inOutSine(k) * Math.PI * 4;
    const off = m0.clone().sub(P).applyAxisAngle(UP, phi);
    atk.model.position.copy(P).add(off);
    atk.model.position.y = 0.07 + Math.abs(Math.sin(phi * 1.5)) * 0.09;
    atk.model.rotation.set(0, phi, 0);
    p.tail?.forEach((seg, i) => (seg.rotation.y = tailRest[i].y + Math.sin(t * 10 - i) * 0.35));
    p.legs?.forEach((leg, i) => (leg.rotation.y = Math.sin(t * 16 + i * 1.6) * 0.3));
    kick(vic, t, 0.6);
    notes(t);
    sparks(t);
  });
  atk.model.position.copy(m0);
  atk.model.rotation.set(0, 0, 0);
  // PTOOEY!
  sfx.play('ptooey');
  sfx.play('whee', { delay: 0.1 });
  K.word(lifted(headPoint(atk), 0.45), 'PTOOEY!', { color: 0x9fd8ff, size: 0.3 });
  ctx.onKill?.();
  const st = detach(ctx);
  const from = vic.root.position.clone();
  const to = endSpot(ctx);
  D.move({ at: ctx.V.clone().lerp(to, 0.5), yaw: 35, pitch: 14, dist: 2.3, lift: 0.3, fov: 36 }, 0.4);
  await anim.tween(0.65, (k, raw) => {
    vic.root.position.lerpVectors(from, to, k);
    const q = st.q.clone().slerp(I, k).multiply(Q(0, Math.PI * 2 * k, Math.PI * 2 * Ease.inOutQuad(k)));
    vpose(vic, q, { cy: lerp(st.cy, restCy(vic), k) + arc(k, 0.6) });
    kick(vic, raw * 0.65, 1 - k);
    if (p.jaw) p.jaw.rotation.x = lerp(0.6, 0.15, k);
  });
  sfx.play('boing', { pitch: 1.1 });
  await plop(ctx, 0.3);
  // the croc's a bit dizzy too
  await Promise.all([
    anim.tween(0.8, (k, raw) => {
      atk.model.rotation.z = Math.sin(raw * 0.8 * 9) * 0.1 * (1 - k);
      if (p.head) p.head.rotation.y = Math.sin(raw * 0.8 * 7) * 0.2 * (1 - k);
    }).then(() => settle(anim, atk, 0.5, endPos(ctx))),
    dizzyEnd(ctx, 1.2),
  ]);
}

// ------------------------------------------------------------------ exports
function prep(ctx) {
  if (!ctx.kid) ctx.kid = { home: ctx.vic.root.parent ?? ctx.world.scene };
  dims(ctx.vic);
  dims(ctx.atk);
  return ctx.kid;
}

// Enforce the end-state contract whatever happened in the choreography.
function finalize(ctx) {
  const { atk, vic, world, dist } = ctx;
  const home = ctx.kid?.home ?? world.scene;
  if (vic.root.parent !== home) home.attach(vic.root);
  const yaw = new THREE.Euler().setFromQuaternion(vic.root.quaternion, 'YXZ').y;
  vic.root.rotation.set(0, yaw, 0);
  vic.root.position.y = BOARD_Y;
  vic.root.scale.setScalar(1);
  vic.restoreMaterials();
  vic.model.visible = true;
  atk.model.position.set(0, 0.07, dist);
  atk.model.rotation.set(0, 0, 0);
  atk.model.scale.set(1, 1, 1);
  atk.model.visible = true;
}

const wrap = (fn) => async (ctx) => {
  prep(ctx);
  await fn(ctx);
  finalize(ctx);
};

export const KID_ATTACKS = {
  eagle: wrap(eagle),
  tiger: wrap(tiger),
  wolf: wrap(wolf),
  bear: wrap(bear),
  cobra: wrap(cobra),
  shark: wrap(shark),
  gorilla: wrap(gorilla),
  rhino: wrap(rhino),
  scorpion: wrap(scorpion),
  crocodile: wrap(crocodile),
};

// A startled little hop with a "!" — eyes on the attacker.
export async function kidVictimReacts(ctx) {
  const { vic, sfx, D, anim, world } = ctx;
  prep(ctx);
  const K = kidFx(world);
  D.cut({ at: ctx.V, yaw: -32, pitch: 8, dist: 1.8, lift: 0.5, fov: 36 });
  sfx.play('squeak');
  K.word(lifted(topPoint(vic), 0.14), '!', { color: 0xffd23a, size: 0.36, life: 0.62 });
  await anim.tween(0.55, (k) => {
    const jump = Math.min(1, k / 0.7);
    const sy = k < 0.7 ? 1 + 0.16 * Math.sin(jump * Math.PI) : 1 - 0.2 * Math.sin(((k - 0.7) / 0.3) * Math.PI);
    vpose(vic, I, { scale: squash(sy), up: arc(jump, 0.2) });
    if (vic.parts.head) poseRel(vic.parts.head, -0.3 * Math.sin(k * Math.PI), 0, 0);
    limbsOf(vic).forEach((l, i) => poseRel(l, Math.sin(jump * Math.PI) * 0.4 * (i % 2 ? 1 : -1), 0, 0));
  });
  await settle(anim, vic, 0.12, VIC_REST);
}

// The defeated victim floats home in a shiny soap bubble and is set down on its yard spot.
export async function kidFloatHome({ world, anim, sfx, vic, spot }) {
  const K = kidFx(world);
  const d = dims(vic);
  const radius = clamp(Math.hypot(d.hx, d.hy, d.hz) * 0.92, 0.3, 0.7);
  const bubble = K.bigBubble(radius);
  const center = () => vic.model.localToWorld(new THREE.Vector3(0, d.cy, d.cz));
  const p0 = vic.root.position.clone();
  const r0 = vic.root.rotation.y;
  const s0 = vic.root.scale.x;
  let t = 0;
  const wobble = (dt) => {
    t += dt;
    const w = Math.sin(t * 7) * 0.045;
    const s = radius * vic.root.scale.x;
    bubble.scale.set(s * (1 + w), s * (1 - w), s * (1 + w));
    bubble.position.copy(center());
  };
  // the bubble forms
  bubble.position.copy(center());
  sfx.play('bubble', { n: 3 });
  sfx.play('twinkle', { delay: 0.2 });
  K.sparkles(center(), { count: 12, spread: radius * 0.8 });
  await Promise.all([
    anim.tween(0.5, (k) => {
      bubble.scale.setScalar(Math.max(0.001, radius * vic.root.scale.x * Ease.outBack(k)));
      bubble.position.copy(center());
    }),
    settle(anim, vic, 0.5, VIC_REST),
  ]);
  // ...and floats up, over the board, all the way home
  const sep = Math.hypot(spot.x - p0.x, spot.z - p0.z);
  const dur = clamp(sep * 0.2, 1.3, 2.6);
  const peak = 0.4 + Math.min(1.3, sep * 0.12);
  const lift = 0.45;
  const shot = () => {
    const b = vic.root.position;
    const c = new THREE.Vector3((b.x + spot.x) / 2, BOARD_Y + 0.6, (b.z + spot.z) / 2);
    const s = Math.hypot(b.x - spot.x, b.z - spot.z);
    return world.frameView(c, Math.max(1.6, s * 0.5 + 1.0), 50);
  };
  const stopTrail = K.trail(() => center().add(new THREE.Vector3(0, -radius * vic.root.scale.x * 0.8, 0)), { rate: 28 });
  sfx.play('harp');
  sfx.play('whee', { delay: 0.35, pitch: 0.9 });
  await anim.tween(0.5, (k, raw, dt) => {
    vic.root.position.y = p0.y + lift * Ease.inOutSine(k);
    kick(vic, t, 0.3 * k);
    wobble(dt);
    world.follow(shot(), dt, 3);
  });
  const twinkle = every(0.5, () => sfx.play('twinkle'));
  await anim.tween(dur, (k, raw, dt) => {
    const e = Ease.inOutSine(k);
    vic.root.position.lerpVectors(p0, spot, e);
    vic.root.position.y = lerp(p0.y + lift, spot.y + 0.3, e) + arc(e, peak);
    vic.root.rotation.y = lerpAngle(r0, 0, e);
    vic.root.scale.setScalar(lerp(s0, YARD_SCALE, e));
    kick(vic, t, 0.3);
    wobble(dt);
    world.follow(shot(), dt, 3.5);
    twinkle(raw * dur);
  });
  // set down on the yard spot... pop!
  await anim.tween(0.35, (k, raw, dt) => {
    vic.root.position.y = lerp(spot.y + 0.3, spot.y + 0.12, Ease.outQuad(k));
    kick(vic, t, 0.3 * (1 - k));
    wobble(dt);
    world.follow(shot(), dt, 3.5);
  });
  stopTrail();
  sfx.play('bubblePop');
  sfx.play('twinkle', { delay: 0.05 });
  const c = center();
  K.sparkles(c, { count: 14, spread: radius * 0.9 });
  K.droplets(c, { count: 16, speed: 1.0, up: 0.6, size: [0.01, 0.02] });
  K.ring(spot, { color: 0xffffff, from: 0.2, to: 0.9, duration: 0.45, opacity: 0.7 });
  bubble.userData.stopTick?.();
  K.release(bubble);
  const settleParts = settle(anim, vic, 0.2, VIC_REST);
  await anim.tween(0.2, (k) => (vic.root.position.y = lerp(spot.y + 0.12, spot.y, Ease.inQuad(k))));
  sfx.play('boing', { pitch: 1.3 });
  await settleParts;
  await anim.tween(0.18, (k) => vpose(vic, I, { scale: squash(1 - 0.22 * Math.sin(k * Math.PI)) }));
  vic.root.position.copy(spot);
  vic.root.rotation.set(0, 0, 0);
  vic.root.scale.setScalar(YARD_SCALE);
  vic.model.position.copy(VIC_REST);
  vic.model.quaternion.identity();
  vic.model.scale.set(1, 1, 1);
}
