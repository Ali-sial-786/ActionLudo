import { registerSounds } from './audio.js';

// Cute, cartoony synthesized sounds for Kids mode. Every sound receives the Sfx instance `s`
// (s.tone / s.noise, see audio.js) and an options object; `pitch` scales most of them so the same
// giggle can come from a tiny scorpion or a big bear.

const SOUNDS = {
  // Spring "boing": a rising, wobbling twang.
  boing: (s, { pitch = 1, delay = 0 } = {}) => {
    s.tone({ type: 'triangle', freq: 150 * pitch, to: 560 * pitch, dur: 0.38, vol: 0.26, vibrato: 45 * pitch, delay });
    s.tone({ type: 'sine', freq: 300 * pitch, to: 1100 * pitch, dur: 0.3, vol: 0.1, vibrato: 70 * pitch, delay });
  },
  // "Hee-hee-hee": quick high chirps with a little wobble.
  giggle: (s, { pitch = 1, delay = 0, n = 5 } = {}) => {
    for (let i = 0; i < n; i++) {
      const f = (880 + (i % 2) * 140 - i * 25) * pitch * (0.95 + Math.random() * 0.1);
      const d = delay + i * 0.095;
      s.tone({ type: 'triangle', freq: f * 1.08, to: f * 0.86, dur: 0.075, vol: 0.13, attack: 0.01, vibrato: 30, delay: d });
      s.tone({ type: 'sine', freq: f * 2.1, to: f * 1.7, dur: 0.06, vol: 0.035, delay: d });
    }
  },
  // Soft cartoon cloud "poof".
  poof: (s, { delay = 0 } = {}) => {
    s.noise({ dur: 0.4, vol: 0.32, filter: 'lowpass', freq: 2200, to: 260, attack: 0.012, delay });
    s.tone({ type: 'sine', freq: 420, to: 130, dur: 0.22, vol: 0.14, delay });
  },
  // "Yaaay!": a bright rising arpeggio that lands on a warbling top note.
  yay: (s, { delay = 0 } = {}) => {
    [523, 659, 784].forEach((f, i) => s.tone({ type: 'triangle', freq: f, dur: 0.12, vol: 0.13, delay: delay + i * 0.07 }));
    s.tone({ type: 'triangle', freq: 1046, to: 1175, dur: 0.5, vol: 0.13, vibrato: 14, delay: delay + 0.21 });
    s.tone({ type: 'sine', freq: 1568, dur: 0.4, vol: 0.05, vibrato: 18, delay: delay + 0.23 });
  },
  // Blub: a soap bubble forming / bubbles rising.
  bubble: (s, { delay = 0, n = 1 } = {}) => {
    for (let i = 0; i < n; i++) {
      const f = 380 + Math.random() * 380;
      s.tone({ type: 'sine', freq: f, to: f * 2.6, dur: 0.09, vol: 0.16, delay: delay + i * (0.07 + Math.random() * 0.06) });
    }
  },
  // Rubber-duck squeak.
  squeak: (s, { pitch = 1, delay = 0 } = {}) => {
    s.tone({ type: 'square', freq: 1250 * pitch, to: 1750 * pitch, dur: 0.07, vol: 0.05, vibrato: 60, delay });
    s.tone({ type: 'triangle', freq: 1700 * pitch, to: 1150 * pitch, dur: 0.12, vol: 0.13, vibrato: 50, delay: delay + 0.06 });
  },
  // "Ta-daaa!"
  tada: (s, { delay = 0 } = {}) => {
    s.tone({ type: 'square', freq: 784, dur: 0.1, vol: 0.06, delay });
    s.tone({ type: 'triangle', freq: 784, dur: 0.12, vol: 0.12, delay });
    [523, 659, 784, 1046].forEach((f) => {
      s.tone({ type: 'triangle', freq: f, dur: 0.75, vol: 0.09, vibrato: 6, delay: delay + 0.14, attack: 0.02 });
      s.tone({ type: 'square', freq: f, dur: 0.6, vol: 0.022, delay: delay + 0.14 });
    });
  },
  // Quick zip / zoom.
  zip: (s, { delay = 0, dur = 0.16 } = {}) => {
    s.noise({ dur, vol: 0.22, filter: 'bandpass', freq: 1300, to: 6500, q: 2.5, delay });
    s.tone({ type: 'sine', freq: 520, to: 2400, dur, vol: 0.09, delay });
  },
  // Fluttering feather tickle: feathery swishes with tiny twinkles.
  tickle: (s, { delay = 0 } = {}) => {
    for (let i = 0; i < 6; i++) {
      s.noise({ dur: 0.05, vol: 0.12, filter: 'highpass', freq: 4200 + Math.random() * 2500, q: 0.7, delay: delay + i * 0.05 });
      s.tone({ type: 'sine', freq: i % 2 ? 1900 : 1500, dur: 0.04, vol: 0.05, delay: delay + i * 0.05 });
    }
  },
  // Bright, bubbly (blue!) splash.
  splashKid: (s, { delay = 0, power = 1 } = {}) => {
    s.noise({ dur: 0.55, vol: 0.32 * power, filter: 'lowpass', freq: 3600, to: 420, attack: 0.01, delay });
    s.noise({ dur: 0.18, vol: 0.18 * power, filter: 'bandpass', freq: 1400, q: 1.2, delay: delay + 0.03 });
    for (let i = 0; i < 4; i++) {
      const f = 420 + Math.random() * 500;
      s.tone({ type: 'sine', freq: f, to: f * 2.2, dur: 0.08, vol: 0.1, delay: delay + 0.12 + i * 0.07 + Math.random() * 0.04 });
    }
  },
  // Bubble pop.
  bubblePop: (s, { delay = 0 } = {}) => {
    s.tone({ type: 'sine', freq: 1300, to: 260, dur: 0.07, vol: 0.2, delay });
    s.noise({ dur: 0.04, vol: 0.14, filter: 'highpass', freq: 3500, delay });
  },
  // Slide whistle up / down (the classic cartoon fall).
  slideUp: (s, { delay = 0, dur = 0.55 } = {}) => s.tone({ type: 'sine', freq: 420, to: 1700, dur, vol: 0.17, vibrato: 10, attack: 0.04, delay }),
  slideDown: (s, { delay = 0, dur = 0.7 } = {}) => s.tone({ type: 'sine', freq: 1700, to: 360, dur, vol: 0.17, vibrato: 10, attack: 0.04, delay }),
  // Wood-block bonk.
  bonk: (s, { delay = 0, pitch = 1 } = {}) => {
    s.tone({ type: 'triangle', freq: 820 * pitch, to: 560 * pitch, dur: 0.09, vol: 0.28, delay });
    s.tone({ type: 'sine', freq: 410 * pitch, to: 260 * pitch, dur: 0.14, vol: 0.2, delay });
    s.noise({ dur: 0.03, vol: 0.16, filter: 'bandpass', freq: 2400, q: 3, delay });
  },
  // Soft, round cartoon thump (no rumble).
  thump: (s, { delay = 0 } = {}) => {
    s.tone({ type: 'sine', freq: 180, to: 70, dur: 0.28, vol: 0.4, delay });
    s.noise({ dur: 0.16, vol: 0.18, freq: 700, to: 160, delay });
  },
  // Twinkly glints.
  twinkle: (s, { delay = 0 } = {}) => {
    [2093, 2637, 3136, 2637, 3520].forEach((f, i) => s.tone({ type: 'sine', freq: f, dur: 0.14, vol: 0.045, delay: delay + i * 0.05 }));
  },
  // Little cheep of a kid eagle.
  tweet: (s, { delay = 0, n = 2 } = {}) => {
    for (let i = 0; i < n; i++) s.tone({ type: 'sine', freq: 2100, to: 2900, dur: 0.07, vol: 0.12, vibrato: 90, delay: delay + i * 0.11 });
  },
  // Wing flaps.
  flap: (s, { delay = 0, n = 3 } = {}) => {
    for (let i = 0; i < n; i++) s.noise({ dur: 0.07, vol: 0.14, filter: 'lowpass', freq: 900, to: 300, delay: delay + i * 0.12 });
  },
  // Happy puppy howl "awoo!".
  awoo: (s, { delay = 0, pitch = 1 } = {}) => {
    s.tone({ type: 'triangle', freq: 520 * pitch, to: 820 * pitch, dur: 0.32, vol: 0.14, vibrato: 9, attack: 0.08, delay });
    s.tone({ type: 'triangle', freq: 820 * pitch, to: 600 * pitch, dur: 0.6, vol: 0.14, vibrato: 9, delay: delay + 0.3 });
    s.tone({ type: 'sine', freq: 1640 * pitch, to: 1200 * pitch, dur: 0.5, vol: 0.03, delay: delay + 0.3 });
  },
  // Puppy yip.
  yip: (s, { delay = 0, pitch = 1 } = {}) => {
    s.tone({ type: 'triangle', freq: 980 * pitch, to: 640 * pitch, dur: 0.08, vol: 0.16, delay });
    s.noise({ dur: 0.04, vol: 0.06, filter: 'bandpass', freq: 1800 * pitch, q: 2, delay });
  },
  // Bongo drum.
  bongo: (s, { delay = 0, pitch = 1 } = {}) => {
    s.tone({ type: 'sine', freq: 300 * pitch, to: 190 * pitch, dur: 0.14, vol: 0.32, delay });
    s.noise({ dur: 0.03, vol: 0.08, filter: 'bandpass', freq: 1500, q: 2, delay });
  },
  // "Aaah-CHOO!"
  achoo: (s, { delay = 0 } = {}) => {
    s.tone({ type: 'triangle', freq: 330, to: 560, dur: 0.38, vol: 0.12, vibrato: 8, attack: 0.1, delay });
    s.noise({ dur: 0.24, vol: 0.32, filter: 'bandpass', freq: 2600, to: 900, q: 0.8, delay: delay + 0.42 });
    s.tone({ type: 'triangle', freq: 620, to: 240, dur: 0.18, vol: 0.14, delay: delay + 0.42 });
  },
  // Warm "awww" (a hug).
  aww: (s, { delay = 0 } = {}) => {
    s.tone({ type: 'triangle', freq: 640, to: 470, dur: 0.6, vol: 0.12, vibrato: 7, attack: 0.08, delay });
    s.tone({ type: 'sine', freq: 960, to: 705, dur: 0.6, vol: 0.05, vibrato: 7, attack: 0.08, delay });
  },
  // Dizzy "wah-wah-wah".
  wobble: (s, { delay = 0, dur = 0.9 } = {}) => s.tone({ type: 'triangle', freq: 560, to: 260, dur, vol: 0.12, am: 7, vibrato: 25, delay }),
  // Spinning whirr.
  whirl: (s, { delay = 0, dur = 1.0 } = {}) => {
    s.tone({ type: 'triangle', freq: 260, to: 900, dur, vol: 0.12, am: 16, delay });
    s.noise({ dur, vol: 0.08, filter: 'bandpass', freq: 900, to: 2600, q: 3, delay });
  },
  // "Wheee!"
  whee: (s, { delay = 0, pitch = 1 } = {}) => s.tone({ type: 'sine', freq: 620 * pitch, to: 1500 * pitch, dur: 0.55, vol: 0.13, vibrato: 16, attack: 0.05, delay }),
  // Soft gummy munch (no crunch).
  munch: (s, { delay = 0 } = {}) => {
    s.tone({ type: 'sine', freq: 220, to: 140, dur: 0.16, vol: 0.28, delay });
    s.noise({ dur: 0.12, vol: 0.1, filter: 'lowpass', freq: 600, delay });
    s.tone({ type: 'sine', freq: 200, to: 130, dur: 0.14, vol: 0.2, delay: delay + 0.2 });
  },
  // "Ptooey!" spit.
  ptooey: (s, { delay = 0 } = {}) => {
    s.noise({ dur: 0.08, vol: 0.2, filter: 'bandpass', freq: 1800, q: 2, delay });
    s.tone({ type: 'triangle', freq: 500, to: 1300, dur: 0.22, vol: 0.13, delay: delay + 0.06 });
  },
  // Squishy squeeze.
  squish: (s, { delay = 0 } = {}) => {
    s.noise({ dur: 0.18, vol: 0.16, filter: 'bandpass', freq: 500, to: 260, q: 4, delay });
    s.tone({ type: 'sine', freq: 300, to: 200, dur: 0.15, vol: 0.12, delay });
  },
  // Little "rawr!" (playful, not scary).
  rawr: (s, { delay = 0, pitch = 1 } = {}) => {
    s.tone({ type: 'sawtooth', freq: 330 * pitch, to: 240 * pitch, dur: 0.32, vol: 0.06, am: 26, delay });
    s.tone({ type: 'triangle', freq: 330 * pitch, to: 250 * pitch, dur: 0.32, vol: 0.13, delay });
  },
  // Cute snort.
  snortKid: (s, { delay = 0 } = {}) => {
    s.noise({ dur: 0.16, vol: 0.18, filter: 'bandpass', freq: 700, to: 400, q: 2, delay });
    s.tone({ type: 'triangle', freq: 260, to: 200, dur: 0.12, vol: 0.06, delay });
  },
  // Tiptoe pizzicato steps.
  tiptoe: (s, { delay = 0, n = 4 } = {}) => {
    const notes = [392, 494, 392, 523, 440, 587];
    for (let i = 0; i < n; i++) s.tone({ type: 'triangle', freq: notes[i % notes.length], dur: 0.08, vol: 0.1, delay: delay + i * 0.17 });
  },
  // Snake-charmer-ish flute wiggle.
  flute: (s, { delay = 0 } = {}) => {
    [587, 659, 587, 523, 587, 698].forEach((f, i) => s.tone({ type: 'sine', freq: f, dur: 0.16, vol: 0.1, vibrato: 10, delay: delay + i * 0.14 }));
  },
  // Rising harp glissando (magic float).
  harp: (s, { delay = 0 } = {}) => {
    [523, 587, 659, 784, 880, 1046, 1175, 1318].forEach((f, i) => s.tone({ type: 'triangle', freq: f, dur: 0.35, vol: 0.06, delay: delay + i * 0.045 }));
  },
  // Little maraca rattle.
  rattle: (s, { delay = 0, n = 6 } = {}) => {
    for (let i = 0; i < n; i++) s.noise({ dur: 0.035, vol: 0.12, filter: 'highpass', freq: 5200, delay: delay + i * 0.06 });
  },
  // Big belly laugh "ha-ha-ha".
  laugh: (s, { delay = 0, pitch = 1 } = {}) => {
    for (let i = 0; i < 4; i++) {
      const f = (520 - i * 30) * pitch;
      s.tone({ type: 'triangle', freq: f * 1.2, to: f, dur: 0.11, vol: 0.14, vibrato: 12, delay: delay + i * 0.14 });
    }
  },
};

registerSounds(SOUNDS);

export const KID_SOUND_NAMES = Object.keys(SOUNDS);
