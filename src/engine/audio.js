// Procedural sound effects built on WebAudio. No assets required.
//
// Every voice runs through one bus: an optional per-voice drive (waveshaper) and stereo position,
// a reverb send (a generated room: a dark stone hall for Action, a small bright room for Kids),
// then a gentle compressor and the master volume. A quiet ambience loop (a night jungle, or a
// sunny garden) plays underneath.

const VOLUME = 0.7;

const MODES = {
  action: { wet: 0.2, room: { len: 2.6, decay: 2.2, damp: 0.82, pre: 0.022 }, ambience: 0.55 },
  kids: { wet: 0.13, room: { len: 1.0, decay: 0.75, damp: 0.3, pre: 0.008 }, ambience: 0.8 },
};

// Small seeded generator, so building buffers never draws on Math.random (the game's dice and AI
// may be replayed from a seed).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Two seconds of white, pink or brown noise, each scaled to the loudness of uniform white noise.
function noiseBuffer(ctx, color, rand) {
  const n = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0; // prettier-ignore
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1;
    if (color === 'pink') {
      // Paul Kellet's pink filter
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else if (color === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last;
    } else d[i] = w;
  }
  // remove any DC offset and match white noise's RMS (1/sqrt(3))
  let mean = 0;
  for (let i = 0; i < n; i++) mean += d[i];
  mean /= n;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += (d[i] - mean) ** 2;
  const k = 0.577 / Math.sqrt(sq / n || 1);
  for (let i = 0; i < n; i++) d[i] = (d[i] - mean) * k;
  return buf;
}

// A stereo room impulse response: a few early reflections, then a noise tail that decays and
// darkens over `decay` seconds (-60 dB).
function roomImpulse(ctx, { len, decay, damp, pre }, rand) {
  const sr = ctx.sampleRate;
  const n = Math.floor(len * sr);
  const p = Math.floor(pre * sr);
  const buf = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let y = 0;
    for (let i = p; i < n; i++) {
      const t = (i - p) / sr;
      const a = Math.max(0.05, 1 - damp * (0.25 + 0.75 * Math.min(1, t / decay)));
      y += a * (rand() * 2 - 1 - y);
      d[i] = y * Math.pow(10, (-3 * t) / decay) * Math.min(1, t / 0.004);
    }
    for (let e = 0; e < 7; e++) {
      const at = p + Math.floor((0.006 + rand() * 0.07) * sr);
      if (at < n) d[at] += (rand() < 0.5 ? -1 : 1) * (0.25 + rand() * 0.5) * (1 - e / 9);
    }
  }
  return buf;
}

// Builds a seamless stereo loop: `bed(i, t)` returns continuous [left, right] samples (the loop's
// head is cross-faded with its tail), and `events(add)` places one-off sounds, wrapped around.
function makeLoop(ctx, seconds, bed, events) {
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const fade = Math.floor(1.5 * sr);
  const buf = ctx.createBuffer(2, n, sr);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  for (let i = 0; i < n + fade; i++) {
    const [l, r] = bed(i / sr);
    if (i < n) {
      const k = i < fade ? Math.sqrt(i / fade) : 1;
      L[i] += l * k;
      R[i] += r * k;
    } else {
      const k = Math.sqrt(1 - (i - n) / fade);
      L[i - n] += l * k;
      R[i - n] += r * k;
    }
  }
  // add(at, len, fn, pan): fn(t) gives a mono sample at t seconds into the event
  events((at, len, fn, pan = 0) => {
    const start = Math.floor(at * sr);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = Math.sin(((pan + 1) * Math.PI) / 4);
    for (let j = 0, m = Math.floor(len * sr); j < m; j++) {
      const v = fn(j / sr);
      const i = (start + j) % n;
      L[i] += v * gl;
      R[i] += v * gr;
    }
  });
  return buf;
}

// Action: a warm night outdoors. Wind through the trees, crickets, the torches' crackle and a
// low, uneasy drone.
function nightAmbience(ctx, rand) {
  const S = 12;
  const tau = Math.PI * 2;
  const lr = [0, 0].map(() => ({ lo: 0, lo2: 0, hi: 0, hb: 0, hi2: 0 }));
  return makeLoop(
    ctx,
    S,
    (t) => {
      // gusts swell and fade (periodic in S, so the loop is seamless)
      const gust = 0.55 + 0.3 * Math.sin((tau * t) / S + 1.2) + 0.15 * Math.sin((tau * 3 * t) / S);
      const drone = 0.006 * Math.sin(tau * 49 * t) * (0.6 + 0.4 * Math.sin((tau * t) / S)) + 0.004 * Math.sin(tau * 73.5 * t);
      return lr.map((c) => {
        const w = rand() * 2 - 1;
        // wind: a low band of noise whose top opens with the gust...
        c.lo += (0.012 + 0.03 * gust) * (w - c.lo);
        c.lo2 += 0.004 * (c.lo - c.lo2);
        // ...and leaves rustling in the trees (a band of a few hundred Hz to ~2 kHz)
        c.hi += 0.2 * (w - c.hi);
        c.hb += 0.2 * (c.hi - c.hb);
        c.hi2 += 0.04 * (c.hb - c.hi2);
        return (c.lo - c.lo2) * 0.5 * gust + (c.hb - c.hi2) * 0.05 * gust * gust + drone;
      });
    },
    (add) => {
      // two crickets, each chirping in bursts of three pulses
      for (const [f, pan, every] of [
        [4400, -0.65, 0.78],
        [5150, 0.55, 1.05],
      ]) {
        for (let at = rand() * every; at < S; at += every * (0.85 + rand() * 0.3)) {
          if (rand() < 0.18) at += 1.5 + rand() * 2; // a pause now and then
          const vol = 0.035 + rand() * 0.015;
          add(at, 0.11, (t) => {
            const pulse = Math.floor(t / 0.032);
            const u = t - pulse * 0.032;
            return pulse < 3 && u < 0.018 ? vol * Math.sin(tau * f * t) * Math.sin((Math.PI * u) / 0.018) : 0;
          }, pan);
        }
      }
      // torch crackle: short dry ticks, the odd bigger pop
      for (let at = 0; at < S; at += rand() * 0.35) {
        const big = rand() < 0.08;
        const vol = big ? 0.07 + rand() * 0.05 : 0.012 + rand() * 0.03;
        const decay = big ? 0.006 : 0.0015 + rand() * 0.002;
        const pan = rand() * 1.6 - 0.8;
        let prev = 0;
        add(at, decay * 6, (t) => {
          const x = rand() * 2 - 1;
          const hp = x - prev; // crude highpass keeps it crisp
          prev = x;
          return hp * vol * Math.exp(-t / decay);
        }, pan);
      }
    },
  );
}

// Kids: a sunny garden. A soft breeze and little birds.
function dayAmbience(ctx, rand) {
  const S = 12;
  const tau = Math.PI * 2;
  let bl = 0, br = 0; // prettier-ignore
  return makeLoop(
    ctx,
    S,
    (t) => {
      const swell = 0.6 + 0.4 * Math.sin((tau * t) / S + 0.5);
      bl += 0.035 * (rand() * 2 - 1 - bl);
      br += 0.035 * (rand() * 2 - 1 - br);
      return [bl * 0.11 * swell, br * 0.11 * swell];
    },
    (add) => {
      // a little songbird phrase every couple of seconds, each from somewhere else
      for (let at = 0.4 + rand(); at < S - 0.5; at += 1.4 + rand() * 2.2) {
        const pan = rand() * 1.6 - 0.8;
        const kind = Math.floor(rand() * 3);
        const vol = 0.035 + rand() * 0.025;
        if (kind === 0) {
          // "tee-oo" whistle
          for (const [off, f0, f1, len] of [
            [0, 3000, 3500, 0.12],
            [0.16, 2700, 2100, 0.18],
          ]) {
            let ph = 0;
            add(at + off, len, (t) => {
              ph += (tau * (f0 + (f1 - f0) * (t / len))) / ctx.sampleRate;
              return vol * Math.sin(ph) * Math.sin((Math.PI * t) / len);
            }, pan);
          }
        } else if (kind === 1) {
          // a quick trill
          const f = 3800 + rand() * 900;
          const notes = 5 + Math.floor(rand() * 5);
          for (let k = 0; k < notes; k++) {
            add(at + k * 0.05, 0.035, (t) => vol * 0.8 * Math.sin(tau * f * t * (1 + t * 3)) * Math.sin((Math.PI * t) / 0.035), pan);
          }
        } else {
          // chirp-chirp
          for (let k = 0; k < 2 + Math.floor(rand() * 2); k++) {
            const f = 2200 + rand() * 600;
            let ph = 0;
            add(at + k * 0.14, 0.07, (t) => {
              ph += (tau * f * (1 + (t / 0.07) * 0.6)) / ctx.sampleRate;
              return vol * Math.sin(ph) * Math.sin((Math.PI * t) / 0.07);
            }, pan);
          }
        }
      }
    },
  );
}

class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.mode = 'action';
    this.ambienceOn = true;
    this.basePan = 0;
  }

  get kids() {
    return this.mode === 'kids';
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.attach(new AC({ latencyHint: 'interactive' }));
      // hearing the jungle from a background tab would be odd
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.ctx.suspend?.();
        else this.ctx.resume?.();
      });
      setTimeout(() => this.updateAmbience(), 50);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // Builds the bus on a context (a live AudioContext, or an OfflineAudioContext to render to file).
  attach(ctx) {
    this.ctx = ctx;
    const rand = mulberry32(0x5eed);
    this.noiseBuffers = { white: noiseBuffer(ctx, 'white', rand), pink: noiseBuffer(ctx, 'pink', rand), brown: noiseBuffer(ctx, 'brown', rand) };
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : VOLUME;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    comp.connect(this.master).connect(ctx.destination);
    this.bus = ctx.createGain();
    this.bus.connect(comp);
    this.verbIn = ctx.createGain();
    this.verbs = {};
    this.verbFor = (mode) => {
      if (!this.verbs[mode]) {
        const conv = ctx.createConvolver();
        conv.buffer = roomImpulse(ctx, MODES[mode].room, mulberry32(mode === 'kids' ? 11 : 7));
        conv.connect(comp);
        this.verbs[mode] = conv;
      }
      return this.verbs[mode];
    };
    this.verbIn.connect(this.verbFor(this.mode));
    this.ambBuffers = {};
    this.amb = null;
  }

  setMode(mode) {
    const next = mode === 'kids' ? 'kids' : 'action';
    if (next === this.mode) return;
    this.mode = next;
    if (!this.ctx) return;
    this.verbIn.disconnect();
    this.verbIn.connect(this.verbFor(next));
    this.updateAmbience();
  }

  setAmbience(on) {
    this.ambienceOn = on;
    this.updateAmbience();
  }

  // Cross-fades to the current mode's ambience loop (or to silence).
  updateAmbience() {
    const ctx = this.ctx;
    if (!ctx || !this.bus) return;
    const want = this.ambienceOn ? this.mode : null;
    if ((this.amb?.mode ?? null) === want) return;
    const t = ctx.currentTime;
    if (this.amb) {
      const { src, gain } = this.amb;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 1.2);
      src.stop(t + 1.3);
      this.amb = null;
    }
    if (!want) return;
    this.ambBuffers[want] ??= (want === 'kids' ? dayAmbience : nightAmbience)(ctx, mulberry32(want === 'kids' ? 23 : 29));
    const src = ctx.createBufferSource();
    src.buffer = this.ambBuffers[want];
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(MODES[want].ambience, t + 2.5);
    src.connect(gain).connect(this.bus);
    src.start(t);
    this.amb = { mode: want, src, gain };
  }

  setMuted(m) {
    this.muted = m;
    if (!this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : VOLUME, t, 0.03);
  }

  get ready() {
    return this.ctx && !this.muted;
  }

  curve(amount) {
    this.curves ??= new Map();
    if (!this.curves.has(amount)) {
      const n = 1024;
      const c = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        c[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
      }
      this.curves.set(amount, c);
    }
    return this.curves.get(amount);
  }

  // Sets a parameter's start value, then glides to `to` (or through `points`: [[fraction of dur, value], ...]).
  glide(param, t0, dur, start, to, points) {
    if (points) {
      param.setValueAtTime(points[0][0] === 0 ? points[0][1] : start, t0);
      for (const [k, v] of points) if (k > 0) param.exponentialRampToValueAtTime(Math.max(1, v), t0 + k * dur);
    } else {
      param.setValueAtTime(start, t0);
      if (to) param.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    }
  }

  // The voice's gain: an exponential attack to `vol`, an optional hold (a fraction of the
  // duration), then a decay to silence at t0 + dur.
  envelope(gain, t0, { vol, attack, hold, dur }) {
    const v = Math.max(0.0002, vol);
    const a = Math.min(attack, dur * 0.9);
    gain.setValueAtTime(0.0001, t0);
    gain.exponentialRampToValueAtTime(v, t0 + a);
    if (hold > 0) gain.setValueAtTime(v, t0 + a + hold * (dur - a));
    gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  // Sends a voice to the bus: optional drive, amplitude flutter, stereo position and reverb send.
  route(node, t0, end, { dur, dist = 0, pan = 0, panTo = null, wet = null, am = 0, amDepth = 0.5 }) {
    const ctx = this.ctx;
    let n = node;
    if (am) {
      const trem = ctx.createGain();
      trem.gain.value = 1 - amDepth;
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = am;
      depth.gain.value = amDepth;
      lfo.connect(depth).connect(trem.gain);
      lfo.start(t0);
      lfo.stop(end);
      n = n.connect(trem);
    }
    if (dist) {
      const ws = ctx.createWaveShaper();
      ws.curve = this.curve(dist);
      n = n.connect(ws);
    }
    const p0 = clamp(this.basePan + pan, -1, 1);
    if ((p0 || panTo !== null) && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(p0, t0);
      if (panTo !== null) p.pan.linearRampToValueAtTime(clamp(this.basePan + panTo, -1, 1), t0 + dur);
      n = n.connect(p);
    }
    n.connect(this.bus);
    const w = wet ?? MODES[this.mode].wet;
    if (w > 0) {
      const send = ctx.createGain();
      send.gain.value = w;
      n.connect(send).connect(this.verbIn);
    }
  }

  /**
   * An oscillator voice. Beyond the basics (type, freq → to, dur, vol, delay, attack):
   *   curve       [[k, Hz], ...] pitch path instead of `to` (k is a fraction of dur)
   *   hold        fraction of dur to sustain before the decay
   *   vibrato     pitch wobble depth in Hz, at vibRate Hz
   *   am          amplitude flutter rate in Hz (a growl's rattle), amDepth 0..0.5
   *   detune      cents: adds detuned copies for a thicker, chorused sound
   *   lp, lpTo / lpCurve, lpQ, ftype   a filter on the voice (lowpass unless ftype says otherwise)
   *   fm, fmRatio, fmTo   frequency modulation index (bells, metal) and its end value
   *   formants    [[Hz, Q, gain], ...] parallel band-passes that shape a voice into a vowel;
   *               formantsTo glides their frequencies
   *   dist, pan, panTo, wet   drive, stereo position and reverb send (see route)
   */
  tone(o) {
    if (!this.ready) return;
    const { type = 'sine', freq = 440, to = null, curve = null, dur = 0.2, vol = 0.3, delay = 0, attack = 0.005, hold = 0 } = o;
    const { vibrato = 0, vibRate = 18, detune = 0, lp = 0, lpTo = null, lpCurve = null, lpQ = 0.7, ftype = 'lowpass' } = o;
    const { fm = 0, fmRatio = 2, fmTo = null, formants = null, formantsTo = null } = o;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + Math.max(0, delay);
    const end = t0 + dur + 0.05;
    const voices = detune ? 3 : 1;
    const sum = ctx.createGain();
    sum.gain.value = 1 / Math.sqrt(voices);
    const oscs = [];
    for (let v = 0; v < voices; v++) {
      const osc = ctx.createOscillator();
      osc.type = type;
      this.glide(osc.frequency, t0, dur, freq, to, curve);
      if (voices > 1) osc.detune.value = (v - 1) * detune;
      osc.connect(sum);
      oscs.push(osc);
    }
    const mods = [];
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = vibRate;
      lg.gain.value = vibrato;
      lfo.connect(lg);
      for (const osc of oscs) lg.connect(osc.frequency);
      mods.push(lfo);
    }
    if (fm) {
      const mod = ctx.createOscillator();
      const mg = ctx.createGain();
      this.glide(mod.frequency, t0, dur, freq * fmRatio, to && to * fmRatio, curve && curve.map(([k, v]) => [k, v * fmRatio]));
      mg.gain.setValueAtTime(fm * freq * fmRatio, t0);
      mg.gain.exponentialRampToValueAtTime(Math.max(0.001, (fmTo ?? fm * 0.05) * (to ?? freq) * fmRatio), t0 + dur);
      mod.connect(mg);
      for (const osc of oscs) mg.connect(osc.frequency);
      mods.push(mod);
    }
    const env = ctx.createGain();
    this.envelope(env.gain, t0, { vol: o.vol ?? vol, attack, hold, dur });
    if (formants) {
      formants.forEach(([f, q, g], i) => {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = q;
        bp.frequency.setValueAtTime(f, t0);
        if (formantsTo?.[i]) bp.frequency.exponentialRampToValueAtTime(formantsTo[i][0], t0 + dur);
        const fg = ctx.createGain();
        fg.gain.value = g * 4;
        sum.connect(bp).connect(fg).connect(env);
      });
    } else if (lp || lpCurve) {
      const f = ctx.createBiquadFilter();
      f.type = ftype;
      f.Q.value = lpQ;
      this.glide(f.frequency, t0, dur, lp, lpTo, lpCurve);
      sum.connect(f).connect(env);
    } else sum.connect(env);
    this.route(env, t0, end, o);
    for (const n of [...oscs, ...mods]) {
      n.start(t0);
      n.stop(end);
    }
  }

  /**
   * A filtered noise voice: dur, vol, filter type (or null), freq → to (or curve), q, delay,
   * attack, hold, color ('white' | 'pink' | 'brown'), rate (playback speed), plus the routing
   * options of tone().
   */
  noise(o) {
    if (!this.ready) return;
    const { dur = 0.2, vol = 0.3, filter = 'lowpass', freq = 1200, to = null, curve = null, q = 1, delay = 0, attack = 0.005, hold = 0 } = o;
    const { color = 'white', rate = 1 } = o;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + Math.max(0, delay);
    const end = t0 + dur + 0.05;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffers[color] ?? this.noiseBuffers.white;
    src.loop = true;
    src.playbackRate.value = rate;
    const env = ctx.createGain();
    this.envelope(env.gain, t0, { vol, attack, hold, dur });
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter;
      f.Q.value = q;
      this.glide(f.frequency, t0, dur, freq, to, curve);
      src.connect(f).connect(env);
    } else src.connect(env);
    this.route(env, t0, end, o);
    src.start(t0, Math.random() * 1.5);
    src.stop(end);
  }

  get names() {
    return Object.keys(SOUNDS);
  }

  // opt.pan places the whole sound in the stereo field (-1 left … 1 right).
  play(name, opt = {}) {
    if (!this.ready) return;
    const fn = SOUNDS[name];
    if (!fn) return;
    this.basePan = clamp(opt.pan ?? 0, -1, 1);
    try {
      fn(this, opt);
    } finally {
      this.basePan = 0;
    }
  }
}

// ------------------------------------------------------------------ building blocks

const rnd = (a, b) => a + Math.random() * (b - a);

// Vowel formants for voiced sounds: [Hz, Q, gain].
export const VOWELS = {
  a: [[780, 5, 1], [1200, 6, 0.55], [2600, 8, 0.18]],
  o: [[520, 5, 1], [880, 6, 0.5], [2500, 8, 0.12]],
  u: [[340, 5, 1], [780, 6, 0.35], [2300, 8, 0.08]],
  e: [[480, 5, 1], [1900, 8, 0.5], [2600, 9, 0.2]],
  i: [[300, 5, 1], [2300, 9, 0.45], [3000, 10, 0.18]],
  ae: [[680, 5, 1], [1750, 7, 0.55], [2500, 9, 0.2]],
};

// A short bright tick of something hard (dice, claws, teeth, a latch).
export function tick(s, { f = 3000, vol = 0.2, delay = 0, pan = 0, q = 5, dur = 0.03, wet } = {}) {
  s.noise({ dur, vol, filter: 'bandpass', freq: f, q, delay, pan, attack: 0.001, wet });
}

// Struck wood: a few inharmonic partials with quick decays.
export function wood(s, { f = 220, vol = 0.3, delay = 0, pan = 0, dur = 0.12, bright = 1, wet } = {}) {
  s.tone({ freq: f, to: f * 0.94, dur, vol, delay, pan, attack: 0.001, wet });
  s.tone({ freq: f * 2.32, dur: dur * 0.5, vol: vol * 0.32 * bright, delay, pan, attack: 0.001, wet });
  s.tone({ freq: f * 4.15, dur: dur * 0.28, vol: vol * 0.16 * bright, delay, pan, attack: 0.001, wet });
}

// Struck metal: frequency modulation at an inharmonic ratio gives a clangy spectrum.
export function metal(s, { f = 600, vol = 0.15, delay = 0, pan = 0, dur = 0.4, ratio = 1.41, index = 3, wet } = {}) {
  s.tone({ freq: f, dur, vol, delay, pan, attack: 0.001, fm: index, fmRatio: ratio, fmTo: index * 0.06, wet });
}

// A bell / glockenspiel note.
export function bell(s, { f = 1046, vol = 0.1, delay = 0, pan = 0, dur = 0.9, wet, bright = 1 } = {}) {
  s.tone({ freq: f, dur, vol, delay, pan, attack: 0.002, fm: 1.2 * bright, fmRatio: 3.5, fmTo: 0.02, wet });
  s.tone({ freq: f * 2.76, dur: dur * 0.3, vol: vol * 0.18 * bright, delay, pan, attack: 0.001, wet });
}

// A mallet note (marimba / xylophone): a soft, woody pitched knock.
export function mallet(s, { f = 523, vol = 0.12, delay = 0, pan = 0, dur = 0.35, wet } = {}) {
  s.tone({ freq: f, dur, vol, delay, pan, attack: 0.002, fm: 0.9, fmRatio: 4, fmTo: 0.01, wet });
  s.tone({ freq: f * 3.9, dur: dur * 0.18, vol: vol * 0.2, delay, pan, attack: 0.001, wet });
}

// A brass note: detuned saws through a lowpass that opens on the attack.
export function brass(s, { f, dur = 0.3, vol = 0.08, delay = 0, pan = 0, bright = 1, wet } = {}) {
  s.tone({
    type: 'sawtooth', freq: f, dur, vol, delay, pan, attack: 0.025, hold: 0.6, detune: 8, wet,
    lp: f * 1.2, lpCurve: [[0, f * 1.2], [0.15, Math.min(9000, f * 6 * bright)], [1, f * 1.6]], lpQ: 1.2,
  }); // prettier-ignore
}

// A plucked string (harp, pizzicato).
export function pluck(s, { f = 440, vol = 0.1, delay = 0, pan = 0, dur = 0.6, wet } = {}) {
  s.tone({ type: 'triangle', freq: f, dur, vol, delay, pan, attack: 0.002, lp: f * 8, lpTo: f * 1.5, wet });
  s.tone({ freq: f * 2, dur: dur * 0.35, vol: vol * 0.3, delay, pan, attack: 0.002, wet });
}

// A vowel sung or growled on a sawtooth (or a buzzier square) through formant filters.
export function voice(s, { f = 220, to, curve, dur = 0.4, vol = 0.12, vowel = 'a', vowelTo, delay = 0, pan = 0, attack = 0.03, hold = 0.5, vibrato = 0, vibRate = 5.5, am = 0, amDepth = 0.4, dist = 0, detune = 0, wet, type = 'sawtooth' } = {}) {
  s.tone({ type, freq: f, to, curve, dur, vol, delay, pan, attack, hold, vibrato, vibRate, am, amDepth, dist, detune, wet, formants: VOWELS[vowel], formantsTo: vowelTo && VOWELS[vowelTo] });
}

// A soft padded footfall on wood.
function paw(s, { vol = 0.2, delay = 0, pan = 0, low = 1 } = {}) {
  s.noise({ color: 'brown', dur: 0.09, vol: vol * 1.6, filter: 'lowpass', freq: 520, to: 150, delay, pan, attack: 0.002, wet: 0.08 });
  s.tone({ freq: 100 * low * rnd(0.9, 1.1), to: 52 * low, dur: 0.08, vol: vol * 0.8, delay, pan, attack: 0.002, wet: 0.05 });
  s.noise({ color: 'pink', dur: 0.035, vol: vol * 0.2, filter: 'bandpass', freq: rnd(1800, 2600), q: 1.4, delay, pan, wet: 0.05 });
}

// Wet flesh: a resonant band of noise sweeping up (or down), with a little body.
function wetSlap(s, { delay = 0, vol = 0.35, f = 380, toF = 1000, dur = 0.18, pan = 0 } = {}) {
  s.noise({ dur, vol, filter: 'bandpass', freq: f, to: toF, q: 7, delay, pan, attack: 0.004 });
  s.noise({ color: 'brown', dur: dur * 0.7, vol: vol * 0.8, filter: 'lowpass', freq: 700, to: 200, delay, pan });
}

// Pentatonic scale for pitched game feedback.
const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093];

// ------------------------------------------------------------------ the sounds

const SOUNDS = {
  click: (s) => {
    if (s.kids) return mallet(s, { f: 1318, vol: 0.09, dur: 0.18 });
    wood(s, { f: 1250, vol: 0.12, dur: 0.05, bright: 0.6, wet: 0.08 });
    tick(s, { f: 3800, vol: 0.06, dur: 0.015 });
  },

  // ------------------------------------------------ dice
  // the die scooped up into the hand
  diceShake: (s) => {
    for (let i = 0; i < 4; i++) SOUNDS.diceRattle(s, { power: 1 - i * 0.12, delay: i * 0.055 });
  },
  // one clack of the die rattling in a closed hand
  diceRattle: (s, { power = 0.5, delay = 0 } = {}) => {
    const f = rnd(2600, 4200);
    s.tone({ freq: f, dur: 0.025, vol: 0.05 * power, delay, attack: 0.001, wet: 0.04 });
    tick(s, { f: f * 0.8, vol: 0.2 * power, q: 4, dur: 0.025, delay, wet: 0.04 });
    if (Math.random() < 0.5) tick(s, { f: rnd(3000, 4800), vol: 0.12 * power, q: 5, dur: 0.02, delay: delay + rnd(0.015, 0.03), wet: 0.04 });
  },
  // the die hitting the tray's floor
  diceHit: (s, { power = 1 } = {}) => {
    const p = Math.max(0.15, power);
    wood(s, { f: rnd(190, 250), vol: 0.22 * p, dur: 0.09 + 0.05 * p, bright: 0.7 + 0.5 * p, wet: 0.12 });
    tick(s, { f: rnd(2200, 3400), vol: 0.14 * p, q: 3, dur: 0.02 + 0.015 * p });
    if (s.kids) s.tone({ freq: rnd(900, 1300), dur: 0.05, vol: 0.03 * p, attack: 0.001 });
  },
  // the die knocking against the tray's wooden wall: hollower, higher
  diceWall: (s, { power = 1 } = {}) => {
    const p = Math.max(0.15, power);
    wood(s, { f: rnd(300, 360), vol: 0.32 * p, dur: 0.13, bright: 0.9, wet: 0.14 });
    s.noise({ dur: 0.05, vol: 0.18 * p, filter: 'bandpass', freq: rnd(900, 1200), q: 3, attack: 0.001 });
    tick(s, { f: 3200, vol: 0.12 * p, dur: 0.015 });
  },
  // the die comes to rest: a pitched knock that rises with the number
  diceSettle: (s, { value = 1 } = {}) => {
    const f = PENTA[value + 1] / (s.kids ? 1 : 2);
    if (s.kids) mallet(s, { f, vol: 0.08, dur: 0.4, wet: 0.2 });
    else {
      mallet(s, { f, vol: 0.075, dur: 0.45, wet: 0.25 });
      wood(s, { f: 170, vol: 0.07, dur: 0.08 });
    }
  },
  diceSix: (s) => {
    if (s.kids) {
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) => bell(s, { f, vol: 0.075, delay: i * 0.07, dur: 0.9, wet: 0.3, pan: -0.4 + i * 0.27 }));
      SOUNDS.sparkle(s, { delay: 0.25 });
      return;
    }
    // a war drum, then a rising bronze arpeggio
    SOUNDS.drum(s, { power: 0.75 });
    [329.6, 415.3, 493.9, 659.3].forEach((f, i) => bell(s, { f, vol: 0.065, delay: 0.06 + i * 0.075, dur: 1.4, wet: 0.4, bright: 0.8, pan: -0.3 + i * 0.2 }));
    s.noise({ dur: 0.9, vol: 0.06, filter: 'highpass', freq: 6000, attack: 0.25, delay: 0.1, wet: 0.5 });
  },

  // ------------------------------------------------ moving
  // each hop of a piece along the track
  hop: (s, { step = 0 } = {}) => {
    if (s.kids) {
      mallet(s, { f: PENTA[step % PENTA.length], vol: 0.08, dur: 0.28, wet: 0.15 });
      s.tone({ freq: PENTA[step % PENTA.length] / 2, to: PENTA[step % PENTA.length] * 0.75, dur: 0.07, vol: 0.04 });
      return;
    }
    paw(s, { vol: 0.085 + Math.min(step, 5) * 0.003 });
    s.noise({ color: 'pink', dur: 0.12, vol: 0.02, filter: 'bandpass', freq: 900, to: 1800, q: 1, attack: 0.05 });
  },
  land: (s) => {
    if (s.kids) return SOUNDS.thump(s, { soft: true, delay: 0 });
    paw(s, { vol: 0.12, low: 0.85 });
    // a scuff of dust
    s.noise({ color: 'pink', dur: 0.2, vol: 0.035, filter: 'bandpass', freq: 1500, to: 600, q: 0.8, delay: 0.015, wet: 0.15 });
  },
  whoosh: (s, { dur = 0.4, delay = 0 } = {}) => {
    const dir = Math.random() < 0.5 ? -1 : 1;
    s.noise({ color: 'pink', dur, vol: 0.32, filter: 'bandpass', freq: 300, to: 2200, q: 1.3, attack: dur * 0.6, delay, pan: -0.5 * dir, panTo: 0.5 * dir });
    s.noise({ dur: dur * 0.9, vol: 0.08, filter: 'bandpass', freq: 1800, to: 5200, q: 2, attack: dur * 0.65, delay, pan: -0.4 * dir, panTo: 0.4 * dir });
  },

  // ------------------------------------------------ the clash mini-game
  // one shove; each side has its own pitch and side of the stereo field
  clash: (s, { side = 1, power = 1 } = {}) => {
    const pan = -0.4 * side;
    if (s.kids) {
      const f = side > 0 ? 330 : 262;
      s.tone({ type: 'triangle', freq: f * rnd(0.96, 1.04), to: f * 1.6, dur: 0.1, vol: 0.22 * power, pan, wet: 0.1 });
      s.noise({ dur: 0.03, vol: 0.08 * power, filter: 'bandpass', freq: 2200, q: 2, pan });
      return;
    }
    const f = side > 0 ? 140 : 108;
    s.tone({ freq: f * rnd(0.95, 1.05), to: f * 0.45, dur: 0.14, vol: 0.34 * power, pan, attack: 0.002, wet: 0.1 });
    s.noise({ color: 'pink', dur: 0.06, vol: 0.22 * power, filter: 'bandpass', freq: side > 0 ? 1500 : 1100, q: 1.4, pan, attack: 0.001 });
    s.noise({ color: 'brown', dur: 0.12, vol: 0.2 * power, filter: 'lowpass', freq: 400, pan });
  },
  clashGo: (s) => {
    if (s.kids) {
      // a referee's whistle and a cymbal "tsss"
      s.tone({ freq: 2350, dur: 0.32, vol: 0.09, vibrato: 90, vibRate: 32, attack: 0.01, hold: 0.7 });
      s.tone({ freq: 2800, dur: 0.32, vol: 0.03, vibrato: 110, vibRate: 32, attack: 0.01, hold: 0.7 });
      SOUNDS.boing(s, { pitch: 1.3, delay: 0.05 });
      s.noise({ dur: 0.6, vol: 0.08, filter: 'highpass', freq: 7000, attack: 0.003, delay: 0.02, wet: 0.3 });
      return;
    }
    // a struck gong and a sub drop
    metal(s, { f: 98, vol: 0.2, dur: 2.2, ratio: 1.41, index: 4, wet: 0.45 });
    metal(s, { f: 247, vol: 0.08, dur: 1.4, ratio: 2.76, index: 2, wet: 0.45 });
    s.tone({ freq: 80, to: 36, dur: 0.6, vol: 0.55, dist: 2, attack: 0.002 });
    s.noise({ color: 'pink', dur: 0.4, vol: 0.25, filter: 'bandpass', freq: 600, to: 3000, q: 1.1, attack: 0.003 });
  },

  // ------------------------------------------------ impacts
  thud: (s, { power = 1, delay = 0 } = {}) => {
    s.tone({ freq: 120, to: 34, dur: 0.5, vol: 0.7 * power, dist: 3, delay, attack: 0.002, wet: 0.15 });
    s.noise({ color: 'brown', dur: 0.4, vol: 0.55 * power, freq: 900, to: 90, delay, wet: 0.2 });
    s.noise({ color: 'pink', dur: 0.03, vol: 0.18 * power, filter: 'bandpass', freq: 1600, q: 1, delay, attack: 0.001 });
  },
  boom: (s) => {
    s.tone({ freq: 85, to: 28, dur: 1.3, vol: 0.7, hold: 0.1, dist: 2, wet: 0.3 });
    s.noise({ color: 'brown', dur: 1.5, vol: 0.6, freq: 2400, to: 60, wet: 0.4 });
    s.noise({ dur: 0.3, vol: 0.28, freq: 6000, to: 500, attack: 0.001 });
  },
  drum: (s, { delay = 0, power = 1 } = {}) => {
    // a taiko: a deep skin with a slap on top
    s.tone({ freq: 120, to: 52, dur: 0.38, vol: 0.5 * power, delay, attack: 0.002, wet: 0.3 });
    s.tone({ freq: 210, to: 130, dur: 0.1, vol: 0.12 * power, delay, attack: 0.001 });
    s.noise({ color: 'pink', dur: 0.05, vol: 0.18 * power, filter: 'bandpass', freq: 900, q: 1.2, delay, attack: 0.001, wet: 0.3 });
  },
  dunDun: (s) => {
    // two low brass stabs, the second a half step higher
    for (const [f, at] of [
      [82.4, 0],
      [87.3, 0.45],
    ]) {
      brass(s, { f, dur: 0.42, vol: 0.13, delay: at, bright: 0.6, wet: 0.35 });
      brass(s, { f: f * 1.5, dur: 0.42, vol: 0.07, delay: at, bright: 0.6, wet: 0.35 });
      s.tone({ freq: 70, to: 40, dur: 0.3, vol: 0.4, delay: at, attack: 0.002 });
    }
  },
  slowmo: (s) => {
    // everything drops: a falling whoosh into a sub drone
    s.noise({ color: 'pink', dur: 1.1, vol: 0.35, freq: 2400, to: 110, attack: 0.02, wet: 0.5 });
    s.tone({ freq: 150, to: 30, dur: 1.3, vol: 0.45, attack: 0.01, hold: 0.2 });
    s.tone({ type: 'sawtooth', freq: 220, to: 48, dur: 1.2, vol: 0.06, lp: 1200, lpTo: 150, detune: 12, wet: 0.5 });
  },
  heartbeat: (s) => {
    // lub-dub, with an overtone so small speakers can hear it
    for (const [at, v] of [
      [0, 1],
      [0.24, 0.75],
    ]) {
      s.tone({ freq: 62, to: 40, dur: 0.2, vol: 0.55 * v, delay: at, attack: 0.008, wet: 0.05 });
      s.tone({ freq: 130, to: 85, dur: 0.12, vol: 0.12 * v, delay: at, attack: 0.008 });
      s.noise({ color: 'brown', dur: 0.12, vol: 0.25 * v, freq: 300, to: 80, delay: at });
    }
  },

  // ------------------------------------------------ gore (Action)
  rip: (s) => {
    SOUNDS.tear(s);
    SOUNDS.crunch(s, { delay: 0.05 });
    SOUNDS.splatter(s, { delay: 0.1 });
  },
  slash: (s, { delay = 0 } = {}) => {
    const dir = Math.random() < 0.5 ? -1 : 1;
    // the swipe, a glint of claw, then the cut
    s.noise({ dur: 0.13, vol: 0.4, filter: 'bandpass', freq: 5200, to: 1200, q: 1.6, delay, attack: 0.03, pan: -0.5 * dir, panTo: 0.5 * dir });
    s.tone({ freq: 3400, to: 2900, dur: 0.18, vol: 0.025, fm: 1.5, fmRatio: 2.76, delay: delay + 0.03, wet: 0.3 });
    SOUNDS.squelch(s, { delay: delay + 0.05 });
  },
  crunch: (s, { delay = 0 } = {}) => {
    // bone: a sharp crack and a burst of splintering ticks over a dull thump
    s.noise({ dur: 0.03, vol: 0.5, filter: 'highpass', freq: 1500, delay, attack: 0.001 });
    const n = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) tick(s, { f: rnd(1200, 4200), vol: rnd(0.25, 0.5), q: rnd(3, 7), dur: rnd(0.02, 0.04), delay: delay + 0.01 + i * rnd(0.018, 0.032), pan: rnd(-0.2, 0.2) });
    s.tone({ freq: 130, to: 45, dur: 0.24, vol: 0.5, delay, attack: 0.002 });
    s.noise({ color: 'brown', dur: 0.2, vol: 0.3, freq: 500, to: 120, delay });
  },
  tear: (s, { delay = 0 } = {}) => {
    // flesh ripping: a rough, gritty sweep made of many tiny overlapping grains
    s.noise({ color: 'pink', dur: 0.5, vol: 0.38, filter: 'bandpass', freq: 600, to: 2400, q: 1, delay, dist: 6, am: 38, amDepth: 0.45 });
    for (let i = 0; i < 12; i++) s.noise({ dur: rnd(0.02, 0.05), vol: rnd(0.12, 0.28), filter: 'bandpass', freq: rnd(400, 1400), q: 5, delay: delay + i * 0.035 + rnd(0, 0.02) });
    wetSlap(s, { delay: delay + 0.3, vol: 0.2, f: 900, toF: 400 });
  },
  squelch: (s, { delay = 0 } = {}) => {
    wetSlap(s, { delay, vol: 0.38, f: 360, toF: 1100, dur: 0.17 });
    wetSlap(s, { delay: delay + rnd(0.07, 0.11), vol: 0.18, f: 700, toF: 300, dur: 0.12 });
    s.tone({ freq: 190, to: 85, dur: 0.12, vol: 0.22, delay });
  },
  splatter: (s, { delay = 0 } = {}) => {
    // drops landing: a little noise and a rising "plip" each
    for (let i = 0; i < 9; i++) {
      const at = delay + Math.random() * 0.45;
      const pan = rnd(-0.6, 0.6);
      s.noise({ dur: 0.05, vol: rnd(0.1, 0.22), filter: 'bandpass', freq: rnd(500, 1400), q: 5, delay: at, pan });
      if (Math.random() < 0.6) {
        const f = rnd(500, 1100);
        s.tone({ freq: f, to: f * 1.7, dur: 0.035, vol: 0.05, delay: at + 0.005, pan });
      }
    }
  },
  bite: (s) => {
    tick(s, { f: 1800, vol: 0.5, q: 3, dur: 0.05 });
    s.tone({ freq: 150, to: 50, dur: 0.14, vol: 0.42, attack: 0.002 });
    SOUNDS.squelch(s, { delay: 0.03 });
  },
  pop: (s) => {
    s.tone({ freq: 240, to: 50, dur: 0.28, vol: 0.5, dist: 6 });
    s.noise({ dur: 0.04, vol: 0.4, filter: 'highpass', freq: 1200, attack: 0.001 });
    SOUNDS.splatter(s);
    SOUNDS.squelch(s);
  },
  pinch: (s, { delay = 0 } = {}) => {
    // a claw snapping shut
    tick(s, { f: 4200, vol: 0.4, q: 5, dur: 0.04, delay });
    wood(s, { f: 900, vol: 0.12, dur: 0.05, delay, bright: 0.4 });
  },
  sting: (s, { delay = 0 } = {}) => {
    s.tone({ type: 'square', freq: 1500, to: 320, dur: 0.12, vol: 0.12, lp: 4000, delay });
    s.noise({ dur: 0.08, vol: 0.3, filter: 'highpass', freq: 3000, delay });
  },
  splash: (s) => {
    s.noise({ color: 'pink', dur: 0.7, vol: 0.45, freq: 4000, to: 300, attack: 0.01, wet: 0.3 });
    s.noise({ dur: 0.3, vol: 0.3, filter: 'bandpass', freq: 800, q: 1, delay: 0.05 });
    for (let i = 0; i < 5; i++) {
      const f = rnd(350, 800);
      s.tone({ freq: f, to: f * 2, dur: 0.06, vol: 0.07, delay: 0.15 + Math.random() * 0.35, pan: rnd(-0.5, 0.5) });
    }
  },

  // ------------------------------------------------ animal voices (Action)
  roar: (s, { pitch = 1 } = {}) => {
    // a big cat: a rough, rising-then-falling "aaa-ohh" with a rattling throat and breath
    const p = pitch * rnd(0.95, 1.05);
    const curve = [
      [0, 85 * p],
      [0.22, 128 * p],
      [1, 58 * p],
    ];
    voice(s, { f: 85 * p, curve, dur: 1.25, vol: 0.38, vowel: 'a', vowelTo: 'o', attack: 0.07, hold: 0.45, am: 31, amDepth: 0.45, dist: 14, detune: 14, wet: 0.3 });
    s.tone({ type: 'square', freq: 43 * p, curve: curve.map(([k, v]) => [k, v / 2]), dur: 1.2, vol: 0.12, attack: 0.08, hold: 0.4, lp: 400, am: 23, dist: 8 });
    s.noise({ color: 'pink', dur: 1.15, vol: 0.28, filter: 'bandpass', freq: 750 * pitch, to: 300, q: 1.3, attack: 0.06, hold: 0.35, am: 31, amDepth: 0.3, wet: 0.3 });
  },
  growl: (s, { pitch = 1, dur = 0.9 } = {}) => {
    voice(s, { f: 72 * pitch, curve: [[0, 68 * pitch], [0.5, 82 * pitch], [1, 64 * pitch]], dur, vol: 0.3, vowel: 'o', vowelTo: 'u', attack: 0.12, hold: 0.5, am: 26, amDepth: 0.5, dist: 10, detune: 10, wet: 0.2 }); // prettier-ignore
    s.noise({ color: 'pink', dur, vol: 0.14, filter: 'bandpass', freq: 420 * pitch, q: 2, attack: 0.1, hold: 0.4, am: 26, amDepth: 0.4 });
  },
  screech: (s) => {
    // a raptor's scream: a harsh, wavering cry
    s.tone({ type: 'sawtooth', freq: 2200, curve: [[0, 2200], [0.15, 3000], [1, 1500]], dur: 0.75, vol: 0.11, attack: 0.02, hold: 0.3, vibrato: 120, vibRate: 30, lp: 5500, dist: 12, wet: 0.35 }); // prettier-ignore
    s.tone({ type: 'square', freq: 1500, curve: [[0, 1500], [0.15, 2000], [1, 1000]], dur: 0.7, vol: 0.04, attack: 0.02, vibrato: 90, vibRate: 30, lp: 4000 }); // prettier-ignore
    s.noise({ dur: 0.6, vol: 0.08, filter: 'bandpass', freq: 3500, q: 1, attack: 0.03 });
  },
  howl: (s) => {
    // a wolf: "ooo-OOOO-ooh", sliding up, holding, and falling away
    voice(s, { type: 'triangle', f: 360, curve: [[0, 360], [0.3, 720], [0.65, 700], [1, 420]], dur: 1.7, vol: 0.22, vowel: 'u', vowelTo: 'o', attack: 0.2, hold: 0.55, vibrato: 7, vibRate: 5.5, detune: 6, wet: 0.5 }); // prettier-ignore
    s.tone({ freq: 360, curve: [[0, 360], [0.3, 720], [0.65, 700], [1, 420]], dur: 1.7, vol: 0.12, attack: 0.25, hold: 0.5, vibrato: 7, vibRate: 5.5, wet: 0.5 }); // prettier-ignore
    s.noise({ color: 'pink', dur: 1.4, vol: 0.03, filter: 'bandpass', freq: 1200, q: 2, attack: 0.3, hold: 0.4 });
  },
  hiss: (s) => {
    s.noise({ dur: 0.75, vol: 0.28, filter: 'highpass', freq: 4500, q: 0.5, attack: 0.12, hold: 0.4, am: 9, amDepth: 0.15, wet: 0.2 });
    s.noise({ color: 'pink', dur: 0.7, vol: 0.08, filter: 'bandpass', freq: 2600, q: 1.5, attack: 0.15, hold: 0.4 });
  },
  snort: (s) => {
    s.noise({ color: 'pink', dur: 0.3, vol: 0.24, freq: 700, to: 220, attack: 0.02, am: 34, amDepth: 0.4 });
    s.tone({ type: 'sawtooth', freq: 95, to: 70, dur: 0.22, vol: 0.06, lp: 500, am: 34 });
  },

  // ------------------------------------------------ chains, cages, keys
  chain: (s, { dur = 1 } = {}) => {
    // links clinking as the chain is dragged, over a faint metal scrape
    const n = Math.floor(dur * 14);
    for (let i = 0; i < n; i++) {
      const at = i / 14 + Math.random() * 0.03;
      metal(s, { f: rnd(1700, 3400), vol: rnd(0.035, 0.07), dur: rnd(0.07, 0.14), ratio: 2.41, index: 1.4, delay: at, pan: rnd(-0.35, 0.35), wet: 0.18 });
      if (Math.random() < 0.15) metal(s, { f: rnd(500, 750), vol: 0.06, dur: 0.18, ratio: 1.41, index: 2, delay: at, wet: 0.2 });
    }
    s.noise({ dur, vol: 0.035, filter: 'bandpass', freq: 2400, q: 1.2, attack: 0.08, hold: 0.7, am: 13, amDepth: 0.45 });
  },
  clank: (s) => {
    // a heavy iron bar or cage door slamming home
    metal(s, { f: 230, vol: 0.2, dur: 0.75, ratio: 1.41, index: 4, wet: 0.35 });
    metal(s, { f: 1230, vol: 0.09, dur: 0.45, ratio: 2.76, index: 2, wet: 0.35 });
    s.noise({ dur: 0.04, vol: 0.3, filter: 'bandpass', freq: 3000, q: 2, attack: 0.001 });
    s.tone({ freq: 110, to: 60, dur: 0.15, vol: 0.25, attack: 0.002 });
  },
  unlock: (s) => {
    if (s.kids) {
      tick(s, { f: 3400, vol: 0.14, dur: 0.02 });
      tick(s, { f: 2600, vol: 0.14, dur: 0.02, delay: 0.08 });
      [784, 1046.5, 1318.5, 1568].forEach((f, i) => bell(s, { f, vol: 0.06, delay: 0.16 + i * 0.05, dur: 0.6, wet: 0.25 }));
      return;
    }
    // the key turning: two latch clicks, the bolt sliding back, then a glint
    metal(s, { f: 2900, vol: 0.08, dur: 0.05, ratio: 1.7, index: 1.5 });
    metal(s, { f: 2300, vol: 0.08, dur: 0.05, ratio: 1.7, index: 1.5, delay: 0.09 });
    metal(s, { f: 640, vol: 0.12, dur: 0.22, ratio: 1.41, index: 2.5, delay: 0.16, wet: 0.25 });
    s.noise({ dur: 0.08, vol: 0.12, filter: 'bandpass', freq: 1800, q: 2, delay: 0.14 });
    [880, 1318.5].forEach((f, i) => bell(s, { f, vol: 0.05, delay: 0.24 + i * 0.07, dur: 0.8, wet: 0.4 }));
  },
  creak: (s) => {
    // a heavy hinge: stick-slip pulses through a resonant body
    s.tone({ type: 'sawtooth', freq: 34, curve: [[0, 34], [0.4, 60], [1, 45]], dur: 0.6, vol: 0.4, attack: 0.04, hold: 0.5, vibrato: 9, vibRate: 7, lp: 700, lpTo: 1100, lpQ: 7, ftype: 'bandpass', wet: 0.3 }); // prettier-ignore
  },

  // ------------------------------------------------ music and feedback
  sparkle: (s, { delay = 0 } = {}) => {
    [1568, 1975.5, 2349.3, 3136].forEach((f, i) => bell(s, { f, vol: 0.05, delay: delay + i * 0.06, dur: 0.6, wet: 0.4, pan: rnd(-0.5, 0.5) }));
  },
  cheer: (s) => {
    // a bright brass flourish over a cymbal
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => brass(s, { f, dur: i === 3 ? 0.6 : 0.2, vol: 0.075, delay: i * 0.08, wet: 0.3 }));
    s.noise({ dur: 1.0, vol: 0.07, filter: 'highpass', freq: 6000, attack: 0.002, delay: 0.24, wet: 0.4 });
  },
  fanfare: (s) => {
    // "ta-ta-ta TAA, ta-TAA": a brass fanfare with timpani, ending on a held chord and a crash
    const line = [
      [523.25, 0, 0.12],
      [523.25, 0.12, 0.12],
      [523.25, 0.24, 0.12],
      [659.25, 0.36, 0.3],
      [783.99, 0.7, 0.16],
      [659.25, 0.88, 0.14],
      [783.99, 1.04, 0.16],
    ];
    for (const [f, at, d] of line) {
      brass(s, { f, dur: d + 0.06, vol: 0.055, delay: at, wet: 0.3 });
      brass(s, { f: f / 2, dur: d + 0.06, vol: 0.032, delay: at, bright: 0.6, wet: 0.3 });
    }
    for (const f of [523.25, 659.25, 783.99, 1046.5]) brass(s, { f, dur: 1.2, vol: 0.04, delay: 1.24, wet: 0.4 });
    brass(s, { f: 130.8, dur: 1.2, vol: 0.05, delay: 1.24, bright: 0.5, wet: 0.4 });
    for (const at of [0, 0.36, 1.24]) s.tone({ freq: 98, to: 62, dur: 0.5, vol: 0.22, delay: at, attack: 0.003, wet: 0.3 });
    s.noise({ dur: 1.6, vol: 0.08, filter: 'highpass', freq: 5000, attack: 0.002, delay: 1.24, wet: 0.45 });
  },
  sad: (s) => {
    // the sad trombone: "wah, wah, wah, waaah"
    const notes = [392, 370, 349.2, 329.6];
    notes.forEach((f, i) => {
      const last = i === notes.length - 1;
      const dur = last ? 0.95 : 0.3;
      s.tone({ type: 'sawtooth', freq: f / 2, dur, vol: 0.055, delay: i * 0.33, attack: 0.03, hold: 0.6, detune: 6, vibrato: last ? 6 : 0, vibRate: 5, lpCurve: [[0, 300], [0.3, 1400], [1, 380]], lpQ: 3, wet: 0.3 }); // prettier-ignore
    });
  },
  error: (s) => {
    s.tone({ type: 'square', freq: 180, to: 120, dur: 0.22, vol: 0.1, lp: 1400 });
    s.tone({ type: 'square', freq: 120, to: 90, dur: 0.18, vol: 0.06, lp: 900, delay: 0.1 });
  },
};

// Lets other modules (e.g. Kids-mode sounds) add named effects: registerSounds({ boing: (s, opt) => s.tone(...) }).
export function registerSounds(map) {
  Object.assign(SOUNDS, map);
}

export const sfx = new Sfx();
