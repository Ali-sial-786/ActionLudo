import * as THREE from 'three';
import { any, blob, both, cheeks, eyeMaps, kidTexture, smooth } from './texturesKid.js';

// Cute, kid-friendly versions of the ten animals (Kids mode): chibi plush toys with big round heads,
// huge glossy eyes, rosy cheeks, smiles, stubby limbs and soft painted patterns. Nothing sharp.
//
// Contract: buildKidAnimal(id, fallback) returns { model, parts, idle(t) } exactly like the
// realistic builders in animals.js, facing +z, standing on y = 0, about one board square long,
// and exposing the SAME named parts so shared animation code keeps working:
//   eagle:     body, head, jaw, wingL, wingR, tail, talons, setWings(spread, flap)
//   tiger:     body, head, jaw, legFL, legFR, legBL, legBR, tail, tail2
//   wolf/bear: body, head, jaw, legFL, legFR, legBL, legBR, tail
//   rhino:     body, head, legFL, legFR, legBL, legBR, tail
//   gorilla:   body, head, jaw, armL, armR, legL, legR
//   cobra:     body, neck[4], hood, head, jaw, tongue
//   shark:     water (+ userData.noGore), foam, body, jaw, fin, tail
//   scorpion:  body, legs[8], clawL, clawR, fingerL, fingerR, tail[5], stinger
//   crocodile: body, head, jaw, legs[4], tail[4]
// Pivots sit at the joints: legs hang down (-y) from hips / shoulders so rotation.x swings them,
// jaws hinge so rotation.x > 0 opens, heads pivot at the neck.

// ---------------------------------------------------------------- geometry (shared by all tokens)
const geoCache = new Map();
const cached = (key, make) => {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
};
const r3 = (x) => Math.round(x * 1000) / 1000;

// Capsule tapering from radius r1 (sphere centred on the origin) to r2 (centred at y = len),
// joined by the common tangent so the silhouette stays perfectly smooth.
function taperCapsule(r1, r2, len, radial = 24, steps = 8) {
  const a = Math.asin(THREE.MathUtils.clamp((r1 - r2) / len, -0.95, 0.95));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = -Math.PI / 2 + (a + Math.PI / 2) * (i / steps);
    pts.push(new THREE.Vector2(Math.max(0, Math.cos(t) * r1), Math.sin(t) * r1));
  }
  for (let i = 0; i <= steps; i++) {
    const t = a + (Math.PI / 2 - a) * (i / steps);
    pts.push(new THREE.Vector2(Math.max(0, Math.cos(t) * r2), len + Math.sin(t) * r2));
  }
  pts[0].x = 0;
  pts[pts.length - 1].x = 0;
  return new THREE.LatheGeometry(pts, radial);
}

const G = {
  sphere: () => cached('sphere', () => new THREE.SphereGeometry(1, 40, 28)),
  small: () => cached('small', () => new THREE.SphereGeometry(1, 20, 14)),
  // poles along z so painted belly / back patterns wrap the torso
  spine: () =>
    cached('spine', () => {
      const g = new THREE.SphereGeometry(1, 40, 28);
      g.rotateX(Math.PI / 2);
      return g;
    }),
  capsule: (r1, r2, len) => cached(`cap:${r3(r1)}:${r3(r2)}:${r3(len)}`, () => taperCapsule(r3(r1), r3(r2), r3(len))),
  torus: (tube, arc = Math.PI * 2) => cached(`torus:${tube.toFixed(3)}:${arc.toFixed(3)}`, () => new THREE.TorusGeometry(1, tube, 18, 64, arc)),
  cyl: () => cached('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 48)),
};

// ---------------------------------------------------------------- materials (shared by all tokens)
const matCache = new Map();
const memoMat = (key, make) => {
  let m = matCache.get(key);
  if (!m) matCache.set(key, (m = make()));
  return m;
};

// Soft plush fabric: matte with a light velvet sheen on the rims.
function plush(color, map = null, key = '') {
  return memoMat(`plush:${color}:${key}`, () => {
    const c = new THREE.Color(color);
    return new THREE.MeshPhysicalMaterial({
      color: c,
      map,
      roughness: 0.82,
      metalness: 0,
      sheen: 0.55,
      sheenRoughness: 0.5,
      sheenColor: map ? new THREE.Color(0xfff6ea) : new THREE.Color(0xffffff).lerp(c, 0.35),
    });
  });
}
const tex = (key, spec) => plush(0xffffff, kidTexture(key, spec), key);

// Smooth vinyl (beaks, horns, noses, toe nails): a soft clear-coat shine.
function vinyl(color, rough = 0.42) {
  return memoMat(`vinyl:${color}:${rough}`, () => new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25 }));
}
const gloss = (color) => vinyl(color, 0.2);
const flat = (color) => memoMat(`flat:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));

function eyeMat(iris) {
  return memoMat(`eye:${iris}`, () => {
    const { map, emissiveMap } = eyeMaps(iris);
    return new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map,
      emissive: 0xffffff,
      emissiveMap,
      emissiveIntensity: 0.9,
      roughness: 0.16,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
    });
  });
}

const MOUTH = 0xc0475e;
const TONGUE = 0xff8aa0;
const SMILE = 0x4a2a26;
const BLUSH = 0xff8aa2;
const IRIS = 0x3e2616;

// ---------------------------------------------------------------- mesh helpers
const UP = new THREE.Vector3(0, 1, 0);

function add(parent, geo, material, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0], shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...pos);
  m.scale.set(...scale);
  m.rotation.set(rot[0], rot[1], rot[2], rot[3] ?? 'XYZ');
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
const ell = (parent, material, pos, radii, rot) => add(parent, G.sphere(), material, pos, radii, rot);
const bead = (parent, material, pos, radii, rot) => add(parent, G.small(), material, pos, radii, rot, false);
const torso = (parent, material, pos, radii, rot) => add(parent, G.spine(), material, pos, radii, rot);

// Tapered capsule from a to b.
function seg(parent, material, a, b, r1, r2 = r1) {
  const A = new THREE.Vector3(...a);
  const d = new THREE.Vector3(...b).sub(A);
  const m = new THREE.Mesh(G.capsule(r1, r2, Math.max(0.001, d.length())), material);
  m.position.copy(A);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// Capsule along local +y from pos with an explicit rotation and scale (ears, horns, fins).
const nub = (parent, material, pos, r1, r2, len, rot = [0, 0, 0], scale = [1, 1, 1]) => add(parent, G.capsule(r1, r2, len), material, pos, scale, rot);

function pivot(parent, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const g = new THREE.Group();
  g.position.set(...pos);
  g.rotation.set(...rot);
  parent.add(g);
  return g;
}

const mirror = (fn) => {
  fn(1);
  fn(-1);
};

// Point on an ellipsoid (centre c, radii R) at yaw (from +z towards +x) / pitch, pushed `out` along
// the normal, plus the YXZ rotation that turns local +z into that normal (local +y stays up).
function onSurface(c, R, yaw, pitch, out = 0) {
  const d = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  const n = new THREE.Vector3(d[0] / R[0], d[1] / R[1], d[2] / R[2]).normalize();
  const pos = [c[0] + R[0] * d[0] + n.x * out, c[1] + R[1] * d[1] + n.y * out, c[2] + R[2] * d[2] + n.z * out];
  return { pos, rot: [-Math.asin(n.y), Math.atan2(n.x, n.z), 0, 'YXZ'] };
}

// Something stuck onto a surface, facing out (noses, nostrils, cheek fluff...).
function stuck(parent, material, c, R, yaw, pitch, radii, out = 0, shadow = false) {
  const { pos, rot } = onSurface(c, R, yaw, pitch, out);
  return add(parent, radii[0] < 0.02 ? G.small() : G.sphere(), material, pos, radii, rot, shadow);
}

// Big glossy eye set into a head surface; returns its pivot (blinks by squashing scale.y).
function eye(parent, c, R, yaw, pitch, size, eyes, iris = IRIS) {
  const { pos, rot } = onSurface(c, R, yaw, pitch, -size * 0.12);
  const g = pivot(parent, pos);
  g.rotation.set(rot[0], rot[1], 0, 'YXZ');
  add(g, G.sphere(), eyeMat(iris), [0, 0, 0], [size, size * 1.1, size * 0.36], [0, 0, 0], false);
  eyes.push(g);
  return g;
}

// A thin line drawn on an ellipsoid through [yaw, pitch] control points (smiles, gills, brows).
// `key` must be unique per distinct line so the tube geometry can be shared between tokens.
function surfLine(parent, key, c, R, pts, thick = 0.0045, color = SMILE) {
  const ends = [onSurface(c, R, ...pts[0], thick * 0.2).pos, onSurface(c, R, ...pts[pts.length - 1], thick * 0.2).pos];
  const geo = cached(`line:${key}`, () => {
    const v = pts.map(([y, p]) => new THREE.Vector3(...onSurface(c, R, y, p, thick * 0.2).pos));
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(v), 40, thick, 8, false);
  });
  const m = flat(color);
  add(parent, geo, m, [0, 0, 0], [1, 1, 1], [0, 0, 0], false);
  for (const e of ends) bead(parent, m, e, [thick, thick, thick]);
}
const smileLine = (parent, key, c, R, span, pitch, dip, thick) =>
  surfLine(parent, key, c, R, [[-span, pitch], [-span * 0.5, pitch - dip * 0.75], [0, pitch - dip], [span * 0.5, pitch - dip * 0.75], [span, pitch]], thick);

// Blink envelope: mostly 1, dipping to ~0.1 for a quick blink every few seconds (sometimes twice).
function blinkAt(t) {
  const period = 3.7;
  const ph = ((t % period) + period) % period;
  const dip = (x) => (x > 0 && x < 0.17 ? Math.sin((x / 0.17) * Math.PI) : 0);
  let k = dip(ph);
  if (Math.floor(t / period) % 3 === 1) k = Math.max(k, dip(ph - 0.26));
  return 1 - 0.9 * k;
}
function blink(eyes, t) {
  const s = blinkAt(t);
  for (const e of eyes) e.scale.y = s;
}

// Occasional ear flick: 0 most of the time, a quick wiggle every ~5 s.
function flick(t, offset = 0) {
  const ph = (((t + offset) % 5.3) + 5.3) % 5.3;
  return ph < 0.45 ? Math.sin((ph / 0.45) * Math.PI * 3) * (1 - ph / 0.45) : 0;
}
const pulse = (t, period, len) => {
  const ph = ((t % period) + period) % period;
  return ph < len ? Math.sin((ph / len) * Math.PI) : 0;
};

// Breathing: scale a mesh relative to its built size (x, y, z growth factors).
function breathe(mesh, gx, gy = gx, gz = 0) {
  const b = mesh.userData.rest?.scale ?? (mesh.userData.size ??= mesh.scale.clone());
  mesh.scale.set(b.x * (1 + gx), b.y * (1 + gy), b.z * (1 + gz));
}

// ---------------------------------------------------------------- shared chibi quadruped
// Bean torso, four stubby legs on hip / shoulder pivots, a head pivot at the neck and a tail pivot
// at the rump. Returns the torso mesh so idles can make it breathe.
function quad(cfg) {
  const model = new THREE.Group();
  const p = {};
  const body = (p.body = pivot(model));
  const chest = torso(body, cfg.coat, cfg.torsoPos, cfg.torsoR);
  const legs = [
    ['legFL', cfg.legX, cfg.frontZ],
    ['legFR', -cfg.legX, cfg.frontZ],
    ['legBL', cfg.legX, cfg.backZ],
    ['legBR', -cfg.legX, cfg.backZ],
  ];
  for (const [name, x, z] of legs) {
    const leg = (p[name] = pivot(body, [x, cfg.hipY, z]));
    const pr = cfg.pawR;
    const footY = -cfg.hipY + pr * 0.72;
    seg(leg, cfg.limb, [0, 0, 0], [0, footY + pr * 0.35, 0.004], cfg.legR, cfg.legR * 0.92);
    ell(leg, cfg.paw ?? cfg.limb, [0, footY, 0.012], [pr, pr * 0.72, pr * 1.12]);
    if (cfg.toes) for (let k = -1; k <= 1; k++) bead(leg, cfg.toes, [k * pr * 0.5, footY - pr * 0.18, 0.012 + pr * 0.98], [pr * 0.25, pr * 0.22, pr * 0.17]);
  }
  p.head = pivot(body, cfg.neck);
  p.tail = pivot(body, cfg.tailPos);
  return { model, p, body, chest };
}

// Mouth with a jaw. The upper lip (whisker pads / snout) stays on the head; the chin rides the jaw
// pivot at `hinge`, tucked under the lip; mouth and tongue hide inside until the jaw opens.
function mouthJaw(h, { hinge, chin, chinMat, lipY }) {
  const [cx, cy, cz] = chin.pos;
  const [rx, ry, rz] = chin.r;
  const top = lipY ?? cy + ry;
  ell(h, flat(MOUTH), [cx, top - 0.002, cz - rz * 0.25], [rx * 0.92, Math.max(0.012, ry * 0.7), rz * 0.72]);
  const jaw = pivot(h, hinge);
  const local = [cx - hinge[0], cy - hinge[1], cz - hinge[2]];
  ell(jaw, chinMat, local, chin.r);
  ell(jaw, flat(TONGUE), [local[0], local[1] + ry * 0.45, local[2] - rz * 0.15], [rx * 0.62, ry * 0.5, rz * 0.66]);
  return jaw;
}

// ---------------------------------------------------------------- Tiger
function buildTiger() {
  const ORANGE = 0xf4892b;
  const CREAM = 0xfff3df;
  const STRIPE = 0x4f2c1f;
  const stripe = (yaw, pitch, a, b, rot) => blob(yaw, pitch, a, b, rot, 0.75);
  const coat = tex('tigerBody', {
    space: 'spine',
    base: ORANGE,
    layers: [
      { color: CREAM, mask: (x, y) => smooth(-0.25, -0.55, y) },
      {
        color: STRIPE,
        mask: (x, y, z) => {
          if (z > 0.62 || z < -0.85) return 0;
          const s = z * 3.3 + Math.sin(Math.abs(x) * 5) * 0.12;
          const f = Math.abs((((s % 1) + 1) % 1) - 0.5);
          const w = 0.13 * smooth(-0.35, 0.5, y);
          return (1 - smooth(w * 0.55, w, f)) * smooth(-0.3, 0.05, y);
        },
        alpha: 0.85,
      },
    ],
  });
  const R = [0.166, 0.146, 0.148];
  const C = [0, 0.12, 0.05];
  const head = tex('tigerHead', {
    base: ORANGE,
    w: 512,
    h: 256,
    layers: [
      { color: CREAM, mask: blob(0, -0.5, 0.78, 0.42, 0, 0.55) },
      { color: CREAM, mask: both(blob(0.36, 0.4, 0.09, 0.065, 0, 0.8)) },
      { color: STRIPE, mask: stripe(0, 0.95, 0.05, 0.24, 0), alpha: 0.85 },
      { color: STRIPE, mask: both(stripe(0.2, 0.78, 0.04, 0.17, -0.35)), alpha: 0.85 },
      { color: STRIPE, mask: both(any(stripe(1.3, 0.12, 0.26, 0.04, -0.15), stripe(1.42, -0.16, 0.24, 0.04, 0.12))), alpha: 0.85 },
      { color: STRIPE, mask: both(stripe(2.4, 0.5, 0.05, 0.25, 0.3)), alpha: 0.75 },
      { color: BLUSH, mask: cheeks(0.64, -0.3, 0.15), alpha: 0.8 },
    ],
  });
  const { model, p, chest } = quad({
    coat,
    limb: plush(ORANGE),
    paw: plush(CREAM),
    toes: plush(0xf8e6cc),
    torsoPos: [0, 0.205, -0.04],
    torsoR: [0.13, 0.118, 0.175],
    legX: 0.075,
    frontZ: 0.06,
    backZ: -0.14,
    hipY: 0.17,
    legR: 0.044,
    pawR: 0.05,
    neck: [0, 0.3, 0.1],
    tailPos: [0, 0.27, -0.19],
  });
  const h = p.head;
  ell(h, head, C, R);
  const eyes = [];
  mirror((s) => eye(h, C, R, s * 0.37, -0.02, 0.05, eyes));
  const ears = [];
  mirror((s) => {
    const e = pivot(h, [s * 0.1, C[1] + 0.105, C[2] - 0.02], [0, 0, -s * 0.42]);
    nub(e, plush(ORANGE), [0, 0, 0], 0.046, 0.018, 0.045, [0, 0, 0], [1, 1, 0.5]);
    nub(e, plush(0xffb3c0), [0, 0.006, 0.012], 0.03, 0.011, 0.035, [0, 0, 0], [1, 1, 0.3]);
    ears.push(e);
  });
  // whisker pads, pink nose, little "w" mouth
  const pad = [0.037, 0.03, 0.03];
  const m = [0, C[1] - 0.06, C[2] + 0.12];
  mirror((s) => ell(h, plush(CREAM), [s * 0.026, m[1], m[2]], pad));
  ell(h, gloss(0xff7b98), [0, m[1] + 0.03, m[2] + 0.024], [0.023, 0.015, 0.013]);
  mirror((s) =>
    surfLine(h, `tigerMouth${s}`, [s * 0.026, m[1], m[2]], pad, [[-s * 0.95, -0.15], [-s * 0.45, -0.6], [s * 0.1, -0.72], [s * 0.6, -0.42]], 0.0042),
  );
  p.jaw = mouthJaw(h, { hinge: [0, m[1] - 0.02, m[2] - 0.05], chin: { pos: [0, m[1] - 0.045, m[2] - 0.006], r: [0.034, 0.021, 0.031] }, chinMat: plush(CREAM), lipY: m[1] - 0.026 });

  // tail curls up behind, ringed, with a dark tip
  const ring = (v) => (v > 0.84 ? 1 : 1 - smooth(0.05, 0.08, Math.abs(((v * 3.2) % 1) - 0.5)));
  const tailMat = tex('tigerTail', { space: 'uv', base: ORANGE, layers: [{ color: STRIPE, mask: (x, y, z, u, v) => ring(v), alpha: 0.9 }] });
  seg(p.tail, tailMat, [0, 0, 0], [0, 0.03, -0.12], 0.034, 0.032);
  p.tail2 = pivot(p.tail, [0, 0.03, -0.12]);
  seg(p.tail2, tailMat, [0, 0, 0], [0, 0.11, -0.03], 0.032, 0.036);

  const idle = (t) => {
    blink(eyes, t);
    p.tail.rotation.y = Math.sin(t * 1.3) * 0.35;
    p.tail2.rotation.x = Math.sin(t * 2.1) * 0.25;
    p.head.rotation.y = Math.sin(t * 0.45) * 0.25;
    p.head.rotation.z = Math.sin(t * 0.7) * 0.07;
    p.head.rotation.x = Math.sin(t * 1.6) * 0.03;
    breathe(chest, Math.sin(t * 2.2) * 0.015, Math.sin(t * 2.2) * 0.02);
    ears.forEach((e, i) => (e.rotation.z = (i ? 0.42 : -0.42) + flick(t, i * 2.1) * 0.25));
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Wolf
function buildWolf() {
  const GREY = 0x8f9bb2;
  const DARK = 0x6b7791;
  const CREAM = 0xf8f2e8;
  const coat = tex('wolfBody', {
    space: 'spine',
    base: GREY,
    layers: [
      { color: DARK, mask: (x, y) => smooth(0.4, 0.9, y) },
      { color: CREAM, mask: (x, y, z) => Math.max(smooth(-0.15, -0.5, y), smooth(0.55, 0.85, z) * smooth(0.3, -0.1, y)) },
    ],
  });
  const R = [0.16, 0.143, 0.146];
  const C = [0, 0.12, 0.05];
  const head = tex('wolfHead', {
    base: GREY,
    w: 512,
    h: 256,
    layers: [
      { color: DARK, mask: (x, y) => smooth(0.5, 0.95, y) * 0.85 },
      { color: CREAM, mask: blob(0, -0.48, 0.8, 0.46, 0, 0.5) },
      { color: CREAM, mask: both(blob(0.34, 0.38, 0.1, 0.075, 0.2, 0.8)) },
      { color: CREAM, mask: both(blob(1.15, -0.25, 0.4, 0.3, 0.3, 0.6)) },
      { color: BLUSH, mask: cheeks(0.66, -0.3, 0.14), alpha: 0.75 },
    ],
  });
  const { model, p, body, chest } = quad({
    coat,
    limb: plush(GREY),
    paw: plush(CREAM),
    toes: plush(0xe9e3d8),
    torsoPos: [0, 0.21, -0.045],
    torsoR: [0.125, 0.115, 0.178],
    legX: 0.072,
    frontZ: 0.06,
    backZ: -0.145,
    hipY: 0.17,
    legR: 0.041,
    pawR: 0.047,
    neck: [0, 0.3, 0.1],
    tailPos: [0, 0.27, -0.2],
  });
  ell(body, plush(CREAM), [0, 0.25, 0.09], [0.085, 0.08, 0.055]);
  const h = p.head;
  ell(h, head, C, R);
  mirror((s) => stuck(h, plush(CREAM), C, R, s * 1.1, -0.36, [0.055, 0.05, 0.04], -0.028, true));
  const eyes = [];
  mirror((s) => eye(h, C, R, s * 0.37, 0.0, 0.049, eyes, 0x3a2a20));
  const ears = [];
  mirror((s) => {
    const e = pivot(h, [s * 0.092, C[1] + 0.1, C[2] - 0.03], [0, 0, -s * 0.3]);
    nub(e, plush(GREY), [0, 0, 0], 0.047, 0.014, 0.078, [0, 0, 0], [1, 1, 0.5]);
    nub(e, plush(0xf6d2d4), [0, 0.008, 0.013], 0.031, 0.009, 0.06, [0, 0, 0], [1, 1, 0.3]);
    ears.push(e);
  });
  // short rounded snout with a shiny button nose
  const SR = [0.066, 0.05, 0.062];
  const m = [0, C[1] - 0.048, C[2] + 0.118];
  ell(h, plush(CREAM), m, SR);
  stuck(h, gloss(0x2a2630), m, SR, 0, 0.5, [0.027, 0.019, 0.017], -0.004, false);
  surfLine(h, 'wolfMouth', m, SR, [[-0.75, -0.3], [-0.38, -0.55], [0, -0.42], [0.38, -0.55], [0.75, -0.3]], 0.0042);
  surfLine(h, 'wolfPhiltrum', m, SR, [[0, 0.28], [0, -0.1], [0, -0.42]], 0.0035);
  p.jaw = mouthJaw(h, { hinge: [0, m[1] - 0.02, m[2] - 0.05], chin: { pos: [0, m[1] - 0.045, m[2] + 0.002], r: [0.048, 0.022, 0.044] }, chinMat: plush(CREAM), lipY: m[1] - 0.034 });

  const tailMat = tex('wolfTail', {
    space: 'uv',
    base: GREY,
    layers: [
      { color: DARK, mask: (x, y, z, u, v) => smooth(0.2, 0.55, v) * (1 - smooth(0.6, 0.75, v)) * 0.6 },
      { color: CREAM, mask: (x, y, z, u, v) => smooth(0.7, 0.8, v) },
    ],
  });
  seg(p.tail, tailMat, [0, 0, 0], [0, 0.1, -0.12], 0.038, 0.06);

  const idle = (t) => {
    blink(eyes, t + 0.7);
    const wag = 0.5 + 0.5 * Math.sin(t * 0.4);
    p.tail.rotation.y = Math.sin(t * 7) * 0.4 * wag;
    p.tail.rotation.x = Math.sin(t * 0.9) * 0.08;
    p.head.rotation.y = Math.sin(t * 0.5) * 0.25;
    p.head.rotation.z = Math.sin(t * 0.8 + 1) * 0.09;
    p.head.rotation.x = Math.sin(t * 1.7) * 0.03;
    breathe(chest, Math.sin(t * 2.4) * 0.015, Math.sin(t * 2.4) * 0.02);
    ears.forEach((e, i) => (e.rotation.z = (i ? 0.3 : -0.3) + flick(t, 1 + i * 2.5) * 0.22));
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Bear
function buildBear() {
  const BROWN = 0xa9693c;
  const TAN = 0xf0cfa3;
  const coat = tex('bearBody', {
    space: 'spine',
    base: BROWN,
    layers: [
      { color: 0x95592f, mask: (x, y) => smooth(0.45, 0.95, y) * 0.7 },
      { color: TAN, mask: blob(0, -0.62, 0.5, 0.62, 0, 0.45) },
    ],
  });
  const R = [0.17, 0.153, 0.152];
  const C = [0, 0.12, 0.045];
  const head = tex('bearHead', {
    base: BROWN,
    w: 512,
    h: 256,
    layers: [
      { color: 0xc08452, mask: blob(0, -0.3, 0.6, 0.45, 0, 0.7), alpha: 0.6 },
      { color: BLUSH, mask: cheeks(0.66, -0.28, 0.15), alpha: 0.75 },
    ],
  });
  const { model, p, chest } = quad({
    coat,
    limb: plush(BROWN),
    paw: plush(0x96592f),
    toes: plush(TAN),
    torsoPos: [0, 0.215, -0.04],
    torsoR: [0.145, 0.132, 0.17],
    legX: 0.085,
    frontZ: 0.055,
    backZ: -0.135,
    hipY: 0.17,
    legR: 0.05,
    pawR: 0.055,
    neck: [0, 0.31, 0.1],
    tailPos: [0, 0.22, -0.2],
  });
  const h = p.head;
  ell(h, head, C, R);
  const eyes = [];
  mirror((s) => eye(h, C, R, s * 0.36, 0.0, 0.047, eyes, 0x33200f));
  const ears = [];
  mirror((s) => {
    const e = pivot(h, [s * 0.115, C[1] + 0.105, C[2] - 0.02], [0, 0, -s * 0.35]);
    ell(e, plush(BROWN), [0, 0, 0], [0.052, 0.05, 0.03]);
    ell(e, plush(TAN), [0, 0.0, 0.014], [0.032, 0.031, 0.016]);
    ears.push(e);
  });
  // big round teddy muzzle, button nose, smile
  const SR = [0.075, 0.058, 0.06];
  const m = [0, C[1] - 0.05, C[2] + 0.115];
  ell(h, plush(TAN), m, SR);
  stuck(h, gloss(0x3a2218), m, SR, 0, 0.42, [0.031, 0.021, 0.019], -0.006, false);
  surfLine(h, 'bearPhiltrum', m, SR, [[0, 0.2], [0, -0.12], [0, -0.38]], 0.0042);
  surfLine(h, 'bearMouth', m, SR, [[-0.6, -0.22], [-0.3, -0.48], [0, -0.38], [0.3, -0.48], [0.6, -0.22]], 0.0045);
  p.jaw = mouthJaw(h, { hinge: [0, m[1] - 0.025, m[2] - 0.05], chin: { pos: [0, m[1] - 0.05, m[2] - 0.002], r: [0.052, 0.024, 0.045] }, chinMat: plush(TAN), lipY: m[1] - 0.04 });
  ell(p.tail, plush(BROWN), [0, 0, -0.01], [0.042, 0.042, 0.04]);

  const idle = (t) => {
    blink(eyes, t + 1.3);
    p.head.rotation.x = Math.sin(t * 1.2) * 0.05;
    p.head.rotation.y = Math.sin(t * 0.4) * 0.2;
    p.head.rotation.z = Math.sin(t * 0.6) * 0.1;
    breathe(chest, Math.sin(t * 1.8) * 0.02, Math.sin(t * 1.8) * 0.025);
    p.tail.rotation.y = Math.sin(t * 3) * 0.3;
    ears.forEach((e, i) => (e.rotation.z = (i ? 0.35 : -0.35) + flick(t, 2 + i * 1.7) * 0.2));
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Rhino
function buildRhino() {
  const GREY = 0xa3adbd;
  const LIGHT = 0xc6cdd8;
  const HORN = 0xf4e6c8;
  const coat = tex('rhinoBody', {
    space: 'spine',
    base: GREY,
    layers: [
      { color: 0x929cad, mask: (x, y) => smooth(0.45, 0.95, y) * 0.8 },
      { color: LIGHT, mask: (x, y) => smooth(-0.2, -0.6, y) },
    ],
  });
  const R = [0.15, 0.13, 0.142];
  const C = [0, 0.085, 0.06];
  const head = tex('rhinoHead', {
    base: GREY,
    w: 512,
    h: 256,
    layers: [
      { color: 0x929cad, mask: (x, y) => smooth(0.5, 0.95, y) * 0.7 },
      { color: BLUSH, mask: cheeks(0.82, -0.3, 0.15), alpha: 0.75 },
    ],
  });
  const { model, p, chest } = quad({
    coat,
    limb: plush(GREY),
    paw: plush(GREY),
    toes: vinyl(HORN),
    torsoPos: [0, 0.22, -0.05],
    torsoR: [0.152, 0.138, 0.19],
    legX: 0.085,
    frontZ: 0.06,
    backZ: -0.16,
    hipY: 0.17,
    legR: 0.053,
    pawR: 0.056,
    neck: [0, 0.28, 0.1],
    tailPos: [0, 0.27, -0.235],
  });
  const h = p.head;
  ell(h, head, C, R);
  // big soft snout with nostrils, a smile and two rounded horns
  const SR = [0.105, 0.085, 0.085];
  const m = [0, C[1] - 0.04, C[2] + 0.1];
  ell(h, plush(LIGHT), m, SR);
  mirror((s) => stuck(h, flat(0x4f4a58), m, SR, s * 0.3, 0.26, [0.008, 0.011, 0.005], -0.002));
  smileLine(h, 'rhinoMouth', m, SR, 0.5, -0.32, 0.16, 0.0048);
  nub(h, vinyl(HORN), [0, m[1] + SR[1] * 0.72, m[2] + 0.035], 0.042, 0.017, 0.07, [0.3, 0, 0]);
  nub(h, vinyl(HORN), [0, C[1] + 0.11, C[2] + 0.06], 0.026, 0.012, 0.03, [0.15, 0, 0]);
  const eyes = [];
  mirror((s) => eye(h, C, R, s * 0.6, 0.14, 0.044, eyes, 0x2f2a33));
  const ears = [];
  mirror((s) => {
    const e = pivot(h, [s * 0.085, C[1] + 0.105, C[2] - 0.045], [0, 0, -s * 0.5]);
    nub(e, plush(GREY), [0, 0, 0], 0.033, 0.016, 0.045, [0, 0, 0], [1, 1, 0.55]);
    nub(e, plush(0xf4c9cf), [0, 0.006, 0.01], 0.021, 0.01, 0.034, [0, 0, 0], [1, 1, 0.3]);
    ears.push(e);
  });
  seg(p.tail, plush(GREY), [0, 0, 0], [0, -0.07, -0.03], 0.014, 0.012);
  ell(p.tail, plush(0x6f6a78), [0, -0.085, -0.035], [0.02, 0.026, 0.02]);

  const idle = (t) => {
    blink(eyes, t + 2.1);
    p.head.rotation.x = Math.sin(t * 0.9) * 0.06;
    p.head.rotation.y = Math.sin(t * 0.35) * 0.18;
    p.head.rotation.z = Math.sin(t * 0.6 + 2) * 0.06;
    p.tail.rotation.z = Math.sin(t * 3.2) * 0.45;
    breathe(chest, Math.sin(t * 1.5) * 0.015, Math.sin(t * 1.5) * 0.02);
    ears.forEach((e, i) => (e.rotation.z = (i ? 0.5 : -0.5) + flick(t, 0.5 + i * 2.2) * 0.3));
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Gorilla
function buildGorilla() {
  const model = new THREE.Group();
  const p = {};
  const FUR = 0x737a89;
  const FACE = 0xdfd0c4;
  const CHEST = 0xa2a8b4;
  const coat = tex('gorillaBody', { base: FUR, layers: [{ color: CHEST, mask: blob(0, 0.0, 0.5, 0.62, 0, 0.5) }] });
  const R = [0.152, 0.145, 0.14];
  const C = [0, 0.12, 0.03];
  const head = tex('gorillaHead', {
    base: FUR,
    w: 512,
    h: 256,
    layers: [
      { color: 0x646a78, mask: (x, y) => smooth(0.55, 0.95, y) },
      // heart-shaped light face: two lobes around the eyes and the muzzle below
      { color: FACE, mask: any(both(blob(0.3, 0.1, 0.36, 0.34, 0, 0.35)), blob(0, -0.3, 0.5, 0.42, 0, 0.4)) },
      { color: BLUSH, mask: cheeks(0.6, -0.26, 0.13), alpha: 0.7 },
    ],
  });
  const body = (p.body = pivot(model));
  const chest = ell(body, coat, [0, 0.225, -0.02], [0.15, 0.15, 0.13]);

  const h = (p.head = pivot(body, [0, 0.36, 0.0]));
  ell(h, head, C, R);
  ell(h, plush(0x646a78), [0, C[1] + 0.112, C[2] - 0.035], [0.058, 0.046, 0.068]);
  const eyes = [];
  mirror((s) => eye(h, C, R, s * 0.3, 0.06, 0.046, eyes, 0x352418));
  mirror((s) => {
    const { pos } = onSurface(C, R, s * 1.5, 0.02, -0.01);
    ell(h, plush(FACE), pos, [0.03, 0.036, 0.022], [0, s * 0.3, 0]);
  });
  const SR = [0.082, 0.058, 0.06];
  const m = [0, C[1] - 0.06, C[2] + 0.105];
  ell(h, plush(FACE), m, SR);
  mirror((s) => stuck(h, flat(0x5b4a46), m, SR, s * 0.2, 0.3, [0.012, 0.009, 0.006], -0.002));
  smileLine(h, 'gorillaMouth', m, SR, 0.55, -0.26, 0.18, 0.0045);
  p.jaw = mouthJaw(h, { hinge: [0, m[1] - 0.025, m[2] - 0.05], chin: { pos: [0, m[1] - 0.048, m[2] - 0.004], r: [0.058, 0.024, 0.046] }, chinMat: plush(FACE), lipY: m[1] - 0.04 });

  mirror((s) => {
    const arm = pivot(body, [s * 0.145, 0.33, 0.0]);
    seg(arm, plush(FUR), [0, 0, 0], [s * 0.03, -0.19, 0.035], 0.052, 0.046);
    ell(arm, plush(FACE), [s * 0.034, -0.245, 0.045], [0.05, 0.043, 0.054]);
    p[s > 0 ? 'armL' : 'armR'] = arm;
    const leg = pivot(body, [s * 0.075, 0.13, -0.03]);
    seg(leg, plush(FUR), [0, 0, 0], [0, -0.075, 0.01], 0.052, 0.046);
    ell(leg, plush(FACE), [0, -0.104, 0.03], [0.047, 0.027, 0.066]);
    p[s > 0 ? 'legL' : 'legR'] = leg;
  });

  const idle = (t) => {
    blink(eyes, t + 0.4);
    const b = Math.sin(t * 1.8);
    breathe(chest, b * 0.02, b * 0.015, b * 0.025);
    p.head.rotation.y = Math.sin(t * 0.45) * 0.3;
    p.head.rotation.z = Math.sin(t * 0.7) * 0.08;
    p.armL.rotation.z = 0.06 + Math.sin(t * 1.0) * 0.05;
    p.armR.rotation.z = -0.06 - Math.sin(t * 1.0) * 0.05;
    p.armL.rotation.x = Math.sin(t * 1.3) * 0.06;
    p.armR.rotation.x = -Math.sin(t * 1.3) * 0.06;
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Eagle
function buildEagle() {
  const model = new THREE.Group();
  const p = {};
  const BROWN = 0x8d5a3b;
  const DARK = 0x6c412a;
  const WHITE = 0xfdfbf6;
  const BEAK = 0xffb62e;
  const FEET = 0xffc845;
  const coat = tex('eagleBody', {
    base: BROWN,
    layers: [
      { color: 0xa9734f, mask: blob(0, -0.15, 0.5, 0.6, 0, 0.5) },
      {
        color: DARK,
        mask: (x, y, z) => {
          // soft feather scallops on the chest
          if (z < 0.2) return 0;
          const row = y * 7;
          const f = Math.abs(((row % 1) + 1) % 1 - 0.5);
          const arc = Math.abs((((x * 6 + Math.floor(row) * 0.5) % 1) + 1) % 1 - 0.5);
          return (1 - smooth(0.05, 0.12, Math.abs(f - arc * 0.5))) * 0.35 * smooth(0.2, 0.6, z);
        },
      },
    ],
  });
  const wingMat = tex('eagleWing', { base: BROWN, layers: [{ color: DARK, mask: (x) => smooth(0.3, 0.9, Math.abs(x)) }] });
  const R = [0.15, 0.142, 0.142];
  const C = [0, 0.125, 0.0];
  const head = tex('eagleHead', {
    base: WHITE,
    w: 512,
    h: 256,
    layers: [
      { color: 0xe9e3d8, mask: (x, y) => smooth(-0.4, -0.9, y) },
      { color: BLUSH, mask: cheeks(0.68, -0.25, 0.14), alpha: 0.7 },
    ],
  });

  const body = (p.body = pivot(model));
  const chest = ell(body, coat, [0, 0.25, -0.01], [0.14, 0.155, 0.135], [0.12, 0, 0]);
  mirror((s) => ell(body, plush(BROWN), [s * 0.06, 0.125, 0.02], [0.052, 0.05, 0.052]));

  const h = (p.head = pivot(body, [0, 0.35, 0.04]));
  ell(h, head, C, R);
  for (let k = -1; k <= 1; k++) nub(h, plush(WHITE), [k * 0.025, C[1] + 0.125, C[2] - 0.03], 0.022, 0.012, 0.045, [-0.6, 0, -k * 0.5]);
  const eyes = [];
  mirror((s) => eye(h, C, R, s * 0.4, 0.06, 0.05, eyes, 0x3a2412));
  // short rounded beak: upper beak with a soft hook, lower beak on the jaw
  const b = [0, C[1] - 0.03, C[2] + 0.115];
  seg(h, vinyl(BEAK), b, [0, b[1] - 0.03, b[2] + 0.062], 0.04, 0.013).scale.set(1.15, 1, 0.8);
  ell(h, vinyl(BEAK), [0, b[1] + 0.002, b[2] + 0.004], [0.046, 0.034, 0.03]);
  ell(h, flat(MOUTH), [0, b[1] - 0.03, b[2] + 0.0], [0.034, 0.012, 0.03]);
  p.jaw = pivot(h, [0, b[1] - 0.028, b[2] - 0.02]);
  ell(p.jaw, vinyl(0xffcb62), [0, -0.004, 0.042], [0.032, 0.013, 0.036]);

  mirror((s) => {
    const w = pivot(body, [s * 0.115, 0.34, -0.02]);
    ell(w, wingMat, [s * 0.1, 0, -0.005], [0.115, 0.03, 0.095]);
    for (let k = 0; k < 3; k++) ell(w, wingMat, [s * (0.18 + k * 0.012), 0, 0.045 - k * 0.05], [0.07, 0.022, 0.03], [0, s * (0.35 - k * 0.35), 0]);
    p[s > 0 ? 'wingL' : 'wingR'] = w;
  });

  p.tail = pivot(body, [0, 0.17, -0.12]);
  for (let k = -1; k <= 1; k++) ell(p.tail, plush(WHITE), [k * 0.03, -0.025, -0.055], [0.032, 0.013, 0.07], [-0.55, k * 0.3, 0]);

  mirror((s) => seg(body, vinyl(FEET), [s * 0.058, 0.1, 0.025], [s * 0.058, 0.03, 0.04], 0.022, 0.02));
  p.talons = pivot(body, [0, 0.02, 0.045]);
  mirror((s) => {
    for (let k = -1; k <= 1; k++) seg(p.talons, vinyl(FEET), [s * 0.058, 0.0, 0], [s * 0.058 + k * 0.024, -0.005, 0.045 - Math.abs(k) * 0.008], 0.014, 0.013);
    seg(p.talons, vinyl(FEET), [s * 0.058, 0.0, 0], [s * 0.058, -0.004, -0.035], 0.013, 0.012);
  });

  p.setWings = (spread, flap = 0) => {
    for (const [w, s] of [
      [p.wingL, 1],
      [p.wingR, -1],
    ]) {
      w.rotation.set(0, s * 0.3 * (1 - spread), -s * (1.3 * (1 - spread) - 0.15 * spread - flap));
    }
  };
  p.setWings(0);

  const idle = (t) => {
    blink(eyes, t + 1.7);
    p.head.rotation.y = Math.sin(t * 0.6) * 0.35;
    p.head.rotation.z = Math.sin(t * 0.9) * 0.1;
    p.head.rotation.x = Math.sin(t * 1.4) * 0.04;
    breathe(chest, Math.sin(t * 2) * 0.012, Math.sin(t * 2) * 0.015);
    p.tail.rotation.y = Math.sin(t * 2.6) * 0.15;
    // every so often a happy little flap
    const f = pulse(t, 6.5, 0.9);
    p.setWings(f * 0.55, Math.sin(t * 18) * 0.25 * f);
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Cobra
function buildCobra() {
  const model = new THREE.Group();
  const p = {};
  const GREEN = 0x62c354;
  const DARK = 0x46a23f;
  const BELLY = 0xf5f2b4;
  const coilMat = tex('cobraCoil', {
    space: 'uv',
    base: GREEN,
    layers: [
      { color: DARK, mask: (x, y, z, u, v) => (1 - smooth(0.08, 0.14, Math.abs(((u * 18) % 1) - 0.5))) * 0.7 },
      { color: 0x8ad66f, mask: (x, y, z, u, v) => (1 - smooth(0.12, 0.2, Math.abs(v - 0.75))) * 0.5 },
    ],
  });
  const neckMat = tex('cobraNeck', {
    space: 'uv',
    base: GREEN,
    layers: [{ color: BELLY, mask: (x, y, z, u) => 1 - smooth(0.11, 0.17, Math.min(u, 1 - u)) }],
  });
  p.body = pivot(model);
  add(p.body, G.torus(0.36), coilMat, [0, 0.056, 0], [0.155, 0.155, 0.155], [Math.PI / 2, 0, 0]);
  add(p.body, G.torus(0.4), coilMat, [0, 0.135, -0.01], [0.11, 0.11, 0.11], [Math.PI / 2, 0, 0.8]);
  seg(p.body, plush(GREEN), [0.12, 0.04, -0.12], [0.2, 0.05, -0.18], 0.04, 0.016);

  p.neck = [];
  let parent = p.body;
  const rest = [-0.12, 0.1, 0.12, 0.05];
  for (let i = 0; i < 4; i++) {
    const s = pivot(parent, i === 0 ? [0, 0.16, 0.06] : [0, 0.075, 0], [rest[i], 0, 0]);
    seg(s, neckMat, [0, 0, 0], [0, 0.075, 0], 0.062 - i * 0.003, 0.059 - i * 0.003);
    p.neck.push(s);
    parent = s;
  }
  const hoodTex = tex('cobraHood', {
    base: GREEN,
    layers: [
      { color: BELLY, mask: blob(0, -0.05, 0.62, 0.74, 0, 0.35) },
      { color: 0x8ad66f, mask: both(blob(0.38, 0.28, 0.13, 0.13, 0, 0.6)) },
    ],
  });
  p.hood = pivot(p.neck[2], [0, 0.04, -0.02]);
  ell(p.hood, hoodTex, [0, 0.045, -0.014], [0.13, 0.14, 0.024]);

  const R = [0.13, 0.108, 0.124];
  const C = [0, 0.06, 0.035];
  const headTex = tex('cobraHead', {
    base: GREEN,
    w: 512,
    h: 256,
    layers: [
      { color: BELLY, mask: (x, y, z) => smooth(-0.3, -0.55, y) * smooth(-0.3, 0.2, z) },
      { color: 0x8ad66f, mask: blob(0, 0.85, 0.3, 0.3, 0, 0.8), alpha: 0.6 },
      { color: BLUSH, mask: cheeks(0.78, -0.22, 0.15), alpha: 0.75 },
    ],
  });
  const h = (p.head = pivot(parent, [0, 0.08, 0], [-0.1, 0, 0]));
  ell(h, headTex, C, R);
  const eyes = [];
  mirror((s) => eye(h, C, R, s * 0.42, 0.14, 0.05, eyes, 0x2c2a12));
  mirror((s) => stuck(h, flat(0x2f6a2a), C, R, s * 0.12, -0.05, [0.006, 0.005, 0.004], -0.001));
  smileLine(h, 'cobraMouth', C, R, 0.62, -0.28, 0.12, 0.0045);
  ell(h, flat(MOUTH), [0, C[1] - 0.055, C[2] + 0.035], [0.08, 0.018, 0.065]);
  p.jaw = pivot(h, [0, C[1] - 0.05, C[2] - 0.03]);
  ell(p.jaw, plush(BELLY), [0, -0.02, 0.075], [0.092, 0.032, 0.076]);
  p.tongue = pivot(h, [0, C[1] - 0.058, C[2] + 0.095]);
  seg(p.tongue, flat(TONGUE), [0, 0, 0], [0, 0, 0.055], 0.008, 0.007);
  mirror((s) => bead(p.tongue, flat(TONGUE), [s * 0.009, 0, 0.064], [0.009, 0.007, 0.009]));
  p.tongue.scale.z = 0.01;

  const idle = (t) => {
    blink(eyes, t + 0.9);
    p.neck.forEach((s, i) => (s.rotation.z = Math.sin(t * 1.3 - i * 0.6) * 0.08));
    p.head.rotation.z = Math.sin(t * 1.3 - 2.4) * 0.1;
    // a quick tongue "blep" now and then
    p.tongue.scale.z = pulse(t, 3.1, 0.5) > 0.25 ? 1 : 0.01;
    p.hood.scale.set(1 + Math.sin(t * 1.1) * 0.05, 1, 1);
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Shark
function buildShark() {
  const model = new THREE.Group();
  const p = {};
  const TOP = 0x6f9ccb;
  const DARK = 0x5b88b8;
  const BELLY = 0xf7fafc;
  const water = add(model, G.cyl(), memoMat('kidWater', () => new THREE.MeshPhysicalMaterial({ color: 0x3aa6e0, transparent: true, opacity: 0.86, roughness: 0.08, metalness: 0, clearcoat: 1 })), [0, 0.012, 0], [0.4, 0.02, 0.4], [0, 0, 0], false);
  water.userData.noGore = true;
  p.water = water;
  const foam = add(model, G.torus(0.12), plush(0xf2fbff), [0, 0.022, 0], [0.39, 0.39, 0.39], [Math.PI / 2, 0, 0], false);
  foam.userData.noGore = true;
  p.foam = foam;

  const bodyTex = tex('sharkBody', {
    space: 'spine',
    base: TOP,
    layers: [
      { color: DARK, mask: (x, y) => smooth(0.5, 0.95, y) * 0.7 },
      { color: BELLY, mask: (x, y, z) => smooth(-0.12, -0.3, y + Math.sin(z * 9) * 0.04) },
    ],
  });
  const R = [0.145, 0.138, 0.14];
  const C = [0, 0.015, 0.1];
  const headTex = tex('sharkHead', {
    base: TOP,
    w: 512,
    h: 256,
    layers: [
      { color: DARK, mask: (x, y) => smooth(0.55, 0.95, y) * 0.7 },
      { color: BELLY, mask: (x, y, z) => smooth(-0.22, -0.38, y - Math.abs(x) * 0.25) },
      { color: DARK, mask: both(any(blob(1.38, -0.02, 0.022, 0.2, 0.1, 0.8), blob(1.55, -0.02, 0.022, 0.18, 0.1, 0.8), blob(1.72, -0.02, 0.022, 0.16, 0.1, 0.8))), alpha: 0.6 },
      { color: BLUSH, mask: cheeks(0.85, -0.2, 0.15), alpha: 0.75 },
    ],
  });
  const b = (p.body = pivot(model, [0, 0.19, 0]));
  const torsoMesh = torso(b, bodyTex, [0, 0, -0.06], [0.135, 0.13, 0.25]);
  ell(b, headTex, C, R);
  const eyes = [];
  mirror((s) => eye(b, C, R, s * 0.52, 0.2, 0.048, eyes, 0x22303e));
  smileLine(b, 'sharkMouth', C, R, 0.78, -0.3, 0.14, 0.005);
  // two little round tooth nubs
  mirror((s) => {
    const { pos, rot } = onSurface(C, R, s * 0.13, -0.42, -0.004);
    add(b, G.small(), vinyl(0xffffff, 0.3), pos, [0.011, 0.013, 0.008], rot, false);
  });
  ell(b, flat(MOUTH), [0, -0.065, 0.16], [0.08, 0.026, 0.06]);
  p.jaw = pivot(b, [0, -0.07, 0.07]);
  ell(p.jaw, plush(BELLY), [0, -0.012, 0.075], [0.098, 0.034, 0.082]);
  ell(p.jaw, flat(TONGUE), [0, 0.012, 0.07], [0.06, 0.014, 0.05]);
  mirror((s) => ell(b, plush(TOP), [s * 0.14, -0.07, 0.03], [0.07, 0.016, 0.042], [0, s * 0.45, -s * 0.55]));
  p.fin = pivot(b, [0, 0.12, -0.05]);
  nub(p.fin, plush(TOP), [0, -0.03, 0.01], 0.065, 0.016, 0.14, [-0.6, 0, 0], [0.32, 1, 1]);
  p.tail = pivot(b, [0, 0, -0.27]);
  ell(p.tail, plush(TOP), [0, 0, -0.025], [0.05, 0.06, 0.07]);
  nub(p.tail, plush(TOP), [0, 0.0, -0.06], 0.046, 0.018, 0.14, [-0.75, 0, 0], [0.3, 1, 1]);
  nub(p.tail, plush(TOP), [0, -0.005, -0.06], 0.038, 0.016, 0.085, [-2.3, 0, 0], [0.3, 1, 1]);

  const idle = (t) => {
    blink(eyes, t + 2.4);
    p.tail.rotation.y = Math.sin(t * 3.2) * 0.32;
    p.body.rotation.y = -Math.sin(t * 3.2) * 0.04;
    p.body.rotation.z = Math.sin(t * 1.6) * 0.05;
    p.body.position.y = 0.19 + Math.sin(t * 2.1) * 0.012;
    p.fin.rotation.z = Math.sin(t * 3.2 + 1) * 0.08;
    breathe(torsoMesh, Math.sin(t * 2.1) * 0.01, Math.sin(t * 2.1) * 0.015);
    p.jaw.rotation.x = pulse(t, 5.5, 1.0) * 0.35;
    p.foam.scale.setScalar(0.39 * (1 + Math.sin(t * 2.4) * 0.025));
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Scorpion
function buildScorpion() {
  const model = new THREE.Group();
  const p = {};
  const RED = 0xdc6a44;
  const DARK = 0xbd5434;
  const LIGHT = 0xf8bf98;
  const GOLD = 0xffc24f;
  const R = [0.13, 0.105, 0.12];
  const C = [0, 0.155, 0.07];
  const headTex = tex('scorpHead', {
    base: RED,
    w: 512,
    h: 256,
    layers: [
      { color: LIGHT, mask: blob(0, -0.42, 0.5, 0.35, 0, 0.6), alpha: 0.85 },
      { color: DARK, mask: (x, y, z) => smooth(0.6, 0.95, y) * 0.6 },
      { color: BLUSH, mask: cheeks(0.66, -0.2, 0.14), alpha: 0.8 },
    ],
  });
  const b = (p.body = pivot(model));
  const chest = ell(b, headTex, C, R);
  const eyes = [];
  mirror((s) => eye(b, C, R, s * 0.36, 0.14, 0.048, eyes, 0x30180e));
  smileLine(b, 'scorpMouth', C, R, 0.38, -0.3, 0.12, 0.0045);
  const segs = [
    [0.112, 0.088, 0.072, -0.045, 0.142],
    [0.096, 0.078, 0.062, -0.11, 0.138],
    [0.078, 0.068, 0.055, -0.168, 0.138],
  ];
  segs.forEach(([rx, ry, rz, z, y], i) => ell(b, plush(i % 2 ? RED : DARK), [0, y, z], [rx, ry, rz]));

  p.legs = [];
  mirror((s) => {
    for (let k = 0; k < 4; k++) {
      const z = 0.07 - k * 0.065;
      const leg = pivot(b, [s * 0.085, 0.12, z]);
      const knee = [s * 0.075, 0.03, (k - 1.5) * 0.02];
      const foot = [s * 0.11, -0.098, (k - 1.5) * 0.035];
      seg(leg, plush(DARK), [0, 0, 0], knee, 0.021, 0.019);
      seg(leg, plush(RED), knee, foot, 0.019, 0.016);
      bead(leg, plush(LIGHT), foot, [0.021, 0.019, 0.023]);
      p.legs.push(leg);
    }
  });

  mirror((s) => {
    const cl = pivot(b, [s * 0.09, 0.13, 0.15]);
    seg(cl, plush(DARK), [0, 0, 0], [s * 0.07, 0.0, 0.07], 0.026, 0.024);
    ell(cl, plush(RED), [s * 0.085, 0.01, 0.13], [0.056, 0.046, 0.06]);
    seg(cl, plush(RED), [s * 0.066, 0.01, 0.16], [s * 0.05, 0.01, 0.215], 0.024, 0.018);
    const finger = pivot(cl, [s * 0.104, 0.01, 0.162], [0, s * 0.15, 0]);
    seg(finger, plush(RED), [0, 0, 0], [0, 0, 0.055], 0.024, 0.018);
    p[s > 0 ? 'clawL' : 'clawR'] = cl;
    p[s > 0 ? 'fingerL' : 'fingerR'] = finger;
  });

  p.tail = [];
  let parent = b;
  for (let i = 0; i < 5; i++) {
    const s = pivot(parent, i === 0 ? [0, 0.15, -0.2] : [0, 0, -0.088], [i === 0 ? 1.1 : 0.5, 0, 0]);
    ell(s, plush(i % 2 ? DARK : RED), [0, 0, -0.044], [0.054 - i * 0.004, 0.05 - i * 0.004, 0.054]);
    p.tail.push(s);
    parent = s;
  }
  p.stinger = pivot(parent, [0, 0, -0.088]);
  ell(p.stinger, vinyl(GOLD, 0.35), [0, 0, -0.035], [0.05, 0.046, 0.055]);
  bead(p.stinger, vinyl(0xf3a338, 0.35), [0, -0.012, -0.085], [0.016, 0.016, 0.018]);

  const idle = (t) => {
    blink(eyes, t + 3.1);
    p.tail[0].rotation.z = Math.sin(t * 1.1) * 0.1;
    p.tail[4].rotation.x = 0.5 + Math.sin(t * 2.3) * 0.12;
    p.stinger.rotation.x = Math.sin(t * 2.3 + 1) * 0.15;
    p.fingerL.rotation.y = 0.15 + Math.max(0, Math.sin(t * 1.5)) * 0.35;
    p.fingerR.rotation.y = -0.15 - Math.max(0, Math.sin(t * 1.5 + 1)) * 0.35;
    p.legs.forEach((leg, i) => (leg.rotation.x = Math.sin(t * 3 + i) * 0.04));
    breathe(chest, Math.sin(t * 2) * 0.01, Math.sin(t * 2) * 0.02);
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Crocodile
function buildCrocodile() {
  const model = new THREE.Group();
  const p = {};
  const GREEN = 0x5fbb58;
  const DARK = 0x479f45;
  const BELLY = 0xf1f1ac;
  const spots = (x, y, z) => {
    const a = Math.sin(z * 11) * Math.sin(x * 9 + 1.3);
    return smooth(0.5, 0.75, a) * smooth(-0.1, 0.3, y) * 0.7;
  };
  const coat = tex('crocBody', {
    space: 'spine',
    base: GREEN,
    layers: [
      { color: DARK, mask: spots },
      { color: BELLY, mask: (x, y) => smooth(-0.25, -0.5, y) },
    ],
  });
  const b = (p.body = pivot(model));
  const chest = torso(b, coat, [0, 0.155, -0.045], [0.145, 0.105, 0.2]);
  mirror((s) => {
    for (let k = 0; k < 4; k++) bead(b, plush(DARK), [s * 0.045, 0.252 - k * 0.003, 0.07 - k * 0.075], [0.024, 0.017, 0.03]);
  });

  const h = (p.head = pivot(b, [0, 0.17, 0.12]));
  const HR = [0.13, 0.1, 0.118];
  const HC = [0, 0.06, 0.05];
  const headTex = tex('crocHead', {
    base: GREEN,
    w: 512,
    h: 256,
    layers: [
      { color: BELLY, mask: (x, y) => smooth(-0.35, -0.65, y) },
      { color: BLUSH, mask: cheeks(0.82, -0.28, 0.16), alpha: 0.75 },
    ],
  });
  ell(h, headTex, HC, HR);
  const SR = [0.108, 0.052, 0.11];
  const S = [0, 0.012, 0.15];
  ell(h, plush(GREEN), S, SR);
  mirror((s) => stuck(h, plush(DARK), S, SR, s * 0.18, 0.62, [0.014, 0.011, 0.012], -0.004));
  surfLine(h, 'crocMouth', S, SR, [[-1.25, -0.12], [-0.7, -0.36], [-0.3, -0.48], [0, -0.42], [0.3, -0.48], [0.7, -0.36], [1.25, -0.12]], 0.0045);
  mirror((s) => {
    const { pos, rot } = onSurface(S, SR, s * 0.2, -0.5, -0.003);
    add(h, G.small(), vinyl(0xffffff, 0.3), pos, [0.011, 0.012, 0.008], rot, false);
  });
  // eyes sit up on two round bumps
  const eyes = [];
  mirror((s) => {
    const EC = [s * 0.062, 0.115, 0.075];
    const ER = [0.05, 0.048, 0.046];
    ell(h, plush(GREEN), EC, ER);
    eye(h, EC, ER, s * 0.22, 0.12, 0.042, eyes, 0x2b2a12);
  });
  ell(h, flat(MOUTH), [0, -0.02, 0.15], [0.09, 0.022, 0.09]);
  p.jaw = pivot(h, [0, -0.02, 0.03]);
  ell(p.jaw, plush(BELLY), [0, -0.016, 0.115], [0.1, 0.034, 0.11]);
  ell(p.jaw, flat(TONGUE), [0, 0.008, 0.1], [0.06, 0.012, 0.065]);

  p.legs = [];
  mirror((s) => {
    for (const z of [0.07, -0.14]) {
      const leg = pivot(b, [s * 0.11, 0.13, z]);
      seg(leg, plush(GREEN), [0, 0, 0], [s * 0.035, -0.075, 0.01], 0.042, 0.038);
      ell(leg, plush(GREEN), [s * 0.04, -0.104, 0.025], [0.046, 0.026, 0.056]);
      for (let k = -1; k <= 1; k++) bead(leg, plush(BELLY), [s * 0.04 + k * 0.022, -0.11, 0.075], [0.012, 0.01, 0.01]);
      p.legs.push(leg);
    }
  });

  p.tail = [];
  let parent = b;
  for (let i = 0; i < 4; i++) {
    const s = pivot(parent, i === 0 ? [0, 0.14, -0.22] : [0, 0, -0.085], [0, 0.32, 0]);
    const r = 0.075 - i * 0.015;
    seg(s, coat, [0, 0, 0.01], [0, 0, -0.085], r, r - 0.014);
    bead(s, plush(DARK), [0, r * 0.85, -0.04], [0.018 - i * 0.002, 0.013, 0.022]);
    p.tail.push(s);
    parent = s;
  }

  const idle = (t) => {
    blink(eyes, t + 1.1);
    p.tail.forEach((s, i) => (s.rotation.y = 0.32 + Math.sin(t * 1.4 - i * 0.7) * 0.12));
    p.jaw.rotation.x = pulse(t, 4.8, 1.2) * 0.4;
    p.head.rotation.y = Math.sin(t * 0.5) * 0.12;
    p.head.rotation.z = Math.sin(t * 0.8) * 0.06;
    breathe(chest, Math.sin(t * 1.8) * 0.02, Math.sin(t * 1.8) * 0.025);
  };
  return { model, parts: p, idle };
}

const BUILDERS = {
  eagle: buildEagle,
  tiger: buildTiger,
  wolf: buildWolf,
  bear: buildBear,
  cobra: buildCobra,
  shark: buildShark,
  gorilla: buildGorilla,
  rhino: buildRhino,
  scorpion: buildScorpion,
  crocodile: buildCrocodile,
};

export function buildKidAnimal(id, fallback) {
  const build = BUILDERS[id];
  return build ? build() : fallback();
}
