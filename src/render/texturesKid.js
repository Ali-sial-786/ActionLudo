import * as THREE from 'three';

// Soft painted textures for the Kids-mode plush animals.
//
// Every texture is shaded per pixel from a function of the surface direction, so patterns (stripes,
// masks, rosy cheeks, belly patches) come out perfectly smooth and seam-free:
//   space 'sphere'  SphereGeometry UVs; shade gets the unit direction (x, y, z), +z = front, +y = up
//   space 'spine'   the same sphere rotated so its poles run along z (torsos); still (x, y, z) in mesh space
//   space 'uv'      raw (u, v), e.g. lathe capsules (v runs base -> tip) or torus coils
// A layer list paints over a base colour: [{ color, mask(x, y, z, u, v) -> 0..1, alpha }].

const cache = new Map();
const memo = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

// Unit direction for yaw (from +z towards +x) and pitch (up).
export const dirOf = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];

// Soft elliptical patch centred on (yaw, pitch): half-axes a (east) and b (north) in tangent units
// (~radians), rotated by rot. 1 inside, easing to 0 over the outer `soft` fraction.
export function blob(yaw, pitch, a, b = a, rot = 0, soft = 0.5) {
  const c = dirOf(yaw, pitch);
  const e = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const n = [-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch)];
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  return (x, y, z) => {
    const w = x * c[0] + y * c[1] + z * c[2];
    if (w <= 0) return 0;
    const u0 = x * e[0] + y * e[1] + z * e[2];
    const v0 = x * n[0] + y * n[1] + z * n[2];
    const u = u0 * cr + v0 * sr;
    const v = -u0 * sr + v0 * cr;
    const d = Math.sqrt((u / a) ** 2 + (v / b) ** 2);
    return 1 - smooth(1 - soft, 1, d);
  };
}

// Mirror a mask across x (left/right pairs: cheeks, eye patches, stripes).
export const both = (f) => (x, y, z, u, v) => Math.max(f(x, y, z, u, v), f(-x, y, z, u, v));
export const any = (...fs) => (x, y, z, u, v) => {
  let m = 0;
  for (const f of fs) m = Math.max(m, f(x, y, z, u, v));
  return m;
};

// Rosy cheeks at (±yaw, pitch).
export const cheeks = (yaw, pitch, r = 0.16) => both(blob(yaw, pitch, r * 1.15, r * 0.85, 0, 0.85));

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function kidTexture(key, { base, layers = [], space = 'sphere', w = 256, h = 128, grain = 0.018 }) {
  return memo(`kid:${key}`, () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    const data = img.data;
    const B = rgb(base);
    const L = layers.map((l) => ({ c: rgb(l.color), mask: l.mask, alpha: l.alpha ?? 1 }));
    const out = [0, 0, 0];
    for (let py = 0; py < h; py++) {
      const theta = ((py + 0.5) / h) * Math.PI;
      const st = Math.sin(theta);
      const ct = Math.cos(theta);
      const v = 1 - (py + 0.5) / h;
      for (let px = 0; px < w; px++) {
        const u = (px + 0.5) / w;
        const phi = u * Math.PI * 2;
        let x = -Math.cos(phi) * st;
        let y = ct;
        let z = Math.sin(phi) * st;
        if (space === 'spine') {
          const ty = y;
          y = -z;
          z = ty;
        }
        out[0] = B[0];
        out[1] = B[1];
        out[2] = B[2];
        for (const l of L) {
          const m = l.mask(x, y, z, u, v) * l.alpha;
          if (m <= 0) continue;
          out[0] += (l.c[0] - out[0]) * m;
          out[1] += (l.c[1] - out[1]) * m;
          out[2] += (l.c[2] - out[2]) * m;
        }
        const n = 1 + (hash(px, py) - 0.5) * grain * 2;
        const i = (py * w + px) * 4;
        data[i] = clamp01(out[0] * n) * 255;
        data[i + 1] = clamp01(out[1] * n) * 255;
        data[i + 2] = clamp01(out[2] * n) * 255;
        data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  });
}

// Big glossy cartoon eye for a sphere whose +z looks out of the face: white rim, large dark iris
// (lighter towards the bottom), black pupil and two catch-lights that also go in the emissive map
// so they stay bright on the shadowed side of the face.
export function eyeMaps(iris = 0x4a2a16) {
  return memo(`eye:${iris}`, () => {
    const I = iris;
    const irisR = 1.08;
    const ang = (x, y, z) => Math.acos(Math.max(-1, Math.min(1, z)));
    const hl1 = blob(-0.4, 0.42, 0.24, 0.28, 0.35, 0.22);
    const hl2 = blob(0.34, -0.4, 0.1, 0.1, 0, 0.3);
    const lighter = new THREE.Color(I).lerp(new THREE.Color(0xffffff), 0.38).getHex();
    const darker = new THREE.Color(I).multiplyScalar(0.4).getHex();
    const glints = (x, y, z) => Math.max(hl1(x, y, z), hl2(x, y, z));
    const map = kidTexture(`eyeMap:${iris}`, {
      base: 0xfbfdff,
      w: 512,
      h: 256,
      grain: 0,
      layers: [
        { color: darker, mask: (x, y, z) => 1 - smooth(irisR - 0.02, irisR + 0.02, ang(x, y, z)) },
        { color: I, mask: (x, y, z) => 1 - smooth(irisR - 0.14, irisR - 0.08, ang(x, y, z)) },
        // warm glow in the lower half of the iris
        { color: lighter, mask: (x, y, z) => (1 - smooth(irisR - 0.24, irisR - 0.12, ang(x, y, z))) * smooth(0.05, -0.6, y) * 0.85 },
        { color: 0x060608, mask: (x, y, z) => 1 - smooth(0.46, 0.52, ang(x, y, z)) },
        { color: 0xffffff, mask: glints },
      ],
    });
    const emissiveMap = kidTexture(`eyeGlow:${iris}`, {
      base: 0x000000,
      w: 512,
      h: 256,
      grain: 0,
      layers: [{ color: 0xffffff, mask: glints }],
    });
    return { map, emissiveMap };
  });
}
