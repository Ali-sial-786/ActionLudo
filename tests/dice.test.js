import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AXES, labelFor, simulateThrow, throwShowing } from '../src/engine/dicePhysics.js';

const bounds = { minX: -1.6, maxX: 1.6, minZ: -2.2, maxZ: 2.2, floor: 0.04 };
const size = 0.72;

// Deterministic pseudo-random numbers so a failure can be reproduced.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function launch(rnd) {
  const r = (lo, hi) => lo + rnd() * (hi - lo);
  const speed = r(1.5, 8.5);
  const a = r(0, Math.PI * 2);
  return {
    size,
    bounds,
    pos: new THREE.Vector3(r(-0.9, 0.9), bounds.floor + 0.85, r(-1.4, 1.4)),
    vel: new THREE.Vector3(Math.cos(a) * speed, r(0.5, 2), Math.sin(a) * speed),
    spin: new THREE.Vector3(r(-1, 1), r(-1, 1), r(-1, 1)).normalize().multiplyScalar(r(8, 30)),
    quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(r(0, 6), r(0, 6), r(0, 6))),
  };
}

const faceUp = (q, face) => face.clone().applyQuaternion(q).y;

test('every throw settles flat, inside the tray, within a few seconds', () => {
  const rnd = rng(1);
  for (let i = 0; i < 400; i++) {
    const sim = simulateThrow(launch(rnd));
    assert.ok(sim.duration < 3.5, `throw ${i} took ${sim.duration.toFixed(2)}s`);
    assert.ok(faceUp(sim.rest.q, AXES[sim.top]) > 0.9999, `throw ${i} did not end flat`);
    const p = sim.rest.p;
    const h = size / 2;
    assert.ok(p.x - h >= bounds.minX - 1e-6 && p.x + h <= bounds.maxX + 1e-6, `throw ${i} left the tray (x)`);
    assert.ok(p.z - h >= bounds.minZ - 1e-6 && p.z + h <= bounds.maxZ + 1e-6, `throw ${i} left the tray (z)`);
    assert.ok(Math.abs(p.y - (bounds.floor + h)) < 1e-9);
  }
});

test('the die always lands showing the number that was rolled, whatever the throw', () => {
  const rnd = rng(2);
  let tries = 0;
  let throws = 0;
  let relabelled = 0;
  for (let i = 0; i < 60; i++) {
    for (const face of AXES) {
      const fit = throwShowing(face, launch(rnd), rnd);
      const shown = fit.sim.rest.q.clone().multiply(fit.label);
      assert.ok(faceUp(shown, face) > 0.9999, 'wrong face up');
      tries += fit.tries;
      throws++;
      if (fit.label.w < 0.9999) relabelled++;
    }
  }
  // a handful of physics runs per throw, and the relabelling fallback is never needed
  const avg = tries / throws;
  assert.ok(avg > 3 && avg < 12, `average tries ${avg.toFixed(2)}`);
  assert.equal(relabelled, 0, `${relabelled} throws needed relabelling`);
});

test('a relabelled die still shows the right face (the fallback path)', () => {
  const rnd = rng(3);
  for (let i = 0; i < 60; i++) {
    for (const face of AXES) {
      const fit = throwShowing(face, launch(rnd), rnd, 1);
      const shown = fit.sim.rest.q.clone().multiply(fit.label);
      assert.ok(faceUp(shown, face) > 0.9999);
    }
  }
  // labelFor maps any face onto any top axis with a proper cube rotation
  for (const face of AXES) {
    for (let top = 0; top < 6; top++) {
      const Q = labelFor(face, top, rnd);
      assert.ok(face.clone().applyQuaternion(Q).distanceTo(AXES[top]) < 1e-6);
      for (const a of AXES) assert.ok(AXES.some((b) => a.clone().applyQuaternion(Q).distanceTo(b) < 1e-6), 'not a cube symmetry');
    }
  }
});
