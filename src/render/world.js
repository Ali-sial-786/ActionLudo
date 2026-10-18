import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Animator, Ease, lerp } from '../engine/anim.js';

// Battle colour grade: desaturate, crush, vignette, film grain and a red impact flash.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0 },
    flash: { value: 0 },
    time: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float amount; uniform float flash; uniform float time; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(l), 0.32 * amount);
      col *= mix(vec3(1.0), vec3(1.06, 0.96, 0.9), amount);
      col = mix(col, (col - 0.18) * 1.18 + 0.18, amount);
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.85);
      float v = smoothstep(0.78, 0.18, length(d));
      col *= mix(1.0, 0.25 + 0.75 * v, amount);
      col = mix(col, vec3(0.55, 0.0, 0.02) + col * 0.5, clamp(flash, 0.0, 1.0) * 0.55);
      float n = fract(sin(dot(vUv * vec2(1931.7, 1733.3) + time, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * 0.045 * amount;
      gl_FragColor = vec4(max(col, vec3(0.0)), c.a);
    }`,
};

export class World {
  constructor(container) {
    this.container = container;
    this.anim = new Animator();

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.98;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.localClippingEnabled = true;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = makeSkyTexture();
    scene.fog = new THREE.Fog(0x1b2440, 38, 80);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.18;
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
    this.setupPost();

    // Short-lived effect objects live here so an aborted sequence can be wiped in one go.
    this.transient = new THREE.Group();
    scene.add(this.transient);

    this.shakeAmount = 0;
    this.shakeOffset = new THREE.Vector3();
    this.cinematic = false;
    this.homeView = { pos: new THREE.Vector3(), target: new THREE.Vector3(0, 0, 0.6) };
    this.idleOrbit = false;
    // Persistent per-frame callbacks (unaffected by Animator.reset). Receive time-scaled dt.
    this.frameFns = new Set();
    // Cinematic state: slow motion, post-processing strength, battle lighting mood and impact flash.
    this.slow = { target: 1, hold: 0 };
    this.post = { amount: 0, target: 0 };
    this.mood = { value: 0, target: 0, center: new THREE.Vector3() };
    this.flashLevel = 0;
    this.baseFov = this.camera.fov;

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
    this.hemi = hemi;
    this.rim = rim;

    // Battle lights: a hard warm key from above and a blood-red back light.
    const key = new THREE.SpotLight(0xffd9b0, 0, 14, 0.62, 0.6, 1.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    key.visible = false;
    this.scene.add(key, key.target);
    const red = new THREE.PointLight(0xff2a14, 0, 6, 1.5);
    red.visible = false;
    this.scene.add(red);
    this.battleKey = key;
    this.battleRed = red;
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

  setupPost() {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bokeh = new BokehPass(this.scene, this.camera, { focus: 4, aperture: 0.0, maxblur: 0.009 });
    composer.addPass(this.bokeh);
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  // Cinematic mode on/off: letterbox, colour grade, depth of field and battle lighting.
  setCinematicLook(on, center = null) {
    this.post.target = on ? 1 : 0;
    this.mood.target = on ? 1 : 0;
    if (center) this.mood.center.copy(center);
    document.body.classList.toggle('letterbox', on);
  }

  // Slow time down to `factor` for `hold` real seconds, then ease back to normal speed.
  slowmo(factor = 0.25, hold = 0.8) {
    if (this.anim.timeScale > 3) return; // fast-forwarding: skip the drama
    this.slow.target = factor;
    this.slow.hold = hold;
  }

  flash(amount = 1) {
    this.flashLevel = Math.max(this.flashLevel, amount);
  }

  setFov(fov) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  onResize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
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

  clearTransient() {
    this.transient.clear();
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
    const rdt = Math.min(dt, 0.1);
    // slow motion (measured in real time so it reads the same at any game speed)
    if (this.slow.hold > 0) {
      this.slow.hold -= rdt;
      this.anim.slow = lerp(this.anim.slow, this.slow.target, 1 - Math.exp(-rdt * 18));
    } else {
      this.anim.slow = lerp(this.anim.slow, 1, 1 - Math.exp(-rdt * 5));
      if (this.anim.slow > 0.995) this.anim.slow = 1;
    }
    this.anim.update(dt);
    const sdt = rdt * this.anim.timeScale * this.anim.slow;
    for (const fn of this.frameFns) fn(sdt, this.anim.time);
    this.updateLook(rdt);

    if (this.idleOrbit) {
      const t = this.controls.target;
      const off = this.camera.position.clone().sub(t);
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.08);
      this.camera.position.copy(t).add(off);
    }

    // During cutscenes the director owns the camera; OrbitControls would clamp it to its zoom limits.
    this.controls.enabled = !this.cinematic;
    if (this.cinematic) this.camera.lookAt(this.controls.target);
    else this.controls.update();
    if (this.shakeAmount > 0.001) {
      const near = THREE.MathUtils.clamp(this.camera.position.distanceTo(this.controls.target) / 10, 0.12, 1);
      const a = this.shakeAmount * near;
      this.shakeOffset.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
      this.shakeAmount *= Math.pow(0.02, dt);
    } else {
      this.shakeOffset.set(0, 0, 0);
      this.shakeAmount = 0;
    }
    this.camera.position.add(this.shakeOffset);
    if (this.post.amount > 0.01) {
      this.bokeh.uniforms.focus.value = this.camera.position.distanceTo(this.controls.target);
      this.composer.render(rdt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  updateLook(rdt) {
    const ease = (v, t, r) => lerp(v, t, 1 - Math.exp(-rdt * r));
    this.post.amount = ease(this.post.amount, this.post.target, 3);
    if (this.post.target === 0 && this.post.amount < 0.01) this.post.amount = 0;
    this.flashLevel = Math.max(0, this.flashLevel - rdt * 2.2);
    this.grade.uniforms.amount.value = this.post.amount;
    this.grade.uniforms.flash.value = this.flashLevel;
    this.grade.uniforms.time.value = (this.grade.uniforms.time.value + rdt) % 100;
    // shallow depth of field only on close shots
    const d = this.camera.position.distanceTo(this.controls.target);
    this.bokeh.uniforms.aperture.value = this.post.amount * THREE.MathUtils.clamp(0.022 - d * 0.0035, 0.002, 0.016);

    const m = this.mood;
    m.value = ease(m.value, m.target, 2.5);
    const k = m.value;
    this.hemi.intensity = lerp(1.25, 0.35, k);
    this.sun.intensity = lerp(2.6, 0.9, k);
    this.rim.intensity = lerp(0.7, 0.2, k);
    this.scene.environmentIntensity = lerp(0.18, 0.1, k);
    const on = k > 0.01;
    this.battleKey.visible = on;
    this.battleRed.visible = on;
    if (on) {
      const toCam = this.camera.position.clone().sub(m.center).setY(0).normalize();
      this.battleKey.position.copy(m.center).add(new THREE.Vector3(toCam.x * 1.5, 5.5, toCam.z * 1.5));
      this.battleKey.target.position.copy(m.center);
      this.battleKey.intensity = 26 * k;
      this.battleRed.position.copy(m.center).add(new THREE.Vector3(-toCam.x * 1.6, 1.0, -toCam.z * 1.6));
      this.battleRed.intensity = 5 * k;
    }
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
