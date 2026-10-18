import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Ease, arc } from '../engine/anim.js';
import { getGlowTexture } from './effects.js';

const R = 0.46;
const H = 1.12;

function buildCageGeometry() {
  const parts = [];
  const ring = (y, tube = 0.03) => {
    const g = new THREE.TorusGeometry(R, tube, 6, 36);
    g.rotateX(Math.PI / 2);
    g.translate(0, y, 0);
    parts.push(g);
  };
  ring(0.04, 0.04);
  ring(0.55, 0.022);
  ring(H, 0.032);
  const bars = 14;
  for (let i = 0; i < bars; i++) {
    const a = (i / bars) * Math.PI * 2;
    // leave a gap at the front for the padlock
    const g = new THREE.CylinderGeometry(0.018, 0.018, H, 6);
    g.translate(Math.sin(a) * R, H / 2, Math.cos(a) * R);
    parts.push(g);
  }
  for (const rot of [0, Math.PI / 2]) {
    const g = new THREE.TorusGeometry(R, 0.022, 6, 24, Math.PI);
    g.scale(1, 0.55, 1);
    g.rotateY(rot);
    g.translate(0, H, 0);
    parts.push(g);
  }
  const knob = new THREE.SphereGeometry(0.06, 10, 8);
  knob.translate(0, H + R * 0.55 + 0.03, 0);
  parts.push(knob);
  const hook = new THREE.TorusGeometry(0.06, 0.015, 6, 16);
  hook.translate(0, H + R * 0.55 + 0.12, 0);
  parts.push(hook);
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

let cageGeo = null;
const ironMat = new THREE.MeshStandardMaterial({ color: 0x3f4550, metalness: 0.85, roughness: 0.38 });
const goldMat = new THREE.MeshStandardMaterial({ color: 0xffc23a, metalness: 0.9, roughness: 0.25, emissive: 0x2a1800 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 });

function buildPadlock() {
  const lock = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.17, 0.08), goldMat);
  body.castShadow = true;
  lock.add(body);
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 10), darkMat);
  hole.rotation.x = Math.PI / 2;
  hole.position.set(0, 0.02, 0.041);
  lock.add(hole);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.04, 0.02), darkMat);
  slot.position.set(0, -0.01, 0.041);
  lock.add(slot);
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.017, 8, 18, Math.PI), ironMat);
  shackle.position.y = 0.085;
  lock.add(shackle);
  lock.userData.shackle = shackle;
  return lock;
}

export class Cage {
  constructor(scene, pos, teamHex) {
    cageGeo ??= buildCageGeometry();
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    this.mat = ironMat.clone();
    this.mat.color.lerp(new THREE.Color(teamHex), 0.18);
    this.bars = new THREE.Mesh(cageGeo, this.mat);
    this.bars.castShadow = true;
    this.group.add(this.bars);
    this.lock = buildPadlock();
    this.lock.position.set(0, 0.5, R + 0.05);
    this.group.add(this.lock);
    scene.add(this.group);
    this.home = pos.clone();
    this.locked = true;
  }

  keyholeWorld() {
    const p = new THREE.Vector3(0, 0.02, 0.05);
    this.lock.localToWorld(p);
    return p;
  }

  setClosed(closed) {
    this.locked = closed;
    this.group.visible = closed;
    this.group.position.copy(this.home);
    this.group.scale.setScalar(1);
    this.mat.opacity = 1;
    this.mat.transparent = false;
    this.lock.visible = closed;
    this.lock.position.set(0, 0.5, R + 0.05);
    this.lock.rotation.set(0, 0, 0);
    this.lock.scale.setScalar(1);
    this.lock.userData.shackle.position.y = 0.085;
  }

  // Shackle pops, padlock drops, cage floats up and fades.
  async open(anim, sfx) {
    const shackle = this.lock.userData.shackle;
    sfx?.play('unlock');
    await anim.tween(0.18, (k) => (shackle.position.y = 0.085 + k * 0.06), Ease.outBack);
    const lp = this.lock.position.clone();
    anim.tween(0.5, (k) => {
      this.lock.position.set(lp.x, lp.y - k * 0.45, lp.z + k * 0.25);
      this.lock.rotation.x = k * 1.6;
      this.lock.scale.setScalar(1 - k);
    }, Ease.inQuad);
    sfx?.play('creak');
    this.mat.transparent = true;
    await anim.tween(0.6, (k) => {
      this.group.position.y = this.home.y + Ease.inQuad(k) * 2.4;
      this.mat.opacity = 1 - k;
      this.group.rotation.y = k * 0.8;
    });
    this.group.visible = false;
    this.group.rotation.y = 0;
    this.locked = false;
  }

  // Cage slams down from the sky and the padlock snaps shut.
  async close(anim, sfx, fx) {
    this.setClosed(true);
    this.lock.visible = false;
    this.mat.transparent = true;
    this.mat.opacity = 0;
    await anim.tween(0.45, (k) => {
      this.group.position.y = this.home.y + (1 - k) * 3;
      this.mat.opacity = Math.min(1, k * 3);
    }, Ease.inQuad);
    this.mat.transparent = false;
    this.mat.opacity = 1;
    sfx?.play('clank');
    fx?.dust(this.home.clone().setY(this.home.y + 0.05), 12, 0xb8b2a6);
    await anim.tween(0.2, (k) => (this.group.scale.y = 1 - Math.sin(k * Math.PI) * 0.12));
    this.lock.visible = true;
    const shackle = this.lock.userData.shackle;
    shackle.position.y = 0.15;
    await anim.tween(0.2, (k) => this.lock.scale.setScalar(k), Ease.outBack);
    await anim.tween(0.12, (k) => (shackle.position.y = 0.15 - k * 0.065));
    sfx?.play('unlock');
  }

  dispose() {
    this.scene.remove(this.group);
    this.mat.dispose();
  }
}

function buildKey() {
  const key = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffd34a, metalness: 0.95, roughness: 0.2, emissive: 0x6a4500, emissiveIntensity: 0.8 });
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.026, 8, 20), mat);
  bow.position.z = 0.27;
  key.add(bow);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.035), new THREE.MeshStandardMaterial({ color: 0xff3355, emissive: 0x880022, roughness: 0.2 }));
  gem.position.z = 0.27;
  key.add(gem);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.3, 8), mat);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = 0.04;
  key.add(shaft);
  for (const [z, h] of [
    [-0.08, 0.06],
    [-0.04, 0.04],
  ]) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.016, h, 0.025), mat);
    tooth.position.set(0, -h / 2, z);
    key.add(tooth);
  }
  key.traverse((o) => (o.castShadow = true));
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xffd34a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  glow.scale.setScalar(0.7);
  glow.position.z = 0.15;
  key.add(glow);
  key.userData.dispose = () =>
    key.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
      if (o.isMesh || o.isSprite) o.material.dispose();
    });
  return key;
}

// A golden key flies in, unlocks the padlock and the cage lifts away.
export async function unlockWithKey({ cage, anim, scene, fx, sfx, from }) {
  const key = buildKey();
  const hole = cage.keyholeWorld();
  const approach = hole.clone().add(new THREE.Vector3(0, 0, 0.42));
  const start = from.clone();
  key.position.copy(start);
  key.scale.setScalar(0.01);
  scene.add(key);
  sfx?.play('sparkle');
  fx.sparks(start, 0xffe27a, 14, 2);
  await anim.tween(0.3, (k) => {
    key.scale.setScalar(0.01 + k * 1.8);
    key.rotation.y = k * Math.PI * 2;
  }, Ease.outBack);

  const qFinal = new THREE.Quaternion(); // shaft along -z (tip into the lock)
  const q0 = key.quaternion.clone();
  const trail = anim.every(() => fx.burst(key.position, { count: 1, colors: [0xffe27a, 0xffffff], glow: true, size: [0.02, 0.04], speed: 0.2, up: 0, gravity: 0, life: [0.2, 0.4], floor: false }));
  await anim.tween(
    0.75,
    (k) => {
      key.position.lerpVectors(start, approach, k);
      key.position.y += arc(k, 1.6);
      key.rotation.set(0, 0, 0);
      const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (1 - k) * Math.PI * 6);
      key.quaternion.copy(q0).slerp(qFinal, k).premultiply(spin);
      key.scale.setScalar(1.8 - k * 0.8);
    },
    Ease.inOutCubic,
  );
  trail();
  await anim.tween(0.18, (k) => key.position.lerpVectors(approach, hole.clone().add(new THREE.Vector3(0, 0, 0.07)), k), Ease.inQuad);
  sfx?.play('click');
  await anim.tween(0.25, (k) => (key.rotation.z = k * (Math.PI / 2)), Ease.outBack);
  fx.sparks(hole, 0xffe27a, 16, 2.5);
  const openP = cage.open(anim, sfx);
  const kp = key.position.clone();
  await anim.tween(0.4, (k) => {
    key.position.set(kp.x, kp.y + k * 0.8, kp.z + k * 0.3);
    key.scale.setScalar(1 - k);
  });
  scene.remove(key);
  key.userData.dispose();
  await openP;
}
