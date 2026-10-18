import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FINISH_PROGRESS,
  HOME_COLUMNS,
  START_INDEX,
  TRACK,
  TRACK_LENGTH,
  locate,
  trackIndexOf,
} from '../src/game/board.js';
import {
  advanceTurn,
  applyMove,
  createGame,
  distinctMoves,
  fairRoll,
  legalMoves,
  registerRoll,
} from '../src/game/rules.js';
import { chooseMove } from '../src/game/ai.js';

const fourPlayers = () =>
  createGame([
    { seat: 0, color: 'red', animal: 'eagle', cpu: false, name: 'A' },
    { seat: 1, color: 'green', animal: 'tiger', cpu: true, name: 'B' },
    { seat: 2, color: 'yellow', animal: 'bear', cpu: true, name: 'C' },
    { seat: 3, color: 'blue', animal: 'shark', cpu: true, name: 'D' },
  ]);

const tok = (game, seat, i) => game.tokens.find((t) => t.seat === seat && t.index === i);

test('track is a closed loop of 52 adjacent unique squares (diagonal only at inner corners)', () => {
  assert.equal(TRACK.length, TRACK_LENGTH);
  assert.equal(new Set(TRACK.map(String)).size, TRACK_LENGTH);
  let diagonals = 0;
  for (let i = 0; i < TRACK_LENGTH; i++) {
    const [c0, r0] = TRACK[i];
    const [c1, r1] = TRACK[(i + 1) % TRACK_LENGTH];
    assert.equal(Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0)), 1, `gap after index ${i}`);
    if (c1 !== c0 && r1 !== r0) diagonals++;
  }
  assert.equal(diagonals, 4);
});

test('each seat enters its home column right after its last track square', () => {
  for (let seat = 0; seat < 4; seat++) {
    const last = TRACK[trackIndexOf(seat, 50)];
    const first = HOME_COLUMNS[seat][0];
    assert.equal(Math.abs(last[0] - first[0]) + Math.abs(last[1] - first[1]), 1);
    // the home column leads toward the centre square (7,7)
    const end = HOME_COLUMNS[seat][4];
    assert.equal(Math.abs(end[0] - 7) + Math.abs(end[1] - 7), 2);
  }
  assert.deepEqual(locate(0, 0), { kind: 'track', index: 0, cell: [1, 6] });
  assert.deepEqual(locate(1, 0).cell, [8, 1]);
  assert.equal(locate(2, FINISH_PROGRESS).kind, 'finish');
  assert.equal(START_INDEX.length, 4);
});

test('only a six releases a token from the yard', () => {
  const g = fourPlayers();
  assert.equal(legalMoves(g, 0, 5).length, 0);
  const moves = legalMoves(g, 0, 6);
  assert.equal(moves.length, 4);
  assert.ok(moves.every((m) => m.kind === 'release' && m.to === 0));
  assert.equal(distinctMoves(moves).length, 1);
});

test('landing on an opponent on a normal square captures it and grants a bonus', () => {
  const g = fourPlayers();
  tok(g, 0, 0).progress = 3; // track index 3
  tok(g, 1, 0).progress = (3 - START_INDEX[1] + TRACK_LENGTH) % TRACK_LENGTH + 2; // index 5
  const victim = tok(g, 1, 0);
  assert.equal(trackIndexOf(1, victim.progress), 5);
  const [move] = legalMoves(g, 0, 2).filter((m) => m.token === tok(g, 0, 0));
  assert.equal(move.captures.length, 1);
  const res = applyMove(g, move, 2);
  assert.equal(victim.progress, -1);
  assert.equal(res.captured.length, 1);
  assert.equal(res.bonus, true);
});

test('safe squares protect tokens', () => {
  const g = fourPlayers();
  tok(g, 0, 0).progress = 5;
  // index 8 is a star square
  tok(g, 1, 0).progress = (8 - START_INDEX[1] + TRACK_LENGTH) % TRACK_LENGTH;
  const [move] = legalMoves(g, 0, 3).filter((m) => m.token === tok(g, 0, 0));
  assert.equal(move.captures.length, 0);
});

test('exact roll needed to finish; finishing all tokens ends the player and ranks them', () => {
  const g = createGame([
    { seat: 0, color: 'red', animal: 'eagle', cpu: false, name: 'A' },
    { seat: 2, color: 'yellow', animal: 'bear', cpu: true, name: 'C' },
  ]);
  for (let i = 0; i < 3; i++) tok(g, 0, i).progress = FINISH_PROGRESS;
  tok(g, 0, 3).progress = 53;
  assert.equal(legalMoves(g, 0, 4).length, 0);
  const [move] = legalMoves(g, 0, 3);
  assert.equal(move.kind, 'finish');
  const res = applyMove(g, move, 3);
  assert.equal(res.playerFinished, true);
  assert.equal(g.over, true);
  assert.deepEqual(g.standings, [0, 2]);
});

test('three sixes in a row forfeit the turn and turns skip finished players', () => {
  const g = fourPlayers();
  assert.equal(registerRoll(g, 6).forfeit, false);
  assert.equal(registerRoll(g, 6).forfeit, false);
  assert.equal(registerRoll(g, 6).forfeit, true);
  assert.equal(registerRoll(g, 6).forfeit, false);
  g.players[1].done = true;
  advanceTurn(g);
  assert.equal(g.players[g.turn].seat, 2);
});

test('fair roll stays in range and covers every face', () => {
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6000; i++) {
    const r = fairRoll();
    assert.ok(r >= 1 && r <= 6);
    counts[r - 1]++;
  }
  for (const c of counts) assert.ok(c > 800 && c < 1200, `skewed distribution ${counts}`);
});

test('cpu prefers a capture', () => {
  const g = fourPlayers();
  tok(g, 0, 0).progress = 10;
  tok(g, 0, 1).progress = 20;
  const victim = tok(g, 2, 0);
  victim.progress = (14 - START_INDEX[2] + TRACK_LENGTH) % TRACK_LENGTH; // index 14
  const moves = legalMoves(g, 0, 4);
  const pick = chooseMove(g, moves, () => 0.5);
  assert.equal(pick.token, tok(g, 0, 0));
  assert.equal(pick.captures[0], victim);
});

test('a full random cpu game always terminates with complete standings', () => {
  for (let n = 0; n < 20; n++) {
    const g = fourPlayers();
    let guard = 0;
    while (!g.over && guard++ < 20000) {
      const p = g.players[g.turn];
      const roll = fairRoll();
      if (registerRoll(g, roll).forfeit) {
        advanceTurn(g);
        continue;
      }
      const moves = legalMoves(g, p.seat, roll);
      if (!moves.length) {
        if (roll !== 6) advanceTurn(g);
        continue;
      }
      const res = applyMove(g, chooseMove(g, moves), roll);
      if (!res.bonus) advanceTurn(g);
    }
    assert.ok(g.over, 'game did not finish');
    assert.equal(new Set(g.standings).size, 4);
  }
});
