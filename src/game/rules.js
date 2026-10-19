import {
  FINISH_PROGRESS,
  LAST_TRACK_PROGRESS,
  START_INDEX,
  TRACK_LENGTH,
  isSafeTrackIndex,
  trackIndexOf,
} from './board.js';

export const TOKENS_PER_PLAYER = 4;

// House rules. The defaults are this game's standard rules; the rest are common Ludo variants.
export const DEFAULT_RULES = Object.freeze({
  clash: true, // a head-to-head mashing duel before any kill; the defender can survive it
  safePairs: true, // two pieces sharing a square (any colours) can't be attacked
  safeSquares: true, // the star squares are safe (start squares always are)
  release: '6', // which roll lets a piece out of its cage: '6' or '1or6'
  threeSixes: true, // three sixes in a row forfeit the turn
  captureBonus: true, // a capture earns another roll
  homeBonus: true, // getting a piece home earns another roll
  killToEnter: false, // a player must capture someone before their pieces may enter the home column
  blockades: false, // two pieces of one colour block the square: opponents can't land on it, and only a 6 jumps it
  bounce: false, // overshooting the centre bounces back instead of needing the exact roll
  piecesToWin: 4, // how many pieces a player must get home to finish
  quickStart: false, // every player starts with one piece already out on its start square
});

// Ready-made sets of rules shown in the settings panel.
export const RULE_PRESETS = {
  classic: { name: 'Action Ludo', blurb: 'The standard rules: clash before kills, safe pairs.', rules: {} },
  traditional: {
    name: 'Traditional',
    blurb: 'Plain Ludo: no clash, pairs can be taken, exact roll home.',
    rules: { clash: false, safePairs: false },
  },
  quick: {
    name: 'Quick',
    blurb: 'Out on a 1 or 6, start with a piece out, first two home win.',
    rules: { release: '1or6', quickStart: true, piecesToWin: 2, bounce: true },
  },
  ruthless: {
    name: 'Ruthless',
    blurb: 'Kill before you can go home, blockades, no safe stars.',
    rules: { killToEnter: true, blockades: true, safeSquares: false, safePairs: false },
  },
};

export function normalizeRules(rules = {}) {
  const r = { ...DEFAULT_RULES };
  for (const k of Object.keys(DEFAULT_RULES)) if (rules[k] !== undefined) r[k] = rules[k];
  if (r.release !== '6' && r.release !== '1or6') r.release = '6';
  r.piecesToWin = [1, 2, 3, 4].includes(+r.piecesToWin) ? +r.piecesToWin : 4;
  return r;
}

/**
 * players: [{ seat, color, animal, cpu, name }]
 */
export function createGame(players, rules = {}) {
  const ordered = [...players].sort((a, b) => a.seat - b.seat);
  const game = {
    rules: normalizeRules(rules),
    players: ordered.map((p) => ({ ...p, done: false, kills: 0 })),
    tokens: [],
    turn: 0,
    sixes: 0,
    standings: [],
    over: false,
  };
  for (const p of game.players) {
    for (let i = 0; i < TOKENS_PER_PLAYER; i++) {
      const out = game.rules.quickStart && i === 0;
      game.tokens.push({ id: `${p.seat}-${i}`, seat: p.seat, index: i, progress: out ? 0 : -1 });
    }
  }
  return game;
}

export function rollDie(random = Math.random) {
  return 1 + Math.floor(random() * 6);
}

// Unbiased die roll using the platform CSPRNG when available.
export function fairRoll() {
  const c = globalThis.crypto;
  if (c && c.getRandomValues) {
    const buf = new Uint8Array(1);
    // Reject values that would bias the modulo (252 is the largest multiple of 6 below 256).
    do c.getRandomValues(buf);
    while (buf[0] >= 252);
    return 1 + (buf[0] % 6);
  }
  return rollDie();
}

export function currentPlayer(game) {
  return game.players[game.turn];
}

export function tokensOf(game, seat) {
  return game.tokens.filter((t) => t.seat === seat);
}

export function tokensOnTrackIndex(game, index) {
  return game.tokens.filter((t) => trackIndexOf(t.seat, t.progress) === index);
}

export const rulesOf = (game) => game.rules ?? DEFAULT_RULES;

// Start squares are always safe; the star squares only while that rule is on.
export function isSafeSquare(game, index) {
  return START_INDEX.includes(index) || (rulesOf(game).safeSquares && isSafeTrackIndex(index));
}

// Seat whose pieces (two or more of one colour) block this square for everyone else, or null.
export function blockadeAt(game, index) {
  if (!rulesOf(game).blockades) return null;
  const count = new Map();
  for (const t of tokensOnTrackIndex(game, index)) count.set(t.seat, (count.get(t.seat) ?? 0) + 1);
  for (const [seat, n] of count) if (n >= 2) return seat;
  return null;
}

// Opponents a piece of `seat` would attack by landing at `progress`. Nobody can be attacked on a
// safe square, and with safe pairs on, neither can two pieces sharing a square.
function capturesAt(game, seat, progress) {
  const index = trackIndexOf(seat, progress);
  if (index === null || isSafeSquare(game, index)) return [];
  const here = tokensOnTrackIndex(game, index);
  if (rulesOf(game).safePairs && here.length >= 2) return [];
  return here.filter((t) => t.seat !== seat);
}

// Whether an opponent's blockade stops a piece: nobody may land on one, and only a 6 jumps one
// (so two blockades facing each other can't jam the game for good).
function blockedBetween(game, seat, from, to, roll) {
  if (!rulesOf(game).blockades) return false;
  for (let p = Math.max(0, from + 1); p <= Math.min(to, LAST_TRACK_PROGRESS); p++) {
    const owner = blockadeAt(game, trackIndexOf(seat, p));
    if (owner !== null && owner !== seat && (p === to || roll !== 6)) return true;
  }
  return false;
}

// Progress values a piece passes through, in order (a bounce goes up to the centre and back).
function stepsFor(from, to, bounced) {
  const steps = [];
  if (!bounced) {
    for (let p = Math.max(from, -1) + 1; p <= to; p++) steps.push(p);
    return steps;
  }
  for (let p = from + 1; p <= FINISH_PROGRESS; p++) steps.push(p);
  for (let p = FINISH_PROGRESS - 1; p >= to; p--) steps.push(p);
  return steps;
}

export function legalMoves(game, seat, roll) {
  const rules = rulesOf(game);
  const player = game.players.find((p) => p.seat === seat);
  const moves = [];
  for (const token of tokensOf(game, seat)) {
    if (token.progress === FINISH_PROGRESS) continue;
    if (token.progress < 0) {
      const opens = roll === 6 || (rules.release === '1or6' && roll === 1);
      if (opens && !blockedBetween(game, seat, -1, 0, roll)) {
        moves.push({ token, from: -1, to: 0, kind: 'release', steps: [0], captures: capturesAt(game, seat, 0) });
      }
      continue;
    }
    let to = token.progress + roll;
    let bounced = false;
    if (to > FINISH_PROGRESS) {
      if (!rules.bounce) continue;
      to = 2 * FINISH_PROGRESS - to;
      bounced = true;
    }
    // with "kill to enter", pieces wait outside their home column until the player has captured
    if (rules.killToEnter && !(player?.kills > 0) && to > LAST_TRACK_PROGRESS) continue;
    if (blockedBetween(game, seat, token.progress, to, roll)) continue;
    moves.push({
      token,
      from: token.progress,
      to,
      kind: to === FINISH_PROGRESS ? 'finish' : 'move',
      bounced,
      steps: stepsFor(token.progress, to, bounced),
      captures: capturesAt(game, seat, to),
    });
  }
  return moves;
}

// Two moves are interchangeable when they start and end on the same squares.
export function distinctMoves(moves) {
  const seen = new Set();
  return moves.filter((m) => {
    const key = `${m.from}>${m.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Records a roll for the current player. Three sixes in a row forfeit the turn (unless that rule
 * is off).
 */
export function registerRoll(game, roll) {
  game.sixes = roll === 6 ? game.sixes + 1 : 0;
  if (game.sixes >= 3 && rulesOf(game).threeSixes) {
    game.sixes = 0;
    return { forfeit: true };
  }
  return { forfeit: false };
}

function finishedCount(game, seat) {
  return tokensOf(game, seat).filter((t) => t.progress === FINISH_PROGRESS).length;
}

// Moves the piece. Landing on opponents doesn't capture them outright: each one fights a duel
// (result.duels), and resolveDuel() then either sends the victim home or lets it stay, sharing
// the square with the attacker.
export function applyMove(game, move, roll) {
  const rules = rulesOf(game);
  const { token } = move;
  token.progress = move.to;

  const player = game.players.find((p) => p.seat === token.seat);
  const finishedToken = move.to === FINISH_PROGRESS;
  let playerFinished = false;
  if (finishedToken && !player.done && finishedCount(game, token.seat) >= rules.piecesToWin) {
    player.done = true;
    playerFinished = true;
    game.standings.push(player.seat);
    const remaining = game.players.filter((p) => !p.done);
    if (remaining.length <= 1) {
      for (const p of remaining) {
        p.done = true;
        game.standings.push(p.seat);
      }
      game.over = true;
    }
  }

  const bonus = !playerFinished && !game.over && (roll === 6 || (finishedToken && rules.homeBonus));
  return { duels: [...move.captures], captured: [], spared: [], finishedToken, playerFinished, bonus };
}

// Settles one duel started by a move. A winning attacker captures the victim (and, with the
// capture bonus on, earns another roll); if the defender wins, both pieces stay on the square.
export function resolveDuel(game, result, victim, attackerWins) {
  const i = result.duels.indexOf(victim);
  if (i < 0) return result;
  result.duels.splice(i, 1);
  if (attackerWins) {
    result.captured.push({ token: victim, from: victim.progress });
    victim.progress = -1;
    const attacker = game.players[game.turn];
    if (attacker) attacker.kills++;
    if (rulesOf(game).captureBonus && !result.playerFinished && !game.over) result.bonus = true;
  } else {
    result.spared.push(victim);
  }
  return result;
}

export function advanceTurn(game) {
  game.sixes = 0;
  if (game.over) return;
  const n = game.players.length;
  for (let i = 1; i <= n; i++) {
    const next = (game.turn + i) % n;
    if (!game.players[next].done) {
      game.turn = next;
      return;
    }
  }
}

// Distance (in squares) an opponent token would need to travel to land on `index`, or null.
export function threatDistance(opponent, index) {
  if (opponent.progress < 0 || opponent.progress > LAST_TRACK_PROGRESS) return null;
  const at = (START_INDEX[opponent.seat] + opponent.progress) % TRACK_LENGTH;
  const d = (index - at + TRACK_LENGTH) % TRACK_LENGTH;
  if (d === 0 || opponent.progress + d > LAST_TRACK_PROGRESS) return null;
  return d;
}
