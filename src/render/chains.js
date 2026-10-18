import * as THREE from 'three';

const SPACING = 0.15;
const linkGeo = new THREE.TorusGeometry(0.06, 0.019, 6, 14);
linkGeo.scale(1.5, 1, 1);
const linkMat = new THREE.MeshStandardMaterial({ color: 0xa4abb5, metalness: 0.9, roughness: 0.32 });

const X = new THREE.Vector3(1, 0, 0);
const _pos = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _roll = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);

// A chain of interlocking links laid along an arbitrary polyline (instanced for speed).
export class Chain {
  constructor(scene, max = 220) {
    this.scene = scene;
    this.mesh = new THREE.InstancedMesh(linkGeo, linkMat, max);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.max = max;
    scene.add(this.mesh);
  }

  // reveal: fraction of the polyline (from its start) covered by links.
  // shift: slides the links along the path, to sell motion while dragging.
  setPath(points, reveal = 1, shift = 0) {
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));
    const total = lengths[lengths.length - 1];
    const visible = total * Math.min(1, Math.max(0, reveal));
    let seg = 1;
    let n = 0;
    const start = ((shift % SPACING) + SPACING) % SPACING;
    for (let d = start; d <= visible && n < this.max; d += SPACING) {
      while (seg < points.length - 1 && lengths[seg] < d) seg++;
      const a = points[seg - 1];
      const b = points[seg];
      const segLen = lengths[seg] - lengths[seg - 1] || 1;
      const t = (d - lengths[seg - 1]) / segLen;
      _pos.lerpVectors(a, b, t);
      _tan.subVectors(b, a).normalize();
      _q.setFromUnitVectors(X, _tan);
      const linkIndex = Math.round((d - shift) / SPACING);
      _roll.setFromAxisAngle(X, linkIndex % 2 ? Math.PI / 2 : 0);
      _q.multiply(_roll);
      _m.compose(_pos, _q, ONE);
      this.mesh.setMatrixAt(n++, _m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    return total;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
  }
}

// Quadratic arc from a to b peaking `height` above the midpoint.
export function arcPoints(a, b, height, n = 28) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y += height;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = new THREE.Vector3()
      .addScaledVector(a, (1 - t) * (1 - t))
      .addScaledVector(mid, 2 * (1 - t) * t)
      .addScaledVector(b, t * t);
    pts.push(p);
  }
  return pts;
}

export function circlePoints(center, radius, y, n = 20, turns = 1, rise = 0) {
  const pts = [];
  const total = n * turns;
  for (let i = 0; i <= total; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(new THREE.Vector3(center.x + Math.cos(a) * radius, y + (i / total) * rise, center.z + Math.sin(a) * radius));
  }
  return pts;
}
