import * as THREE from 'three';
import { featherMaps, furMaps, scaleMaps, skinMaps, tigerStripes } from './textures.js';
import { buildKidAnimal } from './animalsKid.js';

// Procedural animals built from smooth, textured primitives. Every model faces +z, stands on y = 0
// and is roughly one board square long. Builders return { model, parts, idle(t) } where parts are the
// named pivots the battle choreography drives (head, jaw, legs, wings, tail, claws...).

const geoCache = new Map();
const cached = (key, make) => {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
};

const G = {
  sphere: () => cached('sphere', () => new THREE.SphereGeometry(1, 24, 16)),
  // poles along z so canvas stripes / countershading wrap the torso correctly
  spine: () =>
    cached('spine', () => {
      const g = new THREE.SphereGeometry(1, 28, 18);
      g.rotateX(Math.PI / 2);
      return g;
    }),
  cyl: (taper = 1, seg = 12) => cached(`cyl${taper.toFixed(2)}:${seg}`, () => new THREE.CylinderGeometry(taper, 1, 1, seg)),
  cone: (seg = 12) => cached(`cone${seg}`, () => new THREE.ConeGeometry(1, 1, seg)),
  box: () => cached('box', () => new THREE.BoxGeometry(1, 1, 1)),
  torus: (tube = 0.3, arc = Math.PI * 2) =>
    cached(`torus${tube}:${arc.toFixed(3)}`, () => new THREE.TorusGeometry(1, tube, 14, 40, arc)),
};

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.0, ...opts }));
  }
  return matCache.get(key);
}

function texMat(key, maps, opts = {}) {
  const k = `tex:${key}`;
  if (!matCache.has(k)) {
    matCache.set(
      k,
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: maps.map, bumpMap: maps.bumpMap, bumpScale: 1.4, roughness: 0.82, ...opts }),
    );
  }
  return matCache.get(k);
}

const M = (m) => (m && m.isMaterial ? m : mat(m));

function add(parent, geo, material, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, M(material));
  m.position.set(...pos);
  m.scale.set(...scale);
  m.rotation.set(...rot);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

const ell = (parent, material, pos, radii, rot = [0, 0, 0]) => add(parent, G.sphere(), material, pos, radii, rot);
const torso = (parent, material, pos, radii, rot = [0, 0, 0]) => add(parent, G.spine(), material, pos, radii, rot);
const cone = (parent, material, pos, scale, rot = [0, 0, 0], seg = 10) => add(parent, G.cone(seg), material, pos, scale, rot);

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// Elongated ellipsoid ("muscle") spanning from a to b.
function bone(parent, material, a, b, r, rz = r) {
  _a.set(...a);
  _b.set(...b);
  const len = _a.distanceTo(_b);
  const m = new THREE.Mesh(G.sphere(), M(material));
  m.position.copy(_a).add(_b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(_up, _b.clone().sub(_a).normalize());
  m.scale.set(r, len / 2 + r * 0.5, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// Tapered cylinder from a to b.
function limb(parent, material, a, b, r, rEnd = r) {
  _a.set(...a);
  _b.set(...b);
  const len = _a.distanceTo(_b);
  const taper = Math.round((rEnd / r) * 20) / 20;
  const m = new THREE.Mesh(G.cyl(taper), M(material));
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

const mirror = (fn) => {
  fn(1);
  fn(-1);
};

const EYE_GLOSS = { roughness: 0.08, metalness: 0.0 };
// Small, deep-set predator eye: coloured iris, dark pupil, no cartoon whites.
function eye(parent, [x, y, z], r, iris, { slit = false } = {}) {
  const s = Math.sign(x) || 1;
  ell(parent, mat(0x140806, EYE_GLOSS), [x, y, z], [r * 1.12, r * 1.05, r * 1.0]);
  ell(parent, mat(iris, { ...EYE_GLOSS, emissive: iris, emissiveIntensity: 0.18 }), [x + s * r * 0.18, y, z + r * 0.42], [r * 0.82, r * 0.82, r * 0.6]);
  ell(parent, mat(0x050303, EYE_GLOSS), [x + s * r * 0.26, y, z + r * 0.72], slit ? [r * 0.14, r * 0.62, r * 0.25] : [r * 0.42, r * 0.42, r * 0.25]);
}

function fang(parent, pos, len, r, down = true, tilt = 0) {
  return cone(parent, mat(0xeee6d2, { roughness: 0.35 }), pos, [r, len, r], [down ? Math.PI + tilt : tilt, 0, 0], 8);
}

function teethArc(parent, { y, z, radius, count, len, r, down, spread = 2.0 }) {
  for (let k = 0; k < count; k++) {
    const a = (k / (count - 1) - 0.5) * spread;
    fang(parent, [Math.sin(a) * radius, y, z + Math.cos(a) * radius * 0.9], len, r, down);
  }
}

// ---------------------------------------------------------------- shared quadruped skeleton
function quadruped(cfg) {
  const model = new THREE.Group();
  const p = {};
  const body = (p.body = pivot(model));
  const { coat, limbMat } = cfg;
  torso(body, coat, [0, cfg.bodyY, cfg.chestZ], cfg.chestR);
  torso(body, coat, [0, cfg.bodyY - 0.005, cfg.hipZ], cfg.hipR);
  torso(body, coat, [0, cfg.bodyY - 0.015, (cfg.chestZ + cfg.hipZ) / 2], [cfg.chestR[0] * 0.92, cfg.chestR[1] * 0.9, (cfg.chestZ - cfg.hipZ) * 0.7]);
  // neck
  bone(body, limbMat, cfg.neck[0], cfg.neck[1], cfg.neckR, cfg.neckR * 0.95);
  const top = cfg.bodyY - cfg.chestR[1] * 0.25;
  const legs = [
    ['legFL', cfg.legX, cfg.frontZ, true],
    ['legFR', -cfg.legX, cfg.frontZ, true],
    ['legBL', cfg.legX * 0.95, cfg.backZ, false],
    ['legBR', -cfg.legX * 0.95, cfg.backZ, false],
  ];
  for (const [name, x, z, front] of legs) {
    const s = Math.sign(x);
    const leg = (p[name] = pivot(body, [x, top, z]));
    const h = top;
    const pawY = -(h - cfg.pawR * 0.6);
    if (front) {
      // shoulder blade + upper arm + forearm
      ell(leg, coat, [s * -0.01, 0.03, 0], [cfg.legR * 1.6, cfg.legR * 2.4, cfg.legR * 2]);
      const elbow = [s * 0.005, -h * 0.42, -0.03];
      const wrist = [0, pawY + cfg.pawR * 0.8, 0.015];
      bone(leg, limbMat, [0, 0, 0], elbow, cfg.legR * 1.15);
      bone(leg, limbMat, elbow, wrist, cfg.legR * 0.8);
    } else {
      // haunch + thigh + shin + hock (digitigrade)
      ell(leg, coat, [s * -0.01, 0.0, 0.0], [cfg.legR * 1.7, cfg.legR * 2.6, cfg.legR * 2.3]);
      const knee = [0, -h * 0.32, 0.05];
      const hock = [0, -h * 0.66, -0.05];
      const foot = [0, pawY + cfg.pawR * 0.8, -0.005];
      bone(leg, limbMat, [0, 0, 0], knee, cfg.legR * 1.2);
      bone(leg, limbMat, knee, hock, cfg.legR * 0.85);
      bone(leg, limbMat, hock, foot, cfg.legR * 0.7);
    }
    ell(leg, cfg.pawMat ?? limbMat, [0, pawY, 0.03], [cfg.pawR * 1.05, cfg.pawR * 0.6, cfg.pawR * 1.35]);
    if (cfg.claws) {
      for (let k = -1.5; k <= 1.5; k++) {
        cone(leg, mat(cfg.clawColor ?? 0x2a2420, { roughness: 0.3 }), [k * cfg.pawR * 0.42, pawY - cfg.pawR * 0.2, 0.03 + cfg.pawR * 1.3], [0.007, cfg.clawLen ?? 0.035, 0.007], [Math.PI / 2 + 0.5, 0, 0], 6);
      }
    }
  }
  p.head = pivot(body, cfg.headPos);
  p.tail = pivot(body, cfg.tailPos);
  return { model, p, body };
}

// ---------------------------------------------------------------- Tiger
function buildTiger() {
  const coat = texMat(
    'tigerCoat',
    furMaps('tigerCoat', { base: 0xd8762b, dark: 0x8a4214, light: 0xf2a85a, belly: 0xf1e3c8, back: 0xc4621c, spine: true, paint: tigerStripes }),
  );
  const fur = texMat(
    'tigerFur',
    furMaps('tigerFur', {
      base: 0xd8762b,
      dark: 0x8a4214,
      light: 0xf2a85a,
      paint: (g, rnd) => {
        g.fillStyle = '#140c08';
        for (let i = 0; i < 9; i++) {
          const y = 14 + i * 28 + rnd() * 6;
          g.beginPath();
          g.ellipse(64 + rnd() * 128, y, 50 + rnd() * 40, 3 + rnd() * 3, (rnd() - 0.5) * 0.3, 0, Math.PI * 2);
          g.fill();
        }
      },
    }),
  );
  const cream = texMat('tigerCream', furMaps('tigerCream', { base: 0xf1e6d2, dark: 0xc9b9a0, light: 0xffffff }));
  const { model, p } = quadruped({
    coat,
    limbMat: fur,
    pawMat: cream,
    bodyY: 0.36,
    chestR: [0.145, 0.15, 0.17],
    chestZ: 0.1,
    hipR: [0.13, 0.135, 0.17],
    hipZ: -0.13,
    neck: [[0, 0.41, 0.18], [0, 0.46, 0.27]],
    neckR: 0.085,
    legX: 0.085,
    frontZ: 0.16,
    backZ: -0.17,
    legR: 0.04,
    pawR: 0.045,
    claws: true,
    clawColor: 0xe8e0cc,
    headPos: [0, 0.48, 0.3],
    tailPos: [0, 0.39, -0.28],
  });
  const h = p.head;
  ell(h, fur, [0, 0.005, 0], [0.105, 0.095, 0.105]);
  ell(h, fur, [0, 0.01, 0.085], [0.04, 0.035, 0.06]);
  mirror((s) => {
    ell(h, cream, [s * 0.065, -0.03, 0.03], [0.055, 0.06, 0.06]);
    ell(h, fur, [s * 0.07, 0.08, -0.035], [0.034, 0.034, 0.014]);
    ell(h, mat(0x15100c), [s * 0.07, 0.08, -0.045], [0.03, 0.03, 0.006]);
    eye(h, [s * 0.044, 0.028, 0.085], 0.015, 0xd9a11a);
    ell(h, fur, [s * 0.045, 0.045, 0.088], [0.034, 0.012, 0.022], [0.15, 0, s * 0.35]);
    ell(h, cream, [s * 0.026, -0.05, 0.115], [0.03, 0.026, 0.03]);
  });
  ell(h, mat(0x8c4a48, { roughness: 0.4 }), [0, -0.008, 0.147], [0.022, 0.015, 0.012]);
  // mouth interior and upper teeth
  ell(h, mat(0x5e1418, { roughness: 0.35 }), [0, -0.06, 0.07], [0.048, 0.02, 0.06]);
  mirror((s) => fang(h, [s * 0.026, -0.07, 0.122], 0.048, 0.008));
  teethArc(h, { y: -0.064, z: 0.07, radius: 0.045, count: 5, len: 0.014, r: 0.004, down: true, spread: 1.4 });
  p.jaw = pivot(h, [0, -0.065, 0.03]);
  ell(p.jaw, cream, [0, -0.016, 0.06], [0.048, 0.02, 0.065]);
  ell(p.jaw, mat(0xb85a64, { roughness: 0.4 }), [0, 0.0, 0.055], [0.03, 0.008, 0.05]);
  mirror((s) => fang(p.jaw, [s * 0.024, 0.002, 0.1], 0.035, 0.007, false));

  bone(p.tail, fur, [0, 0, 0], [0, -0.08, -0.14], 0.03, 0.03);
  p.tail2 = pivot(p.tail, [0, -0.08, -0.14]);
  bone(p.tail2, fur, [0, 0, 0], [0, -0.02, -0.15], 0.024);
  ell(p.tail2, mat(0x120c08), [0, -0.025, -0.17], [0.024, 0.024, 0.04]);

  const idle = (t) => {
    p.tail.rotation.y = Math.sin(t * 1.2) * 0.35;
    p.tail2.rotation.x = -0.6 + Math.sin(t * 1.9) * 0.25;
    p.head.rotation.y = Math.sin(t * 0.45) * 0.3;
    p.body.scale.y = 1 + Math.sin(t * 2.2) * 0.01;
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Wolf
function buildWolf() {
  const coat = texMat('wolfCoat', furMaps('wolfCoat', { base: 0x7a7066, dark: 0x3b3530, light: 0xb3aa9c, belly: 0xd9cfbf, back: 0x45403a, spine: true, len: 10 }));
  const fur = texMat('wolfFur', furMaps('wolfFur', { base: 0x7a7066, dark: 0x3b3530, light: 0xb3aa9c, len: 9 }));
  const pale = texMat('wolfPale', furMaps('wolfPale', { base: 0xd6ccbc, dark: 0xa59a88, light: 0xf0e8dc, len: 8 }));
  const { model, p, body } = quadruped({
    coat,
    limbMat: fur,
    pawMat: pale,
    bodyY: 0.38,
    chestR: [0.12, 0.14, 0.16],
    chestZ: 0.1,
    hipR: [0.11, 0.115, 0.16],
    hipZ: -0.13,
    neck: [[0, 0.43, 0.17], [0, 0.48, 0.25]],
    neckR: 0.1,
    legX: 0.07,
    frontZ: 0.15,
    backZ: -0.16,
    legR: 0.033,
    pawR: 0.04,
    claws: true,
    headPos: [0, 0.5, 0.28],
    tailPos: [0, 0.41, -0.27],
  });
  ell(body, pale, [0, 0.4, 0.21], [0.1, 0.11, 0.08]);
  const h = p.head;
  ell(h, fur, [0, 0.0, 0], [0.09, 0.085, 0.095]);
  bone(h, fur, [0, -0.005, 0.05], [0, -0.025, 0.19], 0.042, 0.04);
  ell(h, mat(0x161210, { roughness: 0.35 }), [0, -0.022, 0.205], [0.022, 0.017, 0.016]);
  mirror((s) => {
    ell(h, pale, [s * 0.06, -0.035, 0.02], [0.05, 0.05, 0.06]);
    cone(h, fur, [s * 0.05, 0.1, -0.025], [0.032, 0.085, 0.022], [-0.1, 0, -s * 0.18], 10);
    cone(h, mat(0x2a2420), [s * 0.05, 0.098, -0.014], [0.018, 0.06, 0.008], [-0.1, 0, -s * 0.18], 8);
    eye(h, [s * 0.04, 0.03, 0.075], 0.013, 0xe0a22a);
    ell(h, fur, [s * 0.04, 0.045, 0.078], [0.028, 0.01, 0.02], [0.2, 0, s * 0.35]);
    fang(h, [s * 0.022, -0.05, 0.17], 0.038, 0.007);
  });
  ell(h, mat(0x5e1418, { roughness: 0.35 }), [0, -0.048, 0.11], [0.034, 0.016, 0.075]);
  teethArc(h, { y: -0.047, z: 0.12, radius: 0.035, count: 6, len: 0.014, r: 0.004, down: true, spread: 1.4 });
  p.jaw = pivot(h, [0, -0.05, 0.04]);
  bone(p.jaw, pale, [0, -0.008, 0.02], [0, -0.012, 0.14], 0.03, 0.022);
  ell(p.jaw, mat(0xc0606a, { roughness: 0.4 }), [0, 0.004, 0.08], [0.022, 0.007, 0.05]);
  mirror((s) => fang(p.jaw, [s * 0.02, 0.0, 0.13], 0.03, 0.006, false));

  bone(p.tail, coat, [0, 0, 0], [0, -0.13, -0.12], 0.045, 0.05);
  ell(p.tail, mat(0x2a2420), [0, -0.21, -0.17], [0.035, 0.05, 0.035], [0.7, 0, 0]);

  const idle = (t) => {
    p.tail.rotation.y = Math.sin(t * 2.4) * 0.25;
    p.head.rotation.y = Math.sin(t * 0.55) * 0.35;
    p.head.rotation.x = Math.sin(t * 0.8) * 0.08;
    p.body.scale.y = 1 + Math.sin(t * 2.5) * 0.01;
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Bear
function buildBear() {
  const coat = texMat('bearCoat', furMaps('bearCoat', { base: 0x6a4729, dark: 0x3c2614, light: 0x9c7648, back: 0x5b3c22, belly: 0x56381f, spine: true, len: 12, strokes: 3400 }));
  const fur = texMat('bearFur', furMaps('bearFur', { base: 0x63422a, dark: 0x3c2614, light: 0x8e6a42, len: 11, strokes: 3400 }));
  const muzzle = texMat('bearMuzzle', furMaps('bearMuzzle', { base: 0xa07a52, dark: 0x6b4a2c, light: 0xc49c70, len: 5 }));
  const { model, p, body } = quadruped({
    coat,
    limbMat: fur,
    pawMat: mat(0x2e1f14),
    bodyY: 0.35,
    chestR: [0.19, 0.19, 0.19],
    chestZ: 0.08,
    hipR: [0.175, 0.17, 0.18],
    hipZ: -0.13,
    neck: [[0, 0.4, 0.17], [0, 0.42, 0.26]],
    neckR: 0.12,
    legX: 0.115,
    frontZ: 0.13,
    backZ: -0.16,
    legR: 0.058,
    pawR: 0.062,
    claws: true,
    clawColor: 0xd9cdb8,
    clawLen: 0.05,
    headPos: [0, 0.42, 0.3],
    tailPos: [0, 0.38, -0.29],
  });
  ell(body, coat, [0, 0.5, 0.11], [0.15, 0.1, 0.13]);
  const h = p.head;
  ell(h, fur, [0, 0.0, 0], [0.12, 0.105, 0.11]);
  ell(h, muzzle, [0, -0.03, 0.1], [0.06, 0.05, 0.07]);
  ell(h, mat(0x0e0b0a, { roughness: 0.3 }), [0, -0.012, 0.165], [0.03, 0.02, 0.018]);
  mirror((s) => {
    ell(h, fur, [s * 0.085, 0.085, -0.02], [0.035, 0.035, 0.022]);
    ell(h, mat(0x2a1a10), [s * 0.085, 0.085, -0.008], [0.02, 0.02, 0.01]);
    eye(h, [s * 0.05, 0.03, 0.09], 0.012, 0x3a2210);
    ell(h, fur, [s * 0.05, 0.045, 0.09], [0.03, 0.012, 0.022], [0.2, 0, s * 0.3]);
    fang(h, [s * 0.025, -0.07, 0.13], 0.035, 0.008);
  });
  ell(h, mat(0x5e1418, { roughness: 0.35 }), [0, -0.07, 0.08], [0.045, 0.02, 0.055]);
  teethArc(h, { y: -0.068, z: 0.08, radius: 0.045, count: 5, len: 0.012, r: 0.005, down: true, spread: 1.4 });
  p.jaw = pivot(h, [0, -0.072, 0.05]);
  ell(p.jaw, muzzle, [0, -0.014, 0.05], [0.05, 0.022, 0.06]);
  mirror((s) => fang(p.jaw, [s * 0.022, 0.003, 0.09], 0.028, 0.007, false));
  ell(p.tail, fur, [0, -0.02, -0.02], [0.04, 0.04, 0.04]);

  const idle = (t) => {
    p.head.rotation.x = 0.1 + Math.sin(t * 1.0) * 0.06;
    p.head.rotation.y = Math.sin(t * 0.4) * 0.25;
    p.body.scale.y = 1 + Math.sin(t * 1.6) * 0.014;
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Rhino
function buildRhino() {
  const hide = texMat('rhinoHide', skinMaps('rhinoHide', { base: 0x7a746d, dark: 0x45403b, light: 0x9a948c, wrinkles: 140 }), { bumpScale: 2.2, roughness: 0.92 });
  const horn = texMat('rhinoHorn', skinMaps('rhinoHorn', { base: 0xb8ab92, dark: 0x6f6452, light: 0xd8ccb2, wrinkles: 30 }), { roughness: 0.55 });
  const { model, p, body } = quadruped({
    coat: hide,
    limbMat: hide,
    pawMat: hide,
    bodyY: 0.34,
    chestR: [0.18, 0.17, 0.2],
    chestZ: 0.09,
    hipR: [0.175, 0.165, 0.19],
    hipZ: -0.13,
    neck: [[0, 0.36, 0.2], [0, 0.35, 0.28]],
    neckR: 0.12,
    legX: 0.105,
    frontZ: 0.16,
    backZ: -0.17,
    legR: 0.062,
    pawR: 0.064,
    claws: false,
    headPos: [0, 0.34, 0.3],
    tailPos: [0, 0.38, -0.31],
  });
  for (const z of [0.15, -0.05]) torso(body, hide, [0, 0.345, z], [0.186, 0.176, 0.045]);
  mirror((s) => {
    for (const [z] of [[0.17], [-0.18]]) {
      for (let k = -1; k <= 1; k++) ell(body, horn, [s * 0.105 + k * 0.025, 0.02, z + 0.06], [0.016, 0.014, 0.014]);
    }
  });
  const h = p.head;
  bone(h, hide, [0, 0.02, -0.02], [0, -0.06, 0.22], 0.095, 0.085);
  ell(h, hide, [0, -0.08, 0.22], [0.06, 0.05, 0.05]);
  cone(h, horn, [0, 0.07, 0.19], [0.045, 0.2, 0.05], [0.4, 0, 0], 14);
  cone(h, horn, [0, 0.05, 0.07], [0.034, 0.11, 0.038], [0.25, 0, 0], 12);
  mirror((s) => {
    cone(h, hide, [s * 0.06, 0.11, -0.06], [0.028, 0.08, 0.02], [-0.3, 0, -s * 0.35], 10);
    eye(h, [s * 0.085, 0.015, 0.07], 0.011, 0x2a1a10);
    ell(h, mat(0x1c1612), [s * 0.03, -0.075, 0.26], [0.012, 0.01, 0.01]);
  });
  bone(p.tail, hide, [0, 0, 0], [0, -0.14, -0.04], 0.016, 0.012);
  ell(p.tail, mat(0x1c1612), [0, -0.16, -0.045], [0.02, 0.035, 0.018]);

  const idle = (t) => {
    p.head.rotation.x = Math.sin(t * 0.8) * 0.07;
    p.tail.rotation.z = Math.sin(t * 2.6) * 0.4;
    p.body.scale.y = 1 + Math.sin(t * 1.4) * 0.01;
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Gorilla
function buildGorilla() {
  const model = new THREE.Group();
  const p = {};
  const coat = texMat('gorillaCoat', furMaps('gorillaCoat', { base: 0x2c2b31, dark: 0x111114, light: 0x5a5a64, back: 0xa4a4ac, spine: true, len: 9, strokes: 3200 }));
  const fur = texMat('gorillaFur', furMaps('gorillaFur', { base: 0x2c2b31, dark: 0x111114, light: 0x5c5c66, len: 9, strokes: 3200 }));
  const skin = texMat('gorillaSkin', skinMaps('gorillaSkin', { base: 0x2e2a2c, dark: 0x141213, light: 0x4a4443, wrinkles: 90 }), { roughness: 0.55, bumpScale: 1.8 });

  const body = (p.body = pivot(model));
  // massive chest and shoulders sloping down to small hips (knuckle-walking stance)
  torso(body, coat, [0, 0.4, 0.0], [0.17, 0.17, 0.2], [-0.6, 0, 0]);
  torso(body, coat, [0, 0.3, -0.12], [0.13, 0.13, 0.12], [-0.3, 0, 0]);
  ell(body, skin, [0, 0.37, 0.11], [0.11, 0.12, 0.06], [0.5, 0, 0]);
  mirror((s) => ell(body, fur, [s * 0.15, 0.49, 0.06], [0.1, 0.09, 0.11]));

  const h = (p.head = pivot(body, [0, 0.56, 0.16]));
  ell(h, fur, [0, 0.0, -0.01], [0.085, 0.09, 0.085]);
  ell(h, fur, [0, 0.085, -0.04], [0.035, 0.05, 0.065]);
  ell(h, skin, [0, -0.025, 0.055], [0.072, 0.07, 0.05]);
  ell(h, skin, [0, 0.032, 0.075], [0.08, 0.022, 0.035]);
  ell(h, skin, [0, -0.045, 0.085], [0.05, 0.035, 0.035]);
  ell(h, skin, [0, -0.012, 0.1], [0.03, 0.022, 0.016]);
  mirror((s) => {
    eye(h, [s * 0.03, 0.012, 0.088], 0.011, 0x3a2414);
    ell(h, mat(0x0c0a0a), [s * 0.011, -0.016, 0.113], [0.008, 0.007, 0.005]);
    ell(h, fur, [s * 0.082, 0.0, -0.01], [0.018, 0.026, 0.016]);
    fang(h, [s * 0.022, -0.07, 0.1], 0.03, 0.008);
  });
  ell(h, mat(0x4e1216, { roughness: 0.35 }), [0, -0.068, 0.075], [0.04, 0.018, 0.035]);
  p.jaw = pivot(h, [0, -0.072, 0.05]);
  ell(p.jaw, skin, [0, -0.012, 0.03], [0.052, 0.026, 0.04]);
  mirror((s) => fang(p.jaw, [s * 0.018, 0.006, 0.058], 0.02, 0.006, false));

  mirror((s) => {
    const arm = pivot(body, [s * 0.19, 0.5, 0.08]);
    bone(arm, fur, [0, 0, 0], [s * 0.05, -0.2, 0.07], 0.06);
    bone(arm, fur, [s * 0.05, -0.2, 0.07], [s * 0.06, -0.38, 0.13], 0.052);
    ell(arm, skin, [s * 0.06, -0.405, 0.145], [0.05, 0.04, 0.062]);
    for (let k = -1; k <= 1; k++) ell(arm, skin, [s * 0.06 + k * 0.022, -0.42, 0.19], [0.014, 0.014, 0.02]);
    p[s > 0 ? 'armL' : 'armR'] = arm;
    const leg = pivot(body, [s * 0.1, 0.25, -0.15]);
    bone(leg, fur, [0, 0, 0], [0, -0.1, 0.06], 0.06);
    bone(leg, fur, [0, -0.1, 0.06], [0, -0.2, 0.02], 0.045);
    ell(leg, skin, [0, -0.215, 0.05], [0.045, 0.022, 0.075]);
    p[s > 0 ? 'legL' : 'legR'] = leg;
  });

  const idle = (t) => {
    p.body.scale.set(1 + Math.sin(t * 1.8) * 0.012, 1, 1 + Math.sin(t * 1.8) * 0.012);
    p.head.rotation.y = Math.sin(t * 0.45) * 0.35;
    p.armL.rotation.z = Math.sin(t * 1.0) * 0.04;
    p.armR.rotation.z = -Math.sin(t * 1.0) * 0.04;
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Eagle
function buildEagle() {
  const model = new THREE.Group();
  const p = {};
  const plumage = texMat('eagleBody', featherMaps('eagleBody', { base: 0x4a2f19, dark: 0x24160a, light: 0x6e4a2a }), { roughness: 0.75 });
  const wingTex = texMat('eagleWing', featherMaps('eagleWing', { base: 0x3a2412, dark: 0x1a0f06, light: 0x5c3a1e }), { roughness: 0.75, side: THREE.DoubleSide });
  const white = texMat('eagleHead', furMaps('eagleHead', { base: 0xf1ede4, dark: 0xb8b0a0, light: 0xffffff, len: 6 }));
  const YEL = mat(0xe6a823, { roughness: 0.45 });
  const LEG = texMat('eagleLeg', scaleMaps('eagleLeg', { base: 0xd99a1e, dark: 0x9a6a10, light: 0xf0c050, cell: 10 }), { roughness: 0.5 });

  const body = (p.body = pivot(model));
  ell(body, plumage, [0, 0.36, -0.01], [0.16, 0.21, 0.15], [0.3, 0, 0]);
  ell(body, plumage, [0, 0.3, 0.06], [0.12, 0.14, 0.09], [0.25, 0, 0]);
  // legs feathered "trousers"
  mirror((s) => ell(body, plumage, [s * 0.065, 0.17, 0.02], [0.05, 0.07, 0.05]));

  const head = (p.head = pivot(body, [0, 0.57, 0.07]));
  ell(head, white, [0, 0, 0], [0.095, 0.095, 0.11]);
  ell(head, white, [0, -0.07, -0.03], [0.09, 0.07, 0.09]);
  // hooked beak
  ell(head, YEL, [0, -0.005, 0.105], [0.035, 0.04, 0.05]);
  cone(head, YEL, [0, 0.0, 0.16], [0.032, 0.09, 0.038], [Math.PI / 2, 0, 0], 12);
  cone(head, mat(0x3a2a14, { roughness: 0.4 }), [0, -0.03, 0.2], [0.014, 0.05, 0.016], [Math.PI * 0.85, 0, 0], 8);
  mirror((s) => {
    eye(head, [s * 0.05, 0.02, 0.07], 0.016, 0xf0c010);
    // heavy brow = permanent scowl
    ell(head, white, [s * 0.048, 0.04, 0.075], [0.035, 0.014, 0.028], [0.3, 0, s * 0.35]);
  });
  p.jaw = pivot(head, [0, -0.03, 0.09]);
  cone(p.jaw, YEL, [0, -0.005, 0.045], [0.026, 0.06, 0.012], [Math.PI / 2, 0, 0], 10);

  mirror((s) => {
    const w = pivot(body, [s * 0.13, 0.47, -0.03], [0, s * 0.3, -s * 1.3]);
    ell(w, wingTex, [s * 0.14, 0, 0], [0.16, 0.025, 0.12]);
    ell(w, wingTex, [s * 0.3, 0, -0.02], [0.13, 0.02, 0.1]);
    for (let k = 0; k < 6; k++) {
      ell(w, wingTex, [s * (0.42 + k * 0.012), 0, -0.07 + k * 0.03], [0.1, 0.01, 0.022], [0, s * (0.35 - k * 0.12), 0]);
    }
    p[s > 0 ? 'wingL' : 'wingR'] = w;
  });

  p.tail = pivot(body, [0, 0.22, -0.13]);
  for (let k = -2; k <= 2; k++) ell(p.tail, white, [k * 0.025, -0.04, -0.1], [0.024, 0.008, 0.11], [-0.6, k * 0.12, 0]);

  mirror((s) => limb(body, LEG, [s * 0.06, 0.13, 0.03], [s * 0.06, 0.03, 0.05], 0.022, 0.018));
  p.talons = pivot(body, [0, 0.02, 0.06]);
  mirror((s) => {
    for (let k = 0; k < 3; k++) {
      limb(p.talons, LEG, [s * 0.06, 0.005, 0], [s * 0.06 + (k - 1) * 0.025, 0.0, 0.05], 0.009, 0.008);
      cone(p.talons, mat(0x151210, { roughness: 0.3 }), [s * 0.06 + (k - 1) * 0.027, -0.005, 0.065], [0.008, 0.04, 0.008], [Math.PI / 2 + 0.6, 0, 0], 6);
    }
    cone(p.talons, mat(0x151210, { roughness: 0.3 }), [s * 0.06, 0.0, -0.025], [0.008, 0.035, 0.008], [-Math.PI / 2 - 0.5, 0, 0], 6);
  });

  p.setWings = (spread, flap = 0) => {
    for (const [w, s] of [
      [p.wingL, 1],
      [p.wingR, -1],
    ]) {
      w.rotation.set(0, s * 0.3 * (1 - spread), -s * (1.3 * (1 - spread) - 0.15 * spread - flap));
    }
  };

  const idle = (t) => {
    p.head.rotation.y = Math.sin(t * 0.6) * 0.5;
    p.head.rotation.x = Math.sin(t * 1.2) * 0.06;
    p.body.position.y = Math.sin(t * 2) * 0.005;
    p.setWings(Math.max(0, Math.sin(t * 0.45) - 0.93) * 4);
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Cobra
function buildCobra() {
  const model = new THREE.Group();
  const p = {};
  const scales = texMat('cobraScales', scaleMaps('cobraScales', { base: 0x4a4a2a, dark: 0x1f2012, light: 0x7a7444, cell: 10, belly: 0xc9b98a }), { roughness: 0.45, bumpScale: 1.6 });
  const belly = texMat('cobraBelly', scaleMaps('cobraBelly', { base: 0xd4c49a, dark: 0x9a8a62, light: 0xeadcb2, cell: 12, rounded: false }), { roughness: 0.45 });
  p.body = pivot(model);
  add(p.body, G.torus(0.36), scales, [0, 0.06, 0], [0.18, 0.18, 0.17], [Math.PI / 2, 0, 0]);
  add(p.body, G.torus(0.42), scales, [0, 0.145, -0.01], [0.13, 0.13, 0.12], [Math.PI / 2, 0, 0.6]);

  p.neck = [];
  let parent = p.body;
  const rest = [-0.12, 0.1, 0.12, 0.05];
  for (let i = 0; i < 4; i++) {
    const seg = pivot(parent, i === 0 ? [0, 0.17, 0.07] : [0, 0.1, 0], [rest[i], 0, 0]);
    ell(seg, scales, [0, 0.05, 0], [0.052 - i * 0.003, 0.07, 0.046]);
    ell(seg, belly, [0, 0.05, 0.022], [0.038, 0.064, 0.032]);
    p.neck.push(seg);
    parent = seg;
  }
  p.hood = pivot(p.neck[2], [0, 0.05, -0.02]);
  ell(p.hood, scales, [0, 0.05, -0.012], [0.12, 0.13, 0.02]);
  ell(p.hood, belly, [0, 0.05, 0.01], [0.09, 0.11, 0.012]);
  mirror((s) => {
    ell(p.hood, mat(0x15140c), [s * 0.045, 0.085, 0.016], [0.022, 0.018, 0.008]);
    ell(p.hood, mat(0x15140c), [s * 0.025, 0.06, 0.018], [0.01, 0.03, 0.006], [0, 0, s * 0.6]);
  });

  const h = (p.head = pivot(parent, [0, 0.11, 0], [-0.1, 0, 0]));
  ell(h, scales, [0, 0, 0.04], [0.052, 0.035, 0.085]);
  ell(h, scales, [0, 0.02, 0.025], [0.045, 0.022, 0.06]);
  mirror((s) => {
    eye(h, [s * 0.036, 0.016, 0.072], 0.012, 0x1a0e06, { slit: false });
    ell(h, scales, [s * 0.034, 0.03, 0.074], [0.016, 0.006, 0.014], [0, 0, s * 0.3]);
    cone(h, mat(0xf4eee0, { roughness: 0.3 }), [s * 0.02, -0.03, 0.1], [0.005, 0.034, 0.005], [Math.PI - 0.15, 0, 0], 6);
  });
  ell(h, mat(0x8a2a3a, { roughness: 0.3 }), [0, -0.02, 0.06], [0.036, 0.01, 0.055]);
  p.jaw = pivot(h, [0, -0.02, 0]);
  ell(p.jaw, belly, [0, -0.01, 0.05], [0.04, 0.013, 0.07]);
  p.tongue = pivot(h, [0, -0.012, 0.12]);
  limb(p.tongue, mat(0x1a0a10), [0, 0, 0], [0, 0, 0.07], 0.004, 0.003);
  mirror((s) => limb(p.tongue, mat(0x1a0a10), [0, 0, 0.07], [s * 0.012, 0, 0.1], 0.003, 0.0015));
  p.tongue.scale.z = 0.01;

  const idle = (t) => {
    p.neck.forEach((seg, i) => (seg.rotation.z = Math.sin(t * 1.4 - i * 0.6) * 0.09));
    p.tongue.scale.z = Math.sin(t * 2.7) > 0.75 ? 1 : 0.01;
    p.hood.scale.set(1 + Math.sin(t * 1.1) * 0.05, 1, 1);
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Shark
function buildShark() {
  const model = new THREE.Group();
  const p = {};
  const hide = texMat('sharkHide', skinMaps('sharkHide', { base: 0x5b6d7c, dark: 0x34414d, light: 0x7d8f9c, belly: 0xe9edf0, back: 0x3c4b58, wrinkles: 20 }), { roughness: 0.5, bumpScale: 0.8 });
  const fin = texMat('sharkFin', skinMaps('sharkFin', { base: 0x485866, dark: 0x2c3640, light: 0x66788a, wrinkles: 10 }), { roughness: 0.5, side: THREE.DoubleSide });
  const water = add(model, G.cyl(1, 40), mat(0x0f3d5c, { transparent: true, opacity: 0.88, roughness: 0.06, metalness: 0.2 }), [0, 0.012, 0], [0.4, 0.02, 0.4]);
  water.castShadow = false;
  water.userData.noGore = true;
  p.water = water;
  const foam = add(model, G.torus(0.1), mat(0xdfeef5, { roughness: 0.6 }), [0, 0.022, 0], [0.39, 0.39, 0.39], [Math.PI / 2, 0, 0]);
  foam.castShadow = false;
  foam.userData.noGore = true;
  p.foam = foam;

  const b = (p.body = pivot(model, [0, 0.19, 0]));
  torso(b, hide, [0, 0, -0.04], [0.12, 0.115, 0.3]);
  torso(b, hide, [0, 0.005, 0.17], [0.095, 0.085, 0.14]);
  ell(b, hide, [0, -0.005, 0.27], [0.05, 0.04, 0.06]);
  ell(b, mat(0x3c0a10, { roughness: 0.35 }), [0, -0.05, 0.19], [0.07, 0.028, 0.075]);
  mirror((s) => {
    eye(b, [s * 0.075, 0.035, 0.21], 0.014, 0x0a0a0a);
    for (let k = 0; k < 5; k++) add(b, G.box(), mat(0x26323c), [s * 0.11, 0.0, 0.1 - k * 0.025], [0.004, 0.065 - k * 0.006, 0.006], [0, 0, s * 0.1]);
    cone(b, fin, [s * 0.14, -0.06, 0.05], [0.07, 0.16, 0.015], [-0.3, 0, s * (Math.PI / 2 + 0.6)], 4);
  });
  // rows of serrated teeth
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < 9; k++) {
      const a = (k / 8 - 0.5) * 2.4;
      cone(b, mat(0xf2ede2, { roughness: 0.3 }), [Math.sin(a) * (0.066 - row * 0.012), -0.04, 0.19 + Math.cos(a) * (0.07 - row * 0.012)], [0.009, 0.032 - row * 0.008, 0.004], [Math.PI, a, 0], 3);
    }
  }
  p.jaw = pivot(b, [0, -0.055, 0.1]);
  ell(p.jaw, hide, [0, -0.016, 0.09], [0.08, 0.028, 0.1]);
  for (let k = 0; k < 9; k++) {
    const a = (k / 8 - 0.5) * 2.4;
    cone(p.jaw, mat(0xf2ede2, { roughness: 0.3 }), [Math.sin(a) * 0.06, 0.012, 0.09 + Math.cos(a) * 0.065], [0.008, 0.028, 0.004], [0, a, 0], 3);
  }
  p.fin = pivot(b, [0, 0.1, -0.02]);
  cone(p.fin, fin, [0, 0.07, -0.03], [0.018, 0.19, 0.1], [-0.42, 0, 0], 4);
  p.tail = pivot(b, [0, 0, -0.32]);
  torso(p.tail, hide, [0, 0, -0.03], [0.045, 0.055, 0.08]);
  cone(p.tail, fin, [0, 0.09, -0.09], [0.014, 0.22, 0.06], [-0.6, 0, 0], 4);
  cone(p.tail, fin, [0, -0.06, -0.07], [0.014, 0.13, 0.05], [-2.4, 0, 0], 4);

  const idle = (t) => {
    p.tail.rotation.y = Math.sin(t * 3.6) * 0.32;
    p.body.rotation.y = -Math.sin(t * 3.6) * 0.04;
    p.body.rotation.z = Math.sin(t * 1.8) * 0.04;
    p.body.position.y = 0.19 + Math.sin(t * 2.1) * 0.01;
    p.jaw.rotation.x = Math.max(0, Math.sin(t * 0.7) - 0.8) * 1.5;
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Scorpion
function buildScorpion() {
  const model = new THREE.Group();
  const p = {};
  const chitin = texMat('scorpChitin', skinMaps('scorpChitin', { base: 0x2c1c10, dark: 0x120a05, light: 0x4e3420, wrinkles: 30 }), { roughness: 0.28, metalness: 0.15, bumpScale: 0.9 });
  const claw = texMat('scorpClaw', skinMaps('scorpClaw', { base: 0x4a2a14, dark: 0x1e1008, light: 0x6e4424, wrinkles: 40 }), { roughness: 0.3, metalness: 0.15, bumpScale: 1.2 });
  const b = (p.body = pivot(model));
  ell(b, chitin, [0, 0.12, 0.08], [0.11, 0.05, 0.11]);
  for (let k = 0; k < 5; k++) ell(b, chitin, [0, 0.125 - k * 0.002, -0.03 - k * 0.055], [0.1 - k * 0.01, 0.048, 0.042]);
  mirror((s) => {
    ell(b, mat(0x050404, EYE_GLOSS), [s * 0.022, 0.168, 0.15], [0.011, 0.011, 0.011]);
    for (let k = 0; k < 3; k++) ell(b, mat(0x050404, EYE_GLOSS), [s * (0.07 + k * 0.008), 0.15, 0.17 - k * 0.008], [0.006, 0.006, 0.006]);
  });

  p.legs = [];
  mirror((s) => {
    for (let k = 0; k < 4; k++) {
      const z = 0.06 - k * 0.065;
      const leg = pivot(b, [s * 0.08, 0.11, z]);
      const knee = [s * 0.11, 0.07, (k - 1.5) * 0.025];
      const ankle = [s * 0.17, -0.02, (k - 1.5) * 0.05];
      const foot = [s * 0.2, -0.11, (k - 1.5) * 0.065];
      limb(leg, chitin, [0, 0, 0], knee, 0.014, 0.012);
      limb(leg, chitin, knee, ankle, 0.012, 0.009);
      limb(leg, chitin, ankle, foot, 0.009, 0.004);
      p.legs.push(leg);
    }
  });

  mirror((s) => {
    const cl = pivot(b, [s * 0.08, 0.12, 0.17]);
    limb(cl, claw, [0, 0, 0], [s * 0.1, 0.02, 0.1], 0.022, 0.02);
    limb(cl, claw, [s * 0.1, 0.02, 0.1], [s * 0.07, 0.03, 0.22], 0.022, 0.026);
    ell(cl, claw, [s * 0.07, 0.03, 0.27], [0.058, 0.042, 0.075]);
    cone(cl, claw, [s * 0.045, 0.03, 0.355], [0.019, 0.11, 0.016], [Math.PI / 2, 0, 0], 8);
    for (let k = 0; k < 4; k++) cone(cl, mat(0x0c0806), [s * 0.054, 0.03, 0.32 + k * 0.018], [0.004, 0.012, 0.004], [0, 0, s * Math.PI / 2], 4);
    const finger = pivot(cl, [s * 0.095, 0.03, 0.3], [0, s * 0.15, 0]);
    cone(finger, claw, [0, 0, 0.05], [0.017, 0.1, 0.015], [Math.PI / 2, 0, 0], 8);
    p[s > 0 ? 'clawL' : 'clawR'] = cl;
    p[s > 0 ? 'fingerL' : 'fingerR'] = finger;
  });

  p.tail = [];
  let parent = b;
  for (let i = 0; i < 5; i++) {
    const seg = pivot(parent, i === 0 ? [0, 0.13, -0.29] : [0, 0, -0.085], [i === 0 ? 1.1 : 0.5, 0, 0]);
    ell(seg, chitin, [0, 0, -0.045], [0.04 - i * 0.003, 0.038 - i * 0.003, 0.052]);
    p.tail.push(seg);
    parent = seg;
  }
  p.stinger = pivot(parent, [0, 0, -0.085]);
  ell(p.stinger, mat(0x8a4a1a, { roughness: 0.25, metalness: 0.1 }), [0, 0, -0.03], [0.04, 0.034, 0.05]);
  cone(p.stinger, mat(0x120806, { roughness: 0.2 }), [0, 0.03, -0.07], [0.012, 0.08, 0.012], [-0.6, 0, 0], 8);

  const idle = (t) => {
    p.tail[0].rotation.z = Math.sin(t * 1.1) * 0.1;
    p.tail[4].rotation.x = 0.5 + Math.sin(t * 2.3) * 0.1;
    p.fingerL.rotation.y = 0.15 + Math.max(0, Math.sin(t * 1.5)) * 0.35;
    p.fingerR.rotation.y = -0.15 - Math.max(0, Math.sin(t * 1.5 + 1)) * 0.35;
    p.legs.forEach((leg, i) => (leg.rotation.x = Math.sin(t * 3 + i) * 0.035));
  };
  return { model, parts: p, idle };
}

// ---------------------------------------------------------------- Crocodile
function buildCrocodile() {
  const model = new THREE.Group();
  const p = {};
  const armour = texMat('crocArmour', scaleMaps('crocArmour', { base: 0x3e4729, dark: 0x1e2414, light: 0x5c6838, cell: 16, belly: 0xb5aa78, rounded: false }), { roughness: 0.75, bumpScale: 2.4 });
  const plain = texMat('crocPlain', scaleMaps('crocPlain', { base: 0x3e4729, dark: 0x1e2414, light: 0x5c6838, cell: 9 }), { roughness: 0.7, bumpScale: 1.6 });
  const pale = texMat('crocBelly', scaleMaps('crocBelly', { base: 0xb9ae7e, dark: 0x8a7f58, light: 0xd4c99a, cell: 11, rounded: false }), { roughness: 0.7 });
  const inner = pivot(model, [0, 0, 0.03]);
  inner.scale.setScalar(0.85);
  const b = (p.body = pivot(inner));
  torso(b, armour, [0, 0.12, -0.02], [0.14, 0.072, 0.27]);
  torso(b, pale, [0, 0.09, -0.02], [0.12, 0.045, 0.24]);
  mirror((s) => {
    for (let k = 0; k < 6; k++) cone(b, plain, [s * 0.045, 0.18, 0.17 - k * 0.07], [0.02, 0.03, 0.025], [0, 0, 0], 4);
  });

  const h = (p.head = pivot(b, [0, 0.13, 0.22]));
  bone(h, armour, [0, 0.02, 0.0], [0, 0.015, 0.29], 0.075, 0.045);
  ell(h, armour, [0, 0.035, 0.02], [0.09, 0.055, 0.07]);
  ell(h, mat(0x8a3a34, { roughness: 0.4 }), [0, -0.01, 0.12], [0.065, 0.012, 0.14]);
  mirror((s) => {
    ell(h, armour, [s * 0.042, 0.08, 0.03], [0.028, 0.026, 0.03]);
    eye(h, [s * 0.046, 0.092, 0.046], 0.014, 0xb8b020, { slit: true });
    ell(h, mat(0x1c2010), [s * 0.016, 0.045, 0.28], [0.012, 0.012, 0.012]);
    for (let k = 0; k < 7; k++) fang(h, [s * (0.07 - k * 0.005), -0.012, 0.04 + k * 0.04], 0.028 + (k === 1 ? 0.012 : 0), 0.007);
  });
  p.jaw = pivot(h, [0, -0.012, -0.02]);
  bone(p.jaw, pale, [0, -0.015, 0.02], [0, -0.015, 0.29], 0.07, 0.04);
  mirror((s) => {
    for (let k = 0; k < 7; k++) fang(p.jaw, [s * (0.064 - k * 0.005), 0.006, 0.06 + k * 0.04], 0.026 + (k === 2 ? 0.012 : 0), 0.0065, false);
  });

  p.legs = [];
  mirror((s) => {
    for (const z of [0.15, -0.16]) {
      const leg = pivot(b, [s * 0.12, 0.1, z]);
      bone(leg, plain, [0, 0, 0], [s * 0.08, -0.045, 0.01], 0.034);
      bone(leg, plain, [s * 0.08, -0.045, 0.01], [s * 0.1, -0.08, 0.04], 0.026);
      ell(leg, plain, [s * 0.105, -0.088, 0.06], [0.04, 0.012, 0.045]);
      for (let k = -1; k <= 1; k++) cone(leg, mat(0x161a0e), [s * 0.105 + k * 0.016, -0.09, 0.1], [0.005, 0.022, 0.005], [Math.PI / 2, 0, 0], 5);
      p.legs.push(leg);
    }
  });

  p.tail = [];
  let parent = b;
  for (let i = 0; i < 4; i++) {
    const seg = pivot(parent, i === 0 ? [0, 0.11, -0.27] : [0, 0, -0.1], [0, 0.32, 0]);
    torso(seg, armour, [0, 0, -0.05], [0.085 - i * 0.017, 0.052 - i * 0.008, 0.07]);
    mirror((s) => cone(seg, plain, [s * 0.02, 0.05 - i * 0.008, -0.05], [0.014, 0.03, 0.02], [0, 0, 0], 4));
    p.tail.push(seg);
    parent = seg;
  }

  const idle = (t) => {
    p.tail.forEach((seg, i) => (seg.rotation.y = 0.32 + Math.sin(t * 1.1 - i * 0.7) * 0.1));
    p.jaw.rotation.x = Math.max(0, Math.sin(t * 0.5) - 0.6) * 1.0;
    p.head.rotation.y = Math.sin(t * 0.4) * 0.1;
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

// style 'kids' builds the cute Kids-mode version of the animal.
export function createAnimal(id, style = 'action') {
  const realistic = BUILDERS[id] || buildTiger;
  const built = style === 'kids' ? buildKidAnimal(id, realistic) : realistic();
  built.model.traverse((o) => {
    o.userData.rest = { position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone() };
  });
  return built;
}

// How much screen an animal fills, relative to a tiger; the kill-cam backs off for bulky animals.
export const BULK = { eagle: 1, tiger: 1, wolf: 1, bear: 1.2, cobra: 0.95, shark: 1.1, gorilla: 1.15, rhino: 1.3, scorpion: 0.95, crocodile: 1.05 };

// Debris palette per animal (fur tufts, feathers, scales...) thrown along with the blood.
export const DEBRIS = {
  eagle: { kind: 'feather', colors: [0x4a2f19, 0xf1ede4, 0x2a1a0c] },
  tiger: { kind: 'fur', colors: [0xd8762b, 0x140c08, 0xf1e6d2] },
  wolf: { kind: 'fur', colors: [0x7a7066, 0xd6ccbc, 0x3b3530] },
  bear: { kind: 'fur', colors: [0x6a4729, 0x3c2614] },
  cobra: { kind: 'scale', colors: [0x4a4a2a, 0xd4c49a] },
  shark: { kind: 'skin', colors: [0x5b6d7c, 0xe9edf0] },
  gorilla: { kind: 'fur', colors: [0x1f1e22, 0x8d8d94] },
  rhino: { kind: 'skin', colors: [0x7a746d, 0x45403b] },
  scorpion: { kind: 'shard', colors: [0x2c1c10, 0x4a2a14] },
  crocodile: { kind: 'scale', colors: [0x3e4729, 0xb5aa78] },
};
