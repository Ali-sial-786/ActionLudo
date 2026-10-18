import { FINISH_PROGRESS, LAST_TRACK_PROGRESS, isSafeTrackIndex, trackIndexOf } from './board.js';
import { threatDistance } from './rules.js';

function dangerAt(game, seat, progress) {
  const index = trackIndexOf(seat, progress);
  if (index === null || isSafeTrackIndex(index)) return 0;
  let danger = 0;
  for (const t of game.tokens) {
    if (t.seat === seat) continue;
    const d = threatDistance(t, index);
    if (d !== null && d <= 6) danger += 1;
  }
  return danger;
}

export function scoreMove(game, move) {
  const seat = move.token.seat;
  let score = 0;
  for (const victim of move.captures) score += 100 + victim.progress;
  if (move.kind === 'finish') score += 80;
  if (move.kind === 'release') score += 60;
  if (move.from <= LAST_TRACK_PROGRESS && move.to > LAST_TRACK_PROGRESS && move.to < FINISH_PROGRESS) score += 30;

  const toIndex = trackIndexOf(seat, move.to);
  if (toIndex !== null && isSafeTrackIndex(toIndex)) score += 18;

  const before = move.from >= 0 ? dangerAt(game, seat, move.from) : 0;
  const after = dangerAt(game, seat, move.to);
  score += before * 28;
  score -= after * 35;

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
