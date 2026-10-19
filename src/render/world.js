import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Animator, Ease, lerp } from '../engine/anim.js';
import { KID_SKY, buildKidScenery, makeGinghamTexture, makeGrassTexture } from './scenery.js';

// Battle colour grade.
//   amount: Action kill-cam — desaturate, crush, vignette, film grain.
//   joy:    Kids battles — a little extra saturation and warmth with a soft, glowing warm edge.
//   flash:  impact flash in flashTint (blood red in Action, a soft sunny white in Kids).
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0 },
    joy: { value: 0 },
    flash: { value: 0 },
    flashTint: { value: new THREE.Color(0.55, 0.0, 0.02) },
    time: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float amount; uniform float joy; uniform float flash; uniform vec3 flashTint; uniform float time; varying vec2 vUv;
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
      // cheerful kids grade
      float lj = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(lj), col, 1.0 + 0.22 * joy);
      col *= mix(vec3(1.0), vec3(1.04, 1.01, 0.96), joy);
      float edge = smoothstep(0.32, 0.8, length(d));
      col = mix(col, col * vec3(1.02, 0.95, 0.9) + vec3(0.09, 0.06, 0.07), edge * 0.6 * joy);
      col = mix(col, flashTint + col * 0.5, clamp(flash, 0.0, 1.0) * 0.55);
      float n = fract(sin(dot(vUv * vec2(1931.7, 1733.3) + time, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * 0.045 * amount;
      gl_FragColor = vec4(max(col, vec3(0.0)), c.a);
    }`,
};

// Scene look per game mode. Action: dusky, moody arena. Kids: a sunny picnic in the park.
const THEMES = {
  action: {
    toneMapping: THREE.ACESFilmicToneMapping,
    exposure: 0.98,
    fog: 0x1b2440,
    fogRange: [1.1, 2.6],
    hemiSky: 0xcfe3ff,
    hemiGround: 0x3a2a1a,
    hemi: 1.25,
    sunColor: 0xfff1dc,
    sun: 2.6,
    rimColor: 0x8fb4ff,
    rim: 0.7,
    env: 0.18,
    shadowRadius: 0.7,
    shadowIntensity: 1,
    flashTint: new THREE.Color(0.55, 0.0, 0.02),
  },
  kids: {
    toneMapping: THREE.NeutralToneMapping,
    exposure: 0.92,
    fog: KID_SKY.fog,
    fogRange: [1.1, 2.6],
    hemiSky: 0xeaf6ff,
    hemiGround: 0xc4e8a6,
    hemi: 1.55,
    sunColor: 0xfff0d4,
    sun: 2.3,
    rimColor: 0xffd6ea,
    rim: 0.55,
    env: 0.32,
    shadowRadius: 3.5,
    shadowIntensity: 0.62,
    flashTint: new THREE.Color(1.0, 0.94, 0.78),
  },
};

export class World {
  constructor(container, theme = 'action') {
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
    // Procedural textures are seen at grazing angles from the low board camera: filter them
    // anisotropically (applies to every texture created from here on that doesn't set its own).
    THREE.Texture.DEFAULT_ANISOTROPY = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    // Desktop-class GPUs get a 4096 sun shadow map for crisp contact shadows under the pieces.
    this.shadowSize = hiDetail(renderer) ? 4096 : 2048;

    const scene = new THREE.Scene();
    this.skyTexture = makeSkyTexture();
    scene.background = this.skyTexture;
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
    // Set while a script (e.g. the dice cam) owns the camera outside a cinematic.
    this.directed = false;
    this.homeView = { pos: new THREE.Vector3(), target: new THREE.Vector3(0, 0, 0.6) };
    this.idleOrbit = false;
    // Persistent per-frame callbacks (unaffected by Animator.reset). Receive time-scaled dt.
    this.frameFns = new Set();
    // Cinematic state: slow motion, post-processing strength, battle lighting mood and impact flash.
    this.slow = { target: 1, hold: 0 };
    this.post = { amount: 0, target: 0 };
    this.joy = { amount: 0, target: 0 };
    this.mood = { value: 0, target: 0, center: new THREE.Vector3() };
    this.flashLevel = 0;
    this.baseFov = this.camera.fov;
    this.theme = 'action';
    this.look = THEMES.action;
    this.setTheme(theme);

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
    sun.shadow.mapSize.set(this.shadowSize, this.shadowSize);
    const s = sun.shadow.camera;
    // Fitted (in light space) around the board and the dice trays out on the table at
    // x = ±11..12.8, z = ±2.3..6.7, from just under the table top up to ~2 units above it.
    s.left = -15.2;
    s.right = 15.2;
    s.top = 13.4;
    s.bottom = -12.4;
    s.near = 8;
    s.far = 40;
    // Small texels and a tight depth range let the bias stay small: contact shadows stay
    // attached to the paws without acne on the fur.
    const fine = this.shadowSize / 2048;
    sun.shadow.bias = -0.0005 / fine;
    sun.shadow.normalBias = 0.022 / fine;
    this.scene.add(sun);
    this.sun = sun;

    // Rim light: kept behind the subject relative to the camera (see updateRim) so silhouettes
    // separate from the board in every shot, the kill-cam included.
    const rim = new THREE.DirectionalLight(0x8fb4ff, 0.7);
    rim.position.set(10, 8, -14);
    this.scene.add(rim, rim.target);
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
    this.ground = ground;

    // Big stone table the board rests on.
    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(15, 15.6, 0.6, 64),
      new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.85 }),
    );
    table.position.y = -0.62 + 0.3;
    table.receiveShadow = true;
    this.scene.add(table);
    this.table = table;
    this.groundMats = { action: { ground: mat, table: table.material }, kids: null };
  }

  // Kids-mode meadow, picnic cloth and sky are only built the first time they're needed.
  kidGround() {
    if (!this.groundMats.kids) {
      const grass = new THREE.MeshStandardMaterial({ color: 0xffffff, map: makeGrassTexture(), roughness: 1 });
      const side = new THREE.MeshStandardMaterial({ color: 0xffe3ea, roughness: 0.9 });
      const cloth = new THREE.MeshStandardMaterial({ color: 0xffffff, map: makeGinghamTexture(), roughness: 0.95 });
      // CylinderGeometry groups: side, top cap, bottom cap
      this.groundMats.kids = { ground: grass, table: [side, cloth, side] };
      this.kidScenery = buildKidScenery();
      this.scene.add(this.kidScenery);
      this.onFrame((dt) => this.kidScenery.visible && this.kidScenery.userData.update(dt));
    }
    return this.groundMats.kids;
  }

  // Switch the whole scene look between 'action' (dusky arena) and 'kids' (sunny picnic).
  setTheme(theme) {
    const kids = theme === 'kids';
    this.theme = kids ? 'kids' : 'action';
    const look = THEMES[this.theme];
    this.look = look;
    const mats = kids ? this.kidGround() : this.groundMats.action;
    this.ground.material = mats.ground;
    this.table.material = mats.table;
    // the meadow reaches out to the hills on the horizon
    this.ground.scale.setScalar(kids ? 110 / 70 : 1);
    if (this.kidScenery) this.kidScenery.visible = kids;
    this.scene.background = kids ? new THREE.Color(KID_SKY.horizon) : this.skyTexture;
    this.scene.fog.color.setHex(look.fog);
    this.renderer.toneMapping = look.toneMapping;
    this.renderer.toneMappingExposure = look.exposure;
    this.hemi.color.setHex(look.hemiSky);
    this.hemi.groundColor.setHex(look.hemiGround);
    this.sun.color.setHex(look.sunColor);
    this.rim.color.setHex(look.rimColor);
    // PCF radius is in shadow-map texels: scale it so the softness is the same at any map size.
    this.sun.shadow.radius = look.shadowRadius * (this.shadowSize / 2048);
    this.sun.shadow.intensity = look.shadowIntensity;
    this.grade.uniforms.flashTint.value.copy(look.flashTint);
    this.computeHomeView();
    this.updateLook(0);
  }

  setupPost() {
    // Multisampled HDR target: the kill-cam close-ups go through the composer, and without MSAA
    // their silhouettes would be jagged exactly where it matters most. (Resized in onResize.)
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: THREE.HalfFloatType,
      samples: Math.min(4, this.renderer.capabilities.maxSamples),
    });
    target.texture.name = 'EffectComposer.rt1';
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bokeh = new BokehPass(this.scene, this.camera, { focus: 4, aperture: 0.0, maxblur: 0.009 });
    composer.addPass(this.bokeh);
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  // Cinematic mode on/off: letterbox, colour grade, depth of field and battle lighting.
  // look 'action' = grim grade, depth of field, dark battle lighting and letterbox;
  // look 'kids' keeps the sunny lighting and only adds a gentle, cheerful grade.
  setCinematicLook(on, center = null, look = 'action') {
    const grim = on && look === 'action';
    this.post.target = grim ? 1 : 0;
    this.mood.target = grim ? 1 : 0;
    this.joy.target = on && look === 'kids' ? 1 : 0;
    if (center) this.mood.center.copy(center);
    document.body.classList.toggle('letterbox', grim);
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

  // Frame the playing area as closely as the screen allows, between the player chips along the top
  // and the roll bar along the bottom, from a fairly low angle. Portrait screens are width-limited,
  // so there the outermost column may be trimmed at the near corners.
  computeHomeView() {
    const aspect = this.camera.aspect;
    const portrait = aspect < 0.8;
    const elev = THREE.MathUtils.degToRad(portrait ? 54 : 42);
    const ex = portrait ? 7.1 : 7.7;
    const ez = 7.7;
    const pts = [];
    for (const x of [-ex, ex]) for (const z of [-ez, ez]) for (const y of [0.12, 0.82]) pts.push(new THREE.Vector3(x, y, z));
    const h = this.container.clientHeight || window.innerHeight;
    const yTop = 1 - 2 * Math.max(portrait ? 0.17 : 0.11, 70 / h);
    const yBot = -1 + 2 * Math.max(0.12, 92 / h);
    const cam = (this.fitCamera ??= new THREE.PerspectiveCamera());
    cam.fov = this.camera.fov;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    const dir = new THREE.Vector3(0, Math.sin(elev), Math.cos(elev));
    const target = new THREE.Vector3();
    const v = new THREE.Vector3();
    const measure = (tz, d) => {
      target.set(0, 0, tz);
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      let lo = Infinity;
      let hi = -Infinity;
      let wide = 0;
      for (const p of pts) {
        v.copy(p).project(cam);
        wide = Math.max(wide, Math.abs(v.x));
        lo = Math.min(lo, v.y);
        hi = Math.max(hi, v.y);
      }
      return { ok: wide <= 0.97 && hi <= yTop && lo >= yBot, mid: (lo + hi) / 2 };
    };
    // For each aim point, the closest distance that fits; keep the one that centres the board.
    let best = null;
    for (let tz = -3; tz <= 5.001; tz += 0.1) {
      let near = 5;
      let far = 120;
      for (let i = 0; i < 24; i++) {
        const d = (near + far) / 2;
        if (measure(tz, d).ok) far = d;
        else near = d;
      }
      const off = Math.abs(measure(tz, far).mid - (yTop + yBot) / 2);
      if (!best || off < best.off) best = { tz, d: far, off };
    }
    const dist = best.d;
    this.homeView.target.set(0, 0, best.tz);
    this.homeView.pos.copy(this.homeView.target).addScaledVector(dir, dist);
    this.controls.maxDistance = Math.max(45, dist * 1.4);
    // fog ranges are tuned relative to the far edge of the board (1.2× the distance at a high angle)
    const reach = this.homeView.pos.distanceTo(v.set(0, 0, -ez)) / 1.2;
    const [near, far] = this.look?.fogRange ?? THEMES.action.fogRange;
    this.scene.fog.near = reach * near;
    this.scene.fog.far = reach * far;
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

  // Stereo position (-1 … 1) of a point in the scene, for panning its sounds.
  panAt(pos) {
    const v = pos.clone().project(this.camera);
    return Math.max(-1, Math.min(1, v.x)) * 0.6;
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
    const scripted = this.cinematic || this.directed;
    this.controls.enabled = !scripted;
    if (scripted) this.camera.lookAt(this.controls.target);
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
    // gentle handheld drift on cinematic shots
    if (this.post.amount > 0.01) {
      const t = this.anim.time;
      const d = this.camera.position.distanceTo(this.controls.target) * 0.012 * this.post.amount;
      this.shakeOffset.x += Math.sin(t * 1.3) * d;
      this.shakeOffset.y += Math.sin(t * 1.7 + 1) * d * 0.6;
      this.shakeOffset.z += Math.cos(t * 1.1) * d;
    }
    this.camera.position.add(this.shakeOffset);
    this.updateRim();
    if (this.post.amount > 0.01 || this.joy.amount > 0.01) {
      this.bokeh.enabled = this.post.amount > 0.01;
      this.bokeh.uniforms.focus.value = this.camera.position.distanceTo(this.controls.target);
      this.composer.render(rdt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // Keep the rim light behind whatever the camera looks at (swung a little to one side and raised),
  // so every shot gets a thin bright edge on the far side of the pieces.
  updateRim() {
    const t = this.controls.target;
    const f = _rimDir.set(t.x - this.camera.position.x, 0, t.z - this.camera.position.z);
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize().applyAxisAngle(_yAxis, 0.6);
    this.rim.position.set(t.x + f.x * 10, t.y + 6.5, t.z + f.z * 10);
    this.rim.target.position.copy(t);
  }

  updateLook(rdt) {
    const ease = (v, t, r) => lerp(v, t, 1 - Math.exp(-rdt * r));
    this.post.amount = ease(this.post.amount, this.post.target, 3);
    if (this.post.target === 0 && this.post.amount < 0.01) this.post.amount = 0;
    this.joy.amount = ease(this.joy.amount, this.joy.target, 3);
    if (this.joy.target === 0 && this.joy.amount < 0.01) this.joy.amount = 0;
    this.flashLevel = Math.max(0, this.flashLevel - rdt * 2.2);
    this.grade.uniforms.amount.value = this.post.amount;
    this.grade.uniforms.joy.value = this.joy.amount;
    this.grade.uniforms.flash.value = this.flashLevel;
    this.grade.uniforms.time.value = (this.grade.uniforms.time.value + rdt) % 100;
    // shallow depth of field only on close shots
    const d = this.camera.position.distanceTo(this.controls.target);
    this.bokeh.uniforms.aperture.value = this.post.amount * THREE.MathUtils.clamp(0.022 - d * 0.0035, 0.002, 0.016);

    const m = this.mood;
    m.value = ease(m.value, m.target, 2.5);
    const k = m.value;
    const look = this.look;
    this.hemi.intensity = lerp(look.hemi, 0.35, k);
    this.sun.intensity = lerp(look.sun, 0.9, k);
    this.rim.intensity = lerp(look.rim, 0.2, k);
    this.scene.environmentIntensity = lerp(look.env, 0.1, k);
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

const _rimDir = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);

// Whether this looks like a desktop-class GPU (fine pointer, large textures): worth a 4096 shadow map.
function hiDetail(renderer) {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return !coarse && renderer.capabilities.maxTextureSize >= 8192;
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
