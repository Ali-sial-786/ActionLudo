import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Animator, Ease } from '../engine/anim.js';

export class World {
  constructor(container) {
    this.container = container;
    this.anim = new Animator();

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = makeSkyTexture();
    scene.fog = new THREE.Fog(0x1b2440, 38, 80);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    this.camera.position.set(0, 20, 17);

    const controls = new OrbitControls(this.camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 7;
    controls.maxDistance = 45;
    controls.maxPolarAngle = 1.32;
    controls.target.set(0, 0, 0.5);
    this.controls = controls;

    this.setupLights();
    this.setupGround();

    this.shakeAmount = 0;
    this.shakeOffset = new THREE.Vector3();
    this.cinematic = false;
    this.homeView = { pos: new THREE.Vector3(), target: new THREE.Vector3(0, 0, 0.6) };
    this.idleOrbit = false;
    // Persistent per-frame callbacks (unaffected by Animator.reset). Receive time-scaled dt.
    this.frameFns = new Set();

    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
    this.onResize();
    this.camera.position.copy(this.homeView.pos);
    controls.target.copy(this.homeView.target);

    renderer.setAnimationLoop((t) => this.frame(t));
  }

  setupLights() {
    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x3a2a1a, 1.25);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.position.set(-9, 22, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -12;
    s.right = 12;
    s.top = 12;
    s.bottom = -12;
    s.near = 1;
    s.far = 60;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.sun = sun;

    const rim = new THREE.DirectionalLight(0x8fb4ff, 0.7);
    rim.position.set(10, 8, -14);
    this.scene.add(rim);
  }

  setupGround() {
    const geo = new THREE.CircleGeometry(70, 64);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2c3a2a, roughness: 1 });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.62;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Big stone table the board rests on.
    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(15, 15.6, 0.6, 64),
      new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.85 }),
    );
    table.position.y = -0.62 + 0.3;
    table.receiveShadow = true;
    this.scene.add(table);
  }

  onResize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.computeHomeView();
  }

  // Fit the whole board (plus a margin) regardless of aspect ratio.
  computeHomeView() {
    // Portrait screens are width-limited, so fit the board itself rather than its bounding circle.
    const radius = this.camera.aspect < 1 ? 8.6 : 9.6;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fov = Math.min(vFov, hFov);
    const dist = radius / Math.sin(fov / 2);
    const elev = THREE.MathUtils.degToRad(this.camera.aspect < 0.8 ? 62 : 55);
    this.homeView.pos.set(0, Math.sin(elev) * dist, Math.cos(elev) * dist).add(this.homeView.target);
    this.controls.maxDistance = Math.max(45, dist * 1.4);
    this.scene.fog.near = dist * 1.1;
    this.scene.fog.far = dist * 2.6;
    this.camera.far = Math.max(200, dist * 4);
    this.camera.updateProjectionMatrix();
  }

  resetView(duration = 0.8) {
    return this.cameraTo(this.homeView.pos, this.homeView.target, duration);
  }

  // Orbit-style camera move: the target slides while the eye swings around it on a sphere.
  async cameraTo(pos, target, duration = 0.8, ease = Ease.inOutCubic) {
    const t0 = this.controls.target.clone();
    const t1 = target.clone();
    const s0 = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(t0));
    const s1 = new THREE.Spherical().setFromVector3(pos.clone().sub(t1));
    let dTheta = s1.theta - s0.theta;
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;
    const s = new THREE.Spherical();
    const off = new THREE.Vector3();
    await this.anim.tween(
      duration,
      (k) => {
        this.controls.target.lerpVectors(t0, t1, k);
        s.set(s0.radius + (s1.radius - s0.radius) * k, s0.phi + (s1.phi - s0.phi) * k, s0.theta + dTheta * k);
        this.camera.position.copy(this.controls.target).add(off.setFromSpherical(s));
      },
      ease,
    );
  }

  // Frame two points from the side, choosing the side closest to the current camera.
  battleView(a, b, dist = 3.2, height = 1.7, lift = 0.5) {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    const toCam = this.camera.position.clone().sub(mid).setY(0);
    if (perp.dot(toCam) < 0) perp.negate();
    // tilt slightly so the attacker is closer to camera-left
    const offset = perp.multiplyScalar(dist).add(dir.clone().multiplyScalar(-dist * 0.25));
    const pos = mid.clone().add(offset).setY(mid.y + height + lift * 0.6);
    const target = mid.clone().setY(mid.y + lift);
    return { pos, target };
  }

  // Camera pose that frames a sphere (center, radius) from the current azimuth.
  frameView(center, radius, elevDeg = 52) {
    const t = this.controls.target;
    const az = Math.atan2(this.camera.position.x - t.x, this.camera.position.z - t.z);
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const dist = radius / Math.sin(Math.min(vFov, hFov) / 2);
    const elev = THREE.MathUtils.degToRad(elevDeg);
    const pos = new THREE.Vector3(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev)).multiplyScalar(dist).add(center);
    return { pos, target: center.clone() };
  }

  // Ease the camera toward a pose; call every frame for smooth tracking shots.
  follow(view, dt, rate = 4) {
    const k = 1 - Math.exp(-dt * rate);
    this.camera.position.lerp(view.pos, k);
    this.controls.target.lerp(view.target, k);
  }

  onFrame(fn) {
    this.frameFns.add(fn);
    return () => this.frameFns.delete(fn);
  }

  shake(amount = 0.3) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  frame(timestamp) {
    // Remove last frame's shake first so tweens and controls work on the true camera pose.
    this.camera.position.sub(this.shakeOffset);
    this.timer.update(timestamp);
    const dt = this.timer.getDelta();
    this.anim.update(dt);
    const sdt = Math.min(dt, 0.1) * this.anim.timeScale;
    for (const fn of this.frameFns) fn(sdt, this.anim.time);

    if (this.idleOrbit) {
      const t = this.controls.target;
      const off = this.camera.position.clone().sub(t);
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.08);
      this.camera.position.copy(t).add(off);
    }

    this.controls.enabled = !this.cinematic;
    this.controls.update();
    if (this.shakeAmount > 0.001) {
      const a = this.shakeAmount;
      this.shakeOffset.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
      this.shakeAmount *= Math.pow(0.02, dt);
    } else {
      this.shakeOffset.set(0, 0, 0);
      this.shakeAmount = 0;
    }
    this.camera.position.add(this.shakeOffset);
    this.renderer.render(this.scene, this.camera);
  }
}

function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#0d1230');
  grad.addColorStop(0.45, '#2b3f72');
  grad.addColorStop(0.75, '#6a5b8c');
  grad.addColorStop(1, '#1b2440');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
