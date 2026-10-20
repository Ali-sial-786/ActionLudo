import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Action-mode scenery: a ruined stone arena in the jungle at night. A starry sky with a big moon,
// a broken colonnade and stepped tiers around a sandy floor, flaming braziers with drifting embers,
// and the jungle canopy and mountains in silhouette. Everything is procedural, and the flames and
// embers animate on the GPU, so the whole backdrop costs a couple of dozen draw calls.

// The fog matches the sky's horizon so the far stonework melts into the dusk.
export const ARENA_SKY = { fog: 0x2a2442 };

const FLOOR_Y = -0.62;
const WALL_R = 24; // inner face of the arena wall
const MOON_DIR = new THREE.Vector3(-0.45, 0.27, -0.85).normalize();

const TAU = Math.PI * 2;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

function texture(c, repeatX = 1, repeatY = 1, color = true) {
  const tex = new THREE.CanvasTexture(c);
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  return tex;
}

// Tileable value noise on a w×h grid of `cells` cells (wraps at the edges).
function tileNoise(rand, cells) {
  const g = Array.from({ length: cells * cells }, rand);
  const at = (x, y) => g[(((y % cells) + cells) % cells) * cells + (((x % cells) + cells) % cells)];
  return (u, v) => {
    const x = u * cells;
    const y = v * cells;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
}

// Fills a canvas pixel by pixel: fn(u, v) → [r, g, b] (0..255).
function paint(g, w, h, fn) {
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, gg, b] = fn(x / w, y / h);
      const i = (y * w + x) * 4;
      d[i] = r;
      d[i + 1] = gg;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

// ------------------------------------------------------------------ textures

// Packed, dusty arena sand with pebbles and scuffs.
function sandTexture(rand) {
  const n1 = tileNoise(rand, 8);
  const n2 = tileNoise(rand, 32);
  const n3 = tileNoise(rand, 128);
  return canvas(512, 512, (g, w, h) => {
    paint(g, w, h, (u, v) => {
      const k = 0.55 * n1(u, v) + 0.3 * n2(u, v) + 0.15 * n3(u, v);
      const s = 0.78 + 0.32 * k;
      return [118 * s, 96 * s, 72 * s];
    });
    for (let i = 0; i < 260; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const r = 0.8 + rand() * 2.6;
      g.fillStyle = rand() < 0.5 ? 'rgba(60, 46, 34, 0.55)' : 'rgba(170, 150, 120, 0.45)';
      for (const [dx, dy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
        g.beginPath();
        g.ellipse(x + dx, y + dy, r, r * (0.6 + rand() * 0.4), rand() * 3, 0, TAU);
        g.fill();
      }
    }
  });
}

// Stone blocks with mortar, chips and grime: `cols` × `rows` blocks per tile, tiling both ways.
function blockTexture(rand, { cols = 4, rows = 3, base = [112, 100, 88], w = 512, h = 384, moss = 0.25 } = {}) {
  const n = tileNoise(rand, 16);
  const fine = tileNoise(rand, 96);
  return canvas(w, h, (g) => {
    paint(g, w, h, (u, v) => {
      const k = 0.75 + 0.2 * n(u, v) + 0.12 * fine(u, v);
      return base.map((c) => c * k);
    });
    const bh = h / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * 0.5;
      for (let c = 0; c <= cols; c++) {
        const bw = w / cols;
        const x = (c + off) * bw;
        const shade = 0.82 + rand() * 0.3;
        g.fillStyle = `rgba(${shade > 1 ? 255 : 0}, ${shade > 1 ? 240 : 0}, ${shade > 1 ? 220 : 0}, ${Math.abs(1 - shade) * 0.5})`;
        g.fillRect(x - bw + 3, r * bh + 3, bw - 6, bh - 6);
        // chipped corners
        g.fillStyle = 'rgba(30, 24, 20, 0.35)';
        for (let i = 0; i < 3; i++) {
          g.beginPath();
          g.arc(x - bw + 3 + rand() * (bw - 6), r * bh + (rand() < 0.5 ? 4 : bh - 4), 2 + rand() * 5, 0, TAU);
          g.fill();
        }
      }
      // mortar lines
      g.fillStyle = 'rgba(28, 22, 18, 0.85)';
      g.fillRect(0, r * bh, w, 3);
      for (let c = 0; c <= cols; c++) g.fillRect(((c + off) * w) / cols - 1.5, r * bh, 3, bh);
    }
    // a few cracks
    g.strokeStyle = 'rgba(20, 16, 14, 0.6)';
    g.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      let x = rand() * w;
      let y = rand() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 6; s++) g.lineTo((x += (rand() - 0.5) * 30), (y += rand() * 16));
      g.stroke();
    }
    // grime and moss creeping up from the bottom
    const grad = g.createLinearGradient(0, h * (1 - moss), 0, h);
    grad.addColorStop(0, 'rgba(30, 40, 22, 0)');
    grad.addColorStop(1, 'rgba(30, 44, 24, 0.55)');
    g.fillStyle = grad;
    g.fillRect(0, h * (1 - moss), w, h * moss);
  });
}

// Worn flagstones for the ring around the table (u runs around the ring, v outward).
function flagstoneTexture(rand) {
  const n = tileNoise(rand, 24);
  return canvas(512, 256, (g, w, h) => {
    paint(g, w, h, (u, v) => {
      const k = 0.7 + 0.3 * n(u, v);
      return [96 * k, 86 * k, 76 * k];
    });
    const rows = 2;
    for (let r = 0; r < rows; r++) {
      const y0 = (r * h) / rows;
      let x = r * 40;
      while (x < w + 40) {
        const bw = 70 + rand() * 60;
        const shade = 0.85 + rand() * 0.3;
        g.fillStyle = `rgba(${shade > 1 ? 200 : 20}, ${shade > 1 ? 190 : 16}, ${shade > 1 ? 170 : 12}, ${Math.abs(1 - shade) * 0.6})`;
        for (const dx of [0, -w]) g.fillRect(x + dx + 3, y0 + 3, bw - 6, h / rows - 6);
        g.fillStyle = 'rgba(24, 20, 16, 0.85)';
        for (const dx of [0, -w]) g.fillRect(x + dx - 2, y0, 4, h / rows);
        x += bw;
      }
      g.fillStyle = 'rgba(24, 20, 16, 0.85)';
      g.fillRect(0, y0 - 2, w, 4);
    }
    // sand drifted into the joints and over the outer edge
    const grad = g.createLinearGradient(0, h * 0.55, 0, h);
    grad.addColorStop(0, 'rgba(118, 96, 72, 0)');
    grad.addColorStop(1, 'rgba(118, 96, 72, 0.85)');
    g.fillStyle = grad;
    g.fillRect(0, h * 0.55, w, h * 0.45);
  });
}

// The stone table top: weathered granite with a carved ring and a band of glyphs near the rim.
// (A cylinder's cap is mapped flat, so the canvas centre is the table's centre.)
function tableTopTexture(rand) {
  return canvas(1024, 1024, (g, w) => {
    const c = w / 2;
    g.fillStyle = '#5d5045';
    g.fillRect(0, 0, w, w);
    for (let i = 0; i < 2600; i++) {
      const r = 2 + rand() * 18;
      g.fillStyle = rand() < 0.5 ? `rgba(40, 32, 28, ${0.05 + rand() * 0.1})` : `rgba(150, 132, 114, ${0.04 + rand() * 0.08})`;
      g.beginPath();
      g.arc(rand() * w, rand() * w, r, 0, TAU);
      g.fill();
    }
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = rand() < 0.5 ? 'rgba(25, 20, 18, 0.5)' : 'rgba(190, 175, 160, 0.4)';
      g.fillRect(rand() * w, rand() * w, 1.5, 1.5);
    }
    const ring = (r, width, color) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      g.arc(c, c, r, 0, TAU);
      g.stroke();
    };
    // a carved groove (shadowed edge plus a lit lip) and a bronze inlay near the rim
    const R = c / 15; // canvas pixels per world unit
    ring(14.55 * R, 7, 'rgba(22, 16, 12, 0.7)');
    ring(14.55 * R + 3, 2, 'rgba(200, 180, 150, 0.25)');
    ring(13.0 * R, 9, '#7a5a2e');
    ring(13.0 * R - 3, 2, 'rgba(255, 220, 150, 0.45)');
    ring(13.0 * R + 4, 2, 'rgba(20, 12, 6, 0.6)');
    ring(11.95 * R, 4, 'rgba(22, 16, 12, 0.6)');
    // glyphs between the rings
    g.save();
    g.translate(c, c);
    for (let i = 0; i < 64; i++) {
      g.save();
      g.rotate((i / 64) * TAU);
      g.translate(0, -13.75 * R);
      g.strokeStyle = 'rgba(24, 18, 14, 0.7)';
      g.lineWidth = 3;
      g.beginPath();
      const kind = i % 4;
      if (kind === 0) {
        g.moveTo(-8, -9);
        g.lineTo(0, 9);
        g.lineTo(8, -9);
      } else if (kind === 1) {
        g.arc(0, 0, 8, 0, TAU);
        g.moveTo(-8, 0);
        g.lineTo(8, 0);
      } else if (kind === 2) {
        g.moveTo(0, -10);
        g.lineTo(0, 10);
        g.moveTo(-7, -4);
        g.lineTo(7, 4);
      } else {
        g.moveTo(-8, 8);
        g.lineTo(-8, -8);
        g.lineTo(8, -8);
        g.lineTo(8, 8);
      }
      g.stroke();
      g.restore();
    }
    g.restore();
    // hairline cracks
    g.strokeStyle = 'rgba(20, 15, 12, 0.45)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 14; i++) {
      const a = rand() * TAU;
      let r = (10 + rand() * 5) * R;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
      let aa = a;
      for (let s = 0; s < 8; s++) {
        r -= 6 + rand() * 10;
        aa += (rand() - 0.5) * 0.06;
        g.lineTo(c + Math.cos(aa) * r, c + Math.sin(aa) * r);
      }
      g.stroke();
    }
  });
}

// The table's rim: a band of carved blocks under a moulding.
function tableSideTexture(rand) {
  return canvas(512, 64, (g, w, h) => {
    g.fillStyle = '#54473c';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = rand() < 0.5 ? 'rgba(30, 24, 20, 0.3)' : 'rgba(160, 140, 120, 0.2)';
      g.fillRect(rand() * w, rand() * h, 2, 2);
    }
    g.fillStyle = 'rgba(200, 180, 150, 0.35)';
    g.fillRect(0, 4, w, 3);
    g.fillStyle = 'rgba(20, 15, 12, 0.7)';
    g.fillRect(0, 14, w, 3);
    for (let x = 0; x < w; x += 64) g.fillRect(x, 17, 3, h - 17);
    g.fillStyle = 'rgba(20, 15, 12, 0.5)';
    g.fillRect(0, h - 6, w, 6);
  });
}

// A seamless silhouette strip for a ring around the arena (alpha: the shape, colour: `fill`).
function ridgeTexture(rand, layers) {
  return canvas(2048, 256, (g, w, h) => {
    for (const { fill, base, amp, terms } of layers) {
      const ph = Array.from({ length: terms }, () => rand() * TAU);
      const amps = Array.from({ length: terms }, (_, i) => (0.5 + rand()) / (i + 1) ** 1.1);
      g.fillStyle = fill;
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= w; x += 2) {
        const u = x / w;
        let y = 0;
        for (let i = 0; i < terms; i++) y += amps[i] * Math.sin(TAU * (i + 1) * 2 * u + ph[i]);
        // sharpen into ridges
        g.lineTo(x, h - (base + amp * (0.5 + 0.5 * Math.tanh(y))) * h);
      }
      g.lineTo(w, h);
      g.closePath();
      g.fill();
    }
  });
}

// Jungle canopy silhouette: palms, broadleaf crowns and dead branches, wrapping seamlessly.
function jungleTexture(rand) {
  return canvas(2048, 512, (g, w, h) => {
    const draw = (fn) => {
      for (const dx of [0, -w, w]) {
        g.save();
        g.translate(dx, 0);
        fn();
        g.restore();
      }
    };
    const dark = '#06080f';
    g.fillStyle = dark;
    g.strokeStyle = dark;
    g.fillRect(0, h * 0.86, w, h * 0.14);
    // undergrowth
    for (let i = 0; i < 160; i++) {
      const x = rand() * w;
      const r = 14 + rand() * 30;
      draw(() => {
        g.beginPath();
        g.arc(x, h * 0.86 - r * 0.3, r, 0, TAU);
        g.fill();
      });
    }
    // broadleaf trees
    for (let i = 0; i < 46; i++) {
      const x = rand() * w;
      const top = h * (0.25 + rand() * 0.4);
      const r = 26 + rand() * 40;
      draw(() => {
        g.lineWidth = 5 + rand() * 6;
        g.beginPath();
        g.moveTo(x, h);
        g.quadraticCurveTo(x + (rand() - 0.5) * 30, (h + top) / 2, x + (rand() - 0.5) * 20, top + r * 0.5);
        g.stroke();
        for (let b = 0; b < 7; b++) {
          g.beginPath();
          g.arc(x + (rand() - 0.5) * r * 1.8, top + (rand() - 0.3) * r, r * (0.45 + rand() * 0.5), 0, TAU);
          g.fill();
        }
      });
    }
    // palms rising above the canopy
    for (let i = 0; i < 18; i++) {
      const x = rand() * w;
      const top = h * (0.08 + rand() * 0.2);
      const lean = (rand() - 0.5) * 60;
      draw(() => {
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(x, h);
        g.quadraticCurveTo(x + lean * 0.3, (h + top) / 2, x + lean, top);
        g.stroke();
        for (let f = 0; f < 9; f++) {
          const a = (f / 9) * TAU + rand() * 0.3;
          const len = 40 + rand() * 30;
          const ex = x + lean + Math.cos(a) * len;
          const ey = top + Math.sin(a) * len * 0.45 + len * 0.35;
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(x + lean, top);
          g.quadraticCurveTo(x + lean + Math.cos(a) * len * 0.5, top - 14, ex, ey);
          g.stroke();
          // leaflets
          g.lineWidth = 1.5;
          for (let l = 0.25; l < 1; l += 0.12) {
            const px = x + lean + (ex - x - lean) * l;
            const py = top + (ey - top) * l - 10 * Math.sin(l * Math.PI);
            g.beginPath();
            g.moveTo(px, py);
            g.lineTo(px + Math.cos(a + 1.4) * 9, py + 10);
            g.moveTo(px, py);
            g.lineTo(px + Math.cos(a - 1.4) * 9, py + 10);
            g.stroke();
          }
        }
      });
    }
    // a few dead trees
    for (let i = 0; i < 7; i++) {
      const x = rand() * w;
      draw(() => {
        const branch = (x0, y0, a, len, width, depth) => {
          const x1 = x0 + Math.cos(a) * len;
          const y1 = y0 - Math.sin(a) * len;
          g.lineWidth = width;
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(x1, y1);
          g.stroke();
          if (depth > 0) for (const s of [-1, 1]) branch(x1, y1, a + s * (0.35 + rand() * 0.4), len * 0.68, width * 0.65, depth - 1);
        };
        branch(x, h, Math.PI / 2 + (rand() - 0.5) * 0.2, h * 0.28, 7, 4);
      });
    }
  });
}

// ------------------------------------------------------------------ sky

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      time: { value: 0 },
      moonDir: { value: MOON_DIR },
      horizon: { value: new THREE.Color(ARENA_SKY.fog) },
    },
    vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float time; uniform vec3 moonDir; uniform vec3 horizon; varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float vnoise(vec3 p) {
        vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        // night gradient: a dusky purple horizon up to deep indigo
        vec3 col = mix(horizon, vec3(0.05, 0.055, 0.14), smoothstep(0.0, 0.3, h));
        col = mix(col, vec3(0.012, 0.016, 0.05), smoothstep(0.25, 0.95, h));
        // the warm glow of distant fires low on the horizon, away from the moon
        vec2 dir2 = normalize(d.xz + 1e-5);
        float away = max(dot(dir2, -normalize(moonDir.xz)), 0.0);
        col += vec3(0.3, 0.1, 0.03) * pow(away, 2.5) * exp(-max(h, 0.0) * 11.0);
        // a faint band of the galaxy
        vec3 bandN = normalize(vec3(0.35, 0.5, 0.79));
        float band = exp(-pow(dot(d, bandN) / 0.2, 2.0));
        float neb = vnoise(d * 7.0) * 0.6 + vnoise(d * 17.0) * 0.4;
        col += vec3(0.07, 0.06, 0.12) * band * neb * smoothstep(0.05, 0.4, h);
        // stars: one candidate per cell on a sphere, twinkling
        vec3 p = d * 300.0;
        vec3 c = floor(p);
        float r = hash(c);
        float density = 0.986 - band * 0.012;
        if (r > density) {
          vec3 o = vec3(hash(c + 1.7), hash(c + 3.1), hash(c + 5.3)) * 0.6 + 0.2;
          float dist = length(fract(p) - o);
          float px = length(fwidth(p)) * 0.7;
          float size = 0.05 + 0.1 * hash(c + 7.7);
          float tw = 0.7 + 0.3 * sin(time * (1.0 + 3.0 * hash(c + 9.1)) + r * 60.0);
          float b = smoothstep(size + px, max(size - px, 0.0), dist) * tw * (0.35 + 0.65 * (r - density) / (1.0 - density));
          vec3 tint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.9, 0.75), hash(c + 2.9));
          col += tint * b * 1.6 * smoothstep(0.02, 0.25, h);
        }
        // thin clouds drifting low across the sky, lit by the moon at their edges
        float cl = vnoise(vec3(d.xz / (h + 0.35) * 2.2 + vec2(time * 0.004, 0.0), 1.0)) * 0.65 + vnoise(vec3(d.xz / (h + 0.35) * 5.0, 2.0)) * 0.35;
        float cloud = smoothstep(0.55, 0.8, cl) * smoothstep(0.02, 0.12, h) * (1.0 - smoothstep(0.3, 0.6, h));
        float m = dot(d, moonDir);
        col = mix(col, vec3(0.03, 0.03, 0.06) + vec3(0.12, 0.12, 0.16) * pow(max(m, 0.0), 6.0), cloud * 0.85);
        // the moon: a pale disc with dark seas and a soft halo
        vec3 right = normalize(cross(moonDir, vec3(0.0, 1.0, 0.0)));
        vec3 up = cross(right, moonDir);
        float rad = 0.042;
        vec2 uv = vec2(dot(d, right), dot(d, up)) / rad;
        float rr = length(uv);
        float disc = 1.0 - smoothstep(0.97, 1.03, rr);
        if (m > 0.0 && disc > 0.0) {
          float seas = vnoise(vec3(uv * 2.2, 3.0)) * 0.6 + vnoise(vec3(uv * 6.0, 5.0)) * 0.4;
          float shade = mix(0.64, 1.0, smoothstep(0.38, 0.62, seas)) * (0.82 + 0.18 * sqrt(max(0.0, 1.0 - rr * rr)));
          col = mix(col, vec3(1.0, 0.96, 0.86) * 1.5 * shade, disc * (1.0 - cloud * 0.6));
        }
        float halo = pow(max(m, 0.0), 900.0) * 0.5 + pow(max(m, 0.0), 80.0) * 0.16 + pow(max(m, 0.0), 12.0) * 0.05;
        col += vec3(0.7, 0.78, 1.0) * halo * (1.0 - disc);
        // below the horizon fades to the dark of the jungle
        col = mix(col, vec3(0.015, 0.016, 0.03), smoothstep(0.0, -0.12, h));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(120, 48, 24), mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  return dome;
}

// A silhouette ring (mountains, jungle) facing inward.
function silhouetteRing(tex, radius, height, y, tint, order) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 96, 1, true);
  geo.translate(0, y + height / 2, 0);
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: tint, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = order;
  return mesh;
}

// ------------------------------------------------------------------ fire

// Camera-facing flames (instanced quads; the flicker is computed in the fragment shader).
function flameMaterial(glow) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 } },
    vertexShader: `
      attribute float seed; varying vec2 vUv; varying float vSeed; varying float vNear;
      void main() {
        vUv = uv; vSeed = seed;
        vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        // fade out when the camera comes right up to a fire
        vNear = smoothstep(1.5, 5.0, -center.z);
        vec2 scale = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
        gl_Position = projectionMatrix * (center + vec4(position.xy * scale, 0.0, 0.0));
      }`,
    fragmentShader: glow
      ? `
      uniform float time; varying vec2 vUv; varying float vSeed; varying float vNear;
      void main() {
        vec2 p = vUv - 0.5;
        float flick = 0.8 + 0.12 * sin(time * 9.0 + vSeed * 20.0) + 0.08 * sin(time * 23.0 + vSeed * 7.0);
        float a = exp(-dot(p, p) * 16.0) * 0.45 * flick * vNear;
        gl_FragColor = vec4(vec3(1.0, 0.45, 0.12) * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
      : `
      uniform float time; varying vec2 vUv; varying float vSeed; varying float vNear;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        float t = time + vSeed * 13.0;
        vec2 uv = vUv;
        float n1 = noise(vec2(uv.x * 4.0, uv.y * 3.0 - t * 2.6));
        float n2 = noise(vec2(uv.x * 9.0 + 4.0, uv.y * 7.0 - t * 4.3));
        float x = uv.x - 0.5 + (n1 - 0.5) * 0.35 * uv.y;
        float w = 0.46 * pow(1.0 - uv.y, 0.7) * (0.75 + 0.25 * n2) + 0.01;
        float body = 1.0 - smoothstep(w * 0.45, w, abs(x));
        body *= smoothstep(0.0, 0.06, uv.y) * (1.0 - smoothstep(0.45 + 0.4 * n2, 1.0, uv.y));
        float core = (1.0 - smoothstep(0.0, w * 0.45, abs(x))) * (1.0 - smoothstep(0.0, 0.4, uv.y));
        vec3 col = mix(vec3(0.9, 0.16, 0.02), vec3(1.0, 0.5, 0.12), body);
        col = mix(col, vec3(1.0, 0.85, 0.5), core * 0.8);
        float a = body * (0.85 + 0.15 * n1) * vNear;
        gl_FragColor = vec4(col * a * 1.9, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// Embers drifting up from every fire (animated entirely in the vertex shader).
function makeEmbers(fires, perFire, rand) {
  const n = fires.reduce((s, f) => s + Math.round(perFire * f.size), 0);
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  let i = 0;
  for (const f of fires) {
    for (let k = 0; k < Math.round(perFire * f.size); k++, i++) {
      pos[i * 3] = f.pos.x + (rand() - 0.5) * 0.5 * f.size;
      pos[i * 3 + 1] = f.pos.y + 0.2;
      pos[i * 3 + 2] = f.pos.z + (rand() - 0.5) * 0.5 * f.size;
      seed[i] = rand();
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, scale: { value: 300 }, maxSize: { value: 6 } },
    vertexShader: `
      uniform float time; uniform float scale; uniform float maxSize; attribute float seed; varying float vA;
      void main() {
        float life = fract(time * (0.1 + 0.12 * fract(seed * 7.31)) + seed);
        vec3 p = position;
        p.y += life * (3.0 + 4.0 * fract(seed * 3.17));
        p.x += sin(time * 1.3 + seed * 40.0) * 0.35 * life + life * 1.4 * sin(seed * 91.0);
        p.z += cos(time * 1.1 + seed * 23.0) * 0.35 * life + life * 1.4 * cos(seed * 91.0);
        vA = smoothstep(0.0, 0.08, life) * (1.0 - life) * (0.6 + 0.4 * sin(time * 12.0 + seed * 70.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(scale * (0.035 + 0.04 * fract(seed * 11.7)) / -mv.z, 1.5, maxSize);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vA;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(q)) * vA;
        gl_FragColor = vec4(vec3(1.0, 0.55, 0.18) * a * 1.6, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

// ------------------------------------------------------------------ stonework

// A faint cool emissive stands in for moonlight, so the stonework still reads when the kill-cam
// dims the scene lights.
const MOONLIT = 0x4a4a66;

function stoneMaterial(tex, color = 0xffffff, extra = {}) {
  return new THREE.MeshStandardMaterial({ map: tex, color, roughness: 0.95, metalness: 0, emissive: MOONLIT, emissiveMap: tex, ...extra });
}

// Re-maps a ring or band's UVs to polar coordinates: u around (repeated `around` times), v outward.
function polarUVs(geo, r0, r1, around) {
  const p = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const a = Math.atan2(y, x);
    uv.setXY(i, ((a / TAU + 1) % 1) * around, (Math.hypot(x, y) - r0) / (r1 - r0));
  }
  uv.needsUpdate = true;
}

function makeStonework(rand, fires) {
  const group = new THREE.Group();
  const wallTex = texture(blockTexture(rand, { cols: 4, rows: 3, base: [104, 94, 84], moss: 0.35 }), 30, 1);
  const tierTex = texture(blockTexture(rand, { cols: 6, rows: 2, base: [92, 84, 78], w: 512, h: 256, moss: 0.2 }));
  const pillarTex = texture(blockTexture(rand, { cols: 2, rows: 4, base: [120, 108, 94], w: 256, h: 512, moss: 0.3 }), 2, 2);
  const pillarMat = stoneMaterial(pillarTex, 0x8f8a98);
  const tierMat = stoneMaterial(tierTex, 0x6c6876, { side: THREE.DoubleSide });

  // the arena wall: a ring with a broken top edge
  const wallH = 2.6;
  const wallGeo = new THREE.CylinderGeometry(WALL_R, WALL_R, wallH, 160, 3, true);
  const wp = wallGeo.attributes.position;
  for (let i = 0; i < wp.count; i++) {
    if (wp.getY(i) > wallH / 2 - 0.01) {
      const a = Math.atan2(wp.getZ(i), wp.getX(i));
      const dip = Math.max(0, Math.sin(a * 7 + 1.3) * Math.sin(a * 3 + 0.4)) * 1.4 + (rand() < 0.15 ? rand() * 0.6 : 0);
      wp.setY(i, wp.getY(i) - dip);
    }
  }
  wallGeo.translate(0, FLOOR_Y + wallH / 2, 0);
  wallGeo.computeVertexNormals();
  const wall = new THREE.Mesh(wallGeo, stoneMaterial(wallTex, 0x858090, { side: THREE.DoubleSide }));
  // a plinth along the foot of the wall
  const plinth = new THREE.Mesh(new THREE.TorusGeometry(WALL_R, 0.3, 6, 160), stoneMaterial(wallTex, 0x6e6a76));
  plinth.rotation.x = Math.PI / 2;
  plinth.position.y = FLOOR_Y + 0.1;
  group.add(wall, plinth);

  // stepped tiers of seating rising behind the wall, with a few collapsed stretches
  const steps = 5;
  const prof = [new THREE.Vector2(WALL_R + 0.6, FLOOR_Y)];
  for (let s = 0; s <= steps; s++) {
    const r = WALL_R + 0.6 + s * 2.1;
    const y = FLOOR_Y + wallH - 0.4 + s * 1.35;
    prof.push(new THREE.Vector2(r, y), new THREE.Vector2(r + 2.1, y));
    if (s < steps) prof.push(new THREE.Vector2(r + 2.1, y + 1.35));
  }
  prof.push(new THREE.Vector2(prof[prof.length - 1].x, FLOOR_Y));
  const gaps = [
    [0.55, 0.85],
    [2.6, 2.95],
    [4.2, 4.45],
  ];
  const inGap = (a) => gaps.some(([g0, g1]) => (a % TAU) > g0 - 0.12 && (a % TAU) < g1 + 0.12);
  const spans = gaps.map(([, g1], i) => [g1, (gaps[(i + 1) % gaps.length][0] - g1 + TAU) % TAU]);
  for (const [start, len] of spans) {
    const geo = new THREE.LatheGeometry(prof, 64, start, len);
    // lathe UVs run along the profile; repeat the blocks around the ring instead
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (len / TAU) * 46, uv.getY(i) * 6);
    uv.needsUpdate = true;
    group.add(new THREE.Mesh(geo, tierMat));
  }

  // the colonnade: some pillars still whole (with a lintel between pairs), others broken off
  const N = 30;
  const shaft = new THREE.CylinderGeometry(0.55, 0.62, 1, 12);
  shaft.translate(0, 0.5, 0);
  const base = new THREE.BoxGeometry(1.6, 0.45, 1.6);
  base.translate(0, 0.225, 0);
  const cap = new THREE.BoxGeometry(1.5, 0.4, 1.5);
  const whole = [];
  const broken = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU + 0.05;
    if (inGap(a)) continue;
    const r = WALL_R + 1.4;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const isBroken = rand() < 0.3;
    (isBroken ? broken : whole).push({ x, z, a, h: isBroken ? 1.5 + rand() * 3 : 7.2 + rand() * 0.6, i });
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const add = (list, geo, place) => {
    const mesh = new THREE.InstancedMesh(geo, pillarMat, list.length);
    list.forEach((p, k) => {
      place(p);
      mesh.setMatrixAt(k, m);
    });
    group.add(mesh);
    return mesh;
  };
  const all = [...whole, ...broken];
  add(all, base, (p) => m.compose(pv.set(p.x, FLOOR_Y + 2.2, p.z), q.setFromAxisAngle(_y, -p.a), sc.set(1, 1, 1)));
  add(all, shaft, (p) => m.compose(pv.set(p.x, FLOOR_Y + 2.6, p.z), q.setFromAxisAngle(_y, p.i), sc.set(1, p.h, 1)));
  add(whole, cap, (p) => m.compose(pv.set(p.x, FLOOR_Y + 2.6 + p.h + 0.2, p.z), q.setFromAxisAngle(_y, -p.a), sc.set(1, 1, 1)));
  // lintels across neighbouring whole pillars
  const pairs = [];
  const byIndex = new Map(whole.map((p) => [p.i, p]));
  for (const p of whole) {
    const nb = byIndex.get((p.i + 1) % N);
    if (nb && p.i % 3 !== 2) pairs.push([p, nb]);
  }
  const lintel = new THREE.BoxGeometry(1, 0.55, 0.9);
  add(pairs, lintel, ([p, b]) => {
    const len = Math.hypot(b.x - p.x, b.z - p.z) + 1.2;
    const y = FLOOR_Y + 2.6 + Math.min(p.h, b.h) + 0.65;
    m.compose(pv.set((p.x + b.x) / 2, y, (p.z + b.z) / 2), q.setFromAxisAngle(_y, -Math.atan2(b.z - p.z, b.x - p.x)), sc.set(len, 1, 1));
  });
  // fallen blocks scattered at the foot of the wall
  const rubble = new THREE.DodecahedronGeometry(0.45, 0);
  const stones = Array.from({ length: 40 }, () => {
    const a = rand() * TAU;
    const r = WALL_R - 0.6 - rand() * 2.2;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r, s: 0.4 + rand() * 1.1, a: rand() * 6 };
  });
  add(stones, rubble, (p) => m.compose(pv.set(p.x, FLOOR_Y + p.s * 0.25, p.z), q.setFromEuler(new THREE.Euler(p.a, p.a * 2, 0)), sc.set(p.s * 1.3, p.s * 0.8, p.s)));

  // braziers on every third whole pillar
  const bowlGeo = new THREE.LatheGeometry(
    [new THREE.Vector2(0.05, 0), new THREE.Vector2(0.5, 0.05), new THREE.Vector2(0.75, 0.35), new THREE.Vector2(0.8, 0.5), new THREE.Vector2(0.7, 0.5), new THREE.Vector2(0.5, 0.3), new THREE.Vector2(0, 0.3)],
    16,
  );
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.6, metalness: 0.7, emissive: 0x3a1204, emissiveIntensity: 0.6 });
  const tops = whole.filter((p, k) => k % 3 === 0);
  add(tops, bowlGeo, (p) => m.compose(pv.set(p.x, FLOOR_Y + 2.6 + p.h + 0.4, p.z), q.identity(), sc.set(1, 1, 1))).material = ironMat;
  for (const p of tops) fires.push({ pos: new THREE.Vector3(p.x, FLOOR_Y + 2.6 + p.h + 0.75, p.z), size: 1.3 });
  return { group, ironMat, bowlGeo };
}

// Tall iron braziers standing on the flagstones around the table.
function makeFloorBraziers(ironMat, bowlGeo, fires) {
  const group = new THREE.Group();
  const legGeo = new THREE.CylinderGeometry(0.07, 0.1, 2.0, 6);
  legGeo.translate(0, 1.0, 0);
  const legs = [];
  for (let l = 0; l < 3; l++) {
    const g = legGeo.clone();
    g.rotateZ(0.2);
    g.rotateY((l / 3) * TAU);
    g.translate(Math.cos((l / 3) * TAU) * 0.25, 0, -Math.sin((l / 3) * TAU) * 0.25);
    legs.push(g);
  }
  const ring = new THREE.TorusGeometry(0.35, 0.05, 6, 16);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, 1.2, 0);
  const bowl = bowlGeo.clone();
  bowl.scale(1.15, 1.15, 1.15);
  bowl.translate(0, 1.95, 0);
  const stand = mergeGeometries([...legs, ring, bowl]);
  const spots = [];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    spots.push(new THREE.Vector3(Math.cos(a) * 18.6, FLOOR_Y, Math.sin(a) * 18.6));
  }
  const mesh = new THREE.InstancedMesh(stand, ironMat, spots.length);
  const m = new THREE.Matrix4();
  spots.forEach((p, k) => mesh.setMatrixAt(k, m.makeTranslation(p.x, p.y, p.z)));
  group.add(mesh);
  for (const p of spots) fires.push({ pos: new THREE.Vector3(p.x, p.y + 2.35, p.z), size: 1.6, floor: true });
  return group;
}

function makeFires(fires) {
  const group = new THREE.Group();
  const plane = new THREE.PlaneGeometry(1, 1);
  const flameGeo = plane.clone().translate(0, 0.5, 0);
  const seeds = new Float32Array(fires.map((_, i) => (i * 0.618) % 1));
  flameGeo.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 1));
  const glowGeo = plane.clone();
  glowGeo.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 1));
  const flames = new THREE.InstancedMesh(flameGeo, flameMaterial(false), fires.length);
  const glows = new THREE.InstancedMesh(glowGeo, flameMaterial(true), fires.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  fires.forEach((f, i) => {
    flames.setMatrixAt(i, m.compose(f.pos.clone().setY(f.pos.y - 0.2), q, s.set(1.25 * f.size, 1.6 * f.size, 1)));
    glows.setMatrixAt(i, m.compose(f.pos.clone().setY(f.pos.y + 0.5 * f.size), q, s.set(4.2 * f.size, 4.2 * f.size, 1)));
  });
  flames.frustumCulled = glows.frustumCulled = false;
  glows.renderOrder = 1;
  flames.renderOrder = 2;
  group.add(glows, flames);
  return { group, mats: [flames.material, glows.material] };
}

// ------------------------------------------------------------------ assembly

export function makeArenaGround() {
  const rand = rng(41);
  const sand = texture(sandTexture(rand), 30, 30);
  const ground = new THREE.MeshStandardMaterial({ map: sand, color: 0x786a62, roughness: 1 });
  const top = new THREE.MeshStandardMaterial({ map: texture(tableTopTexture(rand)), roughness: 0.82 });
  top.map.wrapS = top.map.wrapT = THREE.ClampToEdgeWrapping;
  const side = new THREE.MeshStandardMaterial({ map: texture(tableSideTexture(rand), 24, 1), roughness: 0.85 });
  // CylinderGeometry groups: side, top cap, bottom cap
  return { ground, table: [side, top, side] };
}

export function buildArenaScenery({ hi = true } = {}) {
  const rand = rng(7);
  const group = new THREE.Group();
  group.name = 'arena-scenery';
  const sky = makeSky();
  group.add(sky);

  // mountains far off, then the jungle canopy just beyond the arena
  const ridges = texture(
    ridgeTexture(rand, [
      { fill: '#2a2546', base: 0.25, amp: 0.55, terms: 9 },
      { fill: '#17152b', base: 0.12, amp: 0.4, terms: 12 },
    ]),
    1,
    1,
  );
  ridges.wrapT = THREE.ClampToEdgeWrapping;
  group.add(silhouetteRing(ridges, 108, 34, -4, 0xffffff, -9));
  const jungle = texture(jungleTexture(rand), 2, 1);
  jungle.wrapT = THREE.ClampToEdgeWrapping;
  group.add(silhouetteRing(jungle, 62, 20, FLOOR_Y - 0.5, 0xffffff, -8));

  // flagstones ringing the table
  const ringGeo = new THREE.RingGeometry(15.4, 20.8, 160, 3);
  polarUVs(ringGeo, 15.4, 20.8, 1);
  const flag = texture(flagstoneTexture(rand), 36, 1);
  flag.wrapT = THREE.ClampToEdgeWrapping;
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ map: flag, color: 0x9a9290, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = FLOOR_Y + 0.01;
  ring.receiveShadow = true;
  group.add(ring);

  const fires = [];
  const stone = makeStonework(rand, fires);
  group.add(stone.group, makeFloorBraziers(stone.ironMat, stone.bowlGeo, fires));
  const fire = makeFires(fires);
  group.add(fire.group);
  const embers = makeEmbers(fires, hi ? 26 : 12, rand);
  group.add(embers);

  // warm light from the two braziers beyond the board, flickering
  const lights = fires
    .filter((f) => f.floor && f.pos.z < 0)
    .map((f) => {
      const l = new THREE.PointLight(0xff7a30, 0, 20, 1.6);
      l.position.copy(f.pos).setY(f.pos.y + 0.6);
      group.add(l);
      return l;
    });

  let t = 0;
  group.userData.update = (dt, camera, renderer) => {
    t += dt;
    sky.material.uniforms.time.value = t;
    for (const mat of fire.mats) mat.uniforms.time.value = t;
    embers.material.uniforms.time.value = t;
    // point size: pixels per world unit at distance 1
    const h = renderer.getDrawingBufferSize(_size).y;
    embers.material.uniforms.scale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    embers.material.uniforms.maxSize.value = Math.max(3, h * 0.007);
    lights.forEach((l, i) => {
      const s = t * 7 + i * 3.1;
      l.intensity = 34 * (0.82 + 0.1 * Math.sin(s) + 0.06 * Math.sin(s * 2.7 + 1) + 0.04 * Math.sin(s * 6.3));
    });
  };
  return group;
}

const _y = new THREE.Vector3(0, 1, 0);
const _size = new THREE.Vector2();
