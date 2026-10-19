import * as THREE from 'three';
import { createAnimal } from './animals.js';

const baseGeo = new THREE.CylinderGeometry(0.36, 0.39, 0.07, 32);
const rimGeo = new THREE.TorusGeometry(0.375, 0.022, 8, 40);
const ringGeo = new THREE.TorusGeometry(0.47, 0.045, 8, 48);

export class TokenView {
  constructor(token, colorHex, animalId, style = 'action') {
    this.token = token;
    this.animal = animalId;
    this.style = style;
    this.colorHex = colorHex;
    this.root = new THREE.Group();
    this.root.userData.tokenView = this;

    this.base = new THREE.Group();
    const baseMesh = new THREE.Mesh(
      baseGeo,
      new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.35, metalness: 0.25 }),
    );
    baseMesh.position.y = 0.035;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    this.base.add(baseMesh);
    const rim = new THREE.Mesh(
      rimGeo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: colorHex, emissiveIntensity: 0.6, roughness: 0.3 }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.07;
    this.base.add(rim);
    this.root.add(this.base);

    this.ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.05;
    this.ring.visible = false;
    this.root.add(this.ring);

    const built = createAnimal(animalId, style);
    this.model = built.model;
    this.parts = built.parts;
    this.idleFn = built.idle;
    this.model.position.y = 0.07;
    this.model.userData.rest.position.y = 0.07;
    this.root.add(this.model);

    this.idle = true;
    this.phase = Math.random() * 100;
    this.selectable = false;
    this.hoverBoost = 0;
    this.savedMaterials = null;
    this.facing = 0;
  }

  setSelectable(on) {
    this.selectable = on;
    this.ring.visible = on;
    if (!on) {
      // don't leave the piece hovering mid-bounce
      this.model.position.y = this.model.userData.rest.position.y;
      this.squash(1);
    }
  }

  faceTowards(target) {
    const dx = target.x - this.root.position.x;
    const dz = target.z - this.root.position.z;
    if (dx * dx + dz * dz < 1e-6) return this.root.rotation.y;
    return Math.atan2(dx, dz);
  }

  update(dt, time) {
    if (this.idle) this.idleFn(time + this.phase);
    if (this.selectable) {
      const s = 1 + Math.sin(time * 6) * 0.07 + this.hoverBoost * 0.12;
      this.ring.scale.set(s, s, s);
      this.ring.material.opacity = 0.65 + Math.sin(time * 6) * 0.25;
      // eager little bounce, squashing briefly each time it touches down
      const b = Math.abs(Math.sin(time * 5));
      this.model.position.y = 0.07 + b * 0.08 * (1 + this.hoverBoost);
      const contact = Math.max(0, 1 - b / 0.3);
      this.squash(1 - contact * contact * (this.style === 'kids' ? 0.14 : 0.07));
    }
  }

  // Volume-preserving squash (sy < 1) / stretch (sy > 1) of the model about its feet.
  squash(sy) {
    const r = this.model.userData.rest.scale;
    const sxz = 1 / Math.sqrt(sy);
    this.model.scale.set(r.x * sxz, r.y * sy, r.z * sxz);
  }

  // Pose used while hopping: squash / stretch plus pitch (nose up < 0) and roll (lean into turns).
  hopPose(sy = 1, pitch = 0, roll = 0) {
    this.squash(sy);
    this.model.rotation.set(pitch, 0, roll);
  }

  clearHopPose() {
    const r = this.model.userData.rest;
    this.model.scale.copy(r.scale);
    this.model.quaternion.copy(r.quaternion);
  }

  // Restore every node of the model to its rest transform.
  resetPose() {
    this.model.traverse((o) => {
      const r = o.userData.rest;
      if (!r) return;
      o.position.copy(r.position);
      o.quaternion.copy(r.quaternion);
      o.scale.copy(r.scale);
      o.visible = true;
    });
  }

  meshes() {
    const out = [];
    this.model.traverse((o) => {
      if (o.isMesh) out.push(o);
    });
    return out;
  }

  // Give the model private materials so it can be tinted / faded without affecting other tokens.
  isolateMaterials() {
    if (this.savedMaterials) return;
    this.savedMaterials = new Map();
    for (const m of this.meshes()) {
      this.savedMaterials.set(m, m.material);
      const clone = m.material.clone();
      clone.userData.baseColor = clone.color.clone();
      clone.userData.baseEmissive = clone.emissive ? clone.emissive.clone() : null;
      m.material = clone;
    }
  }

  restoreMaterials() {
    if (!this.savedMaterials) return;
    for (const [m, original] of this.savedMaterials) {
      m.material.dispose();
      m.material = original;
    }
    this.savedMaterials = null;
  }

  tint(hex, amount, glow = 0) {
    this.isolateMaterials();
    const c = new THREE.Color(hex);
    for (const m of this.meshes()) {
      const mat = m.material;
      // wounds added after isolation carry their own (unshared) material
      mat.userData.baseColor ??= mat.color.clone();
      mat.color.copy(mat.userData.baseColor).lerp(c, amount);
      if (mat.emissive) mat.emissive.copy(c).multiplyScalar(glow);
    }
  }

  // Remove wounds left by a fight (they live on the model's parts).
  clearWounds() {
    const roots = [];
    this.model.traverse((o) => o.userData.woundRoot && roots.push(o));
    for (const r of roots) {
      r.removeFromParent();
      r.traverse((o) => {
        if (!o.isMesh) return;
        this.savedMaterials?.delete(o);
        o.geometry.dispose();
        o.material.dispose();
      });
    }
  }

  setOpacity(o) {
    this.isolateMaterials();
    for (const m of this.meshes()) {
      m.material.transparent = o < 1;
      m.material.opacity = o;
      m.material.depthWrite = o > 0.5;
    }
  }
}
