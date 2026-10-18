// Tiny procedural sound effects built on WebAudio. No assets required.

class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.noiseBuffer = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  get ready() {
    return this.ctx && !this.muted;
  }

  tone({ type = 'sine', freq = 440, to = null, dur = 0.2, vol = 0.3, delay = 0, attack = 0.005, vibrato = 0 }) {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    if (vibrato) {
      const lfo = this.ctx.createOscillator();
      const lg = this.ctx.createGain();
      lfo.frequency.value = 18;
      lg.gain.value = vibrato;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.05);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.2, vol = 0.3, filter = 'lowpass', freq = 1200, to = null, q = 1, delay = 0, attack = 0.005 }) {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t0);
    if (to) f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  play(name, opt = {}) {
    if (!this.ready) return;
    const fn = SOUNDS[name];
    if (fn) fn(this, opt);
  }
}

const SOUNDS = {
  click: (s) => s.tone({ type: 'triangle', freq: 660, to: 880, dur: 0.08, vol: 0.15 }),
  diceShake: (s) => {
    for (let i = 0; i < 5; i++) s.noise({ dur: 0.05, vol: 0.25, filter: 'bandpass', freq: 2500 + Math.random() * 1500, q: 3, delay: i * 0.05 });
  },
  diceHit: (s, { power = 1 }) => {
    s.noise({ dur: 0.07, vol: 0.35 * power, filter: 'bandpass', freq: 1800 + Math.random() * 800, q: 2 });
    s.tone({ type: 'triangle', freq: 220 + Math.random() * 60, to: 120, dur: 0.08, vol: 0.18 * power });
  },
  hop: (s, { step = 0 }) => s.tone({ type: 'sine', freq: 380 + step * 45, to: 520 + step * 45, dur: 0.1, vol: 0.12 }),
  land: (s) => s.noise({ dur: 0.08, vol: 0.18, freq: 600 }),
  whoosh: (s, { dur = 0.4 } = {}) => s.noise({ dur, vol: 0.35, filter: 'bandpass', freq: 400, to: 2400, q: 1.5, attack: dur * 0.6 }),
  thud: (s, { power = 1 } = {}) => {
    s.tone({ type: 'sine', freq: 140, to: 40, dur: 0.35, vol: 0.6 * power });
    s.noise({ dur: 0.25, vol: 0.4 * power, freq: 700, to: 100 });
  },
  boom: (s) => {
    s.tone({ type: 'sine', freq: 90, to: 30, dur: 0.8, vol: 0.7 });
    s.noise({ dur: 0.7, vol: 0.5, freq: 1500, to: 80 });
  },
  rip: (s) => {
    s.noise({ dur: 0.35, vol: 0.5, filter: 'highpass', freq: 900, to: 3000, q: 0.7 });
    s.tone({ type: 'sawtooth', freq: 300, to: 90, dur: 0.3, vol: 0.15 });
  },
  slash: (s, { delay = 0 } = {}) => s.noise({ dur: 0.12, vol: 0.4, filter: 'bandpass', freq: 3000, to: 900, q: 2, delay }),
  roar: (s, { pitch = 1 } = {}) => {
    s.tone({ type: 'sawtooth', freq: 160 * pitch, to: 80 * pitch, dur: 0.9, vol: 0.28, attack: 0.08, vibrato: 12 });
    s.noise({ dur: 0.9, vol: 0.25, freq: 900 * pitch, to: 300, attack: 0.1 });
  },
  screech: (s) => {
    s.tone({ type: 'sawtooth', freq: 2400, to: 1300, dur: 0.6, vol: 0.12, attack: 0.03, vibrato: 90 });
    s.tone({ type: 'sine', freq: 3200, to: 1800, dur: 0.6, vol: 0.12, attack: 0.03, vibrato: 120 });
  },
  howl: (s) => {
    s.tone({ type: 'sine', freq: 420, to: 760, dur: 0.5, vol: 0.25, attack: 0.2, vibrato: 8 });
    s.tone({ type: 'sine', freq: 760, to: 380, dur: 0.9, vol: 0.25, delay: 0.5, vibrato: 8 });
  },
  hiss: (s) => s.noise({ dur: 0.7, vol: 0.3, filter: 'highpass', freq: 5000, q: 0.5, attack: 0.1 }),
  bite: (s) => {
    s.noise({ dur: 0.06, vol: 0.5, filter: 'bandpass', freq: 1500, q: 4 });
    s.tone({ type: 'square', freq: 160, to: 60, dur: 0.1, vol: 0.2 });
  },
  splash: (s) => {
    s.noise({ dur: 0.6, vol: 0.45, freq: 3000, to: 300, attack: 0.01 });
    s.noise({ dur: 0.3, vol: 0.3, filter: 'bandpass', freq: 800, q: 1, delay: 0.05 });
  },
  dunDun: (s) => {
    s.tone({ type: 'sawtooth', freq: 82, dur: 0.35, vol: 0.3 });
    s.tone({ type: 'sawtooth', freq: 87, dur: 0.35, vol: 0.3, delay: 0.45 });
  },
  drum: (s, { delay = 0 } = {}) => s.tone({ type: 'sine', freq: 110, to: 55, dur: 0.18, vol: 0.5, delay }),
  snort: (s) => s.noise({ dur: 0.3, vol: 0.35, freq: 500, to: 200, attack: 0.02 }),
  sting: (s, { delay = 0 } = {}) => {
    s.tone({ type: 'square', freq: 1400, to: 300, dur: 0.12, vol: 0.15, delay });
    s.noise({ dur: 0.08, vol: 0.3, filter: 'highpass', freq: 3000, delay });
  },
  pop: (s) => {
    s.tone({ type: 'sine', freq: 600, to: 80, dur: 0.2, vol: 0.5 });
    s.noise({ dur: 0.3, vol: 0.4, freq: 2000, to: 200 });
  },
  pinch: (s, { delay = 0 } = {}) => s.noise({ dur: 0.05, vol: 0.4, filter: 'bandpass', freq: 4000, q: 5, delay }),
  chain: (s, { dur = 1 } = {}) => {
    const n = Math.floor(dur * 14);
    for (let i = 0; i < n; i++) {
      s.tone({ type: 'triangle', freq: 1800 + Math.random() * 1600, dur: 0.06, vol: 0.06, delay: i / 14 + Math.random() * 0.03 });
    }
  },
  clank: (s) => {
    s.tone({ type: 'square', freq: 260, to: 180, dur: 0.25, vol: 0.18 });
    s.tone({ type: 'triangle', freq: 1300, to: 900, dur: 0.3, vol: 0.15 });
    s.noise({ dur: 0.12, vol: 0.3, filter: 'bandpass', freq: 2500, q: 2 });
  },
  unlock: (s) => {
    s.tone({ type: 'square', freq: 1800, dur: 0.04, vol: 0.12 });
    s.tone({ type: 'square', freq: 1200, dur: 0.05, vol: 0.12, delay: 0.09 });
    s.tone({ type: 'triangle', freq: 880, to: 1760, dur: 0.25, vol: 0.15, delay: 0.16 });
  },
  sparkle: (s) => {
    [1320, 1660, 1980, 2640].forEach((f, i) => s.tone({ type: 'sine', freq: f, dur: 0.18, vol: 0.08, delay: i * 0.06 }));
  },
  cheer: (s) => {
    [523, 659, 784, 1046].forEach((f, i) => s.tone({ type: 'triangle', freq: f, dur: 0.22, vol: 0.14, delay: i * 0.08 }));
  },
  fanfare: (s) => {
    const notes = [523, 523, 523, 659, 784, 659, 784, 1046];
    notes.forEach((f, i) => s.tone({ type: 'square', freq: f, dur: 0.2, vol: 0.09, delay: i * 0.13 }));
    notes.forEach((f, i) => s.tone({ type: 'triangle', freq: f / 2, dur: 0.22, vol: 0.12, delay: i * 0.13 }));
  },
  sad: (s) => {
    [392, 370, 349, 330].forEach((f, i) => s.tone({ type: 'triangle', freq: f, dur: 0.3, vol: 0.12, delay: i * 0.22 }));
  },
  error: (s) => s.tone({ type: 'square', freq: 180, to: 120, dur: 0.25, vol: 0.12 }),
  creak: (s) => s.tone({ type: 'sawtooth', freq: 90, to: 140, dur: 0.5, vol: 0.08, vibrato: 30 }),
};

export const sfx = new Sfx();
