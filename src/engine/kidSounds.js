import { bell, brass, mallet, pluck, registerSounds, tick, voice, wood } from './audio.js';

// Cute, cartoony synthesized sounds for Kids mode. Every sound receives the Sfx instance `s`
// (s.tone / s.noise and the building blocks in audio.js) and an options object; `pitch` scales
// most of them so the same giggle can come from a tiny scorpion or a big bear.

const SOUNDS = {
  // Spring "boing": a rising, wobbling twang.
  boing: (s, { pitch = 1, delay = 0 } = {}) => {
    // a twanging spring through a resonant filter that opens and closes ("bwoing")
    s.tone({ type: 'triangle', freq: 150 * pitch, to: 520 * pitch, dur: 0.42, vol: 0.24, vibrato: 45 * pitch, vibRate: 16, delay, wet: 0.12 });
    s.tone({ type: 'sawtooth', freq: 150 * pitch, to: 520 * pitch, dur: 0.38, vol: 0.06, vibrato: 45 * pitch, vibRate: 16, delay, lpCurve: [[0, 300], [0.25, 2600 * pitch], [1, 500]], lpQ: 6 });
    s.tone({ freq: 300 * pitch, to: 1100 * pitch, dur: 0.3, vol: 0.07, vibrato: 70 * pitch, delay });
  },
  // "Hee-hee-hee": quick high chirps with a little wobble.
  giggle: (s, { pitch = 1, delay = 0, n = 5 } = {}) => {
    for (let i = 0; i < n; i++) {
      const f = (880 + (i % 2) * 140 - i * 25) * pitch * (0.95 + Math.random() * 0.1);
      const d = delay + i * 0.095;
      s.tone({ type: 'triangle', freq: f * 1.08, to: f * 0.86, dur: 0.075, vol: 0.11, attack: 0.01, vibrato: 30, delay: d });
      voice(s, { f: f * 0.5, to: f * 0.42, dur: 0.08, vol: 0.06, vowel: 'i', attack: 0.008, hold: 0.3, delay: d });
    }
  },
  // Soft cartoon cloud "poof".
  poof: (s, { delay = 0 } = {}) => {
    s.noise({ color: 'pink', dur: 0.42, vol: 0.27, filter: 'lowpass', freq: 2400, to: 240, attack: 0.012, delay, wet: 0.2 });
    s.tone({ freq: 420, to: 130, dur: 0.22, vol: 0.12, delay });
  },
  // "Yaaay!": a bright rising arpeggio that lands on a warbling top note.
  yay: (s, { delay = 0 } = {}) => {
    [523, 659, 784].forEach((f, i) => mallet(s, { f, vol: 0.1, dur: 0.25, delay: delay + i * 0.07 }));
    s.tone({ type: 'triangle', freq: 1046, to: 1175, dur: 0.5, vol: 0.11, vibrato: 14, vibRate: 7, delay: delay + 0.21 });
    // a little crowd of kids: "yaaay!"
    for (const [f, pan, d] of [
      [520, -0.4, 0.2],
      [600, 0.35, 0.23],
      [470, 0.05, 0.25],
    ]) {
      voice(s, { f, curve: [[0, f * 0.85], [0.25, f * 1.12], [1, f * 1.05]], dur: 0.62, vol: 0.045, vowel: 'ae', vowelTo: 'i', attack: 0.04, hold: 0.45, vibrato: 9, vibRate: 7, delay: delay + d, pan, wet: 0.2 }); // prettier-ignore
    }
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
    brass(s, { f: 784, dur: 0.12, vol: 0.08, delay });
    [523, 659, 784, 1046].forEach((f) => brass(s, { f, dur: 0.8, vol: 0.055, delay: delay + 0.14, wet: 0.25 }));
    [1568, 2093].forEach((f, i) => bell(s, { f, vol: 0.05, delay: delay + 0.16 + i * 0.05, dur: 0.9, wet: 0.3 }));
    s.noise({ dur: 0.9, vol: 0.07, filter: 'highpass', freq: 6500, attack: 0.003, delay: delay + 0.14, wet: 0.35 });
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
    s.noise({ color: 'pink', dur: 0.55, vol: 0.27 * power, filter: 'lowpass', freq: 3800, to: 420, attack: 0.01, delay, wet: 0.2 });
    s.noise({ dur: 0.18, vol: 0.16 * power, filter: 'bandpass', freq: 1400, q: 1.2, delay: delay + 0.03 });
    for (let i = 0; i < 5; i++) {
      const f = 420 + Math.random() * 500;
      s.tone({ freq: f, to: f * 2.2, dur: 0.08, vol: 0.09, delay: delay + 0.12 + i * 0.07 + Math.random() * 0.04, pan: Math.random() - 0.5 });
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
    wood(s, { f: 640 * pitch, vol: 0.3, dur: 0.12, delay, wet: 0.15 });
    s.tone({ freq: 410 * pitch, to: 260 * pitch, dur: 0.14, vol: 0.14, delay });
    tick(s, { f: 2400, vol: 0.12, q: 3, delay });
  },
  // Soft, round cartoon thump (no rumble).
  thump: (s, { delay = 0, soft = false } = {}) => {
    const v = soft ? 0.35 : 1;
    s.tone({ freq: 180, to: 70, dur: 0.28, vol: 0.4 * v, delay });
    s.noise({ color: 'pink', dur: 0.16, vol: 0.18 * v, freq: 700, to: 160, delay });
  },
  // Twinkly glints.
  twinkle: (s, { delay = 0 } = {}) => {
    [2093, 2637, 3136, 2637, 3520].forEach((f, i) => bell(s, { f, vol: 0.04, dur: 0.5, delay: delay + i * 0.05, pan: (i - 2) * 0.2, wet: 0.35 }));
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
    const curve = [
      [0, 520 * pitch],
      [0.35, 820 * pitch],
      [1, 600 * pitch],
    ];
    voice(s, { type: 'triangle', f: 520 * pitch, curve, dur: 0.9, vol: 0.022, vowel: 'a', vowelTo: 'u', attack: 0.08, hold: 0.5, vibrato: 9, delay, wet: 0.25 });
    s.tone({ type: 'triangle', freq: 520 * pitch, curve, dur: 0.9, vol: 0.035, vibrato: 9, vibRate: 5.5, attack: 0.08, hold: 0.5, delay, wet: 0.25 });
  },
  // Puppy yip.
  yip: (s, { delay = 0, pitch = 1 } = {}) => {
    s.tone({ type: 'triangle', freq: 980 * pitch, to: 640 * pitch, dur: 0.08, vol: 0.16, delay });
    s.noise({ dur: 0.04, vol: 0.06, filter: 'bandpass', freq: 1800 * pitch, q: 2, delay });
  },
  // Bongo drum.
  bongo: (s, { delay = 0, pitch = 1 } = {}) => {
    s.tone({ freq: 300 * pitch, to: 190 * pitch, dur: 0.16, vol: 0.32, delay, attack: 0.001, wet: 0.15 });
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
    voice(s, { f: 640, curve: [[0, 600], [0.3, 680], [1, 470]], dur: 0.7, vol: 0.03, vowel: 'a', vowelTo: 'o', attack: 0.08, hold: 0.4, vibrato: 7, delay, wet: 0.2 });
    s.tone({ type: 'triangle', freq: 640, to: 470, dur: 0.6, vol: 0.07, vibrato: 7, vibRate: 5.5, attack: 0.08, delay });
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
    voice(s, { f: 300 * pitch, curve: [[0, 280 * pitch], [0.3, 340 * pitch], [1, 230 * pitch]], dur: 0.36, vol: 0.075, vowel: 'a', vowelTo: 'o', am: 26, amDepth: 0.25, attack: 0.02, hold: 0.4, delay }); // prettier-ignore
    s.tone({ type: 'triangle', freq: 330 * pitch, to: 250 * pitch, dur: 0.32, vol: 0.08, delay });
  },
  // Cute snort.
  snortKid: (s, { delay = 0 } = {}) => {
    s.noise({ dur: 0.16, vol: 0.18, filter: 'bandpass', freq: 700, to: 400, q: 2, delay });
    s.tone({ type: 'triangle', freq: 260, to: 200, dur: 0.12, vol: 0.06, delay });
  },
  // Tiptoe pizzicato steps.
  tiptoe: (s, { delay = 0, n = 4 } = {}) => {
    const notes = [392, 494, 392, 523, 440, 587];
    for (let i = 0; i < n; i++) pluck(s, { f: notes[i % notes.length], vol: 0.11, dur: 0.25, delay: delay + i * 0.17 });
  },
  // Snake-charmer-ish flute wiggle.
  flute: (s, { delay = 0 } = {}) => {
    [587, 659, 587, 523, 587, 698].forEach((f, i) => {
      s.tone({ freq: f, dur: 0.17, vol: 0.055, vibrato: 8, vibRate: 6, attack: 0.03, hold: 0.5, delay: delay + i * 0.14, wet: 0.25 });
      s.noise({ dur: 0.12, vol: 0.02, filter: 'bandpass', freq: f * 2, q: 4, delay: delay + i * 0.14 });
    });
  },
  // Rising harp glissando (magic float).
  harp: (s, { delay = 0 } = {}) => {
    [523, 587, 659, 784, 880, 1046, 1175, 1318].forEach((f, i) => pluck(s, { f, vol: 0.07, dur: 0.7, delay: delay + i * 0.045, pan: -0.5 + i * 0.14, wet: 0.35 }));
  },
  // Little maraca rattle.
  rattle: (s, { delay = 0, n = 6 } = {}) => {
    for (let i = 0; i < n; i++) s.noise({ dur: 0.035, vol: 0.12, filter: 'highpass', freq: 5200, delay: delay + i * 0.06 });
  },
  // Big belly laugh "ha-ha-ha".
  laugh: (s, { delay = 0, pitch = 1 } = {}) => {
    for (let i = 0; i < 4; i++) {
      const f = (520 - i * 30) * pitch;
      s.tone({ type: 'triangle', freq: f * 1.2, to: f, dur: 0.11, vol: 0.1, vibrato: 12, delay: delay + i * 0.14 });
      voice(s, { f: f * 0.5, to: f * 0.44, dur: 0.12, vol: 0.08, vowel: 'a', attack: 0.01, hold: 0.3, delay: delay + i * 0.14 });
    }
  },
};

registerSounds(SOUNDS);

export const KID_SOUND_NAMES = Object.keys(SOUNDS);
