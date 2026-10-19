import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { COLORS } from '../config.js';

// Felt-lined dice trays out on the table, one beside each player's yard. The die is thrown into
// the current player's tray; the tray's inner walls are the physics bounds of the throw.
export const TRAY = { halfX: 1.6, halfZ: 2.2, wall: 0.16, height: 0.5, floor: 0.04, base: -0.02 };

export function trayCenter(seat, out = new THREE.Vector3()) {
  const sx = seat === 0 || seat === 3 ? -1 : 1;
  const sz = seat === 0 || seat === 1 ? -1 : 1;
  return out.set(sx * 11, TRAY.floor, sz * 4.5);
}

export function trayBounds(seat) {
  const c = trayCenter(seat);
  return { minX: c.x - TRAY.halfX, maxX: c.x + TRAY.halfX, minZ: c.z - TRAY.halfZ, maxZ: c.z + TRAY.halfZ, floor: TRAY.floor };
}

const THEMES = {
  action: { wood: [0x5a3920, 0.55], felt: (c) => c.multiplyScalar(0.32), feltRough: 1 },
  kids: { wood: [0xfff4e6, 0.5], felt: (c) => c.lerp(new THREE.Color(0xffffff), 0.35), feltRough: 0.9 },
};

export class DiceTrays {
  constructor(scene, theme = 'action') {
    this.group = new THREE.Group();
    scene.add(this.group);
    const { halfX, halfZ, wall, height, floor, base } = TRAY;
    const h = floor + height - base;
    this.geo = {
      long: new RoundedBoxGeometry(wall, h, halfZ * 2 + wall * 2, 2, 0.05),
      short: new RoundedBoxGeometry(halfX * 2, h, wall, 2, 0.05),
      base: new THREE.BoxGeometry(halfX * 2, floor - base, halfZ * 2),
      felt: new THREE.PlaneGeometry(halfX * 2, halfZ * 2).rotateX(-Math.PI / 2),
    };
    this.wood = new THREE.MeshStandardMaterial();
    this.trays = COLORS.map((color, seat) => {
      const g = new THREE.Group();
      trayCenter(seat, g.position).setY(0);
      const felt = new THREE.MeshStandardMaterial({ color: color.hex });
      const add = (geo, mat, x, y, z) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = geo !== this.geo.felt;
        m.receiveShadow = true;
        g.add(m);
      };
      add(this.geo.base, this.wood, 0, (floor + base) / 2 - 0.002, 0);
      add(this.geo.felt, felt, 0, floor, 0);
      for (const s of [-1, 1]) {
        add(this.geo.long, this.wood, s * (halfX + wall / 2), base + h / 2, 0);
        add(this.geo.short, this.wood, 0, base + h / 2, s * (halfZ + wall / 2));
      }
      this.group.add(g);
      return { group: g, felt, color: color.hex };
    });
    this.setTheme(theme);
  }

  setTheme(theme) {
    const t = THEMES[theme] ?? THEMES.action;
    this.wood.color.setHex(t.wood[0]);
    this.wood.roughness = t.wood[1];
    for (const tray of this.trays) {
      tray.felt.color.copy(t.felt(new THREE.Color(tray.color)));
      tray.felt.roughness = t.feltRough;
    }
  }

  // Only the seats in the current game get a tray on the table.
  setSeats(seats) {
    this.trays.forEach((t, seat) => (t.group.visible = seats.includes(seat)));
  }
}
