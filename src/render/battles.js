import * as THREE from 'three';
import { Ease, arc, lerp, rand } from '../engine/anim.js';
import { DEBRIS, createAnimal } from './animals.js';
import { BOARD_Y } from './boardMesh.js';

// Each attack receives a context:
//   A, V      world positions (board level) of attacker and victim squares
//   dir       unit vector A -> V (horizontal), dist = |V - A|
//   atk, vic  TokenView instances. atk.root sits on A facing V, vic.root on V facing A.
// Attacker model offsets are in the attacker's local frame: +z points at the victim, so (0, y, dist) is the victim.
// Every attack ends with the victim torn apart (fx.ripApart) and the attacker model standing at (0, 0, dist).

function vicCenter(ctx, y = 0.35) {
  return ctx.V.clone().setY(BOARD_Y + y);
}

function wobble(ctx, view, dur, amount = 0.15, freq = 30) {
  const base = view.model.rotation.z;
  return ctx.anim.tween(dur, (k) => {
    view.model.rotation.z = base + Math.sin(k * dur * freq) * amount * (1 - k * 0.5);
  });
}

function setModelZ(view, z, y = null) {
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

async function rip(ctx, opts = {}) {
  const { fx, vic, sfx } = ctx;
  const c = new THREE.Vector3();
  vic.model.getWorldPosition(c);
  c.y += 0.3;
  sfx.play('rip');
  fx.victimBurst(c, DEBRIS[vic.animal], opts.burst ?? 1);
  fx.flash(c, { color: opts.flashColor ?? 0xffffff, size: 2.2 });
  fx.ripApart(vic, opts);
  ctx.world.shake(opts.shake ?? 0.35);
  if (opts.word) {
    fx.text(c.clone().add(new THREE.Vector3(0, 0.9, 0)), opts.word, { color: opts.wordColor ?? '#ffdd33', stroke: opts.stroke ?? '#2a0a00' });
  }
}

// ------------------------------------------------------------------ EAGLE: Sky Shred
async function eagle(ctx) {
  const { anim, atk, vic, fx, sfx, dist } = ctx;
  const p = atk.parts;
  sfx.play('screech');
  // take off
  await anim.tween(0.25, (k) => p.setWings(k), Ease.outCubic);
  await anim.tween(0.85, (k) => {
    p.setWings(1, Math.sin(k * 30) * 0.6);
    setModelZ(atk, lerp(0, -1.5, k), Ease.inQuad(k) * 6);
    atk.model.rotation.x = -0.5 * k;
  });
  // shadow circles the victim
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.copy(ctx.V).setY(BOARD_Y + 0.015);
  ctx.world.transient.add(shadow);
  const lookUp = anim.tween(0.7, (k) => (vic.model.rotation.x = -0.5 * Math.sin(k * Math.PI)));
  await anim.tween(0.7, (k) => {
    shadow.material.opacity = 0.45 * k;
    shadow.scale.setScalar(1.6 - k * 0.8);
  });
  await lookUp;
  // dive
  sfx.play('whoosh', { dur: 0.35 });
  const z0 = dist - 2.6;
  await anim.tween(0.38, (k) => {
    p.setWings(0.15, 0);
    setModelZ(atk, lerp(z0, dist, k), lerp(5.5, 0.55, k));
    atk.model.rotation.x = lerp(0.9, -0.1, k);
    shadow.scale.setScalar(0.8 - k * 0.2);
  }, Ease.inQuad);
  shadow.removeFromParent();
  shadow.geometry.dispose();
  shadow.material.dispose();
  sfx.play('bite');
  fx.burst(vicCenter(ctx, 0.5), { count: 12, colors: DEBRIS[vic.animal].colors, shape: 'sphere', speed: 2, size: [0.03, 0.05] });
  ctx.world.shake(0.2);
  // carry the victim skywards
  p.talons.attach(vic.root);
  await anim.tween(0.9, (k) => {
    p.setWings(1, Math.sin(k * 28) * 0.7);
    setModelZ(atk, dist, lerp(0.55, 2.3, Ease.outQuad(k)));
    atk.model.rotation.x = lerp(-0.1, -0.3, k);
    vic.model.rotation.z = Math.sin(k * 40) * 0.4;
  });
  sfx.play('screech');
  await anim.tween(0.35, (k) => {
    p.setWings(1, 0.6 * k);
    vic.model.scale.set(1 + k * 0.25, 1 - k * 0.15, 1 + k * 0.25);
  });
  ctx.world.scene.attach(vic.root);
  await rip(ctx, { power: 2.4, up: 1.2, word: 'SHRED!', shake: 0.4 });
  // land on the square
  await anim.tween(0.7, (k) => {
    p.setWings(1, Math.sin(k * 16) * 0.4 * (1 - k));
    setModelZ(atk, dist, lerp(2.3, 0, Ease.inOutCubic(k)));
    atk.model.rotation.x = lerp(-0.3, 0, k);
  });
  await anim.tween(0.25, (k) => p.setWings(1 - k));
}

// ------------------------------------------------------------------ TIGER: Pounce & Maul
async function tiger(ctx) {
  const { anim, atk, vic, fx, sfx, dist } = ctx;
  const p = atk.parts;
  sfx.play('roar', { pitch: 0.9 });
  // crouch & butt wiggle
  await anim.tween(0.7, (k) => {
    const c = Math.min(1, k * 3);
    atk.model.scale.set(1 + 0.08 * c, 1 - 0.22 * c, 1 + 0.05 * c);
    p.body.rotation.y = Math.sin(k * 40) * 0.12 * c;
    p.tail.rotation.y = Math.sin(k * 25) * 0.8;
    p.jaw.rotation.x = 0.5 * c;
  });
  p.body.rotation.y = 0;
  // pounce
  sfx.play('whoosh', { dur: 0.3 });
  await anim.tween(0.42, (k) => {
    atk.model.scale.set(1 - 0.05 * Math.sin(k * Math.PI), 1 + 0.15 * Math.sin(k * Math.PI), 1);
    setModelZ(atk, lerp(0, dist - 0.25, k), arc(k, 1.1));
    atk.model.rotation.x = lerp(-0.6, 0.35, k);
    p.legFL.rotation.x = p.legFR.rotation.x = -1.2 * Math.sin(k * Math.PI);
    p.legBL.rotation.x = p.legBR.rotation.x = 0.9 * Math.sin(k * Math.PI);
  });
  atk.model.scale.set(1, 1, 1);
  atk.model.rotation.x = 0.15;
  sfx.play('thud', { power: 0.6 });
  ctx.world.shake(0.25);
  await anim.tween(0.15, (k) => vic.model.scale.set(1 + 0.25 * k, 1 - 0.35 * k, 1 + 0.25 * k));
  // flurry of claw swipes
  for (let i = 0; i < 3; i++) {
    const leg = i % 2 ? p.legFR : p.legFL;
    sfx.play('slash');
    fx.slashes(vicCenter(ctx, 0.4), { color: 0xff5530, angle: i % 2 ? 0.6 : -0.6 });
    fx.burst(vicCenter(ctx, 0.4), { count: 8, colors: DEBRIS[vic.animal].colors, shape: 'sphere', speed: 2.5, size: [0.025, 0.05] });
    ctx.world.shake(0.15);
    await anim.tween(0.22, (k) => {
      leg.rotation.x = -1.8 * Math.sin(k * Math.PI);
      leg.rotation.z = (i % 2 ? 0.6 : -0.6) * Math.sin(k * Math.PI);
      vic.model.rotation.z = (i % 2 ? -0.3 : 0.3) * Math.sin(k * Math.PI);
    });
  }
  sfx.play('roar');
  await anim.tween(0.2, (k) => {
    p.legFL.rotation.x = p.legFR.rotation.x = -2 * k;
    atk.model.rotation.x = lerp(0.15, -0.5, k);
  });
  await rip(ctx, { power: 3.5, up: 2.2, dir: ctx.dir, dirPower: 1.5, word: 'MAULED!', shake: 0.45 });
  await anim.tween(0.4, (k) => {
    p.legFL.rotation.x = p.legFR.rotation.x = -2 * (1 - k);
    atk.model.rotation.x = lerp(-0.5, 0, k);
    setModelZ(atk, lerp(dist - 0.25, dist, k), 0);
    p.jaw.rotation.x = 0.5 * (1 - k);
  });
}

// ------------------------------------------------------------------ WOLF: Pack Ambush
async function wolf(ctx) {
  const { anim, atk, vic, fx, sfx, dist, world } = ctx;
  const p = atk.parts;
  // howl
  sfx.play('howl');
  await anim.tween(0.9, (k) => {
    const h = Math.sin(Math.min(1, k * 1.4) * Math.PI);
    p.head.rotation.x = -1.0 * h;
    p.jaw.rotation.x = 0.5 * h;
    atk.model.rotation.x = -0.35 * h;
  });
  // summon two ghost wolves that flank the victim from behind, so the pack surrounds it
  const ghosts = [];
  const side = new THREE.Vector3(-ctx.dir.z, 0, ctx.dir.x);
  const ghostMat = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, emissive: 0x4a90e0, emissiveIntensity: 0.9, transparent: true, opacity: 0, roughness: 0.3, flatShading: true });
  for (const s of [1, -1]) {
    const g = createAnimal('wolf');
    g.model.traverse((o) => {
      if (o.isMesh) {
        o.material = ghostMat;
        o.castShadow = false;
      }
    });
    const pos = ctx.V.clone().addScaledVector(ctx.dir, 1.1).addScaledVector(side, s * 0.95).setY(BOARD_Y + 0.07);
    const bite = ctx.V.clone().addScaledVector(ctx.dir, 0.3).addScaledVector(side, s * 0.28).setY(BOARD_Y + 0.07);
    const away = pos.clone().sub(ctx.V).setY(0).normalize();
    g.model.position.copy(pos);
    g.model.scale.setScalar(1.1);
    g.model.lookAt(ctx.V.clone().setY(pos.y));
    world.transient.add(g.model);
    ghosts.push({ ...g, pos, bite, away });
    fx.burst(pos.clone().setY(BOARD_Y + 0.3), { count: 14, colors: [0x9fd8ff, 0xffffff], glow: true, speed: 1.5, up: 1, size: [0.02, 0.05], life: [0.4, 0.8] });
  }
  await anim.tween(0.45, (k) => (ghostMat.opacity = 0.8 * k));
  // all three lunge
  sfx.play('bite');
  sfx.play('roar', { pitch: 1.4 });
  await anim.tween(0.3, (k) => {
    setModelZ(atk, lerp(0, dist - 0.45, k), arc(k, 0.3));
    p.head.rotation.x = lerp(-0.6, 0.2, k);
    p.jaw.rotation.x = 0.7 * Math.sin(k * Math.PI);
    for (const gh of ghosts) {
      gh.model.position.lerpVectors(gh.pos, gh.bite, k);
      gh.model.position.y = gh.pos.y + arc(k, 0.3);
      gh.parts.jaw.rotation.x = 0.7 * Math.sin(k * Math.PI);
    }
  });
  ctx.world.shake(0.25);
  sfx.play('bite');
  // tug of war
  await anim.tween(0.9, (k) => {
    const tug = Math.sin(k * 26) * 0.06;
    setModelZ(atk, dist - 0.45 - tug - k * 0.08, 0);
    p.head.rotation.y = Math.sin(k * 30) * 0.25;
    for (const gh of ghosts) {
      gh.model.position.copy(gh.bite).addScaledVector(gh.away, k * 0.12 + tug);
      gh.parts.head.rotation.y = Math.sin(k * 30 + gh.away.x) * 0.25;
    }
    vic.model.scale.set(1 + k * 0.35, 1 - k * 0.2, 1 + k * 0.25);
    vic.model.rotation.y = Math.sin(k * 35) * 0.2;
  });
  await rip(ctx, { power: 4, up: 2, word: 'TORN!', shake: 0.4 });
  // ghosts dissolve
  for (const gh of ghosts) fx.burst(gh.model.position.clone().setY(BOARD_Y + 0.3), { count: 16, colors: [0x9fd8ff, 0xffffff], glow: true, speed: 1.2, up: 1.2, size: [0.02, 0.05], life: [0.5, 0.9], gravity: -1 });
  await anim.tween(0.5, (k) => {
    ghostMat.opacity = 0.8 * (1 - k);
    setModelZ(atk, lerp(dist - 0.53, dist, k), 0);
    p.head.rotation.x = 0.2 * (1 - k);
  });
  for (const gh of ghosts) gh.model.removeFromParent();
  ghostMat.dispose();
}

// ------------------------------------------------------------------ BEAR: Pancake Slam
async function bear(ctx) {
  const { anim, atk, vic, fx, sfx, dist } = ctx;
  const p = atk.parts;
  const stand = dist - 0.75;
  await anim.tween(0.35, (k) => setModelZ(atk, lerp(0, stand, k), arc(k, 0.12)));
  const hind = new THREE.Vector3(0, 0.02, -0.22);
  const base = new THREE.Vector3(0, 0.07, stand);
  sfx.play('roar', { pitch: 0.65 });
  // rear up on the hind legs and grow huge
  await anim.tween(0.8, (k) => {
    rotateAbout(atk, -1.15 * Ease.outBack(k), hind, 1 + 0.75 * k, base);
    p.legFL.rotation.x = p.legFR.rotation.x = -0.9 * k;
    p.head.rotation.x = 0.8 * k;
    p.jaw.rotation.x = 0.6 * k;
    vic.model.scale.set(1 - 0.08 * k, 1 - 0.1 * k, 1 - 0.08 * k);
  });
  await wobble(ctx, vic, 0.35, 0.1, 40);
  // SLAM
  await anim.tween(0.16, (k) => {
    rotateAbout(atk, lerp(-1.15, 0.45, k), hind, 1.75, base);
    p.legFL.rotation.x = p.legFR.rotation.x = lerp(-0.9, -1.4, k);
  }, Ease.inQuad);
  sfx.play('boom');
  ctx.world.shake(0.8);
  fx.ring(ctx.V, { color: 0xffffff, to: 3.2, duration: 0.6 });
  fx.dust(ctx.V.clone().setY(BOARD_Y + 0.1), 26, 0xb9a27f);
  fx.text(vicCenter(ctx, 1.4), 'SLAM!', { color: '#ffe14d' });
  await anim.tween(0.12, (k) => vic.model.scale.set(1 + 0.8 * k, 1 - 0.88 * k, 1 + 0.8 * k), Ease.outQuad);
  await anim.wait(0.35);
  // lift off the pancake, which cracks apart
  await anim.tween(0.3, (k) => rotateAbout(atk, lerp(0.45, -0.4, k), hind, 1.75, base));
  sfx.play('pop');
  await rip(ctx, { power: 2.6, up: 1.4, spin: 6, shake: 0.3, word: 'PANCAKED!' });
  await anim.tween(0.5, (k) => {
    const b = new THREE.Vector3(0, 0.07 + arc(k, 0.2), lerp(stand, dist, k));
    rotateAbout(atk, lerp(-0.4, 0, k), hind, 1.75 - 0.75 * k, b);
    p.legFL.rotation.x = p.legFR.rotation.x = -1.4 * (1 - k);
    p.head.rotation.x = 0.8 * (1 - k);
    p.jaw.rotation.x = 0.6 * (1 - k);
  });
  atk.model.position.set(0, 0.07, dist);
}

// ------------------------------------------------------------------ COBRA: Coil & Venom
async function cobra(ctx) {
  const { anim, atk, vic, fx, sfx, dist, world } = ctx;
  const p = atk.parts;
  sfx.play('hiss');
  // slither up beside the victim with the hood flared
  await anim.tween(0.7, (k) => {
    setModelZ(atk, lerp(0, dist - 0.55, k), 0);
    atk.model.position.x = Math.sin(k * Math.PI * 3) * 0.12;
    p.hood.scale.set(1 + k * 0.6, 1 + k * 0.3, 1);
  });
  atk.model.position.x = 0;
  // coils spiral up around the victim
  const coilMat = new THREE.MeshStandardMaterial({ color: 0x4f8f3a, roughness: 0.5, flatShading: true });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x2c5a20, roughness: 0.5, flatShading: true });
  const coils = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.065, 8, 28), i % 2 ? bandMat : coilMat);
    m.rotation.x = Math.PI / 2;
    m.position.copy(ctx.V).setY(BOARD_Y + 0.1 + i * 0.17);
    m.scale.setScalar(0.01);
    m.castShadow = true;
    world.transient.add(m);
    coils.push(m);
  }
  sfx.play('hiss');
  for (const [i, m] of coils.entries()) {
    await anim.tween(0.18, (k) => {
      m.scale.setScalar(Ease.outBack(k));
      m.rotation.z = k * 3;
    });
    sfx.play('pinch', { delay: i * 0.02 });
  }
  // squeeze
  sfx.play('creak');
  await anim.tween(0.8, (k) => {
    const s = 1 - 0.38 * Ease.inOutQuad(k);
    coils.forEach((m, i) => {
      m.scale.set(s, s, 1 + Math.sin(k * 30 + i) * 0.05);
      m.rotation.z += 0.05;
    });
    vic.model.scale.set(1 - 0.35 * k, 1 + 0.3 * k, 1 - 0.35 * k);
    vic.model.rotation.y = Math.sin(k * 40) * 0.15;
  });
  // strike!
  const neckRest = p.neck.map((seg) => seg.rotation.x);
  await anim.tween(0.2, (k) => {
    p.neck.forEach((seg, i) => (seg.rotation.x = lerp(neckRest[i], -0.3, k)));
    p.head.rotation.x = -0.5 * k;
    p.jaw.rotation.x = 0.9 * k;
  });
  sfx.play('bite');
  await anim.tween(0.14, (k) => {
    p.neck.forEach((seg) => (seg.rotation.x = lerp(-0.3, 0.45, k)));
    p.head.rotation.x = lerp(-0.5, 0.5, k);
    setModelZ(atk, dist - 0.55 + 0.2 * k, 0);
  }, Ease.inQuad);
  fx.flash(vicCenter(ctx, 0.6), { color: 0x66ff44, size: 1.6 });
  fx.text(vicCenter(ctx, 1.3), 'VENOM!', { color: '#7dff4d', stroke: '#0d2a05' });
  sfx.play('hiss');
  // poison spreads
  await anim.tween(0.7, (k) => {
    vic.tint(0x44ff22, 0.75 * k, 0.4 * k);
    vic.model.rotation.z = Math.sin(k * 50) * 0.12;
    p.jaw.rotation.x = 0.9 * (1 - k);
    if (Math.random() < 0.4) fx.burst(vicCenter(ctx, rand(0.2, 0.7)), { count: 1, colors: [0x66ff44, 0xb6ff8a], shape: 'sphere', speed: 0.3, up: 0.8, gravity: -1, size: [0.03, 0.06], life: [0.5, 0.9], floor: false });
  });
  fx.burst(vicCenter(ctx, 0.4), { count: 30, colors: [0x66ff44, 0x2c8a1a, 0xb6ff8a], shape: 'sphere', speed: 3, up: 2, size: [0.04, 0.08] });
  await rip(ctx, { power: 3.2, up: 2.2, word: 'CRUSHED!', wordColor: '#7dff4d', flashColor: 0x88ff66 });
  await anim.tween(0.4, (k) => {
    coils.forEach((m) => {
      m.scale.setScalar(0.62 * (1 - k));
      m.position.y -= 0.004;
    });
    p.neck.forEach((seg, i) => (seg.rotation.x = lerp(0.45, neckRest[i], k)));
    p.head.rotation.x = lerp(0.5, -0.1, k);
    setModelZ(atk, lerp(dist - 0.35, dist, k), 0);
    p.hood.scale.set(1.6 - 0.6 * k, 1.3 - 0.3 * k, 1);
  });
  for (const m of coils) {
    m.removeFromParent();
    m.geometry.dispose();
  }
  coilMat.dispose();
  bandMat.dispose();
}

// ------------------------------------------------------------------ SHARK: Deep Strike
async function shark(ctx) {
  const { anim, atk, vic, fx, sfx, dist, world } = ctx;
  const p = atk.parts;
  // dive into its own puddle
  sfx.play('splash');
  fx.burst(ctx.A.clone().setY(BOARD_Y + 0.15), { count: 18, colors: [0x2a86d8, 0x8fd3ff, 0xffffff], shape: 'sphere', speed: 1.8, up: 2.5, size: [0.03, 0.06] });
  await anim.tween(0.45, (k) => {
    p.body.rotation.x = 0.9 * k;
    p.body.position.y = 0.19 - k * 0.7;
    p.body.scale.setScalar(1 - k * 0.6);
    p.water.scale.set(0.39 * (1 - k * 0.5), 0.02, 0.39 * (1 - k * 0.5));
  }, Ease.inQuad);
  p.body.visible = false;
  // a whirlpool opens below the victim
  const poolMat = new THREE.MeshStandardMaterial({ color: 0x1e6fc0, transparent: true, opacity: 0.9, roughness: 0.1, metalness: 0.2 });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(0.62, 40), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.copy(ctx.V).setY(BOARD_Y + 0.012);
  pool.scale.setScalar(0.01);
  world.transient.add(pool);
  const swirlStop = anim.every((dt) => {
    pool.rotation.z += dt * 4;
  });
  sfx.play('dunDun');
  const ringLoop = anim.every(() => {
    if (Math.random() < 0.08) fx.ring(ctx.V, { color: 0xbfe6ff, from: 0.15, to: 0.62, duration: 0.6, y: BOARD_Y + 0.02, opacity: 0.7 });
  });
  await anim.tween(0.4, (k) => pool.scale.setScalar(Ease.outBack(k)));
  // fin circles the victim
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 4), new THREE.MeshStandardMaterial({ color: 0x4d6a82, flatShading: true }));
  fin.scale.set(0.3, 1, 1);
  fin.castShadow = true;
  world.transient.add(fin);
  const vicLook = vic.model.rotation.y;
  await anim.tween(1.4, (k) => {
    const a = k * Math.PI * 4;
    const r = 0.52 - k * 0.1;
    fin.position.set(ctx.V.x + Math.cos(a) * r, BOARD_Y + 0.17, ctx.V.z + Math.sin(a) * r);
    fin.rotation.y = -a;
    if (Math.random() < 0.5) {
      fx.burst(fin.position.clone().setY(BOARD_Y + 0.03), { count: 1, colors: [0xffffff, 0xbfe6ff], shape: 'sphere', speed: 0.3, up: 0.3, gravity: 2, size: [0.025, 0.045], life: [0.3, 0.5] });
    }
    vic.model.rotation.y = vicLook + Math.sin(k * 20) * 0.3;
    vic.model.position.x = Math.sin(k * 50) * 0.02;
  });
  fin.removeFromParent();
  fin.geometry.dispose();
  fin.material.dispose();
  vic.model.position.x = 0;
  // ERUPT jaws-first beneath the victim
  setModelZ(atk, dist, -0.7);
  atk.model.rotation.set(-Math.PI / 2, 0, 0);
  p.body.visible = true;
  p.body.position.y = 0.19;
  p.body.rotation.x = 0;
  p.body.scale.setScalar(1.6);
  p.water.visible = false;
  sfx.play('splash');
  sfx.play('roar', { pitch: 0.7 });
  fx.burst(ctx.V.clone().setY(BOARD_Y + 0.2), { count: 40, colors: [0x2a86d8, 0x8fd3ff, 0xffffff], shape: 'sphere', speed: 2.5, up: 5, size: [0.04, 0.08], life: [0.8, 1.4] });
  ctx.world.shake(0.4);
  await anim.tween(0.3, (k) => {
    atk.model.position.y = lerp(-0.7, 0.9, Ease.outQuad(k));
    p.jaw.rotation.x = 1.1 * k;
    vic.root.position.y = BOARD_Y + 0.0 + k * 1.1;
    vic.model.rotation.x = k * 0.6;
  });
  // CHOMP
  await anim.tween(0.1, (k) => (p.jaw.rotation.x = 1.1 * (1 - k)));
  sfx.play('bite');
  await rip(ctx, { power: 2.5, up: 3.5, word: 'CHOMP!', wordColor: '#8fd3ff', stroke: '#002244', shake: 0.5 });
  // flip back down into the water
  await anim.tween(0.55, (k) => {
    atk.model.position.y = 0.07 + arc(k, 0.5) + (1 - k) * 0.83 - k * 0.9;
    atk.model.rotation.x = lerp(-Math.PI / 2, Math.PI * 0.6, k);
  });
  sfx.play('splash');
  fx.burst(ctx.V.clone().setY(BOARD_Y + 0.15), { count: 20, colors: [0x2a86d8, 0x8fd3ff, 0xffffff], shape: 'sphere', speed: 2, up: 3, size: [0.03, 0.06] });
  // resurface calmly on the square
  atk.model.rotation.set(0, 0, 0);
  p.body.scale.setScalar(1);
  p.water.visible = true;
  p.water.scale.set(0.39, 0.02, 0.39);
  setModelZ(atk, dist, -0.5);
  await anim.tween(0.5, (k) => {
    atk.model.position.y = lerp(-0.5, 0.07, Ease.outBack(k));
    pool.scale.setScalar(1 - k);
  });
  swirlStop();
  ringLoop();
  pool.removeFromParent();
  pool.geometry.dispose();
  poolMat.dispose();
  vic.root.position.y = BOARD_Y;
}

// ------------------------------------------------------------------ GORILLA: Ground Pound
async function gorilla(ctx) {
  const { anim, atk, vic, fx, sfx, dist } = ctx;
  const p = atk.parts;
  // chest pounding
  for (let i = 0; i < 4; i++) {
    const arm = i % 2 ? p.armR : p.armL;
    sfx.play('drum');
    await anim.tween(0.17, (k) => {
      const s = Math.sin(k * Math.PI);
      arm.rotation.x = -1.3 * s;
      arm.rotation.z = (i % 2 ? 0.9 : -0.9) * s;
      p.head.rotation.x = -0.3 * s;
      p.jaw.rotation.x = 0.5 * s;
    });
  }
  sfx.play('roar', { pitch: 0.75 });
  // leap to the victim and grab it
  await anim.tween(0.35, (k) => {
    setModelZ(atk, lerp(0, dist - 0.45, k), arc(k, 0.5));
    p.armL.rotation.x = p.armR.rotation.x = -1.6 * k;
  });
  ctx.world.shake(0.15);
  // hoist overhead (victim parented to the gorilla)
  const vicStart = vic.root.position.clone();
  const overhead = new THREE.Vector3();
  atk.model.localToWorld(overhead.set(0, 1.05, 0.05));
  await anim.tween(0.4, (k) => {
    vic.root.position.lerpVectors(vicStart, overhead, Ease.outQuad(k));
    vic.root.position.y += arc(k, 0.3);
    p.armL.rotation.x = p.armR.rotation.x = lerp(-1.6, -3.0, k);
    vic.model.rotation.z = k * Math.PI * 0.9;
  });
  const ground = vicStart.clone();
  // two brutal slams in front
  for (let i = 0; i < 2; i++) {
    const front = ctx.V.clone().addScaledVector(ctx.dir, 0.15);
    front.y = BOARD_Y;
    await anim.tween(0.18, (k) => {
      vic.root.position.lerpVectors(overhead, front, Ease.inQuad(k));
      p.armL.rotation.x = p.armR.rotation.x = lerp(-3.0, -1.2, k);
      atk.model.rotation.x = 0.35 * k;
    });
    sfx.play('thud', { power: 1 });
    fx.dust(front.clone(), 14);
    fx.ring(front, { color: 0xffffff, to: 1.6, duration: 0.35 });
    ctx.world.shake(0.4);
    vic.model.scale.set(1 + 0.2 * (i + 1), 1 - 0.2 * (i + 1), 1 + 0.2 * (i + 1));
    if (i === 0) {
      fx.text(vicCenter(ctx, 1.2), 'WHAM!', { color: '#ffb84d', hold: 0.25 });
      await anim.tween(0.25, (k) => {
        vic.root.position.lerpVectors(front, overhead, Ease.outQuad(k));
        p.armL.rotation.x = p.armR.rotation.x = lerp(-1.2, -3.0, k);
        atk.model.rotation.x = 0.35 * (1 - k);
      });
    }
  }
  sfx.play('boom');
  vic.root.position.copy(ground);
  await rip(ctx, { power: 3.5, up: 2.4, word: 'SMASH!', shake: 0.6 });
  sfx.play('drum');
  sfx.play('drum', { delay: 0.15 });
  await anim.tween(0.5, (k) => {
    atk.model.rotation.x = 0.35 * (1 - k);
    p.armL.rotation.x = p.armR.rotation.x = lerp(-1.2, 0.1, k);
    setModelZ(atk, lerp(dist - 0.45, dist, k), arc(k, 0.2));
  });
}

// ------------------------------------------------------------------ RHINO: Stampede
async function rhino(ctx) {
  const { anim, atk, vic, fx, sfx, dist } = ctx;
  const p = atk.parts;
  // back up and paw the ground
  await anim.tween(0.4, (k) => setModelZ(atk, -0.9 * Ease.outQuad(k), 0));
  for (let i = 0; i < 3; i++) {
    sfx.play('snort');
    const nose = new THREE.Vector3(0, 0.35, 0.55);
    atk.model.localToWorld(nose);
    fx.burst(nose, { count: 6, colors: [0xffffff, 0xdddddd], shape: 'sphere', speed: 0.6, up: 0.4, gravity: -0.6, size: [0.03, 0.06], life: [0.4, 0.7], drag: 2, grow: 1.5 });
    await anim.tween(0.25, (k) => {
      p.legFL.rotation.x = -0.7 * Math.sin(k * Math.PI);
      p.head.rotation.x = 0.3 * Math.sin(k * Math.PI);
    });
    const foot = new THREE.Vector3(0.1, 0.05, 0.25);
    atk.model.localToWorld(foot);
    fx.dust(foot, 6);
  }
  // CHARGE
  sfx.play('roar', { pitch: 0.6 });
  const total = dist + 0.9 - 0.3;
  let lastDust = 0;
  await anim.tween(0.42, (k, raw) => {
    setModelZ(atk, -0.9 + total * k, Math.abs(Math.sin(raw * 30)) * 0.05);
    p.head.rotation.x = 0.35;
    const gait = Math.sin(raw * 40);
    p.legFL.rotation.x = p.legBR.rotation.x = gait * 0.7;
    p.legFR.rotation.x = p.legBL.rotation.x = -gait * 0.7;
    if (raw - lastDust > 0.15) {
      lastDust = raw;
      const foot = new THREE.Vector3(0, 0.05, -0.2);
      atk.model.localToWorld(foot);
      fx.dust(foot, 5);
    }
  }, Ease.inQuad);
  // GORE: launch the victim into orbit
  sfx.play('thud', { power: 1 });
  ctx.world.shake(0.5);
  fx.flash(vicCenter(ctx, 0.4), { size: 1.8 });
  fx.text(vicCenter(ctx, 1.2), 'GORED!', { color: '#ffd04d', hold: 0.3 });
  sfx.play('whoosh', { dur: 0.8 });
  const v0 = vic.root.position.clone();
  const apex = ctx.V.clone().addScaledVector(ctx.dir, 0.6).setY(BOARD_Y + 2.5);
  await anim.tween(0.85, (k) => {
    p.head.rotation.x = lerp(0.35, -0.7, Math.min(1, k * 3));
    vic.root.position.lerpVectors(v0, apex, Ease.outQuad(k));
    vic.model.rotation.x = k * Math.PI * 5;
    vic.model.rotation.z = k * Math.PI * 3;
    p.legFL.rotation.x = p.legBR.rotation.x = p.legFR.rotation.x = p.legBL.rotation.x = 0;
  });
  // explodes up high
  sfx.play('boom');
  fx.sparks(apex.clone().setY(apex.y + 0.3), 0xffd34d, 30, 5);
  await rip(ctx, { power: 2.6, up: 1, burst: 1.4, word: 'BOOM!', wordColor: '#ff8a3d', shake: 0.3 });
  await anim.tween(0.5, (k) => {
    p.head.rotation.x = -0.7 * (1 - k);
    setModelZ(atk, lerp(dist - 0.3, dist, k), 0);
  });
  vic.root.position.copy(v0);
}

// ------------------------------------------------------------------ SCORPION: Death Sting
async function scorpion(ctx) {
  const { anim, atk, vic, fx, sfx, dist } = ctx;
  const p = atk.parts;
  // scuttle in with clacking claws
  await anim.tween(0.6, (k, raw) => {
    setModelZ(atk, lerp(0, dist - 0.62, k), 0);
    p.legs.forEach((leg, i) => (leg.rotation.x = Math.sin(raw * 40 + i * 1.3) * 0.35));
    p.fingerL.rotation.y = 0.15 + Math.abs(Math.sin(raw * 18)) * 0.6;
    p.fingerR.rotation.y = -0.15 - Math.abs(Math.sin(raw * 18)) * 0.6;
  });
  for (let i = 0; i < 3; i++) sfx.play('pinch', { delay: i * 0.1 });
  // raise and open the claws
  await anim.tween(0.3, (k) => {
    p.clawL.rotation.x = p.clawR.rotation.x = -0.5 * k;
    p.fingerL.rotation.y = 0.7 * k;
    p.fingerR.rotation.y = -0.7 * k;
    p.tail[0].rotation.x = 1.1 + 0.3 * k;
  });
  // pinch the victim
  sfx.play('pinch');
  sfx.play('bite');
  await anim.tween(0.15, (k) => {
    p.clawL.rotation.x = p.clawR.rotation.x = lerp(-0.5, 0.15, k);
    p.clawL.rotation.y = -0.25 * k;
    p.clawR.rotation.y = 0.25 * k;
    p.fingerL.rotation.y = lerp(0.7, -0.05, k);
    p.fingerR.rotation.y = lerp(-0.7, 0.05, k);
  });
  ctx.world.shake(0.15);
  await anim.tween(0.2, (k) => {
    vic.model.position.y = 0.07 + k * 0.12;
    vic.model.scale.set(1 - 0.2 * k, 1 + 0.1 * k, 1);
  });
  // repeated stings, the victim swells with venom
  for (let i = 0; i < 3; i++) {
    await anim.tween(0.16, (k) => {
      p.tail.forEach((seg, j) => (seg.rotation.x = (j === 0 ? 1.4 : 0.5) + 0.25 * k));
    });
    sfx.play('sting');
    fx.flash(vicCenter(ctx, 0.75), { color: 0xc04dff, size: 1.2, duration: 0.25 });
    fx.burst(vicCenter(ctx, 0.75), { count: 8, colors: [0xc04dff, 0x7a1fd0], glow: true, speed: 1.6, up: 1, size: [0.02, 0.04], life: [0.3, 0.6] });
    ctx.world.shake(0.12);
    const sw = 1 + 0.18 * (i + 1);
    await anim.tween(0.2, (k) => {
      p.tail.forEach((seg, j) => (seg.rotation.x = (j === 0 ? 1.4 : 0.5) + 0.25 * (1 - k)));
      vic.tint(0xa53cff, 0.25 * (i + k), 0.15 * (i + k));
      vic.model.scale.set(sw * 0.85, sw * 0.95, sw * 0.85);
    });
  }
  fx.text(vicCenter(ctx, 1.4), 'STING!', { color: '#d48aff', stroke: '#2a0040', hold: 0.3 });
  await wobble(ctx, vic, 0.5, 0.25, 45);
  // POP
  sfx.play('pop');
  fx.burst(vicCenter(ctx, 0.5), { count: 30, colors: [0xa53cff, 0x5a10a0, 0xe0b0ff], shape: 'sphere', speed: 3.5, up: 2, size: [0.04, 0.08] });
  await rip(ctx, { power: 3.8, up: 2.4, word: 'POP!', wordColor: '#d48aff', flashColor: 0xd48aff });
  await anim.tween(0.45, (k) => {
    p.clawL.rotation.x = p.clawR.rotation.x = lerp(0.15, -0.6, Math.sin(k * Math.PI));
    p.clawL.rotation.y = -0.25 * (1 - k);
    p.clawR.rotation.y = 0.25 * (1 - k);
    p.tail[0].rotation.x = lerp(1.4, 1.1, k);
    setModelZ(atk, lerp(dist - 0.62, dist, k), 0);
  });
}

// ------------------------------------------------------------------ CROCODILE: Death Roll
async function crocodile(ctx) {
  const { anim, atk, vic, fx, sfx, dist } = ctx;
  const p = atk.parts;
  // creep with jaws slowly opening
  sfx.play('creak');
  await anim.tween(0.8, (k, raw) => {
    setModelZ(atk, lerp(0, dist - 0.75, k), 0);
    p.jaw.rotation.x = 0.9 * k;
    p.head.rotation.x = -0.3 * k;
    p.legs.forEach((leg, i) => (leg.rotation.y = Math.sin(raw * 18 + i * 1.6) * 0.4));
    p.tail.forEach((seg, i) => (seg.rotation.y = 0.32 + Math.sin(raw * 10 - i) * 0.3));
  });
  // SNAP
  await anim.tween(0.12, (k) => {
    setModelZ(atk, lerp(dist - 0.75, dist - 0.55, k), 0);
    p.jaw.rotation.x = lerp(0.9, 0.15, k);
    p.head.rotation.x = lerp(-0.3, 0, k);
  });
  sfx.play('bite');
  ctx.world.shake(0.3);
  fx.text(vicCenter(ctx, 1.2), 'SNAP!', { color: '#b6ff6a', stroke: '#0c2a00', hold: 0.25 });
  // clamp victim in the jaws
  const vicStart = vic.root.position.clone();
  const jawAnchor = new THREE.Group();
  p.head.add(jawAnchor);
  jawAnchor.position.set(0, 0.0, 0.32);
  jawAnchor.updateMatrixWorld(true);
  const anchorWorld = new THREE.Vector3();
  jawAnchor.getWorldPosition(anchorWorld);
  await anim.tween(0.12, (k) => {
    vic.root.position.lerpVectors(vicStart, anchorWorld.clone().setY(BOARD_Y + 0.02), k);
    vic.model.rotation.x = -0.4 * k;
  });
  jawAnchor.attach(vic.root);
  // DEATH ROLL
  sfx.play('splash');
  sfx.play('roar', { pitch: 0.55 });
  const splashLoop = anim.every(() => {
    if (Math.random() < 0.35) fx.burst(ctx.V.clone().setY(BOARD_Y + 0.15), { count: 3, colors: [0x2a86d8, 0x8fd3ff, 0xffffff], shape: 'sphere', speed: 2.2, up: 1.6, size: [0.03, 0.06], life: [0.4, 0.8] });
  });
  fx.ring(ctx.V, { color: 0x8fd3ff, to: 2.2, duration: 0.6 });
  await anim.tween(1.1, (k) => {
    atk.model.rotation.z = Ease.inOutQuad(k) * Math.PI * 6;
    atk.model.position.y = 0.07 + Math.abs(Math.sin(k * Math.PI * 6)) * 0.12;
    if (Math.random() < 0.1) ctx.world.shake(0.15);
  });
  splashLoop();
  atk.model.rotation.z = 0;
  atk.model.position.y = 0.07;
  // thrash side to side
  await anim.tween(0.45, (k) => {
    p.head.rotation.y = Math.sin(k * Math.PI * 4) * 0.7;
    p.body.rotation.y = -Math.sin(k * Math.PI * 4) * 0.2;
  });
  ctx.world.scene.attach(vic.root);
  p.head.remove(jawAnchor);
  await rip(ctx, { power: 3.6, up: 2, word: 'DEATH ROLL!', wordColor: '#b6ff6a', stroke: '#0c2a00', shake: 0.45 });
  vic.root.position.copy(vicStart);
  await anim.tween(0.45, (k) => {
    p.head.rotation.y = 0;
    p.body.rotation.y = 0;
    p.jaw.rotation.x = 0.15 + 0.5 * Math.sin(k * Math.PI);
    setModelZ(atk, lerp(dist - 0.55, dist, k), 0);
  });
}

export const ATTACKS = { eagle, tiger, wolf, bear, cobra, shark, gorilla, rhino, scorpion, crocodile };

// Camera framing per attacker: airborne attacks need a wider, higher shot.
export const CAMERA_HINTS = {
  eagle: { dist: 4.2, height: 1.4, lift: 1.2 },
  rhino: { dist: 4.6, height: 1.5, lift: 1.25 },
  gorilla: { dist: 3.6, height: 1.7, lift: 0.7 },
  shark: { dist: 3.6, height: 1.8, lift: 0.6 },
  bear: { dist: 3.6, height: 1.8, lift: 0.7 },
  wolf: { dist: 4.0, height: 2.2, lift: 0.4 },
};

// Short victim reaction before the attack lands: it turns to face the threat and trembles.
export async function victimReacts(ctx) {
  const { vic, sfx } = ctx;
  sfx.play('error');
  ctx.fx.text(vicCenter(ctx, 1.05), '!', { color: '#ffffff', stroke: '#c0101a', size: 0.9, hold: 0.2 });
  await wobble(ctx, vic, 0.55, 0.1, 45);
  vic.model.rotation.z = 0;
}

export function makeContext({ world, fx, sfx, atk, vic, A, V }) {
  const dir = V.clone().sub(A).setY(0);
  const dist = Math.max(0.6, dir.length());
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  dir.normalize();
  return { world, anim: world.anim, fx, sfx, atk, vic, A, V, dir, dist };
}
