// Promise-based tween scheduler driven by the render loop.

export const Ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  inBack: (t) => {
    const c1 = 1.70158;
    return (c1 + 1) * t * t * t - c1 * t * t;
  },
  outElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  outBounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const rand = (lo, hi) => lo + Math.random() * (hi - lo);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Height of a parabolic hop at t in [0,1].
export const arc = (t, height) => 4 * height * t * (1 - t);

export class Animator {
  constructor() {
    this.tasks = new Set();
    this.updaters = new Set();
    this.timeScale = 1;
    this.time = 0;
  }

  update(rawDt) {
    const dt = Math.min(rawDt, 0.1) * this.timeScale;
    this.time += dt;
    for (const task of [...this.tasks]) {
      if (!this.tasks.has(task)) continue;
      task.elapsed += dt;
      const k = task.duration <= 0 ? 1 : Math.min(1, task.elapsed / task.duration);
      task.fn(task.ease(k), k, dt);
      if (k >= 1) {
        this.tasks.delete(task);
        task.resolve();
      }
    }
    for (const fn of [...this.updaters]) {
      if (fn(dt, this.time) === false) this.updaters.delete(fn);
    }
  }

  tween(duration, fn = () => {}, ease = Ease.linear) {
    return new Promise((resolve) => {
      this.tasks.add({ duration, fn, ease, elapsed: 0, resolve });
    });
  }

  wait(seconds) {
    return this.tween(seconds);
  }

  // Runs fn(dt, time) every frame until it returns false or the remover is called.
  every(fn) {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }

  // Drops everything in flight. Pending promises never settle, which abandons the async flows awaiting them.
  reset() {
    this.tasks.clear();
    this.updaters.clear();
  }
}
