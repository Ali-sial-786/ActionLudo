import * as THREE from 'three';

// Shared procedural surface textures for the Action-mode board frame and dice trays: wood grain
// and felt. They are greyscale-ish and multiply the material colour, so one texture serves every
// tint. Built once, on first use.

let wood = null;
let felt = null;

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Long wavy grain lines along u with a couple of knots; tiles along u.
export function woodTexture() {
  if (wood) return wood;
  const rand = seeded(3);
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d9c2a8';
  g.fillRect(0, 0, c.width, c.height);
  const knots = Array.from({ length: 3 }, () => ({ x: 120 + rand() * 780, y: 20 + rand() * 88, r: 6 + rand() * 7 }));
  for (let line = 0; line < 70; line++) {
    const y0 = rand() * c.height;
    const amp = 1 + rand() * 3;
    const freq = 1 + Math.floor(rand() * 3); // whole waves per tile, so it wraps
    const ph = rand() * Math.PI * 2;
    const dark = rand() < 0.5;
    g.strokeStyle = dark ? `rgba(70, 40, 20, ${0.12 + rand() * 0.22})` : `rgba(255, 240, 220, ${0.08 + rand() * 0.12})`;
    g.lineWidth = 0.6 + rand() * 2.2;
    g.beginPath();
    for (let x = 0; x <= c.width; x += 8) {
      let y = y0 + Math.sin((x / c.width) * Math.PI * 2 * freq + ph) * amp;
      // grain bends around the knots
      for (const k of knots) {
        const dx = x - k.x;
        const dy = y - k.y;
        const d2 = dx * dx + dy * dy;
        y += (dy / (Math.sqrt(d2) + 1)) * k.r * 2.2 * Math.exp(-d2 / (k.r * k.r * 9));
      }
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  for (const k of knots) {
    const grad = g.createRadialGradient(k.x, k.y, 0, k.x, k.y, k.r);
    grad.addColorStop(0, 'rgba(60, 32, 16, 0.75)');
    grad.addColorStop(0.6, 'rgba(90, 52, 28, 0.4)');
    grad.addColorStop(1, 'rgba(90, 52, 28, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(k.x, k.y, k.r * 1.5, k.r, 0, 0, Math.PI * 2);
    g.fill();
  }
  wood = new THREE.CanvasTexture(c);
  wood.colorSpace = THREE.SRGBColorSpace;
  wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
  return wood;
}

// Fine fibrous speckle for the trays' felt lining.
export function feltTexture() {
  if (felt) return felt;
  const rand = seeded(5);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const v = 215 + rand() * 40;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // stray fibres
  for (let i = 0; i < 500; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    const a = rand() * Math.PI;
    g.strokeStyle = rand() < 0.5 ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.14)';
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5);
    g.stroke();
  }
  felt = new THREE.CanvasTexture(c);
  felt.colorSpace = THREE.SRGBColorSpace;
  felt.wrapS = felt.wrapT = THREE.RepeatWrapping;
  felt.repeat.set(3, 4);
  return felt;
}
