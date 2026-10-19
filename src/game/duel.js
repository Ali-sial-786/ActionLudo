import { Ease, lerp, rand } from '../engine/anim.js';
import { BOARD_Y } from '../render/boardMesh.js';
import { BULK } from '../render/animals.js';

// The clash before a kill: a tug-of-war mashing duel between the attacker and the piece it landed
// on. Each tap pushes the clash point toward the opponent; fill the bar with your colour to win,
// or be ahead when time runs out (a dead heat is a coin toss). On the board the two animals shove
// against each other, lunging with every tap.

const STEP = 0.07; // how far one tap pushes the clash point (the bar spans -1..1)
const HUMAN_TIME = 5; // seconds of mashing when a person is involved (real time, whatever the game speed)
const CPU_TIME = 2.4; // a quick clash when two CPUs fight
const CPU_RATE = { action: [5.8, 8.2], kids: [4.2, 6.2] }; // CPU taps per second (Kids CPUs go easier)

// Two people sharing one keyboard: left-hand keys for the attacker, right-hand keys for the defender.
const LEFT_KEYS = new Set(['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'ShiftLeft']);
const RIGHT_KEYS = new Set(['KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'KeyM', 'Comma', 'Period', 'Slash', 'Enter', 'ShiftRight', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

export class Duel {
  // a / b: { view, player, color: { hex, css }, animal: { name, emoji } } for attacker and defender.
  constructor({ world, sfx, fx, ui, a, b, A, V, kids }) {
    Object.assign(this, { world, anim: world.anim, sfx, fx, ui, a, b, A, V, kids });
    this.humans = [a, b].filter((s) => !s.player.cpu).length;
    this.x = 0; // > 0: the attacker is winning
    this.taps = { a: 0, b: 0 };
    this.queued = { a: 0, b: 0 };
    this.lunge = { a: 0, b: 0 };
    this.done = false;
  }

  // Which side a key press or pointer press belongs to (null: not part of the duel).
  sideFor(e) {
    if (this.humans === 0) return null;
    if (this.humans === 1) return this.a.player.cpu ? 'b' : 'a';
    if (e.type === 'keydown') return LEFT_KEYS.has(e.code) ? 'a' : RIGHT_KEYS.has(e.code) ? 'b' : null;
    return e.clientX < window.innerWidth / 2 ? 'a' : 'b';
  }

  tap(side) {
    if (!side || !this.live || this.done) return;
    this.queued[side]++;
  }

  listen() {
    const onKey = (e) => {
      // leave browser shortcuts alone
      if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) return;
      // the duel owns the keyboard while it runs (no fast-forward, no rolling)
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type !== 'keydown' || e.repeat) return;
      const side = this.sideFor(e);
      if (side) this.tap(side);
    };
    const onPointer = (side) => (e) => {
      e.preventDefault();
      this.sfx.unlock();
      this.tap(side ?? this.sideFor(e));
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    this.ui.onPad = (side, e) => {
      const s = this.humans === 2 ? side : this.sideFor(e);
      if (s) this.tap(s);
    };
    this.ui.onBackground = onPointer(null);
    this.stopListening = () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      this.ui.onPad = this.ui.onBackground = null;
    };
  }

  // Abandon the duel (the game was interrupted).
  cancel() {
    this.done = true;
    this.stopListening?.();
    this.ui.close();
  }

  async run() {
    const { a, b, A, V } = this;
    const dir = V.clone().sub(A).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    this.dir = dir;
    this.gapA = 0.32 * (BULK[a.view.animal] ?? 1);
    this.gapB = 0.32 * (BULK[b.view.animal] ?? 1);
    this.ui.open({ kids: this.kids, humans: this.humans, a, b });
    this.listen();

    // the attacker closes in and the two square up, nose to nose
    const a0 = a.view.root.position.clone();
    const b0 = b.view.root.position.clone();
    this.sfx.play(this.kids ? 'boing' : 'roar', { pitch: 1.15 });
    await this.anim.tween(0.35, (k) => {
      this.place(lerp(0, 1, k), a0, b0);
    }, Ease.outCubic);

    // 3, 2, 1... (just a quick call when two CPUs fight)
    if (this.humans) {
      for (const n of ['3', '2', '1']) {
        this.ui.count(n);
        this.sfx.play('click');
        await this.realWait(0.5);
        if (this.done) return false;
      }
    }
    this.ui.count(this.kids ? 'BONK!' : 'FIGHT!');
    this.sfx.play('clashGo');
    this.live = true;

    const limit = this.humans ? HUMAN_TIME : CPU_TIME;
    const [lo, hi] = this.humans ? CPU_RATE[this.kids ? 'kids' : 'action'] : CPU_RATE.action;
    const cpu = { a: a.player.cpu ? rand(lo, hi) : 0, b: b.player.cpu ? rand(lo, hi) : 0, accA: rand(0, 1), accB: rand(0, 1) };
    const phase = rand(0, Math.PI * 2);
    let t = 0;
    await new Promise((resolve) => {
      this.anim.every((dt) => {
        if (this.done) return false;
        // people mash in real seconds; a CPU-only clash follows the game speed
        const step = this.humans ? dt / Math.max(1e-6, this.anim.timeScale * this.anim.slow) : dt;
        // CPU mashing with a little rhythm wobble, integrated in small steps so the game speed
        // (and frame rate) can't favour either side
        for (let rem = step; rem > 1e-9; ) {
          const h = Math.min(rem, 1 / 60);
          rem -= h;
          t += h;
          const wobble = 0.25 * Math.sin(t * 9 + phase);
          if (cpu.a) cpu.accA += cpu.a * (1 + wobble) * h;
          if (cpu.b) cpu.accB += cpu.b * (1 - wobble) * h;
        }
        this.queued.a += Math.floor(cpu.accA);
        this.queued.b += Math.floor(cpu.accB);
        cpu.accA %= 1;
        cpu.accB %= 1;
        // apply the taps alternately, so neither side gets to go first
        while ((this.queued.a > 0 || this.queued.b > 0) && Math.abs(this.x) < 1) {
          for (const side of ['a', 'b']) {
            if (this.queued[side] > 0 && Math.abs(this.x) < 1) {
              this.queued[side]--;
              this.push(side);
            }
          }
        }
        this.queued.a = this.queued.b = 0;
        this.lunge.a *= Math.exp(-dt * 12);
        this.lunge.b *= Math.exp(-dt * 12);
        this.place(1);
        this.ui.update({ x: this.x, left: Math.max(0, limit - t), taps: this.taps });
        if (Math.abs(this.x) >= 1 || t >= limit) {
          resolve();
          return false;
        }
        return true;
      });
    });
    this.live = false;
    this.done = true;
    this.stopListening();
    return Math.abs(this.x) < 1e-9 ? Math.random() < 0.5 : this.x > 0;
  }

  push(side) {
    const s = side === 'a' ? 1 : -1;
    this.x = Math.max(-1, Math.min(1, this.x + STEP * s));
    this.taps[side]++;
    this.lunge[side] = Math.min(0.12, this.lunge[side] + 0.07);
    this.ui.hit(side);
    const view = side === 'a' ? this.a.view : this.b.view;
    this.sfx.play('clash', { side: s, power: 0.6 + 0.4 * Math.abs(this.x) });
    if (this.taps[side] % 2 === 0) {
      const at = this.clashPoint().setY(BOARD_Y + 0.32 * (BULK[view.animal] ?? 1));
      const color = this.kids ? (side === 'a' ? 0xffe066 : 0xff8fc8) : side === 'a' ? 0xffc46b : 0xfff0d0;
      this.fx.sparks(at, color, 4, 1.8);
    }
    this.world.shake(0.025 + 0.03 * Math.abs(this.x));
  }

  clashPoint() {
    return this.A.clone().lerp(this.V, 0.5 + 0.2 * this.x);
  }

  // Stand both animals either side of the clash point, leaning into each other. k blends in from
  // where they were standing (a0, b0) for the opening step.
  place(k, a0, b0) {
    const c = this.clashPoint();
    const pa = c.clone().addScaledVector(this.dir, -(this.gapA - this.lunge.a)).setY(BOARD_Y);
    const pb = c.clone().addScaledVector(this.dir, this.gapB - this.lunge.b).setY(BOARD_Y);
    const { a, b } = this;
    if (a0) a.view.root.position.lerpVectors(a0, pa, k);
    else a.view.root.position.copy(pa);
    if (b0) b.view.root.position.lerpVectors(b0, pb, k);
    else b.view.root.position.copy(pb);
    // lean forward into the shove; whoever is being pushed back leans a touch less
    a.view.model.rotation.x = k * (0.1 + this.lunge.a * 1.6 + Math.max(0, this.x) * 0.06);
    b.view.model.rotation.x = k * (0.1 + this.lunge.b * 1.6 + Math.max(0, -this.x) * 0.06);
    const jawA = a.view.parts.jaw;
    const jawB = b.view.parts.jaw;
    if (jawA) jawA.rotation.x = k * (0.15 + this.lunge.a * 3);
    if (jawB) jawB.rotation.x = k * (0.15 + this.lunge.b * 3);
  }

  realWait(seconds) {
    let t = 0;
    return new Promise((resolve) => {
      this.anim.every((dt) => {
        t += dt / Math.max(1e-6, this.anim.timeScale * this.anim.slow);
        if (t >= seconds || this.done) {
          resolve();
          return false;
        }
        return true;
      });
    });
  }
}
