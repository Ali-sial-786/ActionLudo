import * as THREE from 'three';
import { Ease, pick, rand } from '../engine/anim.js';
import { BOARD_Y } from './boardMesh.js';
import { getGlowTexture } from './effects.js';

// Blood, wounds and dismemberment.

// `blood` scales how much blood is spilled: droplets, mist, meat, stains and wounds (1 = full-on).
export const goreSettings = { enabled: true, blood: 0.35 };
const blood = () => goreSettings.blood;

const MAX_DROPS = 1200;
const MAX_DECALS = 220;

function floorAt(x, z) {
  return Math.abs(x) < 7.85 && Math.abs(z) < 7.85 ? BOARD_Y : -0.02;
}

// ------------------------------------------------------------------ decal textures
function splatCanvas(kind, seed) {
  let s = seed * 9973 + 17;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const blob = (x, y, r, col, a = 1) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${col},${a})`);
    grad.addColorStop(0.75, `rgba(${col},${a})`);
    grad.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  const dark = '70,2,6';
  const mid = '118,6,12';
  if (kind === 'pool') {
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * 60;
      blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 30 + rnd() * 34, i % 3 ? mid : dark, 0.95);
    }
  } else if (kind === 'smear') {
    for (let i = 0; i < 40; i++) {
      const x = 20 + (i / 40) * 216;
      blob(x, 128 + (rnd() - 0.5) * 30, 14 + rnd() * 18 * (1 - Math.abs(i / 40 - 0.5)), i % 2 ? mid : dark, 0.85);
    }
    g.strokeStyle = `rgba(${dark},0.6)`;
    for (let i = 0; i < 6; i++) {
      g.lineWidth = 1 + rnd() * 2;
      g.beginPath();
      const y = 110 + rnd() * 36;
      g.moveTo(10, y);
      g.lineTo(246, y + (rnd() - 0.5) * 10);
      g.stroke();
    }
  } else {
    blob(128, 128, 36 + rnd() * 18, mid, 0.95);
    for (let i = 0; i < 10; i++) {
      const a = rnd() * Math.PI * 2;
      const d = 20 + rnd() * 26;
      blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 12 + rnd() * 16, i % 2 ? mid : dark, 0.95);
    }
    for (let i = 0; i < 24; i++) {
      const a = rnd() * Math.PI * 2;
      const d = 50 + rnd() * 70;
      blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 2 + rnd() * 6, mid, 0.9);
    }
    g.strokeStyle = `rgba(${mid},0.85)`;
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2;
      g.lineWidth = 2 + rnd() * 4;
      g.beginPath();
      g.moveTo(128 + Math.cos(a) * 30, 128 + Math.sin(a) * 30);
      g.lineTo(128 + Math.cos(a) * (70 + rnd() * 50), 128 + Math.sin(a) * (70 + rnd() * 50));
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let decalMats = null;
function getDecalMats() {
  if (decalMats) return decalMats;
  const make = (kind, seed) =>
    new THREE.MeshStandardMaterial({
      map: splatCanvas(kind, seed),
      transparent: true,
      depthWrite: false,
      roughness: 0.12,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
  decalMats = {
    splat: [1, 2, 3, 4, 5].map((s) => make('splat', s)),
    pool: [1, 2].map((s) => make('pool', s)),
    smear: [1, 2].map((s) => make('smear', s)),
  };
  return decalMats;
}

const decalGeo = new THREE.PlaneGeometry(1, 1);
decalGeo.rotateX(-Math.PI / 2);

// ------------------------------------------------------------------ flesh materials
// A double-sided copy whose inside faces render as wet crimson flesh, so torn / sliced bodies show meat.
export function fleshify(material) {
  const m = material.clone();
  m.side = THREE.DoubleSide;
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (!gl_FrontFacing) { diffuseColor.rgb = vec3(0.30, 0.012, 0.018); }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        if (!gl_FrontFacing) { roughnessFactor = 0.22; }`,
      );
  };
  m.customProgramCacheKey = () => 'flesh';
  m.userData = { ...material.userData };
  return m;
}

// Axis-aligned bounds of `obj`'s meshes expressed in `frame`'s local space (obj's own by default).
function localBounds(obj, frame = obj) {
  const box = new THREE.Box3();
  obj.updateMatrixWorld(true);
  frame.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert();
  const tmp = new THREE.Box3();
  obj.traverse((o) => {
    if (!o.isMesh || o.userData.wound) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    tmp.copy(o.geometry.boundingBox).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    box.union(tmp);
  });
  return box;
}

let capMats = null;
// Raw cross-section where a body was cut: meat, a rim of fat/skin and the spine.
function makeCap(rx, ry) {
  capMats ??= {
    meat: new THREE.MeshStandardMaterial({ color: 0x7a0a12, roughness: 0.22, metalness: 0.05 }),
    fat: new THREE.MeshStandardMaterial({ color: 0xd9b0a0, roughness: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x3a0206, roughness: 0.18 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xece2cf, roughness: 0.45 }),
  };
  const g = new THREE.Group();
  const disc = (mat, sx, sy, z, x = 0, y = 0) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 28), mat);
    m.scale.set(sx, sy, 1);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  disc(capMats.fat, rx, ry, 0);
  disc(capMats.meat, rx * 0.9, ry * 0.88, 0.001);
  disc(capMats.dark, rx * 0.45, ry * 0.35, 0.002, 0, -ry * 0.15);
  disc(capMats.bone, rx * 0.16, rx * 0.16, 0.003, 0, ry * 0.55);
  disc(capMats.bone, rx * 0.07, ry * 0.22, 0.003, 0, ry * 0.25);
  return g;
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _c = new THREE.Vector3();
const _h = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

// Directions used to probe the lowest visible point of a half that has been cut open.
const PROBES = [];
for (let i = 0; i < 40; i++) {
  const y = 1 - (2 * (i + 0.5)) / 40;
  const r = Math.sqrt(1 - y * y);
  const a = i * 2.39996;
  PROBES.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
}

// World height of the lowest visible point of a torn piece. Every shape on the animals is a unit
// blob sized by its transform, so each mesh is treated as the ellipsoid inside its bounding box;
// a body half that has been cut open only counts the side its clipping plane keeps.
function lowestPoint(obj) {
  let low = Infinity;
  obj.traverse((o) => {
    if (!o.isMesh || !o.visible || o.userData.wound) return;
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    bb.getCenter(_c);
    bb.getSize(_h).multiplyScalar(0.5);
    const e = o.matrixWorld.elements;
    const plane = o.material.clippingPlanes?.[0];
    if (!plane) {
      // support of the ellipsoid along -y
      const ry = Math.hypot(e[1] * _h.x, e[5] * _h.y, e[9] * _h.z);
      low = Math.min(low, _v.copy(_c).applyMatrix4(o.matrixWorld).y - ry);
      return;
    }
    for (const d of PROBES) {
      _v.set(_c.x + d.x * _h.x, _c.y + d.y * _h.y, _c.z + d.z * _h.z).applyMatrix4(o.matrixWorld);
      if (_v.y < low && plane.distanceToPoint(_v) >= 0) low = _v.y;
    }
  });
  return low;
}

const contains = (root, obj) => {
  for (let o = obj; o; o = o.parent) if (o === root) return true;
  return false;
};

export class Gore {
  constructor(world, fx) {
    this.world = world;
    this.fx = fx;
    this.layer = world.transient;
    this.drops = [];
    this.decals = [];
    this.chunks = [];
    this.sets = new Set();
    this.mists = [];
    this.dropMesh = null;
    world.onFrame((dt) => this.update(dt));
  }

  get on() {
    return goreSettings.enabled;
  }

  ensureDropMesh() {
    if (this.dropMesh && this.dropMesh.parent) return this.dropMesh;
    const geo = new THREE.SphereGeometry(1, 8, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6e0710, roughness: 0.14, metalness: 0.08, emissive: 0x160000 });
    this.dropMesh = new THREE.InstancedMesh(geo, mat, MAX_DROPS);
    this.dropMesh.count = 0;
    this.dropMesh.frustumCulled = false;
    this.dropMesh.castShadow = true;
    this.layer.add(this.dropMesh);
    return this.dropMesh;
  }

  clear() {
    this.drops = [];
    this.decals = [];
    this.chunks = [];
    this.mists = [];
    this.sets.clear();
    this.dropMesh = null;
  }

  // ------------------------------------------------------------ blood droplets
  spray(origin, dir = null, { count = 40, speed = 3, spread = 0.45, size = [0.004, 0.012], up = 0.6, splat = 0.3 } = {}) {
    if (!this.on) return;
    this.ensureDropMesh();
    const d = dir ? dir.clone().normalize() : null;
    const n = Math.round(count * blood());
    for (let i = 0; i < n && this.drops.length < MAX_DROPS; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
      if (d) v.multiplyScalar(spread).add(d).normalize();
      v.multiplyScalar(speed * rand(0.45, 1.15));
      v.y += up * rand(0.3, 1);
      this.drops.push({ p: origin.clone(), v, s: rand(size[0], size[1]), splat, life: 3 });
    }
  }

  // Omnidirectional explosion of blood, a short-lived red mist and a few lumps of meat.
  burst(origin, power = 1) {
    if (!this.on) return;
    this.spray(origin, null, { count: Math.round(110 * power), speed: 2.8 * power, spread: 1, up: 1.1, size: [0.005, 0.014], splat: 0.35 });
    this.mist(origin, power * (0.6 + 0.4 * blood()));
    this.meat(origin, Math.round(6 * power), 1.8 * power);
  }

  mist(origin, size = 1) {
    if (!this.on) return;
    const opacity = 0.55 * (0.4 + 0.6 * blood());
    for (let i = 0; i < Math.max(1, Math.round(4 * blood())); i++) {
      const mat = new THREE.SpriteMaterial({ map: getGlowTexture(), color: pick([0x5a0006, 0x7a0a10, 0x3a0003]), transparent: true, opacity, depthWrite: false });
      const s = new THREE.Sprite(mat);
      s.position.copy(origin).add(new THREE.Vector3(rand(-0.1, 0.1), rand(-0.05, 0.15), rand(-0.1, 0.1)));
      s.scale.setScalar(0.2 * size);
      this.layer.add(s);
      this.mists.push({ s, mat, opacity, t: 0, dur: rand(0.6, 1.1), to: size * rand(0.7, 1.2), rise: rand(0.05, 0.2) });
    }
  }

  // Flesh chunks and bone splinters.
  meat(origin, count = 10, speed = 2.5) {
    if (!this.on) return;
    for (let i = 0; i < Math.round(count * blood()); i++) {
      const bone = Math.random() < 0.25;
      const geo = bone ? new THREE.CylinderGeometry(0.006, 0.01, 1, 5) : new THREE.IcosahedronGeometry(1, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: bone ? 0xe6dccb : pick([0x6a0a0f, 0x8a1c20, 0xa4403a, 0x4e0508]),
        roughness: bone ? 0.5 : 0.25,
      });
      const m = new THREE.Mesh(geo, mat);
      const s = bone ? rand(0.04, 0.08) : rand(0.015, 0.035);
      if (bone) m.scale.set(1, s, 1);
      else m.scale.set(s, s * rand(0.6, 1), s * rand(0.7, 1.2));
      m.position.copy(origin);
      m.castShadow = true;
      this.layer.add(m);
      const v = new THREE.Vector3(rand(-1, 1), rand(0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.4, 1));
      // stray scraps shrink away soon after they land
      this.chunks.push({ m, v, ang: new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8)), r: bone ? 0.01 : s, life: rand(2.2, 3.4), rest: false, bleed: 0.3 });
    }
  }

  // ------------------------------------------------------------ stains
  decal(pos, size, kind = 'splat', { rot = rand(0, Math.PI * 2), grow = 0, life = 40, stretch = 1 } = {}) {
    if (!this.on) return null;
    const mats = getDecalMats()[kind];
    const mat = pick(mats).clone();
    // less blood: smaller, fainter stains
    size *= 0.6 + 0.4 * blood();
    mat.opacity = 0.55 + 0.45 * blood();
    const m = new THREE.Mesh(decalGeo, mat);
    const y = floorAt(pos.x, pos.z) + 0.002 + this.decals.length * 0.00002;
    m.position.set(pos.x, y, pos.z);
    m.rotation.y = rot;
    m.scale.set(size * stretch, 1, size);
    m.receiveShadow = true;
    m.renderOrder = 1;
    this.layer.add(m);
    const d = { m, mat, alpha: mat.opacity, life, maxLife: life, grow, size, stretch, t: 0 };
    if (grow) m.scale.set(0.01, 1, 0.01);
    this.decals.push(d);
    if (this.decals.length > MAX_DECALS) {
      const old = this.decals.shift();
      old.m.removeFromParent();
      old.mat.dispose();
    }
    return d;
  }

  pool(pos, size = 0.6, grow = 2.5) {
    return this.decal(pos, size, 'pool', { grow });
  }

  smear(from, to, width = 0.22) {
    const d = to.clone().sub(from).setY(0);
    const len = d.length();
    if (len < 0.02) return null;
    const mid = from.clone().add(to).multiplyScalar(0.5);
    return this.decal(mid, width, 'smear', { rot: Math.atan2(-d.z, d.x), stretch: Math.max(1, (len + width * 0.6) / width) });
  }

  // ------------------------------------------------------------ wounds stuck on a body
  nearestMesh(view, point) {
    let best = null;
    let bestD = Infinity;
    for (const m of view.meshes()) {
      if (m.userData.wound || m.userData.noGore) continue;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      m.getWorldPosition(_v);
      m.getWorldScale(_s);
      const r = m.geometry.boundingSphere.radius * Math.max(_s.x, _s.y, _s.z);
      const d = _v.distanceTo(point) - r * 0.6;
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  // A raw, glistening wound (or claw gashes when gash > 0) on the mesh nearest to `point`.
  wound(view, point, { size = 0.05, gash = 0, angle = rand(-0.6, 0.6) } = {}) {
    if (!this.on) return null;
    size *= 0.75 + 0.25 * blood();
    const host = this.nearestMesh(view, point);
    if (!host) return null;
    const local = host.worldToLocal(point.clone());
    if (local.lengthSq() < 1e-6) local.set(0, 0, 1);
    local.normalize().multiplyScalar(0.97);
    const surf = host.localToWorld(local.clone());
    const center = host.getWorldPosition(new THREE.Vector3());
    const normal = surf.clone().sub(center).normalize();
    const root = new THREE.Group();
    root.position.copy(surf);
    root.lookAt(surf.clone().add(normal));
    root.rotateZ(angle);
    const meatMat = new THREE.MeshStandardMaterial({ color: 0x5a0408, roughness: 0.15, metalness: 0.05 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x9a1a1e, roughness: 0.3 });
    const cuts = gash ? 3 : 1;
    for (let i = 0; i < cuts; i++) {
      const off = gash ? (i - 1) * size * 0.7 : 0;
      const rim = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), rimMat);
      rim.scale.set(gash ? size * 1.6 : size, gash ? size * 0.2 : size * 0.75, size * 0.25);
      rim.position.set(0, off, 0);
      const core = new THREE.Mesh(rim.geometry, meatMat);
      core.scale.set(rim.scale.x * 0.8, rim.scale.y * 0.6, size * 0.3);
      core.position.set(0, off, size * 0.03);
      root.add(rim, core);
    }
    host.parent.attach(root);
    root.userData.wound = true;
    root.userData.woundRoot = true;
    root.traverse((o) => {
      o.userData.wound = true;
      o.castShadow = false;
      o.userData.rest = { position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone() };
    });
    return root;
  }

  // ------------------------------------------------------------ dismemberment
  chunkRoots(view) {
    const entries = Object.entries(view.parts).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]));
    const set = new Set(entries.filter(([k, v]) => v && v.isObject3D && k !== 'body' && !v.userData.noGore).map(([, v]) => v));
    return [...set].filter((o) => {
      let hasMesh = false;
      o.traverse((c) => (hasMesh ||= c.isMesh));
      if (!hasMesh) return false;
      for (let p = o.parent; p && p !== view.model; p = p.parent) if (set.has(p)) return false;
      return true;
    });
  }

  // Tear an animal apart into a few big pieces that part briskly, turn about one axis (no random
  // tumbling) and come to rest on the board close to the square.
  //   mode 'limbs': the head is flung off, the legs drop away around the torso, which rolls onto its side.
  //   mode 'halves': the torso is cut in two across `axis` ('z' front/back, 'x' left/right); limbs and
  //   head ride along with the half they sit on, only parts the cut runs through come off on their own.
  // `power` sets how far the pieces travel and `up` how high they pop; the carcass ends up lying with
  // its back towards `toward` (a horizontal direction, e.g. the camera's side) when one is given.
  dismember(view, { mode = 'limbs', dir = null, power = 2.4, up = 1.8, axis = 'z', toward = null } = {}) {
    const layer = this.layer;
    view.isolateMaterials();
    if (this.on) {
      for (const m of view.meshes()) {
        if (m.userData.noGore) continue;
        const plain = m.material;
        m.material = fleshify(plain);
        plain.dispose();
      }
    } else {
      mode = 'limbs'; // bloodless: parts come off cleanly, nothing is cut open
    }
    view.root.updateMatrixWorld(true);
    const d = dir ? dir.clone().setY(0).normalize() : null;
    const body = view.parts.body ?? view.model;
    const bodyParent = body.parent;
    const head = view.parts.head;
    const roots = this.chunkRoots(view);
    const halves = mode === 'halves';

    // Which pieces come off on their own: in 'limbs' mode the head plus the four biggest limbs (the
    // rest stay on the torso); in 'halves' mode only the parts the cut runs through.
    const n = axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const comp = axis === 'x' ? 'x' : 'z';
    const info = roots.map((root) => ({ root, parent: root.parent, box: localBounds(root, body), isHead: !!head && contains(root, head) }));
    for (const r of info) layer.attach(r.root);
    const lb = localBounds(body);
    const centerL = lb.getCenter(new THREE.Vector3());
    // the middle of the torso as it lies now (an animal knocked on its side has its feet off to one side)
    const core = body.localToWorld(centerL.clone());
    const sizeL = lb.getSize(new THREE.Vector3());
    if (halves) {
      for (const r of info) {
        const lo = r.box.min[comp] - centerL[comp];
        const hi = r.box.max[comp] - centerL[comp];
        r.free = Math.min(hi, -lo) > Math.max(0.015, 0.2 * (hi - lo));
        r.side = lo + hi >= 0 ? 1 : -1;
      }
    } else {
      const limbs = info.filter((r) => !r.isHead).sort((a, b) => b.box.getSize(_v).lengthSq() - a.box.getSize(_c).lengthSq());
      for (const r of info) r.free = r.isHead || limbs.indexOf(r) < 4;
      for (const r of info) r.side = 1;
    }

    const chunks = [];
    const launch = (obj, parent, com, vel, { w, left }, extra = {}) => {
      const r = Math.max(0.03, localBounds(obj).getSize(new THREE.Vector3()).length() * 0.25);
      chunks.push({ obj, parent, com, p: obj.localToWorld(com.clone()), vel, w, left, r, t: 0, rest: false, landed: false, bleed: 1, ...extra });
    };
    // Turn by `angle` about `axis` in all, at a rate that gets most of it done in the air; a piece
    // that lands early topples over the rest of the way on the board.
    const turn = (obj, com, vel, axisW, angle) => {
      const y = obj.localToWorld(com.clone()).y - floorAt(core.x, core.z);
      const t = (vel.y + Math.sqrt(vel.y * vel.y + 19.6 * Math.max(0.05, y))) / 9.8;
      return { w: axisW.clone().normalize().multiplyScalar(Math.max(2.5, angle / t)), left: angle };
    };
    // The shortest turn that swings world direction `from` (a piece's long axis) round onto `to`.
    const lieDown = (obj, com, vel, from, to) => {
      const w = from.clone().cross(to);
      if (w.lengthSq() < 1e-6) w.set(0, 1, 0).cross(from);
      if (w.lengthSq() < 1e-6) w.set(1, 0, 0);
      return turn(obj, com, vel, w, from.angleTo(to));
    };
    // The single turn that carries two of a piece's directions (fromA, fromB) onto (toA, toB) at once.
    const settle = (obj, com, vel, fromA, toA, fromB, toB) => {
      const basis = (a, b) => {
        const x = a.clone().normalize();
        const y = b.clone().addScaledVector(x, -b.dot(x));
        if (y.lengthSq() < 1e-6) y.set(0, 1, 0).addScaledVector(x, -x.y);
        y.normalize();
        return new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y));
      };
      const m = basis(toA, toB).multiply(basis(fromA, fromB).transpose());
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      const angle = 2 * Math.acos(Math.min(1, q.w));
      const w = new THREE.Vector3(q.x, q.y, q.z);
      if (w.lengthSq() < 1e-10) w.set(0, 1, 0);
      return turn(obj, com, vel, w, angle);
    };
    // the way a carcass rolls: its back towards `toward` (the camera's side), else its nearest side
    const backTo = (upW) => {
      const t = toward ? toward.clone().setY(0) : upW.clone().setY(0);
      if (t.lengthSq() < 0.09) t.copy(d ? new THREE.Vector3(-d.z, 0, d.x) : new THREE.Vector3(1, 0, 0));
      return t.normalize();
    };

    // the torso
    let halfB = null;
    if (halves) {
      const centerW = body.localToWorld(centerL.clone());
      const planeA = { local: new THREE.Plane().setFromNormalAndCoplanarPoint(n, centerL), world: new THREE.Plane() };
      const planeB = { local: new THREE.Plane().setFromNormalAndCoplanarPoint(n.clone().negate(), centerL), world: new THREE.Plane() };
      const twin = body.clone(true);
      twin.traverse((o) => {
        if (o.isMesh) {
          o.material = fleshify(o.material);
          o.material.clippingPlanes = [planeB.world];
          o.material.clipShadows = true;
        }
      });
      body.traverse((o) => {
        if (o.isMesh) {
          o.material.clippingPlanes = [planeA.world];
          o.material.clipShadows = true;
        }
      });
      // cap both cut faces with a raw cross-section
      const rx = (axis === 'x' ? sizeL.z : sizeL.x) * 0.42;
      const ry = sizeL.y * 0.4;
      for (const [half, sign] of [
        [body, -1],
        [twin, 1],
      ]) {
        const cap = makeCap(rx, ry);
        cap.position.copy(centerL).addScaledVector(n, sign * 0.002);
        cap.lookAt(cap.position.clone().addScaledVector(n, sign));
        cap.userData.cap = true;
        half.add(cap);
      }
      bodyParent.add(twin);
      twin.position.copy(body.position);
      twin.quaternion.copy(body.quaternion);
      twin.scale.copy(body.scale);
      twin.updateMatrixWorld(true);
      planeA.world.copy(planeA.local).applyMatrix4(body.matrixWorld);
      planeB.world.copy(planeB.local).applyMatrix4(body.matrixWorld);
      layer.attach(body);
      layer.attach(twin);
      halfB = twin;
      const axisW = n.clone().transformDirection(body.matrixWorld).setY(0);
      if (axisW.lengthSq() < 0.09) axisW.set(d ? -d.z : 1, 0, d ? d.x : 0);
      axisW.normalize();
      // the halves part along the cut, far enough to leave the middle of the square clear
      const out = 0.4 * power;
      const hop = 1.1 + 0.4 * up;
      const square = view.root.getWorldPosition(new THREE.Vector3());
      const axisN = n.clone().transformDirection(body.matrixWorld);
      const upW = new THREE.Vector3(0, 1, 0).transformDirection(body.matrixWorld);
      // cut across the camera's line (front / back): each half rolls onto its side with its back to
      // the camera, outer end a little low so the cut tilts up; cut along it (left / right): each
      // half falls outward onto its flank so the raw face turns up
      const across = !toward || Math.abs(toward.dot(axisW)) < 0.7;
      for (const [half, s, plane] of [
        [body, 1, planeA],
        [twin, -1, planeB],
      ]) {
        const com = centerL.clone().addScaledVector(n, s * sizeL[comp] * 0.25);
        const gap = body.localToWorld(com.clone()).sub(square).setY(0).dot(axisW) * s;
        const vel = axisW.clone().multiplyScalar(s * (out + Math.max(0, 0.42 - gap - out * 0.3) / 0.3)).add(new THREE.Vector3(0, hop, 0));
        if (d) vel.addScaledVector(d, out * 0.25);
        const from = axisN.clone().multiplyScalar(s);
        const tilt = across ? 0.3 : 1.2;
        const to = axisW.clone().multiplyScalar(s * Math.cos(tilt)).addScaledVector(Y, -Math.sin(tilt));
        const spin = across ? settle(half, com, vel, from, to, upW, backTo(upW)) : lieDown(half, com, vel, from, to);
        const extra = s > 0 ? {} : { twin: true, restFrom: body }; // the clone borrows the torso's rest pose
        launch(half, bodyParent, com, vel, spin, { plane, bleed: 1.6, ...extra });
      }
      this.spray(centerW, axisW, { count: 34, speed: 2.4, spread: 0.5, up: 0.6 });
      this.spray(centerW, axisW.clone().negate(), { count: 34, speed: 2.4, spread: 0.5, up: 0.6 });
    } else {
      // the torso drops and slumps onto its side, its back to the camera, sliding clear of the
      // middle of the square where the killer is about to stand
      const upW = new THREE.Vector3(0, 1, 0).transformDirection(body.matrixWorld);
      const vel = new THREE.Vector3(0, 0.9, 0);
      const square = view.root.getWorldPosition(new THREE.Vector3());
      const off = core.clone().sub(square).setY(0);
      const reach = off.length();
      if (reach < 0.01) off.copy(toward ?? d ?? new THREE.Vector3(0, 0, 1)).setY(0);
      vel.addScaledVector(off.normalize(), Math.max(0, 0.5 - reach) / 0.3);
      if (d) vel.addScaledVector(d, power * 0.08);
      layer.attach(body);
      launch(body, bodyParent, centerL.clone(), vel, lieDown(body, centerL, vel, upW, backTo(upW)), { bleed: 1.2 });
    }

    // head and limbs: the ones that come off are flung clear, the others ride their half
    for (const r of info) {
      if (!r.free) {
        (r.side > 0 || !halfB ? body : halfB).attach(r.root);
        chunks.push({ obj: r.root, parent: r.parent, rider: true, rest: true });
        continue;
      }
      const com = localBounds(r.root).getCenter(new THREE.Vector3());
      const wp = r.root.localToWorld(com.clone());
      const outDir = wp.clone().sub(core).setY(0);
      if (outDir.lengthSq() < 1e-4) outDir.set(rand(-1, 1), 0, rand(-1, 1));
      outDir.normalize();
      const flung = r.isHead || halves;
      const vel = outDir.clone().multiplyScalar(power * (flung ? 0.42 : 0.24) * rand(0.85, 1.15)).add(new THREE.Vector3(0, (flung ? 1.6 + 0.35 * up : 0.9) * rand(0.9, 1.1), 0));
      if (d) vel.addScaledVector(d, power * (r.isHead ? 0.2 : 0.08));
      // it lands lying flat: a limb along the board pointing away from the body, a head on its side
      const pivot = r.root.getWorldPosition(new THREE.Vector3());
      const long = wp.clone().sub(pivot);
      const axis = r.isHead || long.length() < 0.04 ? new THREE.Vector3(0, 1, 0).transformDirection(r.root.matrixWorld) : long.normalize();
      const flat = outDir.clone().multiplyScalar(Math.cos(0.2)).addScaledVector(Y, r.isHead ? 0 : -Math.sin(0.2));
      launch(r.root, r.parent, com, vel, lieDown(r.root, com, vel, axis, flat), { bleed: r.isHead ? 1.2 : 0.6 });
      this.spray(wp, vel, { count: r.isHead ? 16 : 8, speed: 1.8, spread: 0.5, up: 0.4 });
    }
    this.burst(core, 0.6);
    this.pool(core.clone(), 0.7, 3);
    const set = { view, chunks };
    view.gore = set;
    this.sets.add(set);
    return set;
  }

  // Drag the pieces back together into a mangled carcass on the (already reset) model.
  async gather(view, duration = 0.9, mangle = 0.3) {
    const set = view.gore;
    if (!set) return;
    this.sets.delete(set);
    view.root.updateMatrixWorld(true);
    // parts that rode along on a torso half fly back on their own
    for (const c of set.chunks) if (c.rider) this.layer.attach(c.obj);
    const jobs = set.chunks.map((c) => {
      const r = (c.restFrom ?? c.obj).userData.rest;
      const off = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(-mangle, mangle), rand(-mangle, mangle), rand(-mangle, mangle)));
      const local = new THREE.Matrix4().compose(r.position.clone().add(new THREE.Vector3(rand(-1, 1), rand(-0.5, 0.5), rand(-1, 1)).multiplyScalar(mangle * 0.06)), r.quaternion.clone().multiply(off), r.scale);
      _m.copy(local).premultiply(c.parent.matrixWorld);
      const tPos = new THREE.Vector3();
      const tQuat = new THREE.Quaternion();
      const tScale = new THREE.Vector3();
      _m.decompose(tPos, tQuat, tScale);
      return { ...c, local, p0: c.obj.position.clone(), q0: c.obj.quaternion.clone(), s0: c.obj.scale.clone(), tPos, tQuat, tScale, delay: Math.random() * 0.3 };
    });
    let trail = 0;
    await this.world.anim.tween(duration, (k, _, dt) => {
      trail += dt;
      for (const j of jobs) {
        const t = Ease.inOutCubic(Math.min(1, Math.max(0, (k - j.delay) / (1 - j.delay))));
        j.obj.position.lerpVectors(j.p0, j.tPos, t);
        j.obj.position.y += Math.sin(t * Math.PI) * 0.25;
        j.obj.quaternion.slerpQuaternions(j.q0, j.tQuat, t);
        j.obj.scale.lerpVectors(j.s0, j.tScale, t);
        if (j.plane) {
          j.obj.updateMatrixWorld();
          j.plane.world.copy(j.plane.local).applyMatrix4(j.obj.matrixWorld);
        }
        if (trail > 0.05 && t > 0 && t < 1 && Math.random() < 0.3) this.spray(j.obj.getWorldPosition(_v), null, { count: 2, speed: 0.4, up: 0, splat: 0.6 });
      }
      if (trail > 0.05) trail = 0;
    });
    for (const j of jobs) {
      const caps = [];
      j.obj.traverse((o) => o.userData.cap && caps.push(o));
      for (const c of caps) {
        c.removeFromParent();
        c.traverse((o) => o.isMesh && o.geometry.dispose());
      }
      if (j.twin) {
        j.obj.removeFromParent();
        j.obj.traverse((o) => o.isMesh && o.material.dispose());
        continue;
      }
      j.parent.attach(j.obj);
      j.local.decompose(j.obj.position, j.obj.quaternion, j.obj.scale);
      if (j.plane) {
        j.obj.traverse((o) => {
          if (o.isMesh) {
            o.material.clippingPlanes = null;
            o.material.needsUpdate = true;
          }
        });
      }
    }
    view.gore = null;
  }

  // ------------------------------------------------------------ simulation
  update(dt) {
    if (dt <= 0) return;
    // droplets
    if (this.dropMesh) {
      const keep = [];
      let n = 0;
      for (const d of this.drops) {
        d.life -= dt;
        d.v.y -= 9.8 * dt;
        d.p.addScaledVector(d.v, dt);
        const f = floorAt(d.p.x, d.p.z);
        if (d.p.y <= f || d.life <= 0) {
          if (d.p.y <= f + 0.01 && Math.random() < d.splat) this.decal(d.p, d.s * rand(8, 16), 'splat', { life: 40 });
          continue;
        }
        keep.push(d);
        const sp = d.v.length();
        _q.setFromUnitVectors(Y, _v.copy(d.v).divideScalar(sp || 1));
        _s.set(d.s, d.s * (1 + sp * 0.9), d.s);
        _m.compose(d.p, _q, _s);
        this.dropMesh.setMatrixAt(n++, _m);
      }
      this.drops = keep;
      this.dropMesh.count = n;
      this.dropMesh.instanceMatrix.needsUpdate = true;
    }
    // mist
    this.mists = this.mists.filter((m) => {
      m.t += dt;
      const k = m.t / m.dur;
      if (k >= 1) {
        m.s.removeFromParent();
        m.mat.dispose();
        return false;
      }
      m.s.scale.setScalar(0.2 + (m.to - 0.2) * Ease.outCubic(k));
      m.s.position.y += m.rise * dt;
      m.mat.opacity = m.opacity * (1 - k);
      return true;
    });
    // stains: grow, then fade near the end of their life
    this.decals = this.decals.filter((d) => {
      d.t += dt;
      d.life -= dt;
      if (d.grow) {
        const k = Math.min(1, d.t / d.grow);
        const s = d.size * Ease.outCubic(k);
        d.m.scale.set(Math.max(0.01, s * d.stretch), 1, Math.max(0.01, s));
      }
      if (d.life < 4) d.mat.opacity = d.alpha * Math.max(0, d.life / 4);
      if (d.life <= 0) {
        d.m.removeFromParent();
        d.mat.dispose();
        return false;
      }
      return true;
    });
    // meat chunks
    this.chunks = this.chunks.filter((c) => this.stepBody(c, c.m, dt));
    // torn body parts
    for (const set of this.sets) for (const c of set.chunks) this.stepPiece(c, dt);
  }

  // Put a torn piece where its simulated centre is (it turns about that centre, not its pivot).
  place(c) {
    const obj = c.obj;
    obj.position.copy(c.com).multiply(obj.scale).applyQuaternion(obj.quaternion).negate().add(c.p);
    obj.updateMatrixWorld(true);
    if (c.plane) c.plane.world.copy(c.plane.local).applyMatrix4(obj.matrixWorld);
  }

  // A torn piece in flight: gravity, a steady turn about its own centre, and a landing that never
  // lets its lowest visible point sink into the board.
  stepPiece(c, dt) {
    if (c.rest) return;
    c.t += dt;
    c.vel.y -= 9.8 * dt;
    c.p.addScaledVector(c.vel, dt);
    const a = Math.min(c.w.length() * dt, c.left);
    if (a > 1e-6) {
      c.obj.quaternion.premultiply(_q.setFromAxisAngle(_v.copy(c.w).normalize(), a));
      c.left -= a;
    }
    this.place(c);
    if (this.on && !c.landed && Math.random() < 0.25 * c.bleed) this.spray(c.p, null, { count: 1, speed: 0.3, up: 0, size: [0.004, 0.009], splat: 0.5 });
    const f = floorAt(c.p.x, c.p.z);
    const low = lowestPoint(c.obj);
    if (low < f) {
      c.p.y += f - low;
      this.place(c);
      if (c.vel.y > 0) return; // still on the way up
      if (!c.landed) {
        c.landed = true;
        this.decal(c.p, c.r * rand(2.5, 4), 'splat');
        // one small bounce off a hard landing, then it stays down
        if (c.vel.y < -2.5) {
          c.vel.set(c.vel.x * 0.4, -c.vel.y * 0.18, c.vel.z * 0.4);
          return;
        }
      }
      c.vel.set(c.vel.x * 0.5, 0, c.vel.z * 0.5);
    }
    // settled once it is down and has finished turning (or after a while, whatever happens)
    if ((c.landed && c.left <= 1e-4 && low <= f + 0.005) || c.t > 3) {
      c.rest = true;
      if (this.on) this.pool(c.p.clone().setY(f), c.r * rand(2.5, 4), 3);
    }
  }

  stepBody(c, obj, dt, persistent = false) {
    if (!persistent) {
      c.life -= dt;
      if (c.life <= 0) {
        obj.removeFromParent();
        obj.geometry?.dispose();
        obj.material?.dispose();
        return false;
      }
      if (c.life < 1) obj.scale.multiplyScalar(1 - dt * 2);
    }
    if (c.rest) return true;
    c.vel = c.vel ?? c.v;
    c.vel.y -= 9.8 * dt;
    obj.position.addScaledVector(c.vel, dt);
    _e.set(c.ang.x * dt, c.ang.y * dt, c.ang.z * dt);
    obj.quaternion.multiply(_q.setFromEuler(_e));
    // airborne parts leave a trail of blood
    if (this.on && Math.random() < 0.6 * c.bleed) {
      this.spray(obj.getWorldPosition(_v), null, { count: 1, speed: 0.3, up: 0, size: [0.004, 0.009], splat: 0.5 });
    }
    const f = floorAt(obj.position.x, obj.position.z) + c.r * 0.5;
    if (obj.position.y < f) {
      obj.position.y = f;
      if (!c.landed) {
        c.landed = true;
        this.decal(obj.position, c.r * rand(3, 5), 'splat');
      }
      if (Math.abs(c.vel.y) < 0.8) {
        c.rest = true;
        if (persistent && this.on) this.pool(obj.position.clone(), c.r * rand(3, 5), 3);
      } else {
        c.vel.y *= -0.25;
        c.vel.x *= 0.5;
        c.vel.z *= 0.5;
        c.ang.multiplyScalar(0.4);
      }
    }
    return true;
  }
}
