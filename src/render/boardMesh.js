import * as THREE from 'three';
import {
  FINISH_CENTROID,
  HOME_COLUMNS,
  START_INDEX,
  STAR_INDEX,
  TRACK,
  YARD_ORIGIN,
  YARD_SPOTS,
  locate,
  trackIndexOf,
} from '../game/board.js';
import { COLORS } from '../config.js';

export const BOARD_Y = 0.12;

export function gridToWorld(x, y, out = new THREE.Vector3()) {
  return out.set(x - 7.5, BOARD_Y, y - 7.5);
}

export function cellCenter([c, r], out) {
  return gridToWorld(c + 0.5, r + 0.5, out);
}

export function yardSpot(seat, i, out) {
  const [ox, oy] = YARD_ORIGIN[seat];
  const [sx, sy] = YARD_SPOTS[i];
  return gridToWorld(ox + sx, oy + sy, out);
}

export function yardCenter(seat, out) {
  const [ox, oy] = YARD_ORIGIN[seat];
  return gridToWorld(ox + 3, oy + 3, out);
}

const FINISH_OFFSETS = [
  [-0.22, -0.22],
  [0.22, -0.22],
  [-0.22, 0.22],
  [0.22, 0.22],
];

export function finishSpot(seat, i, out) {
  const [x, y] = FINISH_CENTROID[seat];
  const [dx, dy] = FINISH_OFFSETS[i % 4];
  const p = gridToWorld(x, y, out);
  p.x += dx * (seat % 2 === 0 ? 0.8 : 1.4);
  p.z += dy * (seat % 2 === 0 ? 1.4 : 0.8);
  return p;
}

// World position of the square a token occupies (null for yard).
export function squareWorld(seat, progress, out = new THREE.Vector3()) {
  const loc = locate(seat, progress);
  if (loc.kind === 'track' || loc.kind === 'home') return cellCenter(loc.cell, out);
  if (loc.kind === 'finish') {
    const [x, y] = FINISH_CENTROID[seat];
    return gridToWorld(x, y, out);
  }
  return null;
}

function starShape(outer, inner, points = 5) {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

function arrowShape() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.32);
  s.lineTo(0.26, 0.02);
  s.lineTo(0.1, 0.02);
  s.lineTo(0.1, -0.3);
  s.lineTo(-0.1, -0.3);
  s.lineTo(-0.1, 0.02);
  s.lineTo(-0.26, 0.02);
  s.closePath();
  return s;
}

// Flat shape lying on the XZ plane, top face at y = depth.
function flatGeometry(shape, depth) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
}

export class BoardView {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.mats = {
      tile: new THREE.MeshStandardMaterial({ color: 0xf5efe3, roughness: 0.7 }),
      grout: new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.9 }),
      frame: new THREE.MeshStandardMaterial({ color: 0x6b4428, roughness: 0.55, metalness: 0.05 }),
      star: new THREE.MeshStandardMaterial({ color: 0x9aa3b5, roughness: 0.4, metalness: 0.4 }),
      starOnColor: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }),
      pad: new THREE.MeshStandardMaterial({ color: 0xf8f4ec, roughness: 0.75 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xffc94a, roughness: 0.3, metalness: 0.7, emissive: 0x3a2500 }),
    };
    this.teamMats = COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c.hex, roughness: 0.55 }));
    this.teamDark = COLORS.map((c) => {
      const col = new THREE.Color(c.hex).multiplyScalar(0.6);
      return new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 });
    });
    this.build();
    this.buildMarkers();
  }

  add(mesh, cast = false) {
    mesh.receiveShadow = true;
    mesh.castShadow = cast;
    this.group.add(mesh);
    return mesh;
  }

  build() {
    const { mats } = this;
    // Base slab (also acts as grout between tiles).
    const base = this.add(new THREE.Mesh(new THREE.BoxGeometry(15.2, 0.5, 15.2), mats.grout));
    base.position.y = -0.25;

    // Raised wooden frame.
    const frameGeoLong = new THREE.BoxGeometry(16.2, 0.55, 0.5);
    for (const [x, z, rot] of [
      [0, -7.85, 0],
      [0, 7.85, 0],
      [-7.85, 0, Math.PI / 2],
      [7.85, 0, Math.PI / 2],
    ]) {
      const f = this.add(new THREE.Mesh(frameGeoLong, mats.frame), true);
      f.position.set(x, -0.1, z);
      f.rotation.y = rot;
    }

    const tileGeo = new THREE.BoxGeometry(0.93, BOARD_Y, 0.93);
    const starGeo = flatGeometry(starShape(0.34, 0.15), 0.02);
    const arrowGeo = flatGeometry(arrowShape(), 0.02);

    TRACK.forEach((cell, index) => {
      const startSeat = START_INDEX.indexOf(index);
      const mat = startSeat >= 0 ? this.teamMats[startSeat] : mats.tile;
      const tile = this.add(new THREE.Mesh(tileGeo, mat));
      cellCenter(cell, tile.position);
      tile.position.y = BOARD_Y / 2;
      if (startSeat >= 0 || STAR_INDEX.includes(index)) {
        const star = this.add(new THREE.Mesh(starGeo, startSeat >= 0 ? mats.starOnColor : mats.star));
        cellCenter(cell, star.position);
      }
    });

    // Entry arrows on each seat's last track square, pointing into the home column.
    for (let seat = 0; seat < 4; seat++) {
      const lastCell = TRACK[trackIndexOf(seat, 50)];
      const first = HOME_COLUMNS[seat][0];
      const arrow = this.add(new THREE.Mesh(arrowGeo, this.teamMats[seat]));
      cellCenter(lastCell, arrow.position);
      const dx = first[0] - lastCell[0];
      const dz = first[1] - lastCell[1];
      arrow.rotation.y = Math.atan2(-dx, -dz);
    }

    HOME_COLUMNS.forEach((cells, seat) => {
      for (const cell of cells) {
        const tile = this.add(new THREE.Mesh(tileGeo, this.teamMats[seat]));
        cellCenter(cell, tile.position);
        tile.position.y = BOARD_Y / 2;
      }
    });

    // Yards
    const yardGeo = new THREE.BoxGeometry(5.94, BOARD_Y - 0.03, 5.94);
    const padGeo = new THREE.BoxGeometry(4.5, BOARD_Y, 4.5);
    const spotGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.02, 32);
    const ringGeo = new THREE.TorusGeometry(0.52, 0.035, 6, 40);
    YARD_ORIGIN.forEach(([ox, oy], seat) => {
      const yard = this.add(new THREE.Mesh(yardGeo, this.teamMats[seat]));
      gridToWorld(ox + 3, oy + 3, yard.position);
      yard.position.y = (BOARD_Y - 0.03) / 2;
      const pad = this.add(new THREE.Mesh(padGeo, mats.pad));
      gridToWorld(ox + 3, oy + 3, pad.position);
      pad.position.y = BOARD_Y / 2;
      for (let i = 0; i < 4; i++) {
        const spot = this.add(new THREE.Mesh(spotGeo, this.teamDark[seat]));
        yardSpot(seat, i, spot.position);
        spot.position.y = BOARD_Y + 0.005;
        const ring = this.add(new THREE.Mesh(ringGeo, this.teamMats[seat]));
        yardSpot(seat, i, ring.position);
        ring.position.y = BOARD_Y + 0.01;
        ring.rotation.x = Math.PI / 2;
      }
    });

    // Centre finish triangles.
    const tris = [
      [[6, 6], [6, 9]],
      [[9, 6], [6, 6]],
      [[9, 9], [9, 6]],
      [[6, 9], [9, 9]],
    ];
    tris.forEach(([a, b], seat) => {
      const shape = new THREE.Shape();
      const inset = 0.04;
      const cx = 7.5;
      const cy = 7.5;
      const pts = [a, b, [cx, cy]].map(([x, y]) => [x + (cx - x) * inset, y + (cy - y) * inset]);
      shape.moveTo(pts[0][0] - 7.5, -(pts[0][1] - 7.5));
      shape.lineTo(pts[1][0] - 7.5, -(pts[1][1] - 7.5));
      shape.lineTo(pts[2][0] - 7.5, -(pts[2][1] - 7.5));
      shape.closePath();
      this.add(new THREE.Mesh(flatGeometry(shape, BOARD_Y), this.teamMats[seat]));
    });
    const gem = this.add(
      new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), mats.gold),
      true,
    );
    gem.position.set(0, BOARD_Y + 0.45, 0);
    gem.scale.set(1, 1.5, 1);
    this.gem = gem;
  }

  buildMarkers() {
    // Destination marker shown when hovering a movable token.
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.4, 0.05, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.38, 2.4, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    beam.position.y = 1.2;
    g.add(beam);
    g.visible = false;
    this.group.add(g);
    this.destMarker = g;
    this.destRing = ring;
    this.destBeam = beam;
  }

  showDestination(pos, colorHex) {
    if (!pos) {
      this.destMarker.visible = false;
      return;
    }
    this.destMarker.visible = true;
    this.destMarker.position.copy(pos).setY(BOARD_Y + 0.02);
    this.destRing.material.color.setHex(colorHex);
    this.destBeam.material.color.setHex(colorHex);
  }

  update(dt, time) {
    this.gem.rotation.y += dt * 0.8;
    this.gem.position.y = BOARD_Y + 0.45 + Math.sin(time * 2) * 0.06;
    if (this.destMarker.visible) {
      const s = 1 + Math.sin(time * 8) * 0.08;
      this.destRing.scale.set(s, s, s);
    }
  }
}
