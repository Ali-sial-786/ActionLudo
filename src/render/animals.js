import * as THREE from 'three';

// Procedural low-poly animals. Every model faces +z, stands on y = 0 and is roughly 0.8 units tall.
// Builders return { model, parts, idle(t) } where parts are named pivots used by the battle animations.

const geoCache = new Map();
const cached = (key, make) => {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
};

const G = {
  sphere: () => cached('sphere', () => new THREE.SphereGeometry(1, 14, 10)),
  cyl: (taper = 1, seg = 10) =>
    cached(`cyl${taper.toFixed(2)}:${seg}`, () => new THREE.CylinderGeometry(taper, 1, 1, seg)),
  cone: (seg = 10) => cached(`cone${seg}`, () => new THREE.ConeGeometry(1, 1, seg)),
  box: () => cached('box', () => new THREE.BoxGeometry(1, 1, 1)),
  torus: (tube = 0.3, arc = Math.PI * 2) =>
    cached(`torus${tube}:${arc.toFixed(3)}`, () => new THREE.TorusGeometry(1, tube, 8, 24, arc)),
};

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (!matCache.has(key)) {
    matCache.set(
      key,
      new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.02, flatShading: true, ...opts }),
    );
  }
  return matCache.get(key);
}

const GLOSSY = { flatShading: false, roughness: 0.25 };

function add(parent, geo, material, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...pos);
  m.scale.set(...scale);
  m.rotation.set(...rot);
  m.castShadow = true;
  parent.add(m);
  return m;
}

const ell = (parent, color, pos, radii, rot = [0, 0, 0], opts) => add(parent, G.sphere(), mat(color, opts), pos, radii, rot);
const cone = (parent, color, pos, scale, rot = [0, 0, 0], seg = 8, opts) =>
  add(parent, G.cone(seg), mat(color, opts), pos, scale, rot);
const box = (parent, color, pos, scale, rot = [0, 0, 0]) => add(parent, G.box(), mat(color), pos, scale, rot);

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// Cylinder running from point a to point b with radius r (tapering to rEnd at b).
function limb(parent, color, a, b, r, rEnd = r, opts) {
  _a.set(...a);
  _b.set(...b);
  const len = _a.distanceTo(_b);
  const taper = Math.round((rEnd / r) * 20) / 20;
  const m = new THREE.Mesh(G.cyl(taper, 8), mat(color, opts));
  m.position.copy(_a).add(_b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(_up, _b.clone().sub(_a).normalize());
  m.scale.set(r, len, r);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function pivot(parent, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const g = new THREE.Group();
  g.position.set(...pos);
  g.rotation.set(...rot);
  parent.add(g);
  return g;
}

function eye(parent, [x, y, z], r, iris = null) {
  const s = Math.sign(x) || 1;
  ell(parent, 0xffffff, [x, y, z], [r, r, r], [0, 0, 0], GLOSSY);
  if (iris) ell(parent, iris, [x + s * r * 0.2, y, z + r * 0.55], [r * 0.72, r * 0.72, r * 0.5], [0, 0, 0], GLOSSY);
  ell(parent, 0x111111, [x + s * r * 0.25, y, z + r * (iris ? 0.88 : 0.72)], [r * 0.42, r * 0.5, r * 0.3], [0, 0, 0], GLOSSY);
}

const mirror = (fn) => {
  fn(1);
  fn(-1);
};

// ---------------------------------------------------------------- Eagle
function buildEagle() {
  const model = new THREE.Group();
  const p = {};
  const BROWN = 0x5b3a1f;
  const DARK = 0x3a2310;
  const WHITE = 0xf4f1ea;
  const YEL = 0xf2b12e;

  const body = (p.body = pivot(model));
  ell(body, BROWN, [0, 0.36, -0.01], [0.17, 0.22, 0.16], [0.25, 0, 0]);
  ell(body, 0x7a5430, [0, 0.33, 0.07], [0.12, 0.15, 0.09], [0.2, 0, 0]);

  const head = (p.head = pivot(body, [0, 0.58, 0.06]));
  ell(head, WHITE, [0, 0, 0], [0.12, 0.115, 0.13]);
  ell(head, WHITE, [0, -0.08, -0.03], [0.1, 0.07, 0.1]);
  cone(head, YEL, [0, -0.015, 0.15], [0.045, 0.12, 0.04], [Math.PI / 2, 0, 0]);
  cone(head, YEL, [0, -0.05, 0.195], [0.022, 0.06, 0.02], [Math.PI, 0, 0], 6);
  mirror((s) => {
    eye(head, [s * 0.07, 0.025, 0.075], 0.026, 0xf5c400);
    box(head, 0xd8d4ca, [s * 0.055, 0.06, 0.095], [0.075, 0.02, 0.04], [0, 0, s * 0.35]);
  });

  mirror((s) => {
    const w = pivot(body, [s * 0.14, 0.47, -0.02], [0, s * 0.3, -s * 1.3]);
    ell(w, DARK, [s * 0.2, 0, 0], [0.22, 0.03, 0.12]);
    ell(w, 0x2b1a0b, [s * 0.4, 0, -0.03], [0.1, 0.025, 0.08]);
    for (let k = 0; k < 3; k++) {
      box(w, 0x24150a, [s * 0.47, 0, -0.07 + k * 0.05], [0.12, 0.015, 0.035], [0, s * (0.2 - k * 0.15), 0]);
    }
    p[s > 0 ? 'wingL' : 'wingR'] = w;
  });

  p.tail = pivot(body, [0, 0.22, -0.14]);
  ell(p.tail, WHITE, [0, -0.04, -0.08], [0.08, 0.025, 0.13], [-0.5, 0, 0]);

  mirror((s) => limb(body, YEL, [s * 0.06, 0.18, 0.03], [s * 0.06, 0.03, 0.05], 0.025));
  p.talons = pivot(body, [0, 0.02, 0.06]);
  mirror((s) => {
    for (let k = 0; k < 3; k++) {
      cone(p.talons, 0x222222, [s * 0.06 + (k - 1) * 0.022, 0, 0.03], [0.012, 0.06, 0.012], [Math.PI / 2, (k - 1) * 0.3, 0], 6);
    }
  });

  p.setWings = (spread, flap = 0) => {
    // spread 0 = folded, 1 = fully open; flap adds extra up/down angle
    for (const [w, s] of [
      [p.wingL, 1],
      [p.wingR, -1],
    ]) {
      w.rotation.set(0, s * 0.3 * (1 - spread), -s * (1.3 * (1 - spread) - 0.15 * spread - flap));
    }
  };

  const idle = (t) => {
    p.head.rotation.y = Math.sin(t * 0.7) * 0.45;
    p.head.rotation.x = Math.sin(t * 1.3) * 0.08;
    p.body.position.y = Math.sin(t * 2.2) * 0.008;
    p.setWings(Math.max(0, Math.sin(t * 0.5) - 0.92) * 4);
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Quadruped skeleton
function quadruped(cfg) {
  const model = new THREE.Group();
  const p = {};
  const body = (p.body = pivot(model));
  ell(body, cfg.color, [0, cfg.bodyY, 0], cfg.bodyR);
  if (cfg.belly) ell(body, cfg.belly, [0, cfg.bodyY - cfg.bodyR[1] * 0.4, 0.02], [cfg.bodyR[0] * 0.8, cfg.bodyR[1] * 0.6, cfg.bodyR[2] * 0.82]);
  const top = cfg.bodyY - cfg.bodyR[1] * 0.3;
  const legs = [
    ['legFL', cfg.legX, cfg.legZ[0]],
    ['legFR', -cfg.legX, cfg.legZ[0]],
    ['legBL', cfg.legX, cfg.legZ[1]],
    ['legBR', -cfg.legX, cfg.legZ[1]],
  ];
  for (const [name, x, z] of legs) {
    const leg = (p[name] = pivot(body, [x, top, z]));
    limb(leg, cfg.legColor ?? cfg.color, [0, 0, 0], [0, -(top - cfg.pawR), 0], cfg.legR, cfg.legR * 0.85);
    ell(leg, cfg.pawColor ?? cfg.color, [0, -(top - cfg.pawR * 0.8), 0.015], [cfg.pawR * 1.1, cfg.pawR * 0.8, cfg.pawR * 1.3]);
    if (cfg.claws) {
      for (let k = -1; k <= 1; k++) {
        cone(leg, 0xf2efe6, [k * cfg.pawR * 0.55, -(top - cfg.pawR * 0.5), cfg.pawR * 1.25], [0.012, 0.04, 0.012], [Math.PI / 2, 0, 0], 5);
      }
    }
  }
  p.head = pivot(body, cfg.headPos);
  p.tail = pivot(body, cfg.tailPos);
  return { model, p, body };
}

// ---------------------------------------------------------------- Tiger
function buildTiger() {
  const ORANGE = 0xe8822a;
  const WHITE = 0xf6efe4;
  const BLACK = 0x1d1410;
  const { model, p, body } = quadruped({
    color: ORANGE,
    belly: WHITE,
    bodyY: 0.33,
    bodyR: [0.15, 0.14, 0.27],
    legX: 0.09,
    legZ: [0.16, -0.16],
    legR: 0.045,
    pawR: 0.05,
    pawColor: WHITE,
    claws: true,
    headPos: [0, 0.44, 0.27],
    tailPos: [0, 0.38, -0.25],
  });
  for (let k = 0; k < 4; k++) {
    const z = -0.17 + k * 0.1;
    const f = Math.sqrt(Math.max(0.05, 1 - (z / 0.27) ** 2));
    add(body, G.torus(0.09, Math.PI), mat(BLACK), [0, 0.33, z], [0.152 * f, 0.142 * f, 0.15], [0, 0, 0]);
  }
  const h = p.head;
  ell(h, ORANGE, [0, 0, 0], [0.13, 0.12, 0.12]);
  mirror((s) => {
    ell(h, WHITE, [s * 0.065, -0.045, 0.06], [0.07, 0.05, 0.06]);
    cone(h, ORANGE, [s * 0.085, 0.1, -0.01], [0.045, 0.08, 0.03], [0, 0, -s * 0.25], 6);
    cone(h, BLACK, [s * 0.085, 0.105, 0.005], [0.025, 0.05, 0.01], [0, 0, -s * 0.25], 6);
    eye(h, [s * 0.055, 0.03, 0.095], 0.024, 0xc8d400);
    box(h, BLACK, [s * 0.11, 0.0, 0.03], [0.012, 0.06, 0.05], [0, 0, s * 0.4]);
  });
  ell(h, WHITE, [0, -0.035, 0.1], [0.065, 0.045, 0.05]);
  ell(h, 0xe57d8c, [0, -0.005, 0.145], [0.025, 0.018, 0.015]);
  for (let k = -1; k <= 1; k++) box(h, BLACK, [k * 0.03, 0.08, 0.085], [0.014, 0.05, 0.02], [0.3, 0, k * 0.3]);
  ell(h, 0x5a0f12, [0, -0.065, 0.07], [0.05, 0.03, 0.05]);
  mirror((s) => cone(h, 0xffffff, [s * 0.03, -0.07, 0.11], [0.012, 0.045, 0.012], [Math.PI, 0, 0], 5));
  p.jaw = pivot(h, [0, -0.07, 0.04]);
  ell(p.jaw, WHITE, [0, -0.015, 0.06], [0.055, 0.025, 0.05]);

  limb(p.tail, ORANGE, [0, 0, 0], [0, 0.08, -0.14], 0.026, 0.022);
  p.tail2 = pivot(p.tail, [0, 0.08, -0.14]);
  limb(p.tail2, ORANGE, [0, 0, 0], [0, 0.1, -0.05], 0.022, 0.018);
  ell(p.tail2, BLACK, [0, 0.11, -0.055], [0.024, 0.04, 0.024]);

  const idle = (t) => {
    p.tail.rotation.y = Math.sin(t * 1.4) * 0.4;
    p.tail2.rotation.x = Math.sin(t * 2.1) * 0.3;
    p.head.rotation.y = Math.sin(t * 0.5) * 0.3;
    p.body.scale.y = 1 + Math.sin(t * 2.4) * 0.012;
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Wolf
function buildWolf() {
  const GRAY = 0x7f8893;
  const LIGHT = 0xd8dade;
  const { model, p, body } = quadruped({
    color: GRAY,
    belly: LIGHT,
    bodyY: 0.35,
    bodyR: [0.13, 0.13, 0.26],
    legX: 0.08,
    legZ: [0.16, -0.16],
    legR: 0.04,
    pawR: 0.045,
    pawColor: LIGHT,
    headPos: [0, 0.48, 0.25],
    tailPos: [0, 0.4, -0.24],
  });
  ell(body, LIGHT, [0, 0.41, 0.19], [0.12, 0.12, 0.09]);
  const h = p.head;
  ell(h, GRAY, [0, 0, 0], [0.11, 0.1, 0.11]);
  ell(h, LIGHT, [0, -0.05, 0.03], [0.09, 0.06, 0.08]);
  cone(h, GRAY, [0, -0.02, 0.15], [0.055, 0.15, 0.045], [Math.PI / 2, 0, 0]);
  ell(h, 0x111111, [0, -0.012, 0.225], [0.022, 0.018, 0.018], [0, 0, 0], GLOSSY);
  mirror((s) => {
    cone(h, GRAY, [s * 0.06, 0.11, -0.02], [0.035, 0.1, 0.025], [0, 0, -s * 0.15], 5);
    cone(h, 0x3a3f46, [s * 0.06, 0.11, -0.005], [0.018, 0.07, 0.01], [0, 0, -s * 0.15], 5);
    eye(h, [s * 0.05, 0.03, 0.08], 0.02, 0xf0a020);
    cone(h, 0xffffff, [s * 0.022, -0.05, 0.17], [0.01, 0.035, 0.01], [Math.PI, 0, 0], 5);
  });
  ell(h, 0x5a0f12, [0, -0.05, 0.1], [0.04, 0.02, 0.07]);
  p.jaw = pivot(h, [0, -0.055, 0.06]);
  ell(p.jaw, LIGHT, [0, -0.01, 0.07], [0.04, 0.018, 0.08]);

  ell(p.tail, GRAY, [0, -0.06, -0.12], [0.06, 0.06, 0.15], [-0.5, 0, 0]);
  ell(p.tail, LIGHT, [0, -0.12, -0.23], [0.04, 0.04, 0.06], [-0.5, 0, 0]);

  const idle = (t) => {
    p.tail.rotation.y = Math.sin(t * 3) * 0.3;
    p.head.rotation.y = Math.sin(t * 0.6) * 0.35;
    p.head.rotation.x = Math.sin(t * 0.9) * 0.08;
    p.body.scale.y = 1 + Math.sin(t * 2.6) * 0.012;
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Bear
function buildBear() {
  const BROWN = 0x6e4526;
  const TAN = 0xc79a6b;
  const { model, p, body } = quadruped({
    color: BROWN,
    bodyY: 0.34,
    bodyR: [0.2, 0.18, 0.27],
    legX: 0.12,
    legZ: [0.15, -0.15],
    legR: 0.07,
    pawR: 0.065,
    pawColor: 0x4a2c16,
    claws: true,
    headPos: [0, 0.42, 0.3],
    tailPos: [0, 0.38, -0.26],
  });
  ell(body, BROWN, [0, 0.47, 0.11], [0.14, 0.09, 0.12]);
  const h = p.head;
  ell(h, BROWN, [0, 0, 0], [0.14, 0.13, 0.13]);
  ell(h, TAN, [0, -0.04, 0.11], [0.07, 0.055, 0.07]);
  ell(h, 0x111111, [0, -0.01, 0.175], [0.03, 0.02, 0.02], [0, 0, 0], GLOSSY);
  mirror((s) => {
    ell(h, BROWN, [s * 0.1, 0.1, -0.01], [0.045, 0.045, 0.03]);
    ell(h, TAN, [s * 0.1, 0.1, 0.008], [0.025, 0.025, 0.015]);
    eye(h, [s * 0.06, 0.035, 0.1], 0.018);
    cone(h, 0xffffff, [s * 0.025, -0.075, 0.13], [0.01, 0.03, 0.01], [Math.PI, 0, 0], 5);
  });
  ell(h, 0x5a0f12, [0, -0.075, 0.08], [0.045, 0.02, 0.05]);
  p.jaw = pivot(h, [0, -0.08, 0.07]);
  ell(p.jaw, TAN, [0, -0.01, 0.05], [0.05, 0.02, 0.05]);
  ell(p.tail, BROWN, [0, 0, -0.02], [0.04, 0.04, 0.04]);

  const idle = (t) => {
    p.head.rotation.x = Math.sin(t * 1.1) * 0.08;
    p.head.rotation.y = Math.sin(t * 0.4) * 0.25;
    p.body.scale.y = 1 + Math.sin(t * 1.8) * 0.018;
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Rhino
function buildRhino() {
  const GRAY = 0x8f8a86;
  const DARK = 0x6f6a66;
  const IVORY = 0xebdfc4;
  const { model, p, body } = quadruped({
    color: GRAY,
    bodyY: 0.32,
    bodyR: [0.19, 0.16, 0.3],
    legX: 0.11,
    legZ: [0.17, -0.17],
    legR: 0.065,
    pawR: 0.07,
    pawColor: DARK,
    headPos: [0, 0.34, 0.28],
    tailPos: [0, 0.36, -0.29],
  });
  ell(body, DARK, [0, 0.33, 0.12], [0.197, 0.167, 0.05]);
  ell(body, DARK, [0, 0.33, -0.14], [0.193, 0.163, 0.04]);
  const h = p.head;
  ell(h, GRAY, [0, -0.02, 0.1], [0.11, 0.1, 0.17], [0.25, 0, 0]);
  cone(h, IVORY, [0, 0.06, 0.2], [0.045, 0.18, 0.045], [0.45, 0, 0], 8, { flatShading: false, roughness: 0.35 });
  cone(h, IVORY, [0, 0.08, 0.08], [0.03, 0.09, 0.03], [0.3, 0, 0], 8, { flatShading: false, roughness: 0.35 });
  mirror((s) => {
    cone(h, GRAY, [s * 0.07, 0.1, -0.04], [0.03, 0.07, 0.02], [0, 0, -s * 0.3], 5);
    eye(h, [s * 0.09, 0.02, 0.06], 0.017);
    ell(h, 0x333333, [s * 0.03, -0.04, 0.25], [0.012, 0.012, 0.01]);
  });
  limb(p.tail, GRAY, [0, 0, 0], [0, -0.12, -0.04], 0.015);
  ell(p.tail, 0x333333, [0, -0.13, -0.045], [0.02, 0.035, 0.02]);

  const idle = (t) => {
    p.head.rotation.x = Math.sin(t * 0.9) * 0.08;
    p.tail.rotation.z = Math.sin(t * 3) * 0.4;
    p.body.scale.y = 1 + Math.sin(t * 1.6) * 0.012;
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Gorilla
function buildGorilla() {
  const model = new THREE.Group();
  const p = {};
  const BLACK = 0x34333a;
  const CHEST = 0x6a6670;
  const FACE = 0x7a6a66;
  const body = (p.body = pivot(model));
  ell(body, BLACK, [0, 0.36, -0.03], [0.19, 0.21, 0.17], [0.45, 0, 0]);
  ell(body, CHEST, [0, 0.36, 0.08], [0.13, 0.13, 0.08], [0.45, 0, 0]);
  ell(body, BLACK, [0, 0.47, 0.06], [0.22, 0.1, 0.13], [0.3, 0, 0]);

  const h = (p.head = pivot(body, [0, 0.56, 0.17]));
  ell(h, BLACK, [0, 0, 0], [0.11, 0.11, 0.1]);
  ell(h, BLACK, [0, 0.07, -0.03], [0.06, 0.06, 0.08]);
  ell(h, FACE, [0, -0.025, 0.065], [0.085, 0.08, 0.06]);
  box(h, BLACK, [0, 0.035, 0.1], [0.17, 0.035, 0.05]);
  mirror((s) => {
    eye(h, [s * 0.035, 0.008, 0.105], 0.017, 0x5a3a1a);
    ell(h, 0x2a2224, [s * 0.016, -0.035, 0.125], [0.013, 0.01, 0.008]);
    ell(h, BLACK, [s * 0.1, 0.0, -0.01], [0.025, 0.035, 0.02]);
  });
  p.jaw = pivot(h, [0, -0.065, 0.055]);
  ell(p.jaw, FACE, [0, -0.01, 0.03], [0.06, 0.03, 0.04]);

  mirror((s) => {
    const arm = pivot(body, [s * 0.2, 0.47, 0.08], [0, 0, 0]);
    ell(arm, BLACK, [0, 0, 0], [0.095, 0.09, 0.09]);
    limb(arm, BLACK, [0, 0, 0], [s * 0.06, -0.21, 0.08], 0.07, 0.065);
    limb(arm, BLACK, [s * 0.06, -0.21, 0.08], [s * 0.07, -0.37, 0.14], 0.065, 0.06);
    ell(arm, FACE, [s * 0.07, -0.39, 0.15], [0.07, 0.06, 0.08]);
    p[s > 0 ? 'armL' : 'armR'] = arm;
    const leg = pivot(body, [s * 0.11, 0.24, -0.1]);
    limb(leg, BLACK, [0, 0, 0], [0, -0.17, 0.03], 0.075, 0.065);
    ell(leg, FACE, [0, -0.2, 0.06], [0.06, 0.03, 0.09]);
    p[s > 0 ? 'legL' : 'legR'] = leg;
  });

  const idle = (t) => {
    p.body.scale.set(1 + Math.sin(t * 2) * 0.015, 1, 1 + Math.sin(t * 2) * 0.015);
    p.head.rotation.y = Math.sin(t * 0.5) * 0.4;
    p.armL.rotation.z = Math.sin(t * 1.1) * 0.05;
    p.armR.rotation.z = -Math.sin(t * 1.1) * 0.05;
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Cobra
function buildCobra() {
  const model = new THREE.Group();
  const p = {};
  const GREEN = 0x4f8f3a;
  const BELLY = 0xdcc97a;
  const DARK = 0x2c5a20;
  p.body = pivot(model);
  add(p.body, G.torus(0.35), mat(GREEN), [0, 0.065, 0], [0.18, 0.18, 0.18], [Math.PI / 2, 0, 0]);
  add(p.body, G.torus(0.45), mat(DARK), [0, 0.15, -0.01], [0.12, 0.12, 0.12], [Math.PI / 2, 0, 0.6]);

  p.neck = [];
  let parent = p.body;
  const rest = [-0.12, 0.1, 0.12, 0.05];
  for (let i = 0; i < 4; i++) {
    const seg = pivot(parent, i === 0 ? [0, 0.17, 0.07] : [0, 0.1, 0], [rest[i], 0, 0]);
    ell(seg, i % 2 ? GREEN : DARK, [0, 0.05, 0], [0.056 - i * 0.004, 0.07, 0.05]);
    ell(seg, BELLY, [0, 0.05, 0.026], [0.04, 0.062, 0.034]);
    p.neck.push(seg);
    parent = seg;
  }
  p.hood = pivot(p.neck[2], [0, 0.05, -0.02]);
  ell(p.hood, GREEN, [0, 0.05, -0.012], [0.13, 0.13, 0.025]);
  ell(p.hood, BELLY, [0, 0.05, 0.012], [0.055, 0.06, 0.016]);
  mirror((s) => ell(p.hood, 0x1d1d1d, [s * 0.05, 0.08, 0.008], [0.022, 0.022, 0.012]));

  const h = (p.head = pivot(parent, [0, 0.11, 0], [-0.1, 0, 0]));
  ell(h, GREEN, [0, 0, 0.04], [0.06, 0.045, 0.09]);
  ell(h, DARK, [0, 0.025, 0.03], [0.05, 0.025, 0.07]);
  mirror((s) => {
    eye(h, [s * 0.04, 0.018, 0.075], 0.015, 0xffb000);
    cone(h, 0xffffff, [s * 0.02, -0.03, 0.105], [0.008, 0.03, 0.008], [Math.PI, 0, 0], 5);
  });
  ell(h, 0x8a1a2a, [0, -0.02, 0.06], [0.04, 0.012, 0.06]);
  p.jaw = pivot(h, [0, -0.02, 0]);
  ell(p.jaw, BELLY, [0, -0.012, 0.05], [0.045, 0.016, 0.075]);
  p.tongue = pivot(h, [0, -0.012, 0.12]);
  box(p.tongue, 0xd0203a, [0, 0, 0.035], [0.008, 0.004, 0.07]);
  mirror((s) => box(p.tongue, 0xd0203a, [s * 0.008, 0, 0.08], [0.006, 0.004, 0.03], [0, s * 0.45, 0]));
  p.tongue.scale.z = 0.01;

  const idle = (t) => {
    p.neck.forEach((seg, i) => {
      seg.rotation.z = Math.sin(t * 1.6 - i * 0.6) * 0.1;
    });
    p.tongue.scale.z = Math.sin(t * 2.7) > 0.75 ? 1 : 0.01;
    const hood = 1 + Math.sin(t * 1.3) * 0.06;
    p.hood.scale.set(hood, 1, 1);
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Shark
function buildShark() {
  const model = new THREE.Group();
  const p = {};
  const BG = 0x6d8ba3;
  const WHITE = 0xf2f4f6;
  const water = add(model, G.cyl(1, 24), mat(0x2a86d8, { transparent: true, opacity: 0.85, flatShading: false, roughness: 0.12, metalness: 0.1 }), [0, 0.012, 0], [0.39, 0.02, 0.39]);
  water.castShadow = false;
  p.water = water;
  const foam = add(model, G.torus(0.12), mat(0xffffff, { flatShading: false }), [0, 0.022, 0], [0.38, 0.38, 0.38], [Math.PI / 2, 0, 0]);
  foam.castShadow = false;

  const b = (p.body = pivot(model, [0, 0.19, 0]));
  ell(b, BG, [0, 0, -0.03], [0.13, 0.12, 0.3]);
  ell(b, WHITE, [0, -0.045, 0.0], [0.11, 0.08, 0.27]);
  ell(b, BG, [0, 0.02, 0.19], [0.1, 0.085, 0.13]);
  ell(b, 0x6a1018, [0, -0.055, 0.18], [0.075, 0.03, 0.08]);
  mirror((s) => {
    eye(b, [s * 0.085, 0.04, 0.2], 0.018);
    for (let k = 0; k < 3; k++) box(b, 0x3d5163, [s * 0.118, 0.0, 0.08 - k * 0.035], [0.006, 0.07, 0.01]);
    cone(b, BG, [s * 0.14, -0.05, 0.06], [0.07, 0.14, 0.018], [0, 0.0, s * (Math.PI / 2 + 0.6)], 4);
  });
  for (let k = 0; k < 6; k++) {
    const a = (k / 5 - 0.5) * 2.2;
    cone(b, 0xffffff, [Math.sin(a) * 0.075, -0.045, 0.2 + Math.cos(a) * 0.075], [0.012, 0.035, 0.012], [Math.PI, 0, 0], 4);
  }
  p.jaw = pivot(b, [0, -0.06, 0.1]);
  ell(p.jaw, WHITE, [0, -0.015, 0.09], [0.085, 0.03, 0.1]);
  for (let k = 0; k < 6; k++) {
    const a = (k / 5 - 0.5) * 2.2;
    cone(p.jaw, 0xffffff, [Math.sin(a) * 0.065, 0.015, 0.09 + Math.cos(a) * 0.07], [0.011, 0.03, 0.011], [0, 0, 0], 4);
  }
  p.fin = pivot(b, [0, 0.1, -0.02]);
  cone(p.fin, BG, [0, 0.07, -0.03], [0.02, 0.18, 0.09], [-0.4, 0, 0], 4);
  p.tail = pivot(b, [0, 0, -0.3]);
  ell(p.tail, BG, [0, 0, -0.02], [0.05, 0.06, 0.08]);
  cone(p.tail, BG, [0, 0.09, -0.08], [0.016, 0.2, 0.06], [-0.6, 0, 0], 4);
  cone(p.tail, BG, [0, -0.05, -0.06], [0.016, 0.12, 0.05], [-2.4, 0, 0], 4);

  const idle = (t) => {
    p.tail.rotation.y = Math.sin(t * 4) * 0.35;
    p.body.rotation.y = -Math.sin(t * 4) * 0.05;
    p.body.rotation.z = Math.sin(t * 2) * 0.05;
    p.body.position.y = 0.19 + Math.sin(t * 2.3) * 0.012;
    p.jaw.rotation.x = Math.max(0, Math.sin(t * 0.8) - 0.8) * 1.5;
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Scorpion
function buildScorpion() {
  const model = new THREE.Group();
  const p = {};
  const SH = 0x3b2414;
  const CL = 0x5e3318;
  const SHINY = { roughness: 0.32, metalness: 0.15 };
  const b = (p.body = pivot(model));
  ell(b, SH, [0, 0.12, 0.08], [0.11, 0.055, 0.11], [0, 0, 0], SHINY);
  for (let k = 0; k < 4; k++) ell(b, SH, [0, 0.125, -0.04 - k * 0.065], [0.1 - k * 0.012, 0.052, 0.05], [0, 0, 0], SHINY);
  mirror((s) => ell(b, 0x111111, [s * 0.025, 0.172, 0.15], [0.012, 0.012, 0.012], [0, 0, 0], GLOSSY));

  p.legs = [];
  mirror((s) => {
    for (let k = 0; k < 4; k++) {
      const z = 0.06 - k * 0.07;
      const leg = pivot(b, [s * 0.08, 0.11, z]);
      const knee = [s * 0.12, 0.06, (k - 1.5) * 0.03];
      const foot = [s * 0.19, -0.11, (k - 1.5) * 0.07];
      limb(leg, SH, [0, 0, 0], knee, 0.015, 0.013, SHINY);
      limb(leg, SH, knee, foot, 0.013, 0.008, SHINY);
      p.legs.push(leg);
    }
  });

  mirror((s) => {
    const claw = pivot(b, [s * 0.08, 0.12, 0.17]);
    limb(claw, CL, [0, 0, 0], [s * 0.1, 0.02, 0.1], 0.022, 0.022, SHINY);
    limb(claw, CL, [s * 0.1, 0.02, 0.1], [s * 0.07, 0.03, 0.22], 0.024, 0.026, SHINY);
    ell(claw, CL, [s * 0.07, 0.03, 0.26], [0.055, 0.04, 0.07], [0, 0, 0], SHINY);
    cone(claw, CL, [s * 0.045, 0.03, 0.35], [0.018, 0.1, 0.018], [Math.PI / 2, 0, 0], 6, SHINY);
    const finger = pivot(claw, [s * 0.095, 0.03, 0.3], [0, s * 0.15, 0]);
    cone(finger, CL, [0, 0, 0.045], [0.016, 0.09, 0.016], [Math.PI / 2, 0, 0], 6, SHINY);
    p[s > 0 ? 'clawL' : 'clawR'] = claw;
    p[s > 0 ? 'fingerL' : 'fingerR'] = finger;
  });

  p.tail = [];
  let parent = b;
  for (let i = 0; i < 5; i++) {
    const seg = pivot(parent, i === 0 ? [0, 0.13, -0.27] : [0, 0, -0.085], [i === 0 ? 1.1 : 0.5, 0, 0]);
    ell(seg, SH, [0, 0, -0.045], [0.042 - i * 0.003, 0.04 - i * 0.003, 0.052], [0, 0, 0], SHINY);
    p.tail.push(seg);
    parent = seg;
  }
  p.stinger = pivot(parent, [0, 0, -0.085]);
  ell(p.stinger, 0x7a2a1a, [0, 0, -0.03], [0.042, 0.036, 0.048], [0, 0, 0], SHINY);
  cone(p.stinger, 0xd02020, [0, 0.03, -0.065], [0.014, 0.075, 0.014], [-0.6, 0, 0], 6, { emissive: 0x500000, flatShading: false });

  const idle = (t) => {
    p.tail[0].rotation.z = Math.sin(t * 1.2) * 0.12;
    p.tail[4].rotation.x = 0.5 + Math.sin(t * 2.5) * 0.12;
    p.fingerL.rotation.y = 0.15 + Math.max(0, Math.sin(t * 1.7)) * 0.4;
    p.fingerR.rotation.y = -0.15 - Math.max(0, Math.sin(t * 1.7 + 1)) * 0.4;
    p.legs.forEach((leg, i) => (leg.rotation.x = Math.sin(t * 3 + i) * 0.04));
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Crocodile
function buildCrocodile() {
  const model = new THREE.Group();
  const p = {};
  const GR = 0x4d7a35;
  const DK = 0x34561f;
  const BL = 0xcfc48c;
  const inner = pivot(model, [0, 0, 0.03]);
  inner.scale.setScalar(0.85);
  const b = (p.body = pivot(inner));
  ell(b, GR, [0, 0.12, -0.02], [0.14, 0.075, 0.26]);
  ell(b, BL, [0, 0.085, -0.02], [0.12, 0.05, 0.23]);
  mirror((s) => {
    for (let k = 0; k < 5; k++) cone(b, DK, [s * 0.05, 0.185, 0.15 - k * 0.08], [0.022, 0.045, 0.022], [0, 0, 0], 4);
  });

  const h = (p.head = pivot(b, [0, 0.13, 0.22]));
  ell(h, GR, [0, 0.02, 0.13], [0.085, 0.04, 0.17]);
  ell(h, GR, [0, 0.035, 0.02], [0.095, 0.055, 0.075]);
  ell(h, 0xc66a6a, [0, -0.012, 0.11], [0.07, 0.012, 0.13]);
  mirror((s) => {
    ell(h, GR, [s * 0.045, 0.08, 0.03], [0.03, 0.03, 0.03]);
    eye(h, [s * 0.05, 0.092, 0.045], 0.016, 0xe8d020);
    ell(h, DK, [s * 0.02, 0.06, 0.27], [0.013, 0.013, 0.013]);
    for (let k = 0; k < 5; k++) cone(h, 0xffffff, [s * 0.075, -0.012, 0.05 + k * 0.05], [0.01, 0.032, 0.01], [Math.PI, 0, 0], 4);
  });
  p.jaw = pivot(h, [0, -0.012, -0.02]);
  ell(p.jaw, BL, [0, -0.02, 0.14], [0.08, 0.025, 0.16]);
  mirror((s) => {
    for (let k = 0; k < 5; k++) cone(p.jaw, 0xffffff, [s * 0.068, 0.006, 0.07 + k * 0.05], [0.009, 0.028, 0.009], [0, 0, 0], 4);
  });

  p.legs = [];
  mirror((s) => {
    for (const z of [0.15, -0.16]) {
      const leg = pivot(b, [s * 0.12, 0.1, z]);
      limb(leg, GR, [0, 0, 0], [s * 0.08, -0.07, 0.02], 0.032, 0.028);
      ell(leg, DK, [s * 0.09, -0.085, 0.04], [0.04, 0.015, 0.045]);
      p.legs.push(leg);
    }
  });

  p.tail = [];
  let parent = b;
  for (let i = 0; i < 4; i++) {
    const seg = pivot(parent, i === 0 ? [0, 0.11, -0.27] : [0, 0, -0.1], [0, 0.32, 0]);
    ell(seg, GR, [0, 0, -0.05], [0.09 - i * 0.018, 0.055 - i * 0.008, 0.07]);
    cone(seg, DK, [0, 0.05 - i * 0.008, -0.05], [0.018, 0.04, 0.018], [0, 0, 0], 4);
    p.tail.push(seg);
    parent = seg;
  }

  const idle = (t) => {
    p.tail.forEach((seg, i) => (seg.rotation.y = 0.32 + Math.sin(t * 1.3 - i * 0.7) * 0.12));
    p.jaw.rotation.x = Math.max(0, Math.sin(t * 0.6) - 0.6) * 1.2;
    p.head.rotation.y = Math.sin(t * 0.45) * 0.12;
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

export function createAnimal(id) {
  const built = (BUILDERS[id] || buildTiger)();
  built.model.traverse((o) => {
    o.userData.rest = { position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone() };
  });
  return built;
}

// Debris / particle palette per animal, used when an animal gets torn apart.
export const DEBRIS = {
  eagle: { kind: 'feather', colors: [0x5b3a1f, 0xf4f1ea, 0x3a2310] },
  tiger: { kind: 'fur', colors: [0xe8822a, 0x1d1410, 0xf6efe4] },
  wolf: { kind: 'fur', colors: [0x7f8893, 0xd8dade] },
  bear: { kind: 'fur', colors: [0x6e4526, 0xc79a6b] },
  cobra: { kind: 'scale', colors: [0x4f8f3a, 0x2c5a20, 0xdcc97a] },
  shark: { kind: 'water', colors: [0x6d8ba3, 0x2a86d8, 0xbfe6ff] },
  gorilla: { kind: 'fur', colors: [0x2e2d33, 0x56535c] },
  rhino: { kind: 'dust', colors: [0x8f8a86, 0x6f6a66, 0xebdfc4] },
  scorpion: { kind: 'shard', colors: [0x3b2414, 0x5e3318, 0xd02020] },
  crocodile: { kind: 'scale', colors: [0x4d7a35, 0x34561f, 0xcfc48c] },
};
