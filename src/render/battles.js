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

// ------------------------------------------------------------------ SHARK: Deep Strike
async function shark(ctx) {
  const { anim, atk, vic, sfx, dist, world, fx, D } = ctx;
  const p = atk.parts;
  D.cut({ at: ctx.A, yaw: 40, pitch: 10, dist: 1.4, lift: 0.2, fov: 34 });
  sfx.play('splash');
  fx.splash(ctx.A.clone().setY(BOARD_Y + 0.15), 0.6);
  await anim.tween(0.5, (k) => {
    p.body.rotation.x = 0.9 * k;
    p.body.position.y = 0.19 - k * 0.75;
  }, Ease.inQuad);
  p.body.visible = false;
  // dark water opens under the prey
  const poolMat = new THREE.MeshStandardMaterial({ color: 0x0b2c44, transparent: true, opacity: 0.94, roughness: 0.05, metalness: 0.25 });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(0.62, 48), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.copy(ctx.V).setY(BOARD_Y + 0.012);
  pool.scale.setScalar(0.01);
  world.transient.add(pool);
  const swirl = anim.every((dt) => (pool.rotation.z += dt * 3));
  const ripples = anim.every(() => {
    if (Math.random() < 0.06) fx.ring(ctx.V, { color: 0x9cc6da, from: 0.15, to: 0.62, duration: 0.7, y: BOARD_Y + 0.02, opacity: 0.5 });
  });
  D.cut({ at: ctx.V, yaw: 65, pitch: 9, dist: 1.5, lift: 0.25, fov: 32 });
  sfx.play('dunDun');
  await anim.tween(0.45, (k) => pool.scale.setScalar(Ease.outCubic(k)));
  const finMat = atk.meshes().find((m) => m.material.side === THREE.DoubleSide)?.material ?? new THREE.MeshStandardMaterial({ color: 0x485866 });
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.42, 4), finMat);
  fin.scale.set(0.3, 1, 1);
  fin.castShadow = true;
  world.transient.add(fin);
  const look0 = vic.model.rotation.y;
  sfx.play('heartbeat');
  await anim.tween(1.5, (k) => {
    const a = k * Math.PI * 4;
    const r = 0.52 - k * 0.12;
    fin.position.set(ctx.V.x + Math.cos(a) * r, BOARD_Y + 0.17, ctx.V.z + Math.sin(a) * r);
    fin.rotation.y = -a;
    if (Math.random() < 0.5) fx.burst(fin.position.clone().setY(BOARD_Y + 0.03), { count: 3, colors: [0xdfeef5, 0x9cc6da], shape: 'sphere', speed: 0.4, up: 0.4, gravity: 3, size: [0.006, 0.012], life: [0.3, 0.5] });
    vic.model.rotation.y = look0 + Math.sin(k * 18) * 0.35;
    if (k > 0.7 && Math.random() < 0.1) sfx.play('heartbeat');
  });
  fin.removeFromParent();
  fin.geometry.dispose();
  // ERUPTION — jaws first, in slow motion
  setZ(atk, dist, -0.9);
  atk.model.rotation.set(-Math.PI / 2, 0, 0);
  p.body.visible = true;
  p.body.position.y = 0.19;
  p.body.rotation.x = 0;
  p.body.scale.setScalar(1.5);
  p.water.visible = false;
  p.foam.visible = false;
  killcam(ctx, { at: ctx.V, yaw: 35, pitch: 4, dist: 1.6, lift: 0.7, fov: 34 }, 0.25, 0.9);
  sfx.play('splash');
  sfx.play('roar', { pitch: 0.5 });
  fx.splash(ctx.V.clone().setY(BOARD_Y + 0.2), 1.4);
  await anim.tween(0.32, (k) => {
    atk.model.position.y = lerp(-0.9, 0.85, Ease.outQuad(k));
    p.jaw.rotation.x = 1.1 * k;
    vic.root.position.y = BOARD_Y + k * 1.05;
    vic.model.rotation.x = k * 0.7;
  });
  // CHOMP — teeth through the middle
  await anim.tween(0.08, (k) => (p.jaw.rotation.x = 1.1 * (1 - k * 0.7)));
  hit(ctx, bodyPoint(vic, 0.25), { count: 80, wound: 0.07, sound: 'crunch', impact: 1.2, mist: 1 });
  // thrash, turning the water red
  const stop = D.track({ at: () => bodyPoint(vic, 0.0), yaw: 50, pitch: 10, dist: 1.5, lift: 0.0 }, 7);
  await Promise.all([
    anim.tween(1.0, (k, raw) => {
      atk.model.rotation.z = Math.sin(raw * 35) * 0.5;
      vic.root.position.x += Math.sin(raw * 35) * 0.004;
      poolMat.color.lerp(new THREE.Color(0x4a0408), 0.03);
      if (Math.random() < 0.5) ctx.gore.spray(bodyPoint(vic, 0.2), new THREE.Vector3(rand(-1, 1), 0.6, rand(-1, 1)), { count: 6, speed: 2.4 });
      if (Math.random() < 0.06) sfx.play('splash');
    }),
    struggle(ctx, vic, 1.0, 1.3, true),
  ]);
  stop();
  atk.model.rotation.z = 0;
  // bites clean through
  killcam(ctx, { at: () => bodyPoint(vic, 0.0), yaw: 45, pitch: 6, dist: 1.4, lift: 0.0, fov: 32 }, 0.15, 1.3);
  await anim.tween(0.08, (k) => (p.jaw.rotation.x = 0.33 * (1 - k)));
  finish(ctx, { mode: 'halves', axis: 'z', power: 1.8, up: 0.8 });
  sfx.play('splash');
  await Promise.all([
    D.orbit({ at: ctx.V, yaw: 42, pitch: 8, dist: 1.6, lift: 0.6 }, 160, 1.6),
    anim.tween(0.6, (k) => {
      atk.model.position.y = 0.07 + arc(k, 0.4) + (1 - k) * 0.78 - k * 0.95;
      atk.model.rotation.x = lerp(-Math.PI / 2, Math.PI * 0.6, k);
    }),
  ]);
  sfx.play('splash');
  // resurfaces on the square
  atk.model.rotation.set(0, 0, 0);
  p.body.scale.setScalar(1);
  p.water.visible = true;
  p.foam.visible = true;
  setZ(atk, dist, -0.5);
  await anim.tween(0.5, (k) => {
    atk.model.position.y = lerp(-0.5, 0.07, Ease.outCubic(k));
    pool.scale.setScalar(1 - k);
  });
  swirl();
  ripples();
  pool.removeFromParent();
  pool.geometry.dispose();
  poolMat.dispose();
  vic.root.position.y = BOARD_Y;
}

// ------------------------------------------------------------------ GORILLA: Pulverize
async function gorilla(ctx) {
  const { anim, atk, vic, sfx, dist, D } = ctx;
  const p = atk.parts;
  D.cut({ at: ctx.A, yaw: 45, pitch: 2, dist: 1.25, lift: 0.5, fov: 34 });
  for (let i = 0; i < 4; i++) {
    const arm = i % 2 ? p.armR : p.armL;
    sfx.play('drum');
    sfx.play('drum', { delay: 0.04 });
    await anim.tween(0.24, (k) => {
      const s = Math.sin(k * Math.PI);
      arm.rotation.x = -1.4 * s;
      arm.rotation.z = (i % 2 ? 1 : -1) * 0.95 * s;
      p.head.rotation.x = -0.25 * s;
      p.jaw.rotation.x = 0.4 * s;
    });
  }
  sfx.play('roar', { pitch: 0.7 });
  await anim.tween(0.5, (k) => (p.jaw.rotation.x = 0.7 * Math.sin(k * Math.PI)));
  // charge and seize
  D.cut({ at: ctx.V, yaw: 15, pitch: 12, dist: 2.0, lift: 0.4, fov: 34 });
  await anim.tween(0.35, (k) => {
    setZ(atk, lerp(0, dist - 0.45, k), arc(k, 0.2));
    p.armL.rotation.x = p.armR.rotation.x = -1.5 * k;
  });
  hit(ctx, bodyPoint(vic, 0.2), { count: 15, wound: 0, sound: 'crunch', impact: 0.4 });
  const vicStart = vic.root.position.clone();
  const overhead = atk.model.localToWorld(new THREE.Vector3(0, 1.05, 0.05));
  await Promise.all([
    anim.tween(0.4, (k) => {
      vic.root.position.lerpVectors(vicStart, overhead, Ease.outQuad(k));
      p.armL.rotation.x = p.armR.rotation.x = lerp(-1.5, -3.0, k);
      vic.model.rotation.z = k * Math.PI * 0.9;
    }),
    struggle(ctx, vic, 0.4, 1),
  ]);
  // pile-driven into the board, twice
  const front = ctx.V.clone().addScaledVector(ctx.dir, 0.12).setY(BOARD_Y);
  for (let i = 0; i < 2; i++) {
    if (i === 1) killcam(ctx, { at: front, yaw: 60, pitch: 10, dist: 1.2, lift: 0.2, fov: 30 }, 0.3, 0.4);
    else D.cut({ at: front, yaw: 40, pitch: 16, dist: 1.6, lift: 0.3, fov: 32 });
    await anim.tween(0.17, (k) => {
      vic.root.position.lerpVectors(overhead, front, Ease.inQuad(k));
      p.armL.rotation.x = p.armR.rotation.x = lerp(-3.0, -1.2, k);
      atk.model.rotation.x = 0.35 * k;
    });
    sfx.play('thud', { power: 1 });
    sfx.play('crunch');
    hit(ctx, front.clone().setY(BOARD_Y + 0.15), { count: 60, wound: 0.06, sound: 'squelch', impact: 1.1, mist: 0.8 });
    ctx.gore.decal(front, 0.6, 'splat');
    ctx.world.shake(0.3);
    vic.model.scale.set(1 + 0.12 * (i + 1), 1 - 0.15 * (i + 1), 1 + 0.12 * (i + 1));
    await anim.tween(0.27, (k) => {
      vic.root.position.lerpVectors(front, overhead, Ease.outQuad(k));
      p.armL.rotation.x = p.armR.rotation.x = lerp(-1.2, -3.0, k);
      atk.model.rotation.x = 0.35 * (1 - k);
    });
  }
  // slammed down, then pounded with both fists
  await anim.tween(0.17, (k) => {
    vic.root.position.lerpVectors(overhead, front, Ease.inQuad(k));
    p.armL.rotation.x = p.armR.rotation.x = lerp(-3.0, -1.2, k);
  });
  sfx.play('thud');
  D.cut({ at: front, yaw: 30, pitch: 34, dist: 1.4, lift: 0.1, fov: 32 });
  for (let i = 0; i < 3; i++) {
    await anim.tween(0.16, (k) => (p.armL.rotation.x = p.armR.rotation.x = lerp(-1.2, -2.8, Ease.outQuad(k))));
    await anim.tween(0.1, (k) => (p.armL.rotation.x = p.armR.rotation.x = lerp(-2.8, -1.0, k)), Ease.inQuad);
    sfx.play('thud', { power: 0.9 });
    sfx.play('crunch');
    hit(ctx, bodyPoint(vic, 0.15), { count: 45, wound: 0.05, sound: null, impact: 0.9 });
    ctx.world.shake(0.25);
  }
  // tears it apart with both hands
  killcam(ctx, { at: front, yaw: 42, pitch: 14, dist: 1.25, lift: 0.3, fov: 30 }, 0.15, 1.3);
  await anim.tween(0.25, (k) => {
    p.armL.rotation.z = -1.0 * k;
    p.armR.rotation.z = 1.0 * k;
    p.armL.rotation.x = p.armR.rotation.x = lerp(-1.0, -1.6, k);
    vic.root.position.y = BOARD_Y + 0.3 * k;
  });
  finish(ctx, { mode: 'halves', axis: 'x', power: 2.4, up: 1.4 });
  sfx.play('roar', { pitch: 0.65 });
  await D.orbit({ at: front, yaw: 42, pitch: 14, dist: 1.4, lift: 0.3 }, 170, 1.6);
  vic.root.position.copy(vicStart);
  await anim.tween(0.5, (k) => {
    atk.model.rotation.x = 0;
    p.armL.rotation.set(lerp(-1.6, 0, k), 0, lerp(-1.0, 0, k));
    p.armR.rotation.set(lerp(-1.6, 0, k), 0, lerp(1.0, 0, k));
    setZ(atk, lerp(dist - 0.45, dist, k), 0);
  });
}

// ------------------------------------------------------------------ RHINO: Gore & Trample
async function rhino(ctx) {
  const { anim, atk, vic, sfx, dist, fx, D } = ctx;
  const p = atk.parts;
  await anim.tween(0.4, (k) => setZ(atk, -0.8 * Ease.outQuad(k), 0));
  // over the shoulder: pawing, snorting steam, head down
  D.cut({ at: ctx.A, yaw: -150, pitch: 8, dist: 1.4, lift: 0.5, fov: 34 });
  for (let i = 0; i < 3; i++) {
    sfx.play('snort');
    const nose = atk.model.localToWorld(new THREE.Vector3(0, 0.28, 0.58));
    fx.puff(nose, { count: 4, color: 0xe8ecef, size: 0.18, spread: 0.05, rise: 0.12, opacity: 0.4 });
    await anim.tween(0.28, (k) => {
      p.legFL.rotation.x = -0.7 * Math.sin(k * Math.PI);
      p.head.rotation.x = 0.35 * Math.sin(k * Math.PI);
    });
    fx.dust(atk.model.localToWorld(new THREE.Vector3(0.1, 0.03, 0.2)), 6);
  }
  // CHARGE (tracking from the side)
  sfx.play('roar', { pitch: 0.5 });
  const total = dist + 0.8 - 0.3;
  let lastDust = 0;
  const stop = D.track({ at: () => wpos(atk.model), yaw: 15, pitch: 5, dist: 1.8, lift: 0.3 }, 9);
  await anim.tween(0.45, (k, raw) => {
    setZ(atk, -0.8 + total * k, Math.abs(Math.sin(raw * 30)) * 0.04);
    p.head.rotation.x = 0.4;
    gait(p, raw * 40, 0.7);
    if (raw - lastDust > 0.12) {
      lastDust = raw;
      fx.dust(atk.model.localToWorld(new THREE.Vector3(0, 0.03, -0.2)), 5);
    }
  }, Ease.inQuad);
  stop();
  // the horn goes in
  killcam(ctx, { at: ctx.V, yaw: 55, pitch: 8, dist: 1.15, lift: 0.3, fov: 30 }, 0.2, 0.8);
  sfx.play('thud');
  hit(ctx, bodyPoint(vic, 0.25), { count: 70, wound: 0.07, sound: 'crunch', impact: 1.2, mist: 0.9 });
  // tossed high, trailing blood
  const v0 = vic.root.position.clone();
  const apex = ctx.V.clone().addScaledVector(ctx.dir, 0.7).setY(BOARD_Y + 1.8);
  const land = ctx.V.clone().addScaledVector(ctx.dir, 0.55).setY(BOARD_Y);
  sfx.play('whoosh', { dur: 0.7 });
  const toss = D.track({ at: () => bodyPoint(vic, 0.0), yaw: 40, pitch: 2, dist: 2.1, lift: 0.0 }, 16);
  await anim.tween(0.6, (k) => {
    p.head.rotation.x = lerp(0.4, -0.8, Math.min(1, k * 3));
    vic.root.position.lerpVectors(v0, apex, Ease.outQuad(k));
    vic.model.rotation.x = k * Math.PI * 2.2;
    gait(p, 0, 0);
    if (Math.random() < 0.6) ctx.gore.spray(bodyPoint(vic, 0.25), null, { count: 3, speed: 0.8, up: 0 });
  });
  await anim.tween(0.42, (k) => {
    vic.root.position.lerpVectors(apex, land, Ease.inQuad(k));
    vic.model.rotation.x = Math.PI * 2.2 + k * Math.PI * 0.8;
  });
  toss();
  vic.model.rotation.set(0, 0, -1.4);
  sfx.play('thud');
  sfx.play('crunch');
  ctx.gore.burst(land.clone().setY(BOARD_Y + 0.1), 0.6);
  ctx.world.shake(0.25);
  // trample
  await anim.tween(0.35, (k) => {
    setZ(atk, lerp(dist - 0.3, dist + 0.25, k), 0);
    p.head.rotation.x = lerp(-0.8, 0.2, k);
  });
  D.cut({ at: land, yaw: 45, pitch: 22, dist: 1.3, lift: 0.15, fov: 32 });
  for (let i = 0; i < 2; i++) {
    const leg = i % 2 ? p.legFR : p.legFL;
    await anim.tween(0.2, (k) => {
      leg.rotation.x = -1.0 * Ease.outQuad(k);
      atk.model.rotation.x = -0.25 * k;
    });
    await anim.tween(0.1, (k) => {
      leg.rotation.x = -1.0 + 1.0 * k;
      atk.model.rotation.x = -0.25 + 0.35 * k;
    }, Ease.inQuad);
    sfx.play('thud');
    sfx.play('crunch');
    hit(ctx, bodyPoint(vic, 0.12), { count: 50, wound: 0.06, sound: null, impact: 1 });
    ctx.world.shake(0.3);
  }
  killcam(ctx, { at: land, yaw: 42, pitch: 12, dist: 1.3, lift: 0.2, fov: 30 }, 0.15, 1.3);
  await anim.tween(0.12, (k) => {
    p.legFL.rotation.x = p.legFR.rotation.x = -0.9 * k;
    atk.model.rotation.x = 0.1 - 0.3 * k;
  });
  await anim.tween(0.08, (k) => {
    p.legFL.rotation.x = p.legFR.rotation.x = -0.9 * (1 - k);
    atk.model.rotation.x = -0.2 + 0.3 * k;
  });
  finish(ctx, { mode: 'limbs', power: 2.6, up: 1.4 });
  await D.orbit({ at: land, yaw: 42, pitch: 12, dist: 1.5, lift: 0.2 }, 170, 1.6);
  await anim.tween(0.45, (k) => {
    atk.model.rotation.x = lerp(0.1, 0, k);
    p.head.rotation.x = 0.2 * (1 - k);
    setZ(atk, lerp(dist + 0.25, dist, k), 0);
  });
  vic.root.position.copy(v0);
}

// ------------------------------------------------------------------ SCORPION: Death Sting
async function scorpion(ctx) {
  const { anim, atk, vic, sfx, dist, D } = ctx;
  const p = atk.parts;
  const stop = D.track({ at: () => wpos(atk.model), yaw: 48, pitch: 6, dist: 0.95, lift: 0.18 }, 7);
  ctx.world.setFov(30);
  sfx.play('hiss');
  await anim.tween(0.8, (k, raw) => {
    setZ(atk, lerp(0, dist - 0.62, k), 0);
    p.legs.forEach((leg, i) => (leg.rotation.x = Math.sin(raw * 40 + i * 1.3) * 0.32));
    p.clawL.rotation.x = p.clawR.rotation.x = -0.5 * k;
    p.fingerL.rotation.y = 0.15 + Math.abs(Math.sin(raw * 16)) * 0.6;
    p.fingerR.rotation.y = -0.15 - Math.abs(Math.sin(raw * 16)) * 0.6;
  });
  stop();
  for (let i = 0; i < 3; i++) sfx.play('pinch', { delay: i * 0.1 });
  // pincers clamp: one at the throat, one at the body
  D.cut({ at: ctx.V, yaw: 50, pitch: 12, dist: 1.1, lift: 0.3, fov: 30 });
  await anim.tween(0.2, (k) => {
    p.fingerL.rotation.y = 0.75 * k;
    p.fingerR.rotation.y = -0.75 * k;
  });
  await anim.tween(0.12, (k) => {
    p.clawL.rotation.x = p.clawR.rotation.x = lerp(-0.5, 0.15, k);
    p.clawL.rotation.y = -0.25 * k;
    p.clawR.rotation.y = 0.25 * k;
    p.fingerL.rotation.y = lerp(0.75, -0.05, k);
    p.fingerR.rotation.y = lerp(-0.75, 0.05, k);
  });
  hit(ctx, headPoint(vic), { count: 40, wound: 0.045, sound: 'crunch', impact: 0.8 });
  hit(ctx, bodyPoint(vic, 0.2), { count: 30, wound: 0.045, sound: 'squelch', impact: 0.4 });
  await anim.tween(0.2, (k) => (vic.model.position.y = 0.07 + 0.1 * k));
  // the stinger hammers in, again and again
  for (let i = 0; i < 4; i++) {
    if (i === 0) killcam(ctx, { at: ctx.V, yaw: 20, pitch: 30, dist: 1.0, lift: 0.4, fov: 30 }, 0.25, 0.5);
    await anim.tween(0.13, (k) => p.tail.forEach((seg, j) => (seg.rotation.x = (j === 0 ? 1.4 : 0.5) + 0.28 * k)), Ease.inQuad);
    sfx.play('sting');
    hit(ctx, bodyPoint(vic, 0.35), { count: 35, wound: 0.03, sound: 'squelch', impact: 0.7, mist: 0.4 });
    vic.tint(0x1a0a20, 0.18 * (i + 1), 0);
    await Promise.all([anim.tween(0.18, (k) => p.tail.forEach((seg, j) => (seg.rotation.x = (j === 0 ? 1.4 : 0.5) + 0.28 * (1 - k)))), struggle(ctx, vic, 0.18, 1.2)]);
  }
  // convulsions as the venom takes hold, foaming at the mouth
  await Promise.all([
    struggle(ctx, vic, 0.9, 1.4, true),
    anim.tween(0.9, () => {
      if (Math.random() < 0.3) ctx.fx.burst(headPoint(vic), { count: 2, colors: [0xe8f0d0, 0xc8d8a0], shape: 'sphere', speed: 0.3, up: 0.2, gravity: 1, size: [0.01, 0.02], life: [0.4, 0.8] });
    }),
  ]);
  // ripped apart in the pincers
  killcam(ctx, { at: ctx.V, yaw: 42, pitch: 12, dist: 1.2, lift: 0.3, fov: 30 }, 0.15, 1.3);
  await anim.tween(0.2, (k) => {
    p.clawL.rotation.y = lerp(-0.25, 0.5, k);
    p.clawR.rotation.y = lerp(0.25, -0.5, k);
  });
  finish(ctx, { mode: 'halves', axis: 'x', power: 2.2, up: 1.3 });
  await D.orbit({ at: ctx.V, yaw: 42, pitch: 12, dist: 1.3, lift: 0.3 }, 160, 1.6);
  await anim.tween(0.45, (k) => {
    p.clawL.rotation.set(lerp(0.15, 0, k), lerp(0.5, 0, k), 0);
    p.clawR.rotation.set(lerp(0.15, 0, k), lerp(-0.5, 0, k), 0);
    p.tail[0].rotation.x = 1.1;
    setZ(atk, lerp(dist - 0.62, dist, k), 0);
  });
}

// ------------------------------------------------------------------ CROCODILE: Death Roll
async function crocodile(ctx) {
  const { anim, atk, vic, sfx, dist, D } = ctx;
  const p = atk.parts;
  // eye-level with the board, jaws easing open
  const stop = D.track({ at: () => wpos(atk.parts.head), yaw: 50, pitch: 2, dist: 1.0, lift: 0.0 }, 6);
  ctx.world.setFov(30);
  sfx.play('growl', { pitch: 0.6, dur: 1.2 });
  await anim.tween(1.0, (k, raw) => {
    setZ(atk, lerp(0, dist - 0.78, k), 0);
    p.jaw.rotation.x = 0.85 * k;
    p.head.rotation.x = -0.3 * k;
    p.legs.forEach((leg, i) => (leg.rotation.y = Math.sin(raw * 16 + i * 1.6) * 0.35));
    p.tail.forEach((seg, i) => (seg.rotation.y = 0.32 + Math.sin(raw * 9 - i) * 0.3));
  });
  stop();
  // SNAP
  killcam(ctx, { at: ctx.V, yaw: 50, pitch: 8, dist: 1.1, lift: 0.25, fov: 30 }, 0.25, 0.6);
  await anim.tween(0.1, (k) => {
    setZ(atk, lerp(dist - 0.78, dist - 0.55, k), 0);
    p.jaw.rotation.x = lerp(0.85, 0.12, k);
    p.head.rotation.x = lerp(-0.3, 0, k);
  });
  hit(ctx, bodyPoint(vic, 0.2), { count: 70, wound: 0.07, sound: 'crunch', impact: 1.2, mist: 0.9 });
  const vicStart = vic.root.position.clone();
  const anchor = new THREE.Group();
  p.head.add(anchor);
  anchor.position.set(0, 0.0, 0.3);
  anchor.updateMatrixWorld(true);
  const anchorW = wpos(anchor);
  await anim.tween(0.12, (k) => {
    vic.root.position.lerpVectors(vicStart, anchorW.clone().setY(BOARD_Y + 0.02), k);
    vic.model.rotation.x = -0.4 * k;
  });
  anchor.attach(vic.root);
  // DEATH ROLL — blood flung off in a spinning ring
  sfx.play('splash');
  sfx.play('roar', { pitch: 0.45 });
  D.cut({ at: ctx.V, yaw: 30, pitch: 18, dist: 1.5, lift: 0.2, fov: 32 });
  const fling = anim.every(() => {
    if (Math.random() < 0.6) {
      const a = Math.random() * Math.PI * 2;
      ctx.gore.spray(bodyPoint(vic, 0.1), new THREE.Vector3(Math.cos(a), 0.4, Math.sin(a)), { count: 6, speed: 2.6, spread: 0.3 });
    }
  });
  await Promise.all([
    anim.tween(1.2, (k) => {
      atk.model.rotation.z = Ease.inOutQuad(k) * Math.PI * 6;
      atk.model.position.y = 0.07 + Math.abs(Math.sin(k * Math.PI * 6)) * 0.1;
      if (Math.random() < 0.08) {
        ctx.world.shake(0.12);
        sfx.play('squelch');
      }
    }),
    D.orbit({ at: ctx.V, yaw: 30, pitch: 18, dist: 1.5, lift: 0.2 }, 110, 1.2),
  ]);
  fling();
  atk.model.rotation.z = 0;
  atk.model.position.y = 0.07;
  // violent head thrash tears it to pieces
  await anim.tween(0.45, (k, raw) => {
    p.head.rotation.y = Math.sin(raw * 26) * 0.7;
    p.body.rotation.y = -Math.sin(raw * 26) * 0.18;
    if (Math.random() < 0.4) ctx.gore.spray(bodyPoint(vic, 0.1), new THREE.Vector3(rand(-1, 1), 0.5, rand(-1, 1)), { count: 6, speed: 2.2 });
  });
  killcam(ctx, { at: ctx.V, yaw: 42, pitch: 10, dist: 1.25, lift: 0.2, fov: 30 }, 0.15, 1.3);
  ctx.world.transient.attach(vic.root);
  p.head.remove(anchor);
  finish(ctx, { mode: 'limbs', power: 2.6, up: 1.2 });
  await D.orbit({ at: ctx.V, yaw: 42, pitch: 10, dist: 1.4, lift: 0.2 }, 165, 1.6);
  vic.root.position.copy(vicStart);
  await anim.tween(0.45, (k) => {
    p.head.rotation.y = 0;
    p.body.rotation.y = 0;
    p.jaw.rotation.x = 0.12 + 0.5 * Math.sin(k * Math.PI);
    setZ(atk, lerp(dist - 0.55, dist, k), 0);
  });
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
