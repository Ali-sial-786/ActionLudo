import * as THREE from 'three';

// Rigid-body tumble of a rounded die inside a walled tray.
//
// The whole throw is simulated up front and then played back, so the camera can follow it and the
// animator can slow it down or fast-forward it like any other tween. The die is modelled as the
// convex hull of eight corner spheres (its rounded corners). A cube's inertia is isotropic, which
// keeps every impulse calculation scalar.
//
// The simulation never decides the number: the caller rolls a fair value first and relabels the
// faces (see `labelFor`) so that whichever face physically ends up on top shows that value.

const UP = new THREE.Vector3(0, 1, 0);
export const AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];
const CORNERS = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) CORNERS.push(new THREE.Vector3(x, y, z));

const _c = new THREE.Vector3();
const _r = new THREE.Vector3();
const _rv = new THREE.Vector3();
const _rn = new THREE.Vector3();
const _t = new THREE.Vector3();
const _j = new THREE.Vector3();
const _dq = new THREE.Quaternion();

// bounds: { minX, maxX, minZ, maxZ, floor } — the tray's inner walls and felt height.
export function simulateThrow({
  size,
  round = 0.1,
  pos,
  vel,
  spin,
  quat = new THREE.Quaternion(),
  bounds,
  gravity = 28,
  restitution = 0.32,
  wallRestitution = 0.5,
  friction = 0.45,
  wallFriction = 0.1,
  step = 1 / 300,
  rate = 60,
  maxTime = 6,
}) {
  const half = size / 2;
  const inset = half - round;
  const invM = 1;
  const invI = 6 / (size * size); // solid cube, unit mass
  const p = pos.clone();
  const v = vel.clone();
  const w = spin.clone();
  const q = quat.clone();
  const planes = [
    { n: UP, d: bounds.floor, wall: false },
    { n: new THREE.Vector3(1, 0, 0), d: bounds.minX, wall: true },
    { n: new THREE.Vector3(-1, 0, 0), d: -bounds.maxX, wall: true },
    { n: new THREE.Vector3(0, 0, 1), d: bounds.minZ, wall: true },
    { n: new THREE.Vector3(0, 0, -1), d: -bounds.maxZ, wall: true },
  ];
  const frames = [{ t: 0, p: p.clone(), q: q.clone() }];
  const hits = [];
  const lastHit = new Map();
  const perFrame = Math.max(1, Math.round(1 / (rate * step)));
  let t = 0;
  let still = 0;
  let n = 0;

  const applyImpulse = (r, j) => {
    v.addScaledVector(j, invM);
    w.addScaledVector(_rn.crossVectors(r, j), invI);
  };

  while (t < maxTime) {
    // integrate
    v.y -= gravity * step;
    p.addScaledVector(v, step);
    _dq.set(w.x * step * 0.5, w.y * step * 0.5, w.z * step * 0.5, 0).multiply(q);
    q.set(q.x + _dq.x, q.y + _dq.y, q.z + _dq.z, q.w + _dq.w).normalize();

    // gather contacts (corner spheres against the floor and walls)
    const contacts = [];
    let floorContacts = 0;
    for (const pl of planes) {
      let deepest = 0;
      for (const k of CORNERS) {
        _c.copy(k).multiplyScalar(inset).applyQuaternion(q).add(p);
        const dist = pl.n.dot(_c) - pl.d - round;
        if (dist < 0) {
          contacts.push({ pl, point: _c.clone().addScaledVector(pl.n, -round) });
          deepest = Math.max(deepest, -dist);
          if (!pl.wall) floorContacts++;
        }
      }
      if (deepest > 0) {
        p.addScaledVector(pl.n, deepest);
        for (const c of contacts) if (c.pl === pl) c.point.addScaledVector(pl.n, deepest);
      }
    }

    // sequential impulses: bounce on the first pass, then just remove approach velocity
    for (let it = 0; it < 4; it++) {
      for (const c of contacts) {
        const nrm = c.pl.n;
        _r.subVectors(c.point, p);
        _rv.crossVectors(w, _r).add(v);
        const vn = _rv.dot(nrm);
        if (vn >= 0) continue;
        if (it === 0 && vn < -0.9) {
          const key = c.pl;
          if (t - (lastHit.get(key) ?? -1) > 0.06) {
            hits.push({ t, power: Math.min(1, -vn / 7), wall: c.pl.wall });
            lastHit.set(key, t);
          }
        }
        const e = it === 0 && vn < -0.6 ? (c.pl.wall ? wallRestitution : restitution) : 0;
        const kn = invM + invI * _rn.crossVectors(_r, nrm).lengthSq();
        const jn = (-(1 + e) * vn) / kn;
        applyImpulse(_r, _j.copy(nrm).multiplyScalar(jn));
        // Coulomb friction along the sliding direction
        _rv.crossVectors(w, _r).add(v);
        _t.copy(_rv).addScaledVector(nrm, -_rv.dot(nrm));
        const vt = _t.length();
        if (vt > 1e-5) {
          _t.divideScalar(vt);
          const kt = invM + invI * _rn.crossVectors(_r, _t).lengthSq();
          const jt = Math.min(vt / kt, (c.pl.wall ? wallFriction : friction) * jn);
          applyImpulse(_r, _j.copy(_t).multiplyScalar(-jt));
        }
      }
    }

    // rolling resistance on the felt, a little air drag otherwise
    const grip = floorContacts > 0;
    w.multiplyScalar(Math.exp(-step * (grip ? 1.6 : 0.05)));
    if (grip) {
      const k = Math.exp(-step * 0.8);
      v.x *= k;
      v.z *= k;
    }

    t += step;
    if (++n % perFrame === 0) frames.push({ t, p: p.clone(), q: q.clone() });
    // at rest on a face, or propped against a wall and barely moving (it gets tipped flat below)
    const slow = v.length() < 0.07 && w.length() < 0.7;
    if (slow && floorContacts >= 3) still += step;
    else if (slow) still += step * 0.4;
    else still = 0;
    if (still > 0.12) break;
  }

  // Settle exactly flat on the face nearest the felt; a die left leaning tips over onto it.
  const top = topAxis(q);
  const upNow = AXES[top].clone().applyQuaternion(q);
  const tilt = Math.acos(Math.min(1, upNow.y));
  const restQ = new THREE.Quaternion().setFromUnitVectors(upNow, UP).multiply(q).normalize();
  const restP = p.clone().setY(bounds.floor + half);
  restP.x = THREE.MathUtils.clamp(restP.x, bounds.minX + half, bounds.maxX - half);
  restP.z = THREE.MathUtils.clamp(restP.z, bounds.minZ + half, bounds.maxZ - half);
  const settle = 0.14 + (tilt / (Math.PI / 4)) * 0.3;
  const from = frames[frames.length - 1];
  for (let i = 1; i <= 6; i++) {
    const k = i / 6;
    const e = k * k * (3 - 2 * k);
    frames.push({ t: from.t + settle * k, p: from.p.clone().lerp(restP, e), q: from.q.clone().slerp(restQ, e) });
  }
  return { frames, hits, duration: from.t + settle, top, rest: { p: restP, q: restQ } };
}

// Index (into AXES) of the body axis pointing most nearly straight up.
export function topAxis(q) {
  let best = 0;
  let bestDot = -2;
  AXES.forEach((a, i) => {
    const d = _c.copy(a).applyQuaternion(q).y;
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  });
  return best;
}

// Position and orientation at time t (linear / spherical interpolation between recorded frames).
export function sampleThrow(sim, t, outP, outQ) {
  const f = sim.frames;
  let lo = 0;
  let hi = f.length - 1;
  if (t <= 0 || t >= f[hi].t) {
    const e = t <= 0 ? f[0] : f[hi];
    outP.copy(e.p);
    outQ.copy(e.q);
    return;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (f[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const k = (t - f[lo].t) / (f[hi].t - f[lo].t);
  outP.copy(f[lo].p).lerp(f[hi].p, k);
  outQ.copy(f[lo].q).slerp(f[hi].q, k);
}

// Simulate a throw that comes to rest with `faceAxis` (a face normal in the die's own frame) on top.
// Variations of the launch are tried until the physics itself lands that face up, typically within
// about eight runs of a few milliseconds each. The spin, which nobody can see in a throw, is varied
// freely; the direction and speed only slightly, so the die still goes where it was flung. In the
// vanishingly rare case that no run fits, the faces are relabelled instead.
// Show the die as `sim orientation * label`.
export function throwShowing(faceAxis, { vel, spin, ...opts }, rnd = Math.random, tries = 150) {
  const want = AXES.findIndex((a) => a.distanceToSquared(faceAxis) < 1e-6);
  const r = (lo, hi) => lo + rnd() * (hi - lo);
  let sim = null;
  for (let i = 0; i < tries; i++) {
    const v = vel.clone();
    const w = spin.clone();
    if (i > 0) {
      // a very gentle throw may barely tumble; after a while, let the search toss a little harder
      const boost = i > 30 ? Math.min(1, (i - 30) / 60) : 0;
      v.applyAxisAngle(UP, r(-0.15, 0.15)).multiplyScalar(r(0.9, 1.1 + 0.4 * boost));
      v.y += r(0, 1.5) * boost;
      const m = w.length() * r(0.7, 1.45 + boost);
      w.normalize().add(new THREE.Vector3(r(-1, 1), r(-1, 1), r(-1, 1)).multiplyScalar(0.9)).normalize().multiplyScalar(m);
    }
    sim = simulateThrow({ ...opts, vel: v, spin: w });
    if (sim.top === want) return { sim, label: new THREE.Quaternion(), tries: i + 1 };
  }
  return { sim, label: labelFor(faceAxis, sim.top, rnd), tries };
}

// The 24 rotations that map a cube onto itself.
const CUBE_ROTATIONS = (() => {
  const out = [];
  for (const a of AXES) {
    const base = new THREE.Quaternion().setFromUnitVectors(UP, a);
    for (let i = 0; i < 4; i++) out.push(new THREE.Quaternion().setFromAxisAngle(a, (i * Math.PI) / 2).multiply(base));
  }
  return out;
})();

// A cube symmetry Q for the visual die (shown as bodyQuat * Q) that puts the face whose outward
// normal is `faceAxis` (in the die's own frame) onto the body axis that ended up on top. The die
// looks identical under Q, so the tumble is unchanged; only which number lands face-up is chosen.
export function labelFor(faceAxis, top, rnd = Math.random) {
  const want = AXES[top];
  const fits = CUBE_ROTATIONS.filter((Q) => _c.copy(faceAxis).applyQuaternion(Q).distanceToSquared(want) < 1e-6);
  return fits[Math.floor(rnd() * fits.length) % fits.length].clone();
}
