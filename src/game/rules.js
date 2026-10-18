import {
  FINISH_PROGRESS,
  LAST_TRACK_PROGRESS,
  START_INDEX,
  TRACK_LENGTH,
  isSafeTrackIndex,
  trackIndexOf,
} from './board.js';

export const TOKENS_PER_PLAYER = 4;

/**
 * players: [{ seat, color, animal, cpu, name }]
 */
export function createGame(players) {
  const ordered = [...players].sort((a, b) => a.seat - b.seat);
  const game = {
    players: ordered.map((p) => ({ ...p, done: false })),
    tokens: [],
    turn: 0,
    sixes: 0,
    standings: [],
    over: false,
  };
  for (const p of game.players) {
    for (let i = 0; i < TOKENS_PER_PLAYER; i++) {
      game.tokens.push({ id: `${p.seat}-${i}`, seat: p.seat, index: i, progress: -1 });
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

function capturesAt(game, seat, progress) {
  const index = trackIndexOf(seat, progress);
  if (index === null || isSafeTrackIndex(index)) return [];
  return tokensOnTrackIndex(game, index).filter((t) => t.seat !== seat);
}

export function legalMoves(game, seat, roll) {
  const moves = [];
  for (const token of tokensOf(game, seat)) {
    if (token.progress === FINISH_PROGRESS) continue;
    if (token.progress < 0) {
      if (roll === 6) {
        moves.push({ token, from: -1, to: 0, kind: 'release', captures: capturesAt(game, seat, 0) });
      }
      continue;
    }
    const to = token.progress + roll;
    if (to > FINISH_PROGRESS) continue;
    moves.push({
      token,
      from: token.progress,
      to,
      kind: to === FINISH_PROGRESS ? 'finish' : 'move',
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
 * Records a roll for the current player. Three sixes in a row forfeit the turn.
 */
export function registerRoll(game, roll) {
  game.sixes = roll === 6 ? game.sixes + 1 : 0;
  if (game.sixes >= 3) {
    game.sixes = 0;
    return { forfeit: true };
  }
  return { forfeit: false };
}

export function applyMove(game, move, roll) {
  const { token } = move;
  const captured = move.captures.map((victim) => ({ token: victim, from: victim.progress }));
  token.progress = move.to;
  for (const { token: victim } of captured) victim.progress = -1;

  const player = game.players.find((p) => p.seat === token.seat);
  const finishedToken = move.to === FINISH_PROGRESS;
  let playerFinished = false;
  if (finishedToken && tokensOf(game, token.seat).every((t) => t.progress === FINISH_PROGRESS)) {
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

  const bonus = !playerFinished && !game.over && (roll === 6 || captured.length > 0 || finishedToken);
  return { captured, finishedToken, playerFinished, bonus };
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
