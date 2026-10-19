import { FINISH_PROGRESS, LAST_TRACK_PROGRESS, isSafeTrackIndex, trackIndexOf } from './board.js';
import { threatDistance, tokensOnTrackIndex } from './rules.js';

// Chance a CPU expects to win a duel; a lost duel still leaves both pieces sharing the square.
const DUEL_ODDS = 0.55;

// How many opponents could land on `token` if it stood at `progress` (pieces in `gone` are
// ignored). A piece sharing its square with any other piece can't be attacked.
function dangerAt(game, token, progress, gone = []) {
  const { seat } = token;
  const index = trackIndexOf(seat, progress);
  if (index === null || isSafeTrackIndex(index)) return 0;
  if (tokensOnTrackIndex(game, index).some((t) => t !== token && !gone.includes(t))) return 0;
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
  let score = 0;
  for (const victim of move.captures) score += (100 + victim.progress) * DUEL_ODDS;
  if (move.kind === 'finish') score += 80;
  if (move.kind === 'release') score += 60;
  if (move.from <= LAST_TRACK_PROGRESS && move.to > LAST_TRACK_PROGRESS && move.to < FINISH_PROGRESS) score += 30;

  const toIndex = trackIndexOf(seat, move.to);
  if (toIndex !== null && isSafeTrackIndex(toIndex)) score += 18;
  // pairing up with one of our own pieces makes both safe from attack
  const others = toIndex === null ? [] : tokensOnTrackIndex(game, toIndex).filter((t) => t !== token);
  if (others.length === 1 && others[0].seat === seat && !isSafeTrackIndex(toIndex)) score += 12;

  const before = move.from >= 0 ? dangerAt(game, token, move.from) : 0;
  // after a won duel we'd stand alone; after a lost one we'd share the square (and be safe)
  const after = move.captures.length ? dangerAt(game, token, move.to, move.captures) * DUEL_ODDS : dangerAt(game, token, move.to);
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
