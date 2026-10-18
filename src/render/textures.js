import * as THREE from 'three';

// Procedural canvas textures (fur, stripes, scales, skin) so the animals read as animals instead of plastic toys.
// Torso textures assume a "spine sphere": a sphere whose poles run along the spine (z axis).
// On that mapping canvas x runs around the body (x = 0.25W is the belly, 0.75W the back)
// and canvas y runs along the spine (top = head end).

const SIZE = 256;
const cache = new Map();

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function canvas() {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return [c, c.getContext('2d')];
}

function toTexture(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

function shade(color, f) {
  const c = new THREE.Color(color);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
}

// Short directional strokes = fur. `belly` lightens the underside, `back` darkens the spine (countershading).
function paintFur(g, rnd, { base, dark, light, strokes = 2600, len = 7, belly = null, back = null, spine = false }) {
  g.fillStyle = hex(base);
  g.fillRect(0, 0, SIZE, SIZE);
  if (spine && (belly || back)) {
    const grad = g.createLinearGradient(0, 0, SIZE, 0);
    const b = belly ? hex(belly) : hex(base);
    const k = back ? hex(back) : hex(base);
    grad.addColorStop(0, hex(base));
    grad.addColorStop(0.25, b);
    grad.addColorStop(0.5, hex(base));
    grad.addColorStop(0.75, k);
    grad.addColorStop(1, hex(base));
    g.fillStyle = grad;
    g.fillRect(0, 0, SIZE, SIZE);
  }
  for (let i = 0; i < strokes; i++) {
    const x = rnd() * SIZE;
    const y = rnd() * SIZE;
    const r = rnd();
    g.strokeStyle = r < 0.5 ? shade(dark, 0.9 + rnd() * 0.3) : shade(light, 0.85 + rnd() * 0.3);
    g.globalAlpha = 0.18 + rnd() * 0.25;
    g.lineWidth = 0.8 + rnd() * 1.2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 2, y + len * (0.6 + rnd()));
    g.stroke();
  }
  g.globalAlpha = 1;
}

function paintBumpFur(g, rnd, strokes = 3000, len = 7) {
  g.fillStyle = '#808080';
  g.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < strokes; i++) {
    const x = rnd() * SIZE;
    const y = rnd() * SIZE;
    const v = Math.floor(70 + rnd() * 120);
    g.strokeStyle = `rgb(${v},${v},${v})`;
    g.globalAlpha = 0.5;
    g.lineWidth = 1 + rnd();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 2, y + len * (0.6 + rnd()));
    g.stroke();
  }
  g.globalAlpha = 1;
}

function memo(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

export function furMaps(key, opts) {
  return memo(`fur:${key}`, () => {
    const rnd = seeded(key.length * 7919 + (opts.base & 0xffff));
    const [c, g] = canvas();
    paintFur(g, rnd, opts);
    if (opts.paint) opts.paint(g, rnd);
    const [b, bg] = canvas();
    paintBumpFur(bg, seeded(31 + key.length), 3200, opts.len ?? 7);
    if (opts.paintBump) opts.paintBump(bg, rnd);
    return { map: toTexture(c), bumpMap: toTexture(b, false) };
  });
}

// Tiger torso: orange with cream belly and wavy black stripes across the back.
export function tigerStripes(g, rnd) {
  g.fillStyle = '#120c08';
  const bands = 13;
  for (let i = 0; i < bands; i++) {
    const y0 = (i + 0.5) * (SIZE / bands) + (rnd() - 0.5) * 6;
    const thick = 4 + rnd() * 5;
    g.beginPath();
    // band spans the back (x ~ 0.75W) and fades out toward the belly
    const reach = 0.28 + rnd() * 0.16;
    const xs = (0.75 - reach) * SIZE;
    const xe = (0.75 + reach) * SIZE;
    const steps = 18;
    for (let s = 0; s <= steps; s++) {
      const x = xs + ((xe - xs) * s) / steps;
      const taper = Math.sin((s / steps) * Math.PI);
      const y = y0 + Math.sin(s * 0.9 + i) * 4;
      if (s === 0) g.moveTo(x, y);
      else g.lineTo(x, y - thick * taper);
    }
    for (let s = steps; s >= 0; s--) {
      const x = xs + ((xe - xs) * s) / steps;
      const taper = Math.sin((s / steps) * Math.PI);
      const y = y0 + Math.sin(s * 0.9 + i) * 4;
      g.lineTo(x, y + thick * taper);
    }
    g.closePath();
    g.fill();
  }
}

// Plated scales (crocodile back, cobra).
export function scaleMaps(key, { base, dark, light, cell = 14, belly = null, rounded = true }) {
  return memo(`scale:${key}`, () => {
    const rnd = seeded(key.length * 104729);
    const [c, g] = canvas();
    const [b, bg] = canvas();
    g.fillStyle = hex(base);
    g.fillRect(0, 0, SIZE, SIZE);
    bg.fillStyle = '#303030';
    bg.fillRect(0, 0, SIZE, SIZE);
    if (belly) {
      const grad = g.createLinearGradient(0, 0, SIZE, 0);
      grad.addColorStop(0, hex(base));
      grad.addColorStop(0.18, hex(belly));
      grad.addColorStop(0.32, hex(belly));
      grad.addColorStop(0.5, hex(base));
      grad.addColorStop(1, hex(base));
      g.fillStyle = grad;
      g.fillRect(0, 0, SIZE, SIZE);
    }
    for (let y = 0; y < SIZE + cell; y += cell) {
      const off = (y / cell) % 2 ? cell / 2 : 0;
      for (let x = -cell; x < SIZE + cell; x += cell) {
        const cx = x + off;
        const r = cell * 0.46;
        g.fillStyle = rnd() < 0.5 ? shade(dark, 0.8 + rnd() * 0.4) : shade(light, 0.8 + rnd() * 0.3);
        g.globalAlpha = 0.35;
        g.beginPath();
        if (rounded) g.ellipse(cx, y, r, r * 0.8, 0, 0, Math.PI * 2);
        else g.rect(cx - r, y - r * 0.7, r * 2, r * 1.4);
        g.fill();
        const v = Math.floor(150 + rnd() * 80);
        bg.fillStyle = `rgb(${v},${v},${v})`;
        bg.beginPath();
        bg.ellipse(cx, y, r * 0.9, r * 0.72, 0, 0, Math.PI * 2);
        bg.fill();
      }
    }
    g.globalAlpha = 1;
    return { map: toTexture(c), bumpMap: toTexture(b, false) };
  });
}

// Fine wrinkled / pitted skin (rhino, shark, gorilla face).
export function skinMaps(key, { base, dark, light, belly = null, back = null, wrinkles = 60 }) {
  return memo(`skin:${key}`, () => {
    const rnd = seeded(key.length * 7907);
    const [c, g] = canvas();
    const [b, bg] = canvas();
    g.fillStyle = hex(base);
    g.fillRect(0, 0, SIZE, SIZE);
    if (belly || back) {
      const grad = g.createLinearGradient(0, 0, SIZE, 0);
      grad.addColorStop(0, hex(base));
      grad.addColorStop(0.25, hex(belly ?? base));
      grad.addColorStop(0.5, hex(base));
      grad.addColorStop(0.75, hex(back ?? base));
      grad.addColorStop(1, hex(base));
      g.fillStyle = grad;
      g.fillRect(0, 0, SIZE, SIZE);
    }
    bg.fillStyle = '#808080';
    bg.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 1800; i++) {
      const x = rnd() * SIZE;
      const y = rnd() * SIZE;
      g.fillStyle = rnd() < 0.5 ? hex(dark) : hex(light);
      g.globalAlpha = 0.08 + rnd() * 0.1;
      g.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 2);
      const v = Math.floor(90 + rnd() * 80);
      bg.fillStyle = `rgb(${v},${v},${v})`;
      bg.fillRect(x, y, 2, 2);
    }
    for (let i = 0; i < wrinkles; i++) {
      const x = rnd() * SIZE;
      const y = rnd() * SIZE;
      g.strokeStyle = hex(dark);
      g.globalAlpha = 0.2;
      g.lineWidth = 1;
      bg.strokeStyle = '#3a3a3a';
      bg.lineWidth = 1.5;
      const ang = rnd() * Math.PI;
      const l = 8 + rnd() * 20;
      for (const ctx of [g, bg]) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + Math.cos(ang) * l * 0.5 + (rnd() - 0.5) * 6, y + Math.sin(ang) * l * 0.5, x + Math.cos(ang) * l, y + Math.sin(ang) * l);
        ctx.stroke();
      }
    }
    g.globalAlpha = 1;
    return { map: toTexture(c), bumpMap: toTexture(b, false) };
  });
}

// Layered feathers for wings / tail.
export function featherMaps(key, { base, dark, light }) {
  return memo(`feather:${key}`, () => {
    const rnd = seeded(key.length * 3301);
    const [c, g] = canvas();
    const [b, bg] = canvas();
    g.fillStyle = hex(base);
    g.fillRect(0, 0, SIZE, SIZE);
    bg.fillStyle = '#606060';
    bg.fillRect(0, 0, SIZE, SIZE);
    for (let row = 0; row < 12; row++) {
      for (let i = 0; i < 14; i++) {
        const x = i * 20 + (row % 2) * 10;
        const y = row * 22;
        g.fillStyle = rnd() < 0.5 ? shade(dark, 0.8 + rnd() * 0.4) : shade(light, 0.8 + rnd() * 0.3);
        g.globalAlpha = 0.55;
        g.beginPath();
        g.ellipse(x, y, 9, 18, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = hex(dark);
        g.globalAlpha = 0.5;
        g.beginPath();
        g.moveTo(x, y - 16);
        g.lineTo(x, y + 16);
        g.stroke();
        bg.fillStyle = '#b0b0b0';
        bg.beginPath();
        bg.ellipse(x, y, 8, 16, 0, 0, Math.PI * 2);
        bg.fill();
        bg.strokeStyle = '#404040';
        bg.beginPath();
        bg.ellipse(x, y, 9, 18, 0, 0, Math.PI * 2);
        bg.stroke();
      }
    }
    g.globalAlpha = 1;
    return { map: toTexture(c), bumpMap: toTexture(b, false) };
  });
}
