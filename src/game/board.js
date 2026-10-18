// Pure board geometry for a classic 15x15 Ludo layout.
// Cells are addressed as [col, row] with row 0 at the top (north) of the board.
// Seats go clockwise: 0 = top-left, 1 = top-right, 2 = bottom-right, 3 = bottom-left.

export const GRID = 15;
export const TRACK_LENGTH = 52;
export const LAST_TRACK_PROGRESS = 50; // a token's 51st track square
export const HOME_COLUMN_LENGTH = 5;
export const FINISH_PROGRESS = 56; // 51 track squares + 5 home column squares + finish
export const YARD = -1;

function build(...segments) {
  const out = [];
  for (const [from, to] of segments) {
    const [c0, r0] = from;
    const [c1, r1] = to;
    const steps = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0));
    const dc = Math.sign(c1 - c0);
    const dr = Math.sign(r1 - r0);
    for (let i = 0; i <= steps; i++) out.push([c0 + dc * i, r0 + dr * i]);
  }
  return out;
}

// Clockwise loop starting at seat 0's start square.
export const TRACK = build(
  [[1, 6], [5, 6]],
  [[6, 5], [6, 0]],
  [[7, 0], [8, 0]],
  [[8, 1], [8, 5]],
  [[9, 6], [14, 6]],
  [[14, 7], [14, 8]],
  [[13, 8], [9, 8]],
  [[8, 9], [8, 14]],
  [[7, 14], [6, 14]],
  [[6, 13], [6, 9]],
  [[5, 8], [0, 8]],
  [[0, 7], [0, 6]],
);

export const START_INDEX = [0, 13, 26, 39];
export const STAR_INDEX = START_INDEX.map((s) => (s + 8) % TRACK_LENGTH);
export const SAFE_INDICES = new Set([...START_INDEX, ...STAR_INDEX]);

export const HOME_COLUMNS = [
  build([[1, 7], [5, 7]]),
  build([[7, 1], [7, 5]]),
  build([[13, 7], [9, 7]]),
  build([[7, 13], [7, 9]]),
];

// Top-left cell of each 6x6 yard.
export const YARD_ORIGIN = [
  [0, 0],
  [9, 0],
  [9, 9],
  [0, 9],
];

// Cage spots inside a yard, in continuous cell units relative to the yard origin.
export const YARD_SPOTS = [
  [1.9, 1.9],
  [4.1, 1.9],
  [1.9, 4.1],
  [4.1, 4.1],
];

// Centroid of each seat's finish triangle in continuous grid units.
export const FINISH_CENTROID = [
  [6.55, 7.5],
  [7.5, 6.55],
  [8.45, 7.5],
  [7.5, 8.45],
];

export function trackIndexOf(seat, progress) {
  if (progress < 0 || progress > LAST_TRACK_PROGRESS) return null;
  return (START_INDEX[seat] + progress) % TRACK_LENGTH;
}

export function isSafeTrackIndex(index) {
  return SAFE_INDICES.has(index);
}

// Where a token of `seat` with the given progress sits.
export function locate(seat, progress) {
  if (progress < 0) return { kind: 'yard' };
  if (progress <= LAST_TRACK_PROGRESS) {
    const index = trackIndexOf(seat, progress);
    return { kind: 'track', index, cell: TRACK[index] };
  }
  if (progress < FINISH_PROGRESS) {
    return { kind: 'home', cell: HOME_COLUMNS[seat][progress - LAST_TRACK_PROGRESS - 1] };
  }
  return { kind: 'finish' };
}

// Unique key per physical square, used for stacking tokens.
export function squareKey(seat, progress) {
  const loc = locate(seat, progress);
  if (loc.kind === 'track') return `t${loc.index}`;
  if (loc.kind === 'home') return `h${seat}:${progress}`;
  if (loc.kind === 'finish') return `f${seat}`;
  return null;
}
