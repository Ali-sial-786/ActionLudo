import * as THREE from 'three';
import { Ease, arc, lerp, rand } from '../engine/anim.js';
import { DEBRIS, createAnimal } from './animals.js';
import { BOARD_Y } from './boardMesh.js';

// Each attack receives a context:
//   A, V       board-level world positions of attacker and victim squares, dir = A->V, dist = |V - A|
//   atk, vic   TokenViews. atk.root sits on A facing V, vic.root on V facing A.
//   D          camera Director (cuts, moves, tracking, orbit, slow-mo); gore = blood & dismemberment
// Attacker model offsets are in the attacker's local frame (+z towards the victim, so (0, y, dist) is the victim).
// Every attack ends with the victim dismembered and the attacker's model standing at (0, 0, dist).

const UP = new THREE.Vector3(0, 1, 0);

const wpos = (obj, out = new THREE.Vector3()) => obj.getWorldPosition(out);
const bodyPoint = (view, y = 0.28) => wpos(view.model).add(new THREE.Vector3(0, y, 0));
const headPoint = (view) => (view.parts.head ? wpos(view.parts.head) : bodyPoint(view, 0.45));

const _box = new THREE.Box3();
// Middle of an animal as it actually lies (it moves with the body when the animal is knocked over).
const midPoint = (view) => _box.setFromObject(view.model).getCenter(new THREE.Vector3());

// Knock an animal onto its side (k = 0..1); `toward` = +1 rolls its back to its own +x side. It is
// lifted as it goes over, just enough that nothing (splayed legs, a flat croc) sinks into the board.
function knockDown(view, k, toward = 1, angle = 1.35) {
  const m = view.model;
  const key = `${toward}:${angle}`;
  if (m.userData.knock?.key !== key) {
    const [rz, y] = [m.rotation.z, m.position.y];
    m.rotation.z = -toward * angle;
    m.position.y = 0.07;
    view.root.updateMatrixWorld(true);
    const low = _box.setFromObject(m, true).min.y;
    m.rotation.z = rz;
    m.position.y = y;
    m.userData.knock = { key, lift: THREE.MathUtils.clamp(BOARD_Y + 0.005 - low, 0, 0.2) };
  }
  m.rotation.z = -toward * angle * k;
  m.position.y = 0.07 + m.userData.knock.lift * k;
}

function setZ(view, z, y = null) {
  view.model.position.z = z;
  if (y !== null) view.model.position.y = 0.07 + y;
}

const _q = new THREE.Quaternion();
const _eul = new THREE.Euler();
// Rotate the model about X (and scale it) while keeping a model-space point, e.g. the hind feet, planted.
function rotateAbout(view, rotX, pivot, scale = 1, base = new THREE.Vector3(0, 0.07, view.model.position.z)) {
  view.model.rotation.x = rotX;
  view.model.scale.setScalar(scale);
  _q.setFromEuler(_eul.set(rotX, 0, 0));
  const moved = pivot.clone().multiplyScalar(scale).applyQuaternion(_q);
  view.model.position.copy(base).add(pivot).sub(moved);
}

const LIMB_NAMES = ['legFL', 'legFR', 'legBL', 'legBR', 'armL', 'armR', 'legL', 'legR', 'wingL', 'wingR', 'clawL', 'clawR'];
function limbsOf(view) {
  const p = view.parts;
  return LIMB_NAMES.map((n) => p[n]).filter(Boolean).concat(p.legs ?? []);
}

// One convulsion: a fast snap out over the first quarter of the beat, then an eased return to rest.
const kick = (u) => (u < 0.25 ? Ease.outQuad(u / 0.25) : 1 - Ease.inOutSine((u - 0.25) / 0.75));
// Which way each limb swings on a kick: fore limbs reach forward, hind limbs shove back.
const SWING = { legFL: -1, legFR: -1, armL: -1, armR: -1, clawL: -0.5, clawR: -0.5, wingL: -0.4, wingR: -0.4, legBL: 1, legBR: 1, legL: 1, legR: 1 };
const KICKS_PER_SECOND = 2.6;

// Victim thrashes in a few big, deliberate convulsions (about 2.6 a second): legs kick out, the head
// jerks back, the jaw gapes and the body jolts. `fade` makes each one weaker (death throes). Every
// joint is back where it started when the tween ends, so nothing pops on the next move.
function struggle(ctx, view, dur, power = 1, fade = false) {
  const p = view.parts;
  const limbs = LIMB_NAMES.filter((n) => p[n]).map((n) => [p[n], SWING[n]]);
  (p.legs ?? []).forEach((l, i) => limbs.push([l, i % 2 ? 1 : -1]));
  const rest = limbs.map(([l]) => l.rotation.x);
  const head = p.head;
  const h0 = head?.rotation.clone();
  const j0 = p.jaw?.rotation.x ?? 0;
  const m0 = view.model.rotation.clone();
  const beats = Math.max(1, Math.round(dur * KICKS_PER_SECOND));
  return ctx.anim.tween(dur, (k) => {
    const b = Math.min(k * beats, beats - 1e-6);
    const n = Math.floor(b);
    // alternate a full splay with a smaller tuck; throes lose strength beat by beat
    const alt = n % 2 ? -0.6 : 1;
    const s = (k >= 1 ? 0 : kick(b - n)) * power * (fade ? 1 - (0.75 * n) / beats : 1);
    limbs.forEach(([l, w], i) => (l.rotation.x = rest[i] + w * s * alt * 0.65));
    if (head) {
      head.rotation.x = h0.x - s * 0.38;
      head.rotation.y = h0.y + s * 0.3 * Math.sign(alt);
    }
    if (p.jaw) p.jaw.rotation.x = j0 + s * 0.5;
    view.model.rotation.z = m0.z + s * 0.09 * Math.sign(alt);
    view.model.rotation.x = m0.x - s * 0.05;
  });
}

// Quadruped running gait.
function gait(p, t, amp = 0.6) {
  if (!p.legFL) return;
  const s = Math.sin(t);
  p.legFL.rotation.x = p.legBR.rotation.x = s * amp;
  p.legFR.rotation.x = p.legBL.rotation.x = -s * amp;
}

// A wound with one tight jet of blood, a red flash and a crunch.
function hit(ctx, point, { dir = UP, count = 45, speed = 2.6, wound = 0.05, gash = 0, sound = 'bite', impact = 0.7, mist = 0.6 } = {}) {
  ctx.gore.spray(point, dir, { count: Math.round(count * 0.9), speed: speed * 0.85, spread: 0.35, up: 0.45 });
  if (mist) ctx.gore.mist(point, mist * 0.6);
  if (wound) ctx.gore.wound(ctx.vic, point, { size: wound, gash });
  if (sound) ctx.sfx.play(sound);
  ctx.D.impact(impact);
}

// Slow-motion close-up for the moment that matters.
function killcam(ctx, spec, slow = 0.18, hold = 1.0) {
  ctx.D.cut(spec);
  ctx.D.slowmo(slow, hold);
  ctx.sfx.play('slowmo');
  ctx.sfx.play('heartbeat');
}

// The kill: the victim is torn apart.
function finish(ctx, opts = {}) {
  const c = midPoint(ctx.vic);
  ctx.sfx.play('rip');
  ctx.sfx.play('crunch', { delay: 0.05 });
  ctx.D.impact(1.2);
  ctx.fx.victimBurst(c, DEBRIS[ctx.vic.animal], 0.3);
  ctx.gore.dismember(ctx.vic, { dir: ctx.dir, toward: ctx.D.r, ...opts });
  // the killer is left blood-soaked around the mouth
  for (let i = 0; i < 2; i++) ctx.gore.wound(ctx.atk, headPoint(ctx.atk).add(new THREE.Vector3(rand(-0.04, 0.04), -0.03, 0)), { size: 0.045 });
  ctx.onKill?.();
}

// ------------------------------------------------------------------ EAGLE: Sky Shred
async function eagle(ctx) {
  const { anim, atk, vic, sfx, dist, D } = ctx;
  const p = atk.parts;
  // the pair, from the eagle's crown down to the prey's belly, for every shot once they meet
  const pair = [() => headPoint(atk).add(new THREE.Vector3(0, 0.12, 0)), () => bodyPoint(vic, 0.05)];
  await D.move({ at: ctx.A, yaw: -38, pitch: 10, dist: 1.6, lift: 0.4, fov: 36 }, 0.5);
  sfx.play('screech');
  await anim.tween(0.5, (k) => {
    p.setWings(Ease.outCubic(k));
    p.head.rotation.x = -0.5 * Math.sin(k * Math.PI);
    p.jaw.rotation.x = 0.5 * Math.sin(k * Math.PI);
  });
  // two big wingbeats and it bursts up out of the top of the frame
  sfx.play('whoosh', { dur: 0.45 });
  await anim.tween(0.5, (k) => {
    p.setWings(1, Math.sin(k * Math.PI * 4) * 0.7);
    setZ(atk, lerp(0, -0.4, k), Ease.inQuad(k) * 3.2);
    atk.model.rotation.x = -0.35 * k;
  });
  // the prey looks up; a shadow grows over it
  D.cut({ at: ctx.V, yaw: -30, pitch: 6, dist: 1.3, lift: 0.35, fov: 34 });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.copy(ctx.V).setY(BOARD_Y + 0.015);
  ctx.world.transient.add(shadow);
  sfx.play('heartbeat');
  sfx.play('growl', { pitch: 1.3, dur: 0.6 });
  await anim.tween(0.6, (k) => {
    shadow.material.opacity = 0.5 * k;
    shadow.scale.setScalar(1.8 - k);
    if (vic.parts.head) vic.parts.head.rotation.x = -0.5 * Ease.outCubic(k);
  });
  // the dive, talons first, seen from low down so it drops in from high in the frame
  sfx.play('whoosh', { dur: 0.45 });
  D.cut({ at: ctx.V, yaw: 18, pitch: 4, dist: 2.0, lift: 0.75, fov: 36 });
  D.slowmo(0.45, 0.3);
  await anim.tween(0.4, (k) => {
    const e = Ease.inQuad(k);
    p.setWings(lerp(0.25, 0.8, e));
    setZ(atk, lerp(dist - 0.9, dist, k), lerp(1.7, 0.42, lerp(k, e, 0.5)));
    atk.model.rotation.x = lerp(0.8, -0.35, e);
    p.talons.rotation.x = -0.8 * e;
  });
  shadow.removeFromParent();
  shadow.geometry.dispose();
  shadow.material.dispose();
  // talons sink in
  killcam(ctx, { fit: pair, yaw: 40, pitch: 12, dist: 1.1, lift: 0, fov: 34 }, 0.22, 0.6);
  for (const s of [1, -1]) hit(ctx, bodyPoint(vic, 0.32).add(ctx.dir.clone().multiplyScalar(s * 0.08)), { count: 40, wound: 0.045, sound: s > 0 ? 'crunch' : null, impact: 0.8 });
  await Promise.all([
    struggle(ctx, vic, 0.4, 1),
    anim.tween(0.4, (k) => p.setWings(lerp(0.8, 1, k), 0.35 * Math.sin(k * Math.PI))),
  ]);
  // two heavy wingbeats carry it up, the pair held in one shot
  p.talons.attach(vic.root);
  const stopFollow = D.track({ fit: pair, yaw: 35, pitch: 6, dist: 1.4, lift: 0 }, 9);
  await Promise.all([
    anim.tween(0.8, (k) => {
      p.setWings(1, Math.sin(k * Math.PI * 4) * 0.7);
      setZ(atk, dist, lerp(0.42, 0.85, Ease.outQuad(k)));
      atk.model.rotation.x = lerp(-0.35, -0.15, k);
    }),
    struggle(ctx, vic, 0.8, 1),
  ]);
  // three tearing strikes with the beak
  for (let i = 0; i < 3; i++) {
    const h0 = p.head.rotation.x;
    await anim.tween(0.1, (k) => (p.head.rotation.x = lerp(h0, 0.9, Ease.inQuad(k))));
    hit(ctx, bodyPoint(vic, 0.35), { dir: new THREE.Vector3(rand(-0.5, 0.5), 0.8, rand(-0.5, 0.5)), count: 30, wound: 0.05, sound: 'tear', impact: 0.5 });
    await anim.tween(0.2, (k) => {
      p.head.rotation.x = lerp(0.9, -0.2, Ease.outCubic(k));
      p.setWings(1, Math.sin(k * Math.PI) * 0.45);
    });
  }
  stopFollow();
  sfx.play('screech');
  // rips it clean in two; the halves drop to the square under the hovering eagle
  const below = { fit: [pair[0], ctx.V.clone().setY(BOARD_Y + 0.25)], yaw: 60, pitch: 10, dist: 1.4, lift: 0 };
  killcam(ctx, { ...below, fov: 34 }, 0.15, 1.2);
  ctx.world.transient.attach(vic.root);
  finish(ctx, { mode: 'halves', axis: 'z', power: 1.6, up: 0.4 });
  // the camera swings round as the eagle hovers, then glides down onto the remains
  await Promise.all([
    D.orbit(below, 25, 1.9),
    (async () => {
      await anim.tween(0.6, (k) => {
        p.setWings(1, 0.5 * Math.sin(k * Math.PI * 2));
        p.head.rotation.x = -0.2 * (1 - k);
      });
      await anim.tween(0.8, (k) => {
        p.setWings(1, Math.sin(k * Math.PI * 2) * 0.4 * (1 - k));
        setZ(atk, dist, lerp(0.85, 0, Ease.inOutCubic(k)));
        atk.model.rotation.x = lerp(-0.15, 0, k);
        p.talons.rotation.x = -0.8 * (1 - k);
      });
    })(),
  ]);
  await anim.tween(0.3, (k) => p.setWings(1 - k));
}

// ------------------------------------------------------------------ TIGER: Pounce & Maul
async function tiger(ctx) {
  const { anim, atk, vic, sfx, dist, D } = ctx;
  const p = atk.parts;
  // The prey is knocked onto its side with its back to the camera, the tiger standing over it.
  // toCam: which way that is across the board (+1 = the victim's own +x side).
  const toCam = D.r.dot(new THREE.Vector3(-ctx.dir.z, 0, ctx.dir.x)) > 0 ? 1 : -1;
  const pair = [() => headPoint(atk).add(new THREE.Vector3(0, 0.15, 0)), () => midPoint(vic)];
  // sinking low and easing back a step, side-on, with the prey in the same shot
  const back = -0.12;
  const stalk = D.track({ fit: [() => bodyPoint(atk, 0.55), () => headPoint(vic)], yaw: -14, pitch: 6, dist: 1.5, lift: 0 }, 5);
  sfx.play('growl', { pitch: 0.8, dur: 1.3 });
  await anim.tween(1.0, (k, raw) => {
    const c = Math.min(1, k * 3);
    atk.model.position.y = 0.07 - 0.07 * c;
    setZ(atk, back * Ease.inOutSine(k));
    p.head.rotation.x = 0.25 * c;
    gait(p, raw * 9, 0.35);
    p.tail.rotation.y = Math.sin(raw * 10) * 0.5;
    if (vic.parts.head) vic.parts.head.rotation.x = -0.25 * Ease.outCubic(Math.max(0, k * 2 - 1));
  });
  stalk();
  // it gathers itself: haunches down, hind feet set
  sfx.play('heartbeat');
  await anim.tween(0.3, (k) => {
    const e = Ease.outQuad(k);
    atk.model.rotation.x = -0.18 * e;
    gait(p, 0, 0);
    p.legBL.rotation.x = p.legBR.rotation.x = 0.35 * e;
    p.legFL.rotation.x = p.legFR.rotation.x = -0.2 * e;
  });
  // POUNCE, side-on in slow motion; the prey is knocked flat as the paws land
  D.cut({ at: ctx.mid, yaw: 0, pitch: 8, dist: 2.0, lift: 0.55, fov: 34 });
  D.slowmo(0.3, 0.5);
  sfx.play('roar', { pitch: 0.85 });
  const land = dist - 0.45;
  await anim.tween(0.42, (k) => {
    setZ(atk, lerp(back, land, k), arc(k, 0.45) - 0.07 * (1 - k));
    atk.model.rotation.x = lerp(-0.4, 0.35, k);
    p.legFL.rotation.x = p.legFR.rotation.x = -1.4 * Math.sin(k * Math.PI);
    p.legBL.rotation.x = p.legBR.rotation.x = 0.35 + 0.6 * Math.sin(k * Math.PI);
    p.jaw.rotation.x = 0.7 * k;
    if (vic.parts.head) vic.parts.head.rotation.x = -0.25 * (1 - k);
    knockDown(vic, Ease.outQuad(Math.max(0, (k - 0.75) / 0.25)), toCam);
  });
  sfx.play('thud', { power: 0.8 });
  ctx.world.shake(0.15);
  // teeth into the neck
  killcam(ctx, { fit: pair, yaw: 35, pitch: 14, dist: 1.2, lift: 0, fov: 34 }, 0.25, 0.6);
  await anim.tween(0.14, (k) => {
    const e = Ease.inQuad(k);
    p.head.rotation.x = lerp(0, 0.8, e);
    p.head.rotation.y = -toCam * 0.45 * e;
    p.jaw.rotation.x = lerp(0.7, 0.1, e);
    p.legBL.rotation.x = p.legBR.rotation.x = 0.35 * (1 - k);
  });
  hit(ctx, headPoint(vic), { count: 55, wound: 0.06, sound: 'crunch', impact: 1 });
  // three savage shakes of the head
  const stopShake = D.track({ fit: pair, yaw: 30, pitch: 16, dist: 1.2, lift: 0 }, 6);
  const throes = struggle(ctx, vic, 1.0, 1.1, true);
  for (let i = 0; i < 3; i++) {
    const s = i % 2 ? -1 : 1;
    await anim.tween(0.1, (k) => {
      const e = Ease.outQuad(k);
      p.head.rotation.y = -toCam * 0.45 + s * 0.35 * e;
      atk.model.rotation.z = s * 0.07 * e;
    });
    ctx.gore.spray(headPoint(vic), new THREE.Vector3(0, 0.8, 0).addScaledVector(D.r, 0.5 * s), { count: 14, speed: 2 });
    if (i === 1) sfx.play('squelch');
    await anim.tween(0.22, (k) => {
      const e = Ease.inOutSine(k);
      p.head.rotation.y = -toCam * 0.45 + s * 0.35 * (1 - e);
      atk.model.rotation.z = s * 0.07 * (1 - e);
    });
  }
  await throes;
  // two claw rakes down the flank
  for (const s of [1, -1]) {
    const leg = s > 0 ? p.legFL : p.legFR;
    await anim.tween(0.12, (k) => {
      leg.rotation.x = -1.5 * Ease.outQuad(k);
      leg.rotation.z = s * 0.4 * Ease.outQuad(k);
    });
    sfx.play('slash');
    await anim.tween(0.08, (k) => {
      leg.rotation.x = lerp(-1.5, 0.1, Ease.inQuad(k));
      leg.rotation.z = s * 0.4 * (1 - k);
    });
    hit(ctx, bodyPoint(vic, 0.12), { dir: new THREE.Vector3(0, 0.7, 0).addScaledVector(D.r, 0.6), count: 35, wound: 0.05, gash: 1, sound: null, impact: 0.6 });
    await anim.tween(0.1, (k) => (leg.rotation.x = 0.1 * (1 - k)));
  }
  stopShake();
  // rip
  killcam(ctx, { fit: pair, yaw: 42, pitch: 10, dist: 1.25, lift: 0, fov: 34 }, 0.16, 1.2);
  await anim.tween(0.18, (k) => {
    const e = Ease.outCubic(k);
    p.head.rotation.x = lerp(0.8, -0.5, e);
    p.head.rotation.y = -toCam * 0.45 * (1 - e);
    atk.model.rotation.x = lerp(0.35, -0.25, e);
  });
  finish(ctx, { mode: 'limbs', power: 2.2, up: 1.6 });
  sfx.play('roar', { pitch: 0.8 });
  await D.orbit({ at: ctx.V, yaw: 42, pitch: 12, dist: 1.4, lift: 0.25 }, 10, 1.7);
  await anim.tween(0.4, (k) => {
    const e = Ease.inOutCubic(k);
    p.head.rotation.set(lerp(-0.5, 0, e), 0, 0);
    p.jaw.rotation.x = 0.1 * (1 - e);
    atk.model.rotation.set(lerp(-0.25, 0, e), 0, 0);
    setZ(atk, lerp(land, dist, e), 0);
  });
}

// ------------------------------------------------------------------ WOLF: Pack Ambush
async function wolf(ctx) {
  const { anim, atk, vic, sfx, dist, world, D } = ctx;
  const p = atk.parts;
  const f = ctx.dir;
  const near = D.r.clone(); // the camera's side of the fight; the whole pack attacks from the far side
  // the attacker's own +x points along -(-f.z, 0, f.x): farX is the sign of its far side
  const farX = near.dot(new THREE.Vector3(-f.z, 0, f.x)) > 0 ? 1 : -1;
  // the howl, with the prey in the same shot
  D.cut({ fit: [headPoint(atk).add(new THREE.Vector3(0, 0.25, 0)), headPoint(vic), bodyPoint(atk, 0), bodyPoint(vic, 0)], yaw: 28, pitch: 6, dist: 1.2, lift: 0, fov: 34 });
  sfx.play('growl', { pitch: 1.1, dur: 1.0 });
  await anim.tween(0.6, (k) => {
    const e = Ease.outCubic(k);
    p.head.rotation.x = 0.25 * e;
    p.jaw.rotation.x = 0.35 * e;
    atk.model.position.y = 0.07 - 0.04 * e;
  });
  sfx.play('howl');
  await anim.tween(0.8, (k) => {
    const h = Math.sin(Math.min(1, k * 1.25) * Math.PI);
    p.head.rotation.x = 0.25 - 1.2 * h;
    p.jaw.rotation.x = 0.35 + 0.15 * h;
  });
  // the rest of the pack charges in from the far side; every mouth goes for a different spot
  const V = ctx.V.clone().setY(BOARD_Y + 0.07);
  const spots = [
    { mouth: V.clone().addScaledVector(near, -0.13).addScaledVector(f, 0.06), u: near.clone() },
    { mouth: V.clone().addScaledVector(f, 0.3).addScaledVector(near, -0.04), u: f.clone().multiplyScalar(-0.91).addScaledVector(near, 0.42).normalize() },
  ];
  const pack = spots.map(({ mouth, u }, i) => {
    const g = createAnimal('wolf');
    const bite = mouth.clone().addScaledVector(u, -0.45);
    const from = bite.clone().addScaledVector(u, -2.2).addScaledVector(f, i ? 0.4 : 0.6);
    g.model.position.copy(from);
    g.model.lookAt(bite);
    world.transient.add(g.model);
    return { ...g, from, bite, u, away: u.clone().negate() };
  });
  // the leader takes the throat, coming round to the far side of the prey's head
  const lead = { x: farX * 0.45, z: dist - 0.35, yaw: -farX * 1.15 };
  D.cut({ at: ctx.V, yaw: 10, pitch: 22, dist: 2.4, lift: 0.3, fov: 36 });
  sfx.play('roar', { pitch: 1.3 });
  await anim.tween(0.65, (k, raw) => {
    const e = Ease.inQuad(k);
    atk.model.position.set(lead.x * e, 0.03, lead.z * e);
    atk.model.rotation.y = lead.yaw * Ease.inOutSine(k);
    p.head.rotation.x = 0.25 * (1 - k);
    gait(p, raw * 30, 0.6);
    for (const w of pack) {
      w.model.position.lerpVectors(w.from, w.bite, e);
      gait(w.parts, raw * 30 + 1, 0.6);
    }
  });
  gait(p, 0, 0);
  for (const w of pack) gait(w.parts, 0, 0);
  // all three bite at once
  const heads = [() => headPoint(atk), ...pack.map((w) => () => wpos(w.parts.head))];
  const group = [...heads.map((h) => () => h().add(new THREE.Vector3(0, 0.12, 0))), () => bodyPoint(vic, 0)];
  killcam(ctx, { fit: group, yaw: -12, pitch: 30, dist: 1.3, lift: 0, fov: 34 }, 0.25, 0.6);
  await anim.tween(0.12, (k) => {
    for (const w of [{ parts: p }, ...pack]) {
      w.parts.head.rotation.x = 0.45 * Ease.inQuad(k);
      w.parts.jaw.rotation.x = 0.6 * (1 - k);
    }
  });
  hit(ctx, headPoint(vic).lerp(bodyPoint(vic, 0.42), 0.5), { count: 45, wound: 0.05, sound: 'crunch', impact: 1 });
  for (const w of pack) hit(ctx, wpos(w.parts.head).lerp(bodyPoint(vic, 0.3), 0.6), { dir: w.away.clone().setY(0.7), count: 30, wound: 0.05, sound: null, impact: 0.3 });
  sfx.play('bite');
  // tug of war in three hard yanks, the prey stretched between the jaws
  const stop = D.track({ fit: group, yaw: -6, pitch: 30, dist: 1.3, lift: 0 }, 5);
  sfx.play('growl', { pitch: 1.0, dur: 1.3 });
  const leadAway = new THREE.Vector3(-Math.sin(lead.yaw), 0, -Math.cos(lead.yaw));
  let beat = -1;
  await Promise.all([
    anim.tween(1.2, (k) => {
      const b = Math.min(k * 3, 2.999);
      const n = Math.floor(b);
      const pull = kick(b - n) * 0.05 + k * 0.1;
      const s = n % 2 ? -1 : 1;
      atk.model.position.set(lead.x + leadAway.x * pull, 0.03, lead.z + leadAway.z * pull);
      p.head.rotation.y = s * 0.3 * kick(b - n);
      pack.forEach((w, i) => {
        w.model.position.copy(w.bite).addScaledVector(w.away, pull);
        w.parts.head.rotation.y = (i % 2 ? s : -s) * 0.3 * kick(b - n);
      });
      vic.model.scale.set(1 + k * 0.12, 1 - k * 0.06, 1 + k * 0.14);
      if (n !== beat) {
        beat = n;
        sfx.play('tear');
        ctx.gore.spray(bodyPoint(vic, 0.3), new THREE.Vector3(0, 1, 0).addScaledVector(near, 0.4), { count: 16, speed: 2 });
      }
    }),
    struggle(ctx, vic, 1.2, 1.1, true),
  ]);
  stop();
  killcam(ctx, { fit: group, yaw: 5, pitch: 28, dist: 1.4, lift: 0, fov: 34 }, 0.15, 1.2);
  finish(ctx, { mode: 'halves', axis: 'x', power: 2.0, up: 1.0 });
  // the pack springs back with its prize, then slinks off into the dark
  await Promise.all([
    D.orbit({ at: ctx.V, yaw: 5, pitch: 28, dist: 1.6, lift: 0.2 }, 45, 1.6),
    anim.tween(0.4, (k) => {
      const e = Ease.outCubic(k);
      for (const w of pack) w.model.position.copy(w.bite).addScaledVector(w.away, 0.15 + e * 0.3);
      atk.model.position.set(lead.x + leadAway.x * (0.15 + e * 0.15), 0.03, lead.z + leadAway.z * (0.15 + e * 0.15));
      for (const w of [{ parts: p }, ...pack]) w.parts.head.rotation.set(0.45 * (1 - e), 0, 0);
    }),
    (async () => {
      await anim.wait(0.5);
      for (const w of pack) w.model.lookAt(w.model.position.clone().add(w.away));
      await anim.tween(0.8, (k, raw) => {
        for (const w of pack) {
          w.model.position.addScaledVector(w.away, 0.05);
          gait(w.parts, raw * 24, 0.6);
          w.model.scale.setScalar(1 - Ease.inQuad(Math.max(0, (k - 0.6) / 0.4)));
        }
      });
    })(),
  ]);
  for (const w of pack) w.model.removeFromParent();
  const from = atk.model.position.clone();
  const yaw0 = atk.model.rotation.y;
  await anim.tween(0.45, (k) => {
    const e = Ease.inOutCubic(k);
    atk.model.position.set(lerp(from.x, 0, e), lerp(0.03, 0.07, e), lerp(from.z, dist, e));
    atk.model.rotation.y = lerp(yaw0, 0, e);
    p.head.rotation.set(0, 0, 0);
    p.jaw.rotation.x = 0.35 * (1 - e);
  });
}

// ------------------------------------------------------------------ BEAR: Maul & Crush
async function bear(ctx) {
  const { anim, atk, vic, sfx, dist, D } = ctx;
  const p = atk.parts;
  // the prey goes down on its side with its back to the camera (+1 = its own +x side)
  const toCam = D.r.dot(new THREE.Vector3(-ctx.dir.z, 0, ctx.dir.x)) > 0 ? 1 : -1;
  const hind = new THREE.Vector3(0, 0.02, -0.22);
  const base = new THREE.Vector3(0, 0.07, 0);
  const stand = Math.max(0.1, dist - 0.6);
  const pair = [() => headPoint(atk).add(new THREE.Vector3(0, 0.15, 0)), () => midPoint(vic)];
  // rears up to its full height, roaring, from a low hero angle
  D.cut({ fit: [ctx.A.clone().setY(BOARD_Y + 1.0), ctx.V.clone()], yaw: 12, pitch: 2, dist: 1.6, lift: 0, fov: 36 });
  sfx.play('roar', { pitch: 0.6 });
  await anim.tween(0.85, (k) => {
    const e = Ease.outCubic(k);
    rotateAbout(atk, -1.05 * e, hind, 1, base);
    p.legFL.rotation.x = p.legFR.rotation.x = -0.7 * e;
    p.head.rotation.x = 0.75 * e;
    p.jaw.rotation.x = 0.7 * Math.sin(k * Math.PI * 0.9);
  });
  // lurches in on its hind legs and swats the prey off its feet
  killcam(ctx, { fit: pair, yaw: 18, pitch: 8, dist: 1.3, lift: 0, fov: 34 }, 0.3, 0.6);
  await anim.tween(0.16, (k) => {
    const e = Ease.outQuad(k);
    p.legFL.rotation.x = lerp(-0.7, -1.3, e);
    p.legFL.rotation.z = 0.35 * e;
  });
  sfx.play('slash');
  await anim.tween(0.2, (k) => {
    const e = Ease.inQuad(k);
    rotateAbout(atk, lerp(-1.05, -0.8, e), hind, 1, base.clone().setZ(stand * e));
    p.legFL.rotation.x = lerp(-1.3, -0.3, e);
    p.legFL.rotation.z = lerp(0.35, -0.8, e);
  });
  hit(ctx, headPoint(vic), { dir: new THREE.Vector3(0, 0.6, 0).addScaledVector(D.r, 0.8), count: 55, wound: 0.06, gash: 1, sound: 'crunch', impact: 1 });
  await anim.tween(0.26, (k) => {
    knockDown(vic, Ease.outQuad(k), toCam);
    p.legFL.rotation.z = -0.8 * (1 - k);
  });
  // drops its full weight on it
  D.cut({ fit: pair, yaw: 35, pitch: 22, dist: 1.4, lift: 0, fov: 34 });
  await anim.tween(0.18, (k) => {
    rotateAbout(atk, lerp(-0.8, 0.35, k), hind, 1, base.clone().setZ(stand));
    p.legFL.rotation.set(lerp(-0.3, -1.2, k), 0, 0);
    p.legFR.rotation.x = lerp(-0.7, -1.2, k);
    p.head.rotation.x = lerp(0.75, 0.3, k);
  }, Ease.inQuad);
  sfx.play('boom');
  sfx.play('crunch');
  ctx.world.shake(0.4);
  D.impact(1.1);
  ctx.fx.ring(ctx.V, { color: 0x3a0004, to: 1.4, duration: 0.5, opacity: 0.5 });
  ctx.gore.burst(bodyPoint(vic, 0.1), 0.6);
  ctx.gore.pool(ctx.V.clone(), 0.8, 2);
  await anim.tween(0.12, (k) => vic.model.scale.set(1 - 0.4 * k, 1 + 0.1 * k, 1 + 0.15 * k));
  await struggle(ctx, vic, 0.75, 0.8, true);
  // jaws clamp on and the head wrenches up
  killcam(ctx, { fit: pair, yaw: 42, pitch: 12, dist: 1.3, lift: 0, fov: 34 }, 0.15, 1.2);
  await anim.tween(0.14, (k) => {
    const e = Ease.inQuad(k);
    p.head.rotation.x = lerp(0.3, 0.9, e);
    p.head.rotation.y = -toCam * 0.4 * e;
    p.jaw.rotation.x = 0.5 * (1 - e);
  });
  hit(ctx, headPoint(vic), { count: 40, wound: 0.05, sound: 'bite', impact: 0.6 });
  await anim.tween(0.2, (k) => {
    const e = Ease.outCubic(k);
    p.head.rotation.x = lerp(0.9, -0.3, e);
    p.head.rotation.y = -toCam * 0.4 * (1 - e);
    rotateAbout(atk, lerp(0.35, -0.3, e), hind, 1, base.clone().setZ(stand));
  });
  finish(ctx, { mode: 'limbs', power: 2.0, up: 2.0 });
  sfx.play('roar', { pitch: 0.55 });
  await D.orbit({ at: ctx.V, yaw: 42, pitch: 12, dist: 1.5, lift: 0.3 }, 12, 1.6);
  await anim.tween(0.5, (k) => {
    const e = Ease.inOutCubic(k);
    const b = new THREE.Vector3(0, 0.07 + arc(k, 0.1), lerp(stand, dist, e));
    rotateAbout(atk, lerp(-0.3, 0, e), hind, 1, b);
    p.legFL.rotation.set(-1.2 * (1 - e), 0, 0);
    p.legFR.rotation.x = -1.2 * (1 - e);
    p.head.rotation.set(-0.3 * (1 - e), 0, 0);
    p.jaw.rotation.x = 0;
  });
  atk.model.position.set(0, 0.07, dist);
  atk.model.rotation.set(0, 0, 0);
}

// ------------------------------------------------------------------ COBRA: Strike & Constrict
async function cobra(ctx) {
  const { anim, atk, vic, sfx, dist, world, D } = ctx;
  const p = atk.parts;
  const neckRest = p.neck.map((seg) => seg.rotation.x);
  // the snake rises a little to the camera's side of the prey, so the strike is seen clear of its head
  const nearX = D.r.dot(new THREE.Vector3(-ctx.dir.z, 0, ctx.dir.x)) > 0 ? -1 : 1; // its own x towards the camera
  const pose = { x: nearX * 0.14, z: Math.max(0.05, dist - 0.72) };
  const pair = [() => headPoint(atk).add(new THREE.Vector3(0, 0.15, 0)), () => headPoint(vic).add(new THREE.Vector3(0, 0.1, 0)), () => bodyPoint(vic, 0)];
  // rears up, hood spread, face to face
  D.cut({ at: ctx.A, yaw: 38, pitch: 6, dist: 1.15, lift: 0.45, fov: 34 });
  sfx.play('hiss');
  await anim.tween(0.8, (k) => {
    const e = Ease.outCubic(k);
    p.hood.scale.set(1 + 0.6 * e, 1 + 0.25 * e, 1);
    p.jaw.rotation.x = 0.5 * e;
    p.tongue.scale.z = Math.sin(k * Math.PI * 6) > 0.3 ? 1 : 0.01;
  });
  p.tongue.scale.z = 0.01;
  // glides in, swaying, then draws its head back to strike
  D.cut({ fit: pair, yaw: 12, pitch: 6, dist: 1.2, lift: 0, fov: 34 });
  await anim.tween(0.45, (k) => {
    const e = Ease.inOutSine(k);
    atk.model.position.set(pose.x * e, 0.07, pose.z * e);
    p.neck.forEach((seg, i) => (seg.rotation.z = Math.sin(k * Math.PI * 2 - i * 0.6) * 0.12));
  });
  await anim.tween(0.25, (k) => {
    const e = Ease.outQuad(k);
    p.neck.forEach((seg, i) => {
      seg.rotation.x = lerp(neckRest[i], neckRest[i] - 0.18, e);
      seg.rotation.z = 0;
    });
    p.jaw.rotation.x = lerp(0.5, 1.0, e);
  });
  // lightning strike to the neck
  killcam(ctx, { fit: pair, yaw: 15, pitch: 8, dist: 1.1, lift: 0, fov: 34 }, 0.15, 0.7);
  await anim.tween(0.09, (k) => {
    p.neck.forEach((seg, i) => (seg.rotation.x = lerp(neckRest[i] - 0.18, 0.32, k)));
    p.head.rotation.x = lerp(-0.1, 0.45, k);
    atk.model.position.z = pose.z + 0.12 * k;
  }, Ease.inQuad);
  hit(ctx, headPoint(vic).lerp(bodyPoint(vic, 0.42), 0.5), { count: 30, wound: 0.035, sound: 'bite', impact: 0.9 });
  sfx.play('hiss');
  // venom: the prey convulses and its flesh blackens
  await Promise.all([
    struggle(ctx, vic, 1.0, 1.2),
    anim.tween(1.0, (k) => {
      vic.tint(0x2a2a12, 0.55 * k, 0);
      p.jaw.rotation.x = lerp(1.0, 0.7, k);
    }),
  ]);
  // then lets go, and its coils close round the prey
  const scales = atk.meshes()[0].material;
  const coils = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.06, 14, 40), scales);
    m.rotation.x = Math.PI / 2;
    m.position.copy(ctx.V).setY(BOARD_Y + 0.17 + i * 0.15);
    m.scale.setScalar(0.01);
    m.castShadow = true;
    world.transient.add(m);
    coils.push(m);
  }
  D.cut({ fit: [...pair, ctx.V.clone().setY(BOARD_Y + 0.6)], yaw: 20, pitch: 22, dist: 1.4, lift: 0, fov: 34 });
  const z0 = atk.model.position.z;
  await anim.tween(0.25, (k) => {
    const e = Ease.outCubic(k);
    p.neck.forEach((seg, i) => (seg.rotation.x = lerp(0.32, neckRest[i], e)));
    p.head.rotation.x = lerp(0.45, -0.1, e);
    atk.model.position.z = lerp(z0, pose.z, e);
  });
  for (const m of coils) {
    sfx.play('creak');
    await anim.tween(0.16, (k) => {
      m.scale.setScalar(Ease.outBack(k));
      m.rotation.z = (1 - k) * 2;
    });
  }
  // three crushing squeezes
  for (let i = 0; i < 3; i++) {
    await anim.tween(0.24, (k) => {
      const e = Ease.inQuad(k);
      const s = 1 - 0.1 * (i + e);
      coils.forEach((m) => m.scale.set(s, s, 1));
      vic.model.scale.set(1 - 0.09 * (i + e), 1 + 0.05 * (i + e), 1 - 0.09 * (i + e));
    });
    sfx.play('crunch');
    ctx.gore.spray(bodyPoint(vic, 0.4), UP, { count: 30, speed: 2, spread: 0.6 });
    D.impact(0.6);
    await anim.wait(0.1);
  }
  killcam(ctx, { fit: pair, yaw: 40, pitch: 14, dist: 1.25, lift: 0, fov: 34 }, 0.15, 1.2);
  finish(ctx, { mode: 'halves', axis: 'z', power: 1.8, up: 1.2 });
  await Promise.all([
    D.orbit({ at: ctx.V, yaw: 40, pitch: 14, dist: 1.35, lift: 0.3 }, 10, 1.6),
    anim.tween(0.12, (k) => coils.forEach((m) => m.scale.setScalar(0.7 * (1 - Ease.inQuad(k))))),
  ]);
  for (const m of coils) {
    m.removeFromParent();
    m.geometry.dispose();
  }
  await anim.tween(0.4, (k) => {
    const e = Ease.inOutCubic(k);
    p.neck.forEach((seg, i) => (seg.rotation.x = neckRest[i]));
    p.head.rotation.x = -0.1;
    p.jaw.rotation.x = 0.7 * (1 - e);
    atk.model.position.set(lerp(pose.x, 0, e), 0.07, lerp(pose.z, dist, e));
    p.hood.scale.set(1.6 - 0.6 * e, 1.25 - 0.25 * e, 1);
  });
}

// ------------------------------------------------------------------ staging helpers for the heavy hitters (shark ... crocodile)
// The gold gem crowning the board's centre: a big, shiny occluder when a fight happens near it.
const HEAVY_GEM = new THREE.Vector3(0, BOARD_Y + 0.45, 0);

// True when the gem would loom in the foreground of a shot (in frame, between the camera and the subject).
function heavyGemBlocks(ctx, spec) {
  const { pos, target } = ctx.D.pose(spec);
  const fwd = target.clone().sub(pos);
  const depth = fwd.length();
  fwd.divideScalar(depth);
  const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd);
  const rel = HEAVY_GEM.clone().sub(pos);
  const z = rel.dot(fwd);
  if (z < 0.05 || z > depth) return false;
  const tanV = Math.tan(THREE.MathUtils.degToRad(Math.max(34, spec.fov ?? ctx.world.camera.fov)) / 2);
  const tanH = tanV * ctx.world.camera.aspect;
  return (Math.abs(rel.dot(right)) - 0.4) / (z * tanH) < 1 && (Math.abs(rel.dot(up)) - 0.55) / (z * tanV) < 0.8;
}

// The shot as asked for, or the nearest variation (higher, swung round, or an orbit turned the other way) that
// keeps the gem out of the foreground. With `to`, the whole orbit from spec.yaw to `to` is checked; the result
// carries the (possibly changed) end yaw as `to`.
function heavyShot(ctx, spec, to = spec.yaw) {
  const yaw = spec.yaw ?? 0;
  const pitch = spec.pitch ?? 18;
  const sweep = to - yaw;
  const s = Math.sign(yaw) || 1;
  const tries = [];
  for (const dp of [0, 8, 16, 24]) {
    for (const dy of [0, -15, 15, -30, 30, -45]) {
      for (const flip of sweep ? [false, true] : [false]) tries.push({ dp, dy: s * dy, flip, cost: dp / 8 + Math.abs(dy) / 15 + (flip ? 1.5 : 0) });
    }
  }
  tries.sort((m, n) => m.cost - n.cost);
  const samples = sweep ? [0, 0.2, 0.4, 0.6, 0.8, 1] : [0];
  let best = null;
  for (const t of tries) {
    const shot = { ...spec, yaw: yaw + t.dy, pitch: pitch + t.dp, to: yaw + t.dy + (t.flip ? -sweep : sweep) };
    const blocked = samples.filter((k) => heavyGemBlocks(ctx, { ...shot, yaw: lerp(shot.yaw, shot.to, k) })).length;
    if (!blocked) return shot;
    if (!best || blocked < best.blocked) best = { shot, blocked };
  }
  return best.shot;
}

// A view's rest bounds, measured in its model's own frame.
function heavyBounds(view) {
  view.root.updateMatrixWorld(true);
  const inv = view.model.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  view.model.traverse((m) => {
    if (!m.isMesh || !m.visible || m.userData.noGore) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
      box.expandByPoint(v.applyMatrix4(m.matrixWorld).applyMatrix4(inv));
    }
  });
  return box;
}

// Pose a model so that its own point `c` (model space) sits at `to` (its root's frame), turned by the Euler angles.
function heavyHold(view, c, to, rx = 0, ry = 0, rz = 0) {
  view.model.rotation.set(rx, ry, rz);
  view.model.position.copy(to).sub(c.clone().multiply(view.model.scale).applyEuler(view.model.rotation));
}

// ------------------------------------------------------------------ SHARK: Deep Strike
async function shark(ctx) {
  const { anim, atk, vic, sfx, dist, world, fx, D } = ctx;
  const p = atk.parts;
  const shot = (spec, to) => heavyShot(ctx, spec, to);
  const vb = heavyBounds(vic);
  const vc = vb.getCenter(new THREE.Vector3());
  const vicParent = vic.root.parent;
  const vicRoot = { p: vic.root.position.clone(), q: vic.root.quaternion.clone(), s: vic.root.scale.clone() };
  // a flick of the tail, then it slips under its own water
  D.cut(shot({ at: ctx.A, yaw: -58, pitch: 12, dist: 1.3, lift: 0.22, fov: 34 }));
  await anim.tween(0.2, (k) => {
    p.body.rotation.x = -0.22 * Ease.outQuad(k);
    p.tail.rotation.y = 0.55 * Math.sin(k * Math.PI);
  });
  sfx.play('splash');
  fx.splash(ctx.A.clone().setY(BOARD_Y + 0.15), 0.6);
  await anim.tween(0.32, (k) => {
    p.body.rotation.x = lerp(-0.22, 1.05, k);
    p.body.position.y = 0.19 - 0.8 * k;
    p.tail.rotation.y = -0.3 * Math.sin(k * Math.PI);
  }, Ease.inQuad);
  p.body.visible = false;
  // dark water opens under the prey and a fin circles it
  const poolMat = new THREE.MeshStandardMaterial({ color: 0x0b2c44, transparent: true, opacity: 0.94, roughness: 0.05, metalness: 0.25 });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(0.62, 48), poolMat);
  pool.rotation.x = -Math.PI / 2;
  // centred a touch beyond the prey, so the shark's slanting body breaks the surface inside it
  const poolAt = ctx.V.clone().addScaledVector(ctx.dir, 0.12).setY(BOARD_Y);
  pool.position.copy(poolAt).setY(BOARD_Y + 0.012);
  pool.scale.setScalar(0.01);
  world.transient.add(pool);
  const swirl = anim.every((dt) => (pool.rotation.z += dt * 3));
  const ripples = anim.every(() => {
    if (Math.random() < 0.05) fx.ring(poolAt, { color: 0x9cc6da, from: 0.15, to: 0.62, duration: 0.7, y: BOARD_Y + 0.02, opacity: 0.5 });
  });
  D.cut(shot({ at: ctx.V, yaw: 52, pitch: 15, dist: 1.6, lift: 0.22, fov: 34 }));
  sfx.play('dunDun');
  await anim.tween(0.4, (k) => pool.scale.setScalar(Ease.outCubic(k)));
  const finMat = atk.meshes().find((m) => m.material.side === THREE.DoubleSide)?.material ?? new THREE.MeshStandardMaterial({ color: 0x485866 });
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.42, 4), finMat);
  fin.scale.set(0.3, 1, 1);
  fin.castShadow = true;
  world.transient.add(fin);
  const look0 = vic.model.rotation.y;
  const head = vic.parts.head;
  const head0 = head?.rotation.y ?? 0;
  const face = vic.root.rotation.y;
  sfx.play('heartbeat');
  // slow push-in while the prey's eyes follow the fin
  D.move(shot({ at: ctx.V, yaw: 36, pitch: 10, dist: 1.35, lift: 0.25 }), 1.3, Ease.inOutSine);
  await anim.tween(1.3, (k) => {
    const a = k * Math.PI * 3.4 + 0.6;
    const r = 0.52 - k * 0.1;
    fin.position.set(poolAt.x + Math.cos(a) * r, BOARD_Y + 0.16, poolAt.z + Math.sin(a) * r);
    fin.rotation.y = -a;
    if (Math.random() < 0.4) fx.burst(fin.position.clone().setY(BOARD_Y + 0.03), { count: 3, colors: [0xdfeef5, 0x9cc6da], shape: 'sphere', speed: 0.4, up: 0.4, gravity: 3, size: [0.006, 0.012], life: [0.3, 0.5] });
    const look = Math.sin(Math.atan2(fin.position.x - ctx.V.x, fin.position.z - ctx.V.z) - face);
    vic.model.rotation.y = look0 + 0.3 * look;
    if (head) head.rotation.y = head0 + 0.45 * look;
    if (k > 0.7 && Math.random() < 0.08) sfx.play('heartbeat');
  });
  fin.removeFromParent();
  fin.geometry.dispose();
  // ERUPTION: it bursts up behind the prey and clamps its hindquarters, in slow motion. Shark and prey both
  // stay in profile: the shark rears up facing back the way it came, the prey hanging out of its jaws.
  p.body.visible = true;
  p.body.position.y = 0.19;
  p.body.rotation.set(0, 0, 0);
  p.body.scale.setScalar(1.6);
  p.water.visible = false;
  p.foam.visible = false;
  p.tail.rotation.y = 0;
  const mouth = new THREE.Object3D();
  p.body.add(mouth);
  mouth.position.set(0, -0.07, 0.15);
  const lean = 0.22;
  const breach = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), lean - Math.PI / 2));
  const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(breach);
  const nod = new THREE.Quaternion();
  const pose = (a = 0) => atk.model.quaternion.copy(breach).multiply(nod.setFromAxisAngle(new THREE.Vector3(1, 0, 0), a));
  pose();
  atk.model.position.set(0, 0, 0);
  atk.root.updateMatrixWorld(true);
  vic.root.updateMatrixWorld(true);
  const grip = vic.model.localToWorld(new THREE.Vector3(vc.x, lerp(vb.min.y, vb.max.y, 0.5), lerp(vb.min.z, vb.max.z, 0.35)));
  const base = atk.root.worldToLocal(grip.clone()).sub(atk.root.worldToLocal(wpos(mouth)));
  const rise = (y) => atk.model.position.copy(base).addScaledVector(nose, y);
  rise(-1.2);
  killcam(ctx, shot({ at: ctx.V, yaw: 12, pitch: 5, dist: 1.75, lift: 0.45, fov: 34 }), 0.25, 0.9);
  sfx.play('splash');
  sfx.play('roar', { pitch: 0.5 });
  fx.splash(grip.clone().setY(BOARD_Y + 0.2), 1.3);
  await anim.tween(0.14, (k) => {
    rise(lerp(-1.2, 0, k));
    p.jaw.rotation.x = 1.0 * Math.min(1, k * 1.6);
  }, Ease.outQuad);
  // CHOMP: the jaws slam shut and it is hauled up out of the water, front end dangling
  await anim.tween(0.05, (k) => (p.jaw.rotation.x = lerp(1.0, 0.4, k)));
  hit(ctx, grip, { count: 40, wound: 0.06, sound: 'crunch', impact: 1.1, mist: 0.8 });
  mouth.attach(vic.root);
  const gripV = vic.model.worldToLocal(grip.clone());
  const gripRoot = gripV.clone().add(vic.model.position);
  const ry0 = vic.model.rotation.y;
  await Promise.all([
    struggle(ctx, vic, 0.26, 1.1),
    anim.tween(0.26, (k) => {
      rise(0.24 * k);
      heavyHold(vic, gripV, gripRoot, 0.3 * k, lerp(ry0, 0, k), 0);
    }, Ease.outCubic),
  ]);
  // shakes it like a rag, the water turning red
  const red = new THREE.Color(0x4a0408);
  let from = 0;
  for (const to of [0.3, -0.26, 0.16, 0]) {
    const a = from;
    sfx.play(to ? 'squelch' : 'splash');
    await Promise.all([
      struggle(ctx, vic, 0.17, 0.9),
      anim.tween(0.17, (k) => {
        pose(lerp(a, to, k));
        if (ctx.gore.on) poolMat.color.lerp(red, 0.05);
      }, Ease.inOutSine),
    ]);
    if (to) ctx.gore.spray(wpos(mouth), ctx.dir.clone().multiplyScalar(Math.sign(to)).setY(0.6), { count: 16, speed: 2.2 });
    from = to;
  }
  // bites clean through
  killcam(ctx, shot({ at: ctx.V, yaw: 46, pitch: 9, dist: 1.65, lift: 0.45, fov: 34 }), 0.15, 1.1);
  await anim.tween(0.1, (k) => (p.jaw.rotation.x = lerp(0.4, 0.9, k)), Ease.outQuad);
  await anim.tween(0.05, (k) => (p.jaw.rotation.x = lerp(0.9, 0, k)), Ease.inQuad);
  vicParent.attach(vic.root);
  finish(ctx, { mode: 'halves', axis: 'z', power: 1.6, up: 0.5 });
  // and drops back into the deep
  const top = atk.model.position.clone();
  let splashed = false;
  const orbit = shot({ at: ctx.V, yaw: 46, pitch: 12, dist: 1.75, lift: 0.3 }, 76);
  await Promise.all([
    D.orbit(orbit, orbit.to, 1.4),
    anim.tween(0.45, (k) => {
      atk.model.position.copy(top).addScaledVector(nose, -1.3 * k);
      if (k > 0.3 && !splashed) {
        splashed = true;
        sfx.play('splash');
        fx.splash(ctx.V.clone().setY(BOARD_Y + 0.15), 1);
      }
    }, Ease.inQuad),
  ]);
  // resurfaces on the square
  mouth.removeFromParent();
  atk.model.rotation.set(0, 0, 0);
  p.body.scale.setScalar(1);
  p.water.visible = true;
  p.foam.visible = true;
  atk.model.position.set(0, -0.5, dist);
  sfx.play('splash');
  await anim.tween(0.5, (k) => {
    atk.model.position.y = lerp(-0.5, 0.07, Ease.outCubic(k));
    pool.scale.setScalar(1 - k);
  });
  swirl();
  ripples();
  pool.removeFromParent();
  pool.geometry.dispose();
  poolMat.dispose();
  vic.root.position.copy(vicRoot.p);
  vic.root.quaternion.copy(vicRoot.q);
  vic.root.scale.copy(vicRoot.s);
}

// ------------------------------------------------------------------ GORILLA: Pulverize
async function gorilla(ctx) {
  const { anim, atk, vic, sfx, dist, D } = ctx;
  const p = atk.parts;
  const shot = (spec, to) => heavyShot(ctx, spec, to);
  const vb = heavyBounds(vic);
  const vc = vb.getCenter(new THREE.Vector3());
  const vh = vb.max.y - vb.min.y;
  const rest = vc.clone().add(vic.model.position);
  atk.root.updateMatrixWorld(true);
  vic.root.updateMatrixWorld(true);
  // a point given in the gorilla's frame, expressed in the prey's
  const inVic = (x, y, z) => vic.root.worldToLocal(atk.root.localToWorld(new THREE.Vector3(x, y, z)));
  const vicHead = vic.parts.head;
  const vh0 = vicHead?.rotation.x ?? 0;
  // chest-beating two-shot: the challenger on the left, the prey cowering on the right
  D.cut(shot({ at: ctx.A.clone().lerp(ctx.V, 0.42), yaw: 14, pitch: 7, dist: 1.6, lift: 0.36, fov: 34 }));
  for (let i = 0; i < 4; i++) {
    const arm = i % 2 ? p.armR : p.armL;
    sfx.play('drum');
    sfx.play('drum', { delay: 0.04 });
    await anim.tween(0.22, (k) => {
      const s = Math.sin(k * Math.PI);
      arm.rotation.x = -1.4 * s;
      arm.rotation.z = (i % 2 ? 1 : -1) * 0.95 * s;
      p.head.rotation.x = -0.25 * s;
      p.jaw.rotation.x = 0.4 * s;
      if (vicHead) vicHead.rotation.x = vh0 + 0.25 * Math.min(1, (i + k) / 2);
    });
  }
  sfx.play('roar', { pitch: 0.7 });
  await anim.tween(0.45, (k) => {
    const s = Math.sin(k * Math.PI);
    p.jaw.rotation.x = 0.75 * s;
    p.head.rotation.x = -0.35 * s;
    atk.model.rotation.x = -0.12 * s;
  });
  // charges in, and the prey is hoisted overhead, belly up
  const reach = dist - 0.72;
  D.move(shot({ at: ctx.A.clone().lerp(ctx.V, 0.66), yaw: 12, pitch: 6, dist: 1.9, lift: 0.7 }), 0.6);
  await anim.tween(0.3, (k) => {
    setZ(atk, lerp(0, reach, Ease.inQuad(k)), arc(k, 0.1));
    p.armL.rotation.x = p.armR.rotation.x = -1.3 * k;
    atk.model.rotation.x = 0.15 * k;
  });
  sfx.play('thud');
  D.impact(0.4);
  const overhead = inVic(0, 0.8 + vh * 0.33, reach + 0.3);
  await Promise.all([
    struggle(ctx, vic, 0.42, 1),
    anim.tween(0.42, (k) => {
      const to = new THREE.Vector3(lerp(rest.x, overhead.x, k), lerp(rest.y, overhead.y, Ease.outQuad(k)), lerp(rest.z, overhead.z, Ease.inQuad(k)));
      heavyHold(vic, vc, to, 0, 0, Math.PI * Ease.inOutQuad(k));
      p.armL.rotation.x = p.armR.rotation.x = lerp(-1.3, -2.9, k);
      atk.model.rotation.x = lerp(0.15, -0.1, k);
    }),
  ]);
  // SLAM: driven down onto its back in front of the gorilla
  const ground = inVic(0, vh * 0.44, dist - 0.05);
  const groundW = vic.root.localToWorld(ground.clone()).setY(BOARD_Y);
  D.cut(shot({ at: ctx.A.clone().lerp(ctx.V, 0.66), yaw: 30, pitch: 12, dist: 1.55, lift: 0.4, fov: 34 }));
  await anim.tween(0.16, (k) => {
    heavyHold(vic, vc, overhead.clone().lerp(ground, k), 0, 0, Math.PI);
    p.armL.rotation.x = p.armR.rotation.x = lerp(-2.9, -1.0, k);
    atk.model.rotation.x = lerp(-0.1, 0.3, k);
  }, Ease.inQuad);
  D.slowmo(0.3, 0.35);
  sfx.play('thud', { power: 1 });
  sfx.play('crunch');
  hit(ctx, groundW.clone().setY(BOARD_Y + 0.15), { count: 45, wound: 0.06, sound: 'squelch', impact: 1.1, mist: 0.6 });
  ctx.gore.decal(groundW, 0.5, 'splat');
  ctx.world.shake(0.3);
  await anim.tween(0.22, (k) => {
    const s = 1 - 0.18 * Math.sin(Math.min(1, k * 2) * Math.PI * 0.5) + 0.08 * Math.max(0, k * 2 - 1);
    vic.model.scale.set(1 + (1 - s) * 0.6, s, 1 + (1 - s) * 0.6);
    heavyHold(vic, vc, ground, 0, 0, Math.PI);
  });
  // two hammer blows with both fists
  D.cut(shot({ at: groundW.clone().lerp(ctx.A, 0.25), yaw: 42, pitch: 14, dist: 1.65, lift: 0.44, fov: 34 }));
  for (let i = 0; i < 2; i++) {
    await anim.tween(0.17, (k) => {
      p.armL.rotation.x = p.armR.rotation.x = lerp(-1.0, -2.7, k);
      atk.model.rotation.x = lerp(0.3, -0.05, k);
    }, Ease.outQuad);
    await anim.tween(0.08, (k) => {
      p.armL.rotation.x = p.armR.rotation.x = lerp(-2.7, -0.95, k);
      atk.model.rotation.x = lerp(-0.05, 0.3, k);
    }, Ease.inQuad);
    sfx.play('thud', { power: 0.9 });
    sfx.play('crunch');
    hit(ctx, groundW.clone().setY(BOARD_Y + 0.2), { count: 30, wound: 0.05, sound: null, impact: 0.9, mist: 0.4 });
    ctx.world.shake(0.25);
    const s = 0.86 - 0.05 * i;
    vic.model.scale.set(1 + (1 - s) * 0.6, s, 1 + (1 - s) * 0.6);
    heavyHold(vic, vc, ground, 0, 0, Math.PI);
    await anim.wait(0.06);
  }
  // tears it in two with both hands
  // seen from high on the side, so neither body hides the other
  killcam(ctx, shot({ at: groundW.clone().lerp(ctx.A, 0.2), yaw: 8, pitch: 30, dist: 1.5, lift: 0.3, fov: 34 }), 0.15, 1.0);
  await anim.tween(0.25, (k) => {
    p.armL.rotation.z = -0.9 * k;
    p.armR.rotation.z = 0.9 * k;
    p.armL.rotation.x = p.armR.rotation.x = lerp(-0.95, -1.5, k);
    atk.model.rotation.x = lerp(0.3, 0.1, k);
    heavyHold(vic, vc, ground.clone().add(new THREE.Vector3(0, 0.18 * k, 0)), 0, 0, Math.PI);
  }, Ease.outQuad);
  finish(ctx, { mode: 'halves', axis: 'x', power: 1.1, up: 0.8 });
  sfx.play('roar', { pitch: 0.65 });
  // holds the pose a beat, then straightens up and steps onto the square as the camera swings round
  const orbit = shot({ at: groundW, yaw: 8, pitch: 24, dist: 1.6, lift: 0.3 }, 52);
  await Promise.all([
    D.orbit(orbit, orbit.to, 1.5),
    anim.wait(0.7).then(() =>
      anim.tween(0.6, (k) => {
        atk.model.rotation.x = lerp(0.1, 0, k);
        p.armL.rotation.set(lerp(-1.5, 0, k), 0, lerp(-0.9, 0, k));
        p.armR.rotation.set(lerp(-1.5, 0, k), 0, lerp(0.9, 0, k));
        setZ(atk, lerp(reach, dist, k), arc(k, 0.05));
      }, Ease.inOutQuad),
    ),
  ]);
}

// ------------------------------------------------------------------ RHINO: Gore & Trample
async function rhino(ctx) {
  const { anim, atk, vic, sfx, dist, fx, D } = ctx;
  const p = atk.parts;
  const shot = (spec, to) => heavyShot(ctx, spec, to);
  const vb = heavyBounds(vic);
  const vc = vb.getCenter(new THREE.Vector3());
  const rest = vc.clone().add(vic.model.position);
  atk.root.updateMatrixWorld(true);
  vic.root.updateMatrixWorld(true);
  const inVic = (x, y, z) => vic.root.worldToLocal(atk.root.localToWorld(new THREE.Vector3(x, y, z)));
  // backs off for a run-up, then paws the ground, snorting
  const back = -0.75;
  const runup = ctx.A.clone().addScaledVector(ctx.dir, back);
  D.cut(shot({ at: runup, yaw: 38, pitch: 7, dist: 1.25, lift: 0.25, fov: 34 }));
  await anim.tween(0.4, (k) => {
    setZ(atk, back * k, 0);
    gait(p, k * 9, 0.22 * Math.sin(k * Math.PI));
  }, Ease.outQuad);
  for (let i = 0; i < 2; i++) {
    sfx.play('snort');
    fx.puff(atk.model.localToWorld(new THREE.Vector3(0, 0.26, 0.6)), { count: 4, color: 0xe8ecef, size: 0.18, spread: 0.05, rise: 0.12, opacity: 0.4 });
    await anim.tween(0.3, (k) => {
      p.legFL.rotation.x = -0.7 * Math.sin(k * Math.PI);
      p.head.rotation.x = 0.35 * Math.sin(k * Math.PI) + 0.1 * i * k;
    });
    fx.dust(atk.model.localToWorld(new THREE.Vector3(0.1, 0.03, 0.2)), 6);
  }
  // CHARGE, seen whole from the side
  sfx.play('roar', { pitch: 0.5 });
  const end = dist - 0.92;
  D.cut(shot({ at: runup.clone().lerp(ctx.V, 0.55), yaw: 6, pitch: 7, dist: 1.75, lift: 0.3, fov: 34 }));
  let lastDust = 0;
  await anim.tween(0.5, (k, raw) => {
    setZ(atk, lerp(back, end, k), Math.abs(Math.sin(raw * Math.PI * 3.5)) * 0.03);
    p.head.rotation.x = lerp(0.1, 0.45, Math.min(1, raw * 3));
    gait(p, raw * 22, 0.6);
    if (raw - lastDust > 0.12) {
      lastDust = raw;
      fx.dust(atk.model.localToWorld(new THREE.Vector3(0, 0.03, -0.2)), 5);
    }
  }, Ease.inQuad);
  gait(p, 0, 0);
  // the horn goes in
  killcam(ctx, shot({ at: ctx.V.clone().addScaledVector(ctx.dir, -0.35), yaw: 50, pitch: 9, dist: 1.3, lift: 0.3, fov: 34 }), 0.2, 0.8);
  sfx.play('thud');
  const chest = vic.model.localToWorld(new THREE.Vector3(vc.x, lerp(vb.min.y, vb.max.y, 0.45), lerp(vc.z, vb.max.z, 0.45)));
  hit(ctx, chest, { count: 45, wound: 0.07, sound: 'crunch', impact: 1.2, mist: 0.8 });
  await Promise.all([struggle(ctx, vic, 0.14, 1), anim.tween(0.14, (k) => (p.head.rotation.x = lerp(0.45, 0.6, k)))]);
  // hooked up and tossed: it tumbles end over end and lands across the line, on its side
  const land = inVic(0, 0, dist + 0.62);
  land.y = (vb.max.x - vb.min.x) / 2 + 0.02;
  const landW = vic.root.localToWorld(land.clone()).setY(BOARD_Y);
  D.cut(shot({ at: ctx.V.clone().addScaledVector(ctx.dir, 0.1), yaw: 22, pitch: 6, dist: 1.9, lift: 0.62, fov: 34 }));
  sfx.play('whoosh', { dur: 0.7 });
  await Promise.all([
    struggle(ctx, vic, 0.75, 0.8, true),
    anim.tween(0.75, (k) => {
      const to = rest.clone().lerp(land, k);
      to.y += arc(k, 0.62);
      heavyHold(vic, vc, to, -Math.PI * 2 * Ease.inOutSine(k), (Math.PI / 2) * k, (Math.PI / 2) * Ease.inOutQuad(k));
      p.head.rotation.x = lerp(0.6, -0.7, Ease.outQuad(Math.min(1, k * 3)));
      if (Math.random() < 0.4) ctx.gore.spray(vic.model.localToWorld(vc.clone()), null, { count: 3, speed: 0.8, up: 0 });
    }),
  ]);
  heavyHold(vic, vc, land, 0, Math.PI / 2, Math.PI / 2);
  sfx.play('thud');
  sfx.play('crunch');
  ctx.gore.burst(landW.clone().setY(BOARD_Y + 0.1), 0.45);
  ctx.world.shake(0.25);
  // trots up and rears over it
  const stomp = dist + 0.62 - 0.42;
  const hind = new THREE.Vector3(0, 0, -0.17);
  const rear = (rx, legs) => {
    rotateAbout(atk, rx, hind, 1, new THREE.Vector3(0, 0.07, stomp));
    p.legFL.rotation.x = p.legFR.rotation.x = legs;
  };
  D.cut(shot({ at: landW, yaw: 42, pitch: 16, dist: 1.4, lift: 0.22, fov: 34 }));
  await anim.tween(0.4, (k, raw) => {
    setZ(atk, lerp(end, stomp, k), 0);
    p.head.rotation.x = lerp(-0.7, 0.15, k);
    gait(p, raw * 10, 0.4 * Math.sin(raw * Math.PI));
  }, Ease.inOutQuad);
  gait(p, 0, 0);
  for (let i = 0; i < 2; i++) {
    // the killing stomp, seen head-on
    if (i === 1) killcam(ctx, shot({ at: landW, yaw: 78, pitch: 10, dist: 1.45, lift: 0.28, fov: 34 }), 0.15, 1.1);
    await anim.tween(0.24, (k) => rear(-0.42 * k, -0.6 * k), Ease.outQuad);
    await anim.tween(0.09, (k) => rear(lerp(-0.42, -0.1, k), lerp(-0.6, -0.35, k)), Ease.inQuad);
    sfx.play('thud');
    sfx.play('crunch');
    ctx.world.shake(0.3);
    if (i === 0) {
      hit(ctx, vic.model.localToWorld(vc.clone()), { count: 35, wound: 0.06, sound: null, impact: 1 });
      vic.model.scale.set(0.8, 1, 1);
      heavyHold(vic, vc, land, 0, Math.PI / 2, Math.PI / 2);
      await anim.wait(0.08);
    } else {
      finish(ctx, { mode: 'limbs', power: 1.5, up: 1.0 });
    }
  }
  // steps back off the carcass as the camera swings round
  const orbit = shot({ at: landW, yaw: 78, pitch: 16, dist: 1.55, lift: 0.22 }, 118);
  await Promise.all([
    D.orbit(orbit, orbit.to, 1.5),
    anim.wait(0.5).then(() =>
      anim.tween(0.55, (k) => {
        rotateAbout(atk, lerp(-0.1, 0, k), hind, 1, new THREE.Vector3(0, 0.07, lerp(stomp, dist, k)));
        p.legFL.rotation.x = p.legFR.rotation.x = lerp(-0.35, 0, k);
        p.head.rotation.x = 0.15 * (1 - k);
      }, Ease.inOutQuad),
    ),
  ]);
}

// ------------------------------------------------------------------ SCORPION: Death Sting
async function scorpion(ctx) {
  const { anim, atk, vic, sfx, dist, D } = ctx;
  const p = atk.parts;
  const shot = (spec, to) => heavyShot(ctx, spec, to);
  // tail pose: the base segment swings the whole tail, the rest open or close its curl
  const tail0 = p.tail.map((s) => s.rotation.x);
  let tailNow = [0, 0];
  const curl = (base, rest) => {
    tailNow = [base, rest];
    p.tail.forEach((seg, j) => (seg.rotation.x = tail0[j] + (j === 0 ? base : rest)));
  };
  const curlTo = (base, rest, dur, ease) => {
    const [b0, r0] = tailNow;
    return anim.tween(dur, (k) => curl(lerp(b0, base, k), lerp(r0, rest, k)), ease);
  };
  // close enough for the pincers to take the forelegs and the stinger to reach the face
  const near = dist - 0.6;
  const close = ctx.A.clone().lerp(ctx.V, 0.6);
  // skitters in, pincers raised, tail cocked
  D.cut(shot({ at: ctx.A.clone().lerp(ctx.V, 0.5), yaw: 24, pitch: 14, dist: 1.5, lift: 0.32, fov: 34 }));
  D.move(shot({ at: close, yaw: 28, pitch: 14, dist: 1.4, lift: 0.33 }), 0.8, Ease.inOutSine);
  sfx.play('hiss');
  await anim.tween(0.75, (k) => {
    setZ(atk, lerp(0, near, Ease.inOutQuad(k)), 0);
    const step = Math.sin(k * Math.PI);
    p.legs.forEach((leg, i) => (leg.rotation.x = Math.sin(k * 40 + i * 1.3) * 0.32 * step));
    p.clawL.rotation.x = p.clawR.rotation.x = -0.5 * k;
    p.fingerL.rotation.y = 0.15 + Math.abs(Math.sin(k * 16)) * 0.6;
    p.fingerR.rotation.y = -0.15 - Math.abs(Math.sin(k * 16)) * 0.6;
    curl(-0.1 * k, 0);
  });
  p.legs.forEach((leg) => (leg.rotation.x = 0));
  // pincers snap shut on the forelegs; the prey snaps down at its attacker
  for (let i = 0; i < 3; i++) sfx.play('pinch', { delay: i * 0.08 });
  await anim.tween(0.18, (k) => {
    p.fingerL.rotation.y = lerp(0.15, 0.75, k);
    p.fingerR.rotation.y = lerp(-0.15, -0.75, k);
  });
  await anim.tween(0.08, (k) => {
    p.clawL.rotation.x = p.clawR.rotation.x = lerp(-0.5, 0.1, k);
    p.clawL.rotation.y = -0.25 * k;
    p.clawR.rotation.y = 0.25 * k;
    p.fingerL.rotation.y = lerp(0.75, -0.05, k);
    p.fingerR.rotation.y = lerp(-0.75, 0.05, k);
  }, Ease.inQuad);
  hit(ctx, wpos(p.fingerL), { count: 22, wound: 0.04, sound: 'crunch', impact: 0.7, mist: 0.3 });
  hit(ctx, wpos(p.fingerR), { count: 12, wound: 0.035, sound: null, impact: 0.3, mist: 0 });
  const vicHead = vic.parts.head;
  const vh0 = vicHead?.rotation.x ?? 0;
  await anim.tween(0.2, (k) => {
    if (vicHead) vicHead.rotation.x = vh0 + 0.3 * k;
    if (vic.parts.jaw) vic.parts.jaw.rotation.x = 0.5 * Math.sin(k * Math.PI * 0.5);
  }, Ease.outQuad);
  // the stinger: drawn back, then driven into its face; twice
  const face = () => wpos(p.stinger);
  const faceAt = vic.parts.head ? wpos(vic.parts.head).setY(BOARD_Y) : ctx.V.clone();
  for (let i = 0; i < 2; i++) {
    // first from over the tail as it arcs in, then back on the pair
    if (i === 0) killcam(ctx, shot({ at: faceAt, yaw: -40, pitch: 16, dist: 1.1, lift: 0.36, fov: 34 }), 0.25, 0.6);
    else D.cut(shot({ at: close, yaw: 30, pitch: 14, dist: 1.4, lift: 0.33, fov: 34 }));
    await curlTo(-0.3, 0.05, 0.22, Ease.outQuad);
    await curlTo(0.8, -0.25, 0.07, Ease.inQuad);
    sfx.play('sting');
    hit(ctx, face(), { count: 26, wound: 0.035, sound: 'squelch', impact: 0.8, mist: 0.35 });
    vic.tint(0x1a0a20, 0.25 * (i + 1), 0);
    await Promise.all([struggle(ctx, vic, 0.22, 1.1), anim.wait(0.22)]);
    await curlTo(-0.1, 0, 0.16, Ease.inOutQuad);
  }
  // convulsions as the venom takes hold, foaming at the mouth
  await Promise.all([
    struggle(ctx, vic, 0.7, 1.2, true),
    anim.tween(0.7, () => {
      if (Math.random() < 0.3) ctx.fx.burst(headPoint(vic), { count: 2, colors: [0xe8f0d0, 0xc8d8a0], shape: 'sphere', speed: 0.3, up: 0.2, gravity: 1, size: [0.01, 0.02], life: [0.4, 0.8] });
    }),
  ]);
  // ripped apart in the pincers
  const kill = ctx.V.clone().addScaledVector(ctx.dir, -0.25);
  // high over the scorpion's shoulder, the pincers in front
  killcam(ctx, shot({ at: kill, yaw: -24, pitch: 30, dist: 1.4, lift: 0.25, fov: 34 }), 0.15, 1.0);
  await anim.tween(0.2, (k) => {
    p.clawL.rotation.y = lerp(-0.25, 0.5, k);
    p.clawR.rotation.y = lerp(0.25, -0.5, k);
  }, Ease.inQuad);
  finish(ctx, { mode: 'halves', axis: 'x', power: 1.3, up: 0.8 });
  // scuttles onto the square as the camera swings round
  const orbit = shot({ at: kill, yaw: -24, pitch: 24, dist: 1.55, lift: 0.25 }, 18);
  await Promise.all([
    D.orbit(orbit, orbit.to, 1.5),
    anim.wait(0.6).then(() =>
      anim.tween(0.55, (k) => {
        p.clawL.rotation.set(lerp(0.1, 0, k), lerp(0.5, 0, k), 0);
        p.clawR.rotation.set(lerp(0.1, 0, k), lerp(-0.5, 0, k), 0);
        p.fingerL.rotation.y = lerp(-0.05, 0.15, k);
        p.fingerR.rotation.y = lerp(0.05, -0.15, k);
        p.legs.forEach((leg, i) => (leg.rotation.x = Math.sin(k * 30 + i * 1.3) * 0.25 * Math.sin(k * Math.PI)));
        curl(-0.1 * (1 - k), 0);
        setZ(atk, lerp(near, dist, Ease.inOutQuad(k)), 0);
      }),
    ),
  ]);
}

// ------------------------------------------------------------------ CROCODILE: Death Roll
async function crocodile(ctx) {
  const { anim, atk, vic, sfx, dist, D } = ctx;
  const p = atk.parts;
  const shot = (spec, to) => heavyShot(ctx, spec, to);
  const vb = heavyBounds(vic);
  const vc = vb.getCenter(new THREE.Vector3());
  const rest = vc.clone().add(vic.model.position);
  const vicParent = vic.root.parent;
  const vicRoot = { p: vic.root.position.clone(), q: vic.root.quaternion.clone(), s: vic.root.scale.clone() };
  atk.root.updateMatrixWorld(true);
  vic.root.updateMatrixWorld(true);
  const inVic = (x, y, z) => vic.root.worldToLocal(atk.root.localToWorld(new THREE.Vector3(x, y, z)));
  const tail0 = p.tail.map((s) => s.rotation.y);
  // low two-shot: it glides in, jaws easing open
  const start = dist - 0.95;
  const bite = dist - 0.7;
  D.cut(shot({ at: ctx.A.clone().lerp(ctx.V, 0.5), yaw: 20, pitch: 6, dist: 1.6, lift: 0.27, fov: 34 }));
  sfx.play('growl', { pitch: 0.6, dur: 1.2 });
  await anim.tween(0.9, (k) => {
    const e = Ease.inOutQuad(k);
    setZ(atk, lerp(0, start, e), 0);
    p.jaw.rotation.x = 0.85 * e;
    p.head.rotation.x = -0.3 * e;
    p.legs.forEach((leg, i) => (leg.rotation.y = Math.sin(k * 16 + i * 1.6) * 0.35 * Math.sin(k * Math.PI)));
    p.tail.forEach((seg, i) => (seg.rotation.y = tail0[i] + Math.sin(k * 9 - i) * 0.25));
  });
  // SNAP
  killcam(ctx, shot({ at: ctx.A.clone().lerp(ctx.V, 0.75), yaw: 40, pitch: 10, dist: 1.3, lift: 0.25, fov: 34 }), 0.25, 0.6);
  await anim.tween(0.08, (k) => {
    setZ(atk, lerp(start, bite, k), 0);
    p.jaw.rotation.x = lerp(0.85, 0.1, k);
    p.head.rotation.x = lerp(-0.3, 0.05, k);
  }, Ease.inQuad);
  const chest = vic.model.localToWorld(new THREE.Vector3(vc.x, lerp(vb.min.y, vb.max.y, 0.4), lerp(vc.z, vb.max.z, 0.55)));
  hit(ctx, chest, { count: 45, wound: 0.07, sound: 'crunch', impact: 1.2, mist: 0.8 });
  // dragged down and twisted onto its side, its middle on the line the roll turns about
  const axisY = 0.26;
  const onAxis = inVic(0, axisY, bite + 0.3 + (vb.max.z - vc.z) * 0.75);
  await Promise.all([
    struggle(ctx, vic, 0.16, 1),
    anim.tween(0.16, (k) => heavyHold(vic, vc, rest.clone().lerp(onAxis, k), 0, 0, (Math.PI / 2) * k), Ease.outQuad),
  ]);
  atk.model.attach(vic.root);
  // DEATH ROLL: crocodile and prey spin together about one axis, blood flung off in a ring
  sfx.play('splash');
  sfx.play('roar', { pitch: 0.45 });
  const pivot = new THREE.Vector3(0, axisY - 0.07, 0);
  const fling = anim.every(() => {
    if (Math.random() < 0.5) {
      const a = Math.random() * Math.PI * 2;
      ctx.gore.spray(vic.model.localToWorld(vc.clone()), new THREE.Vector3(Math.cos(a), 0.4, Math.sin(a)), { count: 5, speed: 2.4, spread: 0.3 });
    }
  });
  // swinging round towards the crocodile's side, so it stays in front of its prey
  const orbit = shot({ at: ctx.V.clone().addScaledVector(ctx.dir, -0.3), yaw: 12, pitch: 10, dist: 1.4, lift: 0.26 }, -32);
  D.cut(orbit);
  await Promise.all([
    anim.tween(1.1, (k) => {
      heavyHold(atk, pivot, new THREE.Vector3(0, axisY + arc(k, 0.08), bite), 0, 0, Ease.inOutCubic(k) * Math.PI * 4);
      p.legs.forEach((leg, i) => (leg.rotation.y = (i % 4 < 2 ? 1 : -1) * 0.9 * Math.sin(k * Math.PI)));
      p.tail.forEach((seg, i) => (seg.rotation.y = lerp(tail0[i], 0, Math.sin(k * Math.PI))));
      if (Math.random() < 0.06) {
        ctx.world.shake(0.1);
        sfx.play('squelch');
      }
    }),
    D.orbit(orbit, orbit.to, 1.1),
  ]);
  fling();
  heavyHold(atk, pivot, new THREE.Vector3(0, axisY, bite), 0, 0, 0);
  // two savage whips of the head tear it apart
  p.head.attach(vic.root);
  let from = 0;
  for (const to of [0.55, -0.55]) {
    const a = from;
    await anim.tween(0.15, (k) => {
      p.head.rotation.y = lerp(a, to, k);
      p.body.rotation.y = -0.25 * lerp(a, to, k);
    }, Ease.inOutSine);
    sfx.play('squelch');
    ctx.gore.spray(vic.model.localToWorld(vc.clone()), new THREE.Vector3(-Math.sign(to) * ctx.dir.z, 0.5, Math.sign(to) * ctx.dir.x), { count: 14, speed: 2.2 });
    ctx.world.shake(0.12);
    from = to;
  }
  killcam(ctx, shot({ at: ctx.V.clone().addScaledVector(ctx.dir, -0.15), yaw: 40, pitch: 12, dist: 1.45, lift: 0.25, fov: 34 }), 0.15, 1.2);
  await anim.tween(0.1, (k) => {
    p.head.rotation.y = lerp(-0.55, 0.3, k);
    p.body.rotation.y = lerp(0.14, -0.08, k);
  }, Ease.inQuad);
  vicParent.attach(vic.root);
  finish(ctx, { mode: 'limbs', power: 1.5, up: 1.0 });
  vic.root.position.copy(vicRoot.p);
  vic.root.quaternion.copy(vicRoot.q);
  vic.root.scale.copy(vicRoot.s);
  // a last snap of the jaws, then it slides onto the square as the camera swings round
  const after = shot({ at: ctx.V.clone().addScaledVector(ctx.dir, -0.15), yaw: 40, pitch: 18, dist: 1.55, lift: 0.22 }, 95);
  await Promise.all([
    D.orbit(after, after.to, 1.5),
    anim.wait(0.6).then(() =>
      anim.tween(0.55, (k) => {
        p.head.rotation.y = lerp(0.3, 0, k);
        p.body.rotation.y = lerp(-0.08, 0, k);
        p.head.rotation.x = lerp(0.05, 0, k);
        p.jaw.rotation.x = 0.1 + 0.45 * Math.sin(k * Math.PI);
        setZ(atk, lerp(bite, dist, Ease.inOutQuad(k)), 0);
      }),
    ),
  ]);
}

export const ATTACKS = { eagle, tiger, wolf, bear, cobra, shark, gorilla, rhino, scorpion, crocodile };

// The prey turns to face the threat, lowers itself and snarls.
export async function victimReacts(ctx) {
  const { vic, sfx, D } = ctx;
  D.cut({ at: ctx.V, yaw: -32, pitch: 8, dist: 1.25, lift: 0.4, fov: 30 });
  sfx.play('growl', { pitch: 1.4, dur: 0.6 });
  await ctx.anim.tween(0.6, (k) => {
    vic.model.position.y = 0.07 - 0.03 * Math.sin(k * Math.PI * 0.5);
    if (vic.parts.head) vic.parts.head.rotation.x = 0.2 * k;
    if (vic.parts.jaw) vic.parts.jaw.rotation.x = 0.45 * Math.sin(k * Math.PI);
  });
}

export function makeContext({ world, fx, gore, sfx, atk, vic, A, V, director, onKill }) {
  const dir = V.clone().sub(A).setY(0);
  const dist = Math.max(0.6, dir.length());
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  dir.normalize();
  const mid = A.clone().add(V).multiplyScalar(0.5);
  return { world, anim: world.anim, fx, gore, sfx, atk, vic, A, V, mid, dir, dist, D: director, onKill };
}
