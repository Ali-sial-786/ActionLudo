import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Sunny Kids-mode scenery: a sky dome with a soft sun, puffy clouds, rolling hills,
// lollipop trees on a flowery meadow and a gingham picnic cloth under the board.
// Everything is procedural and built once, the first time Kids mode is shown.

export const KID_SKY = { zenith: '#4fb6ff', horizon: '#e4f6ff', fog: 0xd5efff };

function canvasTexture(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  return tex;
}

// Meadow grass: soft green mottling sprinkled with tiny flowers.
export function makeGrassTexture() {
  return canvasTexture(
    256,
    (g, n) => {
      g.fillStyle = '#86d36a';
      g.fillRect(0, 0, n, n);
      for (let i = 0; i < 900; i++) {
        const x = Math.random() * n;
        const y = Math.random() * n;
        const r = 2 + Math.random() * 7;
        g.fillStyle = Math.random() < 0.5 ? 'rgba(98, 186, 82, 0.35)' : 'rgba(170, 230, 120, 0.35)';
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
      const petals = ['#ffffff', '#ffd1e3', '#fff3a6', '#d9c8ff'];
      for (let i = 0; i < 14; i++) {
        const x = 10 + Math.random() * (n - 20);
        const y = 10 + Math.random() * (n - 20);
        g.fillStyle = petals[i % petals.length];
        for (let p = 0; p < 5; p++) {
          const a = (p / 5) * Math.PI * 2;
          g.beginPath();
          g.arc(x + Math.cos(a) * 3.2, y + Math.sin(a) * 3.2, 2.6, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = '#ffc93c';
        g.beginPath();
        g.arc(x, y, 2, 0, Math.PI * 2);
        g.fill();
      }
    },
    26,
  );
}

// Pastel gingham picnic cloth.
export function makeGinghamTexture() {
  return canvasTexture(
    128,
    (g, n) => {
      const h = n / 2;
      g.fillStyle = '#fff8f0';
      g.fillRect(0, 0, n, n);
      g.fillStyle = 'rgba(255, 150, 175, 0.36)';
      g.fillRect(0, 0, h, n);
      g.fillRect(0, 0, n, h);
      g.fillStyle = 'rgba(255, 120, 150, 0.26)';
      g.fillRect(0, 0, h, h);
      // faint woven threads
      g.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      g.lineWidth = 1;
      for (let i = 0; i < n; i += 4) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, n);
        g.stroke();
      }
    },
    9,
  );
}

function makeSkyDome() {
  const sunDir = new THREE.Vector3(-9, 22, 12).normalize();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color(KID_SKY.zenith) },
      horizon: { value: new THREE.Color(KID_SKY.horizon) },
      sunDir: { value: sunDir },
    },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(horizon, zenith, pow(h, 0.55));
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.93, 0.75) * (pow(s, 400.0) * 1.2 + pow(s, 24.0) * 0.28 + pow(s, 4.0) * 0.08);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  // keep the dome inside the camera's far plane from anywhere the camera can go
  const dome = new THREE.Mesh(new THREE.SphereGeometry(120, 32, 16), mat);
  dome.renderOrder = -10;
  return dome;
}

function puffGeometry(blobs) {
  const parts = blobs.map(([x, y, z, r]) => {
    const g = new THREE.IcosahedronGeometry(r, 2);
    g.translate(x, y, z);
    return g;
  });
  return mergeGeometries(parts);
}

function makeClouds() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f2ff, emissiveIntensity: 0.55, roughness: 1, fog: false });
  const shapes = [
    [[0, 0, 0, 2.6], [2.6, -0.4, 0.3, 2], [-2.6, -0.5, 0, 1.9], [1, 1.2, 0, 1.8], [-1.2, 0.9, 0.4, 1.6]],
    [[0, 0, 0, 2.2], [2.2, -0.3, 0, 1.6], [-2, -0.4, 0.2, 1.5], [0.4, 1.1, 0, 1.5]],
    [[0, 0, 0, 3], [3, -0.6, 0, 2.2], [-3.1, -0.6, 0.4, 2.1], [1.3, 1.4, -0.3, 2], [-1.4, 1.2, 0.2, 1.8], [4.6, -1, 0, 1.3]],
  ].map(puffGeometry);
  const N = 11;
  for (let i = 0; i < N; i++) {
    const cloud = new THREE.Mesh(shapes[i % shapes.length], mat);
    const a = (i / N) * Math.PI * 2 + Math.random() * 0.3;
    const r = 70 + Math.random() * 25;
    cloud.position.set(Math.sin(a) * r, 16 + Math.random() * 18, Math.cos(a) * r);
    cloud.scale.set(1.6 + Math.random(), 1.1 + Math.random() * 0.4, 1.4);
    cloud.scale.multiplyScalar(1.3);
    cloud.lookAt(0, cloud.position.y, 0);
    group.add(cloud);
  }
  return group;
}

// A ring of soft, misty hills that also hides the far edge of the meadow.
function makeHills() {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 32, 16);
  const greens = [0xb4e9a0, 0xa2e18f, 0xc3eeac, 0x97db8a];
  const mats = greens.map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: 0x6fa860, emissiveIntensity: 0.25, roughness: 1, fog: false }));
  const N = 18;
  for (let i = 0; i < N; i++) {
    const hill = new THREE.Mesh(geo, mats[i % mats.length]);
    const a = (i / N) * Math.PI * 2 + Math.random() * 0.15;
    const r = 94 + Math.random() * 10;
    const w = 18 + Math.random() * 12;
    hill.position.set(Math.sin(a) * r, -0.62, Math.cos(a) * r);
    hill.scale.set(w, 6 + Math.random() * 8, w * 0.6);
    hill.lookAt(0, -0.62, 0);
    group.add(hill);
  }
  return group;
}

function makeTrees() {
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.2, 10);
  trunkGeo.translate(0, 1.1, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1.5, 3);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0xb07a52, roughness: 0.9 });
  const crowns = [0x6fd35c, 0x8ae06a, 0x55c46a, 0xffb7d5, 0x9be36a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 }));
  const N = 16;
  for (let i = 0; i < N; i++) {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    const crown = new THREE.Mesh(crownGeo, crowns[i % crowns.length]);
    crown.position.y = 3.0;
    crown.scale.set(1, 1.08, 1);
    tree.add(trunk, crown);
    const a = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
    const r = 19 + Math.random() * 9;
    tree.position.set(Math.sin(a) * r, -0.62, Math.cos(a) * r);
    tree.scale.setScalar(0.85 + Math.random() * 0.5);
    group.add(tree); // outside the sun's shadow frustum, so no shadow casting
  }
  return group;
}

export function buildKidScenery() {
  const group = new THREE.Group();
  group.name = 'kid-scenery';
  const sky = makeSkyDome();
  const clouds = makeClouds();
  group.add(sky, clouds, makeHills(), makeTrees());
  group.userData.update = (dt) => {
    clouds.rotation.y += dt * 0.004;
  };
  return group;
}
