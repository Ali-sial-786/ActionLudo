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
  resolveDuel,
  RULE_PRESETS,
  rollDie,
  tokensOf,
} from '../src/game/rules.js';

// Seeded random numbers, so the simulated games below are reproducible.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
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

// Places a lone red piece two squares behind a lone green piece on normal track squares.
function standoff() {
  const g = fourPlayers();
  tok(g, 0, 0).progress = 3; // track index 3
  tok(g, 1, 0).progress = (5 - START_INDEX[1] + TRACK_LENGTH) % TRACK_LENGTH; // index 5
  const victim = tok(g, 1, 0);
  assert.equal(trackIndexOf(1, victim.progress), 5);
  const [move] = legalMoves(g, 0, 2).filter((m) => m.token === tok(g, 0, 0));
  return { g, move, victim };
}

test('landing on a lone opponent starts a duel; winning it captures and grants a bonus', () => {
  const { g, move, victim } = standoff();
  const from = victim.progress;
  assert.equal(move.captures.length, 1);
  const res = applyMove(g, move, 2);
  assert.deepEqual(res.duels, [victim]);
  assert.equal(victim.progress, from, 'nothing is captured until the duel is decided');
  assert.equal(res.bonus, false);
  resolveDuel(g, res, victim, true);
  assert.equal(victim.progress, -1);
  assert.equal(res.captured.length, 1);
  assert.equal(res.captured[0].from, from);
  assert.equal(res.bonus, true);
});

test('a defender who wins the duel survives and shares the square', () => {
  const { g, move, victim } = standoff();
  const from = victim.progress;
  const res = resolveDuel(g, applyMove(g, move, 2), victim, false);
  assert.equal(victim.progress, from);
  assert.deepEqual(res.spared, [victim]);
  assert.equal(res.captured.length, 0);
  assert.equal(res.bonus, false);
  assert.equal(trackIndexOf(0, tok(g, 0, 0).progress), trackIndexOf(1, victim.progress));
});

test('two pieces sharing a square can not be attacked', () => {
  // a defended pair (attacker and defender after a lost duel)
  const { g, move, victim } = standoff();
  resolveDuel(g, applyMove(g, move, 2), victim, false);
  tok(g, 2, 0).progress = (1 - START_INDEX[2] + TRACK_LENGTH) % TRACK_LENGTH; // index 1
  const [third] = legalMoves(g, 2, 4).filter((m) => m.token === tok(g, 2, 0));
  assert.equal(trackIndexOf(2, third.to), 5);
  assert.equal(third.captures.length, 0);
  assert.deepEqual(applyMove(g, third, 4).duels, []);
  // two pieces of the same colour are just as safe
  const h = fourPlayers();
  for (const i of [0, 1]) tok(h, 1, i).progress = (20 - START_INDEX[1] + TRACK_LENGTH) % TRACK_LENGTH;
  tok(h, 0, 0).progress = 18;
  const [hit] = legalMoves(h, 0, 2).filter((m) => m.token === tok(h, 0, 0));
  assert.equal(trackIndexOf(0, hit.to), 20);
  assert.equal(hit.captures.length, 0);
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
    const rnd = seeded(n + 1);
    const g = fourPlayers();
    let guard = 0;
    while (!g.over && guard++ < 20000) {
      const p = g.players[g.turn];
      const roll = rollDie(rnd);
      if (registerRoll(g, roll).forfeit) {
        advanceTurn(g);
        continue;
      }
      const moves = legalMoves(g, p.seat, roll);
      if (!moves.length) {
        if (roll !== 6) advanceTurn(g);
        continue;
      }
      const res = applyMove(g, chooseMove(g, moves, rnd), roll);
      for (const v of [...res.duels]) resolveDuel(g, res, v, rnd() < 0.5);
      if (!res.bonus) advanceTurn(g);
    }
    assert.ok(g.over, 'game did not finish');
    assert.equal(new Set(g.standings).size, 4);
  }
});

// ------------------------------------------------------------------ house rules
const at = (seat, index) => (index - START_INDEX[seat] + TRACK_LENGTH) % TRACK_LENGTH;
const withRules = (rules) =>
  createGame(
    [
      { seat: 0, color: 'red', animal: 'eagle', cpu: false, name: 'A' },
      { seat: 1, color: 'green', animal: 'tiger', cpu: true, name: 'B' },
      { seat: 2, color: 'yellow', animal: 'bear', cpu: true, name: 'C' },
      { seat: 3, color: 'blue', animal: 'shark', cpu: true, name: 'D' },
    ],
    rules,
  );

test('rules default to the standard set and ignore junk', () => {
  const g = withRules({ piecesToWin: 9, release: 'any', bogus: true });
  assert.equal(g.rules.piecesToWin, 4);
  assert.equal(g.rules.release, '6');
  assert.equal(g.rules.clash, true);
  assert.equal('bogus' in g.rules, false);
});

test('release on a 1 or a 6', () => {
  assert.equal(legalMoves(withRules({}), 0, 1).length, 0);
  const moves = legalMoves(withRules({ release: '1or6' }), 0, 1);
  assert.equal(moves.length, 4);
  assert.ok(moves.every((m) => m.kind === 'release'));
});

test('quick start puts one piece of each colour on its start square', () => {
  const g = withRules({ quickStart: true });
  for (const p of g.players) assert.deepEqual(tokensOf(g, p.seat).map((t) => t.progress), [0, -1, -1, -1]);
});

test('without safe pairs, landing on two pieces attacks both', () => {
  const g = withRules({ safePairs: false });
  tok(g, 0, 0).progress = 3;
  for (const i of [0, 1]) tok(g, 1, i).progress = at(1, 5);
  const [move] = legalMoves(g, 0, 2).filter((m) => m.token === tok(g, 0, 0));
  assert.equal(move.captures.length, 2);
  const res = applyMove(g, move, 2);
  resolveDuel(g, res, tok(g, 1, 0), true);
  resolveDuel(g, res, tok(g, 1, 1), false);
  assert.equal(tok(g, 1, 0).progress, -1);
  assert.equal(tok(g, 1, 1).progress, at(1, 5));
  assert.equal(res.bonus, true);
  assert.equal(g.players[0].kills, 1);
});

test('safe stars can be switched off, start squares stay safe', () => {
  const g = withRules({ safeSquares: false });
  tok(g, 0, 0).progress = 5;
  tok(g, 1, 0).progress = at(1, 8); // a star square
  const [move] = legalMoves(g, 0, 3).filter((m) => m.token === tok(g, 0, 0));
  assert.equal(move.captures.length, 1);
  // green's start square is still safe
  tok(g, 1, 0).progress = 0;
  tok(g, 0, 0).progress = START_INDEX[1] - 2;
  const [onStart] = legalMoves(g, 0, 2).filter((m) => m.token === tok(g, 0, 0));
  assert.equal(onStart.captures.length, 0);
});

test('capture and home bonuses can be switched off; three sixes can be allowed', () => {
  const g = withRules({ captureBonus: false, threeSixes: false, homeBonus: false });
  tok(g, 0, 0).progress = 3;
  tok(g, 1, 0).progress = at(1, 5);
  const [move] = legalMoves(g, 0, 2).filter((m) => m.token === tok(g, 0, 0));
  const res = applyMove(g, move, 2);
  resolveDuel(g, res, tok(g, 1, 0), true);
  assert.equal(res.bonus, false);
  for (let i = 0; i < 4; i++) assert.equal(registerRoll(g, 6).forfeit, false);
  tok(g, 0, 1).progress = 53;
  const [home] = legalMoves(g, 0, 3).filter((m) => m.token === tok(g, 0, 1));
  assert.equal(applyMove(g, home, 3).bonus, false);
});

test('kill to enter home holds pieces at the gate until their player captures', () => {
  const g = withRules({ killToEnter: true });
  tok(g, 0, 0).progress = 48;
  assert.equal(legalMoves(g, 0, 2).filter((m) => m.token === tok(g, 0, 0)).length, 1); // to 50: fine
  assert.equal(legalMoves(g, 0, 4).filter((m) => m.token === tok(g, 0, 0)).length, 0); // 52: home column
  g.players[0].kills = 1;
  assert.equal(legalMoves(g, 0, 4).filter((m) => m.token === tok(g, 0, 0)).length, 1);
});

test('blockades stop opponents landing, and passing unless they roll a 6', () => {
  const g = withRules({ blockades: true });
  for (const i of [0, 1]) tok(g, 1, i).progress = at(1, 10);
  tok(g, 0, 0).progress = 7;
  assert.equal(legalMoves(g, 0, 3).filter((m) => m.token === tok(g, 0, 0)).length, 0, 'lands on it');
  assert.equal(legalMoves(g, 0, 5).filter((m) => m.token === tok(g, 0, 0)).length, 0, 'passes it');
  assert.equal(legalMoves(g, 0, 6).filter((m) => m.token === tok(g, 0, 0)).length, 1, 'a 6 jumps it');
  assert.equal(legalMoves(g, 0, 2).filter((m) => m.token === tok(g, 0, 0)).length, 1, 'stops short');
  tok(g, 1, 2).progress = at(1, 8);
  assert.equal(legalMoves(g, 1, 4).filter((m) => m.token === tok(g, 1, 2)).length, 1, 'owner passes');
});

test('bounce back: an overshoot reflects off the centre', () => {
  const exact = withRules({});
  tok(exact, 0, 0).progress = 54;
  assert.equal(legalMoves(exact, 0, 5).length, 0);
  const g = withRules({ bounce: true });
  tok(g, 0, 0).progress = 54;
  const [move] = legalMoves(g, 0, 5);
  assert.equal(move.to, 53);
  assert.equal(move.bounced, true);
  assert.deepEqual(move.steps, [55, 56, 55, 54, 53]);
});

test('a quick game ends once enough pieces are home', () => {
  const g = createGame(
    [
      { seat: 0, color: 'red', animal: 'eagle', cpu: false, name: 'A' },
      { seat: 2, color: 'yellow', animal: 'bear', cpu: true, name: 'C' },
    ],
    { piecesToWin: 1 },
  );
  tok(g, 0, 0).progress = 53;
  const [move] = legalMoves(g, 0, 3);
  const res = applyMove(g, move, 3);
  assert.equal(res.playerFinished, true);
  assert.equal(g.over, true);
  assert.deepEqual(g.standings, [0, 2]);
});

test('random cpu games terminate under every preset', () => {
  for (const preset of Object.values(RULE_PRESETS)) {
    for (let n = 0; n < 40; n++) {
      const rnd = seeded(1000 + n);
      const g = withRules(preset.rules);
      let guard = 0;
      while (!g.over && guard++ < 30000) {
        const p = g.players[g.turn];
        const roll = rollDie(rnd);
        if (registerRoll(g, roll).forfeit) {
          advanceTurn(g);
          continue;
        }
        const moves = legalMoves(g, p.seat, roll);
        if (!moves.length) {
          if (roll !== 6) advanceTurn(g);
          continue;
        }
        const res = applyMove(g, chooseMove(g, moves, rnd), roll);
        for (const v of [...res.duels]) resolveDuel(g, res, v, rnd() < 0.5);
        if (!res.bonus) advanceTurn(g);
      }
      assert.ok(g.over, `${preset.name} game did not finish`);
    }
  }
});
