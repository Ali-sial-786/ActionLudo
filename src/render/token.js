import * as THREE from 'three';
import { createAnimal } from './animals.js';

const baseGeo = new THREE.CylinderGeometry(0.36, 0.39, 0.07, 32);
const rimGeo = new THREE.TorusGeometry(0.375, 0.022, 8, 40);
const ringGeo = new THREE.TorusGeometry(0.47, 0.045, 8, 48);

export class TokenView {
  constructor(token, colorHex, animalId) {
    this.token = token;
    this.animal = animalId;
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

    const built = createAnimal(animalId);
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
      this.model.position.y = 0.07 + Math.abs(Math.sin(time * 5)) * 0.08 * (1 + this.hoverBoost);
    }
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
      mat.color.copy(mat.userData.baseColor).lerp(c, amount);
      if (mat.emissive) mat.emissive.copy(c).multiplyScalar(glow);
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
