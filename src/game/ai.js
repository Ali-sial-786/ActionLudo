import { FINISH_PROGRESS, LAST_TRACK_PROGRESS, trackIndexOf } from './board.js';
import { isSafeSquare, rulesOf, threatDistance, tokensOnTrackIndex } from './rules.js';

// Chance a CPU expects to win a clash; a lost clash still leaves both pieces sharing the square.
const DUEL_ODDS = 0.55;

// How many opponents could land on `token` if it stood at `progress` (pieces in `gone` are
// ignored). Depending on the rules, a piece sharing its square can't be attacked (safe pairs),
// and two of a colour form a blockade nobody can land on.
function dangerAt(game, token, progress, gone = []) {
  const { seat } = token;
  const rules = rulesOf(game);
  const index = trackIndexOf(seat, progress);
  if (index === null || isSafeSquare(game, index)) return 0;
  const others = tokensOnTrackIndex(game, index).filter((t) => t !== token && !gone.includes(t));
  if (rules.safePairs && others.length) return 0;
  if (rules.blockades && others.some((t) => t.seat === seat)) return 0;
  let danger = 0;
  for (const t of game.tokens) {
    if (t.seat === seat || gone.includes(t)) continue;
    const d = threatDistance(t, index);
    if (d !== null && d <= 6) danger += 1;
  }
  return danger;
}

export function scoreMove(game, move) {
  const { token } = move;
  const seat = token.seat;
  const rules = rulesOf(game);
  const odds = rules.clash ? DUEL_ODDS : 1;
  // with "kill to enter home", the first capture unlocks the home column
  const needKill = rules.killToEnter && !(game.players.find((p) => p.seat === seat)?.kills > 0);
  let score = 0;
  for (const victim of move.captures) score += (100 + victim.progress + (needKill ? 40 : 0)) * odds;
  if (move.kind === 'finish') score += 80;
  if (move.kind === 'release') score += 60;
  if (move.from <= LAST_TRACK_PROGRESS && move.to > LAST_TRACK_PROGRESS && move.to < FINISH_PROGRESS) score += 30;

  const toIndex = trackIndexOf(seat, move.to);
  if (toIndex !== null && isSafeSquare(game, toIndex)) score += 18;
  // pairing up with one of our own pieces makes both safe (or forms a blockade)
  const others = toIndex === null ? [] : tokensOnTrackIndex(game, toIndex).filter((t) => t !== token);
  if (others.length === 1 && others[0].seat === seat && !isSafeSquare(game, toIndex)) score += rules.blockades ? 16 : rules.safePairs ? 12 : 0;

  const before = move.from >= 0 ? dangerAt(game, token, move.from) : 0;
  // after a won duel we'd stand alone; after a lost one we'd share the square (and be safe)
  const after = move.captures.length ? dangerAt(game, token, move.to, move.captures) * odds : dangerAt(game, token, move.to);
  score += before * 28;
  score -= after * 35;
  // leaving a partner behind on its own exposes it again
  const fromIndex = move.from >= 0 ? trackIndexOf(seat, move.from) : null;
  const left = fromIndex === null ? [] : tokensOnTrackIndex(game, fromIndex).filter((t) => t !== token);
  if (left.length === 1 && left[0].seat === seat) score -= dangerAt(game, left[0], left[0].progress, [token]) * 20;

  score += (move.to - Math.max(move.from, 0)) * 0.4 + move.to * 0.08;
  return score;
}

export function chooseMove(game, moves, random = Math.random) {
  let best = null;
  let bestScore = -Infinity;
  for (const m of moves) {
    const s = scoreMove(game, m) + random() * 4;
    if (s > bestScore) {
      bestScore = s;
      best = m;
    }
  }
  return best;
}
