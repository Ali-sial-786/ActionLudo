import * as THREE from 'three';
import { Ease, pick, rand } from '../engine/anim.js';
import { BOARD_Y } from './boardMesh.js';
import { getGlowTexture } from './effects.js';

// Blood, wounds and dismemberment.

export const goreSettings = { enabled: true };

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

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0);

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
    for (let i = 0; i < count && this.drops.length < MAX_DROPS; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
      if (d) v.multiplyScalar(spread).add(d).normalize();
      v.multiplyScalar(speed * rand(0.45, 1.15));
      v.y += up * rand(0.3, 1);
      this.drops.push({ p: origin.clone(), v, s: rand(size[0], size[1]), splat, life: 3 });
    }
  }

  // Omnidirectional explosion of blood, a hanging red mist and lumps of meat.
  burst(origin, power = 1) {
    if (!this.on) return;
    this.spray(origin, null, { count: Math.round(170 * power), speed: 3.4 * power, spread: 1, up: 1.4, size: [0.005, 0.016], splat: 0.35 });
    this.mist(origin, 1.2 * power);
    this.meat(origin, Math.round(10 * power), 2.6 * power);
  }

  mist(origin, size = 1) {
    if (!this.on) return;
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.SpriteMaterial({ map: getGlowTexture(), color: pick([0x5a0006, 0x7a0a10, 0x3a0003]), transparent: true, opacity: 0.55, depthWrite: false });
      const s = new THREE.Sprite(mat);
      s.position.copy(origin).add(new THREE.Vector3(rand(-0.1, 0.1), rand(-0.05, 0.15), rand(-0.1, 0.1)));
      s.scale.setScalar(0.2 * size);
      this.layer.add(s);
      this.mists.push({ s, mat, t: 0, dur: rand(0.6, 1.1), to: size * rand(0.7, 1.2), rise: rand(0.05, 0.2) });
    }
  }

  // Flesh chunks and bone splinters.
  meat(origin, count = 10, speed = 2.5) {
    if (!this.on) return;
    for (let i = 0; i < count; i++) {
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
      this.chunks.push({ m, v, ang: new THREE.Vector3(rand(-14, 14), rand(-14, 14), rand(-14, 14)), r: bone ? 0.01 : s, life: rand(9, 14), rest: false, bleed: 0.5 });
    }
  }

  // ------------------------------------------------------------ stains
  decal(pos, size, kind = 'splat', { rot = rand(0, Math.PI * 2), grow = 0, life = 40, stretch = 1 } = {}) {
    if (!this.on) return null;
    const mats = getDecalMats()[kind];
    const mat = pick(mats).clone();
    const m = new THREE.Mesh(decalGeo, mat);
    const y = floorAt(pos.x, pos.z) + 0.002 + this.decals.length * 0.00002;
    m.position.set(pos.x, y, pos.z);
    m.rotation.y = rot;
    m.scale.set(size * stretch, 1, size);
    m.receiveShadow = true;
    m.renderOrder = 1;
    this.layer.add(m);
    const d = { m, mat, life, maxLife: life, grow, size, stretch, t: 0 };
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

  // Tear an animal apart. mode 'limbs' rips off head/limbs/tail; 'halves' also splits the torso in two.
  dismember(view, { mode = 'limbs', dir = null, power = 2.4, up = 1.8, spin = 7, axis = 'z' } = {}) {
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
    const center = view.model.getWorldPosition(new THREE.Vector3());
    center.y += 0.25;
    const chunks = [];
    const push = (obj, parent, vel, extra = {}) => {
      const box = new THREE.Box3().setFromObject(obj);
      const r = Math.max(0.03, box.getSize(new THREE.Vector3()).length() * 0.25);
      chunks.push({ obj, parent, vel, ang: new THREE.Vector3(rand(-spin, spin), rand(-spin, spin), rand(-spin, spin)), r, rest: false, landed: false, bleed: 1, ...extra });
    };
    const d = dir ? dir.clone().setY(0).normalize() : null;

    for (const root of this.chunkRoots(view)) {
      const parent = root.parent;
      const wp = root.getWorldPosition(new THREE.Vector3());
      layer.attach(root);
      const out = wp.clone().sub(center).setY(0);
      if (out.lengthSq() < 1e-4) out.set(rand(-1, 1), 0, rand(-1, 1));
      out.normalize();
      const vel = out.multiplyScalar(power * rand(0.6, 1.25)).add(new THREE.Vector3(0, up * rand(0.6, 1.3), 0));
      if (d) vel.addScaledVector(d, power * rand(0.2, 0.6));
      push(root, parent, vel);
      this.spray(wp, vel, { count: 26, speed: 2.4, spread: 0.6, up: 0.4 });
    }

    const body = view.parts.body ?? view.model;
    const bodyParent = body.parent;
    if (mode === 'halves') {
      const box = new THREE.Box3().setFromObject(body);
      const centerW = box.getCenter(new THREE.Vector3());
      const centerL = body.worldToLocal(centerW.clone());
      const n = axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
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
      bodyParent.add(twin);
      twin.position.copy(body.position);
      twin.quaternion.copy(body.quaternion);
      twin.scale.copy(body.scale);
      planeA.world.copy(planeA.local).applyMatrix4(body.matrixWorld);
      planeB.world.copy(planeB.local).applyMatrix4(body.matrixWorld);
      layer.attach(body);
      layer.attach(twin);
      const axisW = n.clone().transformDirection(body.matrixWorld).setY(0).normalize();
      const vA = axisW.clone().multiplyScalar(power * 0.75).add(new THREE.Vector3(0, up * 0.9, 0));
      const vB = axisW.clone().multiplyScalar(-power * 0.75).add(new THREE.Vector3(0, up * 0.9, 0));
      if (d) {
        vA.addScaledVector(d, power * 0.3);
        vB.addScaledVector(d, power * 0.3);
      }
      push(body, bodyParent, vA, { plane: planeA, bleed: 2.5 });
      // the clone's userData was JSON-copied, so it borrows the original torso's rest pose
      push(twin, bodyParent, vB, { plane: planeB, bleed: 2.5, twin: true, restFrom: body });
      this.spray(centerW, axisW, { count: 70, speed: 3, spread: 0.7, up: 0.8 });
      this.spray(centerW, axisW.clone().negate(), { count: 70, speed: 3, spread: 0.7, up: 0.8 });
    } else {
      layer.attach(body);
      const vel = new THREE.Vector3(rand(-0.3, 0.3), up * 0.35, rand(-0.3, 0.3));
      if (d) vel.addScaledVector(d, power * 0.35);
      push(body, bodyParent, vel, { bleed: 2 });
    }
    this.burst(center, 1);
    this.pool(center.clone(), 0.7, 3);
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
      m.mat.opacity = 0.55 * (1 - k);
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
      if (d.life < 4) d.mat.opacity = Math.max(0, d.life / 4);
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
    for (const set of this.sets) {
      for (const c of set.chunks) {
        this.stepBody(c, c.obj, dt, true);
        if (c.plane) {
          c.obj.updateMatrixWorld();
          c.plane.world.copy(c.plane.local).applyMatrix4(c.obj.matrixWorld);
        }
      }
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
