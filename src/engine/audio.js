// Sound effects on WebAudio: recorded samples (CC0, in src/sounds) layered with synthesis.
//
// Every voice runs through one bus: an optional per-voice drive (waveshaper) and stereo position,
// its group's volume, a reverb send (a generated room: a dark stone hall for Action, a small
// bright room for Kids), then a gentle compressor and the master volume. A quiet ambience loop
// (a night jungle, or a sunny garden) plays underneath.

const VOLUME = 0.7;

const MODES = {
  action: { wet: 0.2, room: { len: 2.6, decay: 2.2, damp: 0.82, pre: 0.022 }, ambience: 0.3 },
  kids: { wet: 0.13, room: { len: 1.0, decay: 0.75, damp: 0.3, pre: 0.008 }, ambience: 0.4 },
};

// Sound groups, each with its own volume (the Sound settings). A sound belongs to the group
// listed here, or to 'fight'; a call can override it with opt.group.
export const SOUND_GROUPS = ['fight', 'cage', 'dice', 'move', 'music', 'ambience'];
const DEFAULT_VOLUMES = { master: 1, fight: 1, cage: 1, dice: 1, move: 1, music: 1, ambience: 0.6 };
const GROUP_OF = {
  keyIn: 'cage', keyTurn: 'cage', unlock: 'cage', cageLift: 'cage', release: 'cage', lockSnap: 'cage', clank: 'cage', chain: 'cage', creak: 'cage', // prettier-ignore
  diceShake: 'dice', diceRattle: 'dice', diceHit: 'dice', diceWall: 'dice', diceSettle: 'dice', diceSix: 'dice', // prettier-ignore
  hop: 'move', land: 'move', // prettier-ignore
  click: 'music', fanfare: 'music', cheer: 'music', sad: 'music', error: 'music', tada: 'music', yay: 'music', sparkle: 'music', // prettier-ignore
};

// Recorded samples, named <kind>_<n>.mp3: a kind can have several variants, picked at random.
// Decoded buffers aren't tied to a context, so they're shared by the live and offline contexts.
const SAMPLE_FILES = import.meta.glob('../sounds/*.mp3', { query: '?url', import: 'default', eager: true });
const decoded = new Map();
let samplesLoading = null;

async function fetchBytes(url) {
  if (url.startsWith('data:')) {
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  return (await fetch(url)).arrayBuffer();
}

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

// Action: a night in the jungle. Crickets, frogs, an owl now and then and the torches' crackle.
// There is no broadband noise bed (slow noise swells read as ocean waves). With a recorded
// night bed (`bed`), only the torch crackle is synthesised on top of it.
function nightAmbience(ctx, rand, bed) {
  const S = 12;
  const tau = Math.PI * 2;
  const sr = ctx.sampleRate;
  return makeLoop(
    ctx,
    S,
    () => [0, 0],
    (add) => {
      if (!bed) {
        // a chorus of crickets, each chirping in bursts of pulses at its own pitch and pace
        for (const [f, pan, every, pulses] of [
          [4300, -0.7, 0.62, 3],
          [4750, 0.6, 0.84, 4],
          [5200, -0.2, 0.5, 2],
          [3900, 0.3, 1.1, 5],
        ]) {
          for (let at = rand() * every; at < S; at += every * (0.9 + rand() * 0.2)) {
            if (rand() < 0.12) at += 1 + rand() * 1.5;
            const vol = 0.036 + rand() * 0.024;
            add(at, pulses * 0.034, (t) => {
              const k = Math.floor(t / 0.034);
              const u = t - k * 0.034;
              return u < 0.02 ? vol * Math.sin(tau * f * t) * Math.sin((Math.PI * u) / 0.02) : 0;
            }, pan);
          }
        }
        // frogs: short buzzy croaks, often in pairs
        for (const [f, pan, every] of [
          [420, -0.5, 2.6],
          [610, 0.55, 3.4],
        ]) {
          for (let at = rand() * every; at < S - 0.5; at += every * (0.7 + rand() * 0.6)) {
            const n = rand() < 0.6 ? 2 : 1;
            for (let c = 0; c < n; c++) {
              const len = 0.14 + rand() * 0.08;
              const pulse = 38 + rand() * 12;
              const vol = 0.08 + rand() * 0.04;
              add(at + c * (len + 0.07), len, (t) => {
                const env = Math.sin((Math.PI * t) / len);
                const buzz = Math.max(0, Math.sin(tau * pulse * t)) ** 3;
                return vol * env * buzz * (Math.sin(tau * f * t) + 0.5 * Math.sin(tau * f * 2.03 * t));
              }, pan);
            }
          }
        }
        // a distant owl, once a loop: "hoo ... hoo-hoo"
        const owlAt = 3 + rand() * 4;
        for (const [off, len] of [
          [0, 0.42],
          [0.75, 0.22],
          [1.05, 0.38],
        ]) {
          let ph = 0;
          add(owlAt + off, len, (t) => {
            ph += (tau * (370 - 30 * (t / len))) / sr;
            return 0.06 * Math.sin(ph) * Math.sin((Math.PI * t) / len) ** 2;
          }, -0.35);
        }
      }
      // torch crackle: short dry ticks and the odd pop
      for (let at = 0; at < S; at += 0.05 + rand() * 0.45) {
        const big = rand() < 0.07;
        const vol = big ? 0.07 + rand() * 0.04 : 0.014 + rand() * 0.026;
        const decay = big ? 0.005 : 0.0012 + rand() * 0.0018;
        const pan = rand() * 1.4 - 0.7;
        let prev = 0;
        add(at, decay * 6, (t) => {
          const x = rand() * 2 - 1;
          const hp = x - prev;
          prev = x;
          return hp * vol * Math.exp(-t / decay);
        }, pan);
      }
    },
  );
}

// Kids: a sunny garden. Little birds and the odd passing bee (no breeze noise). With a recorded
// birdsong bed (`bed`), only the bee is synthesised on top of it.
function dayAmbience(ctx, rand, bed) {
  const S = 12;
  const tau = Math.PI * 2;
  return makeLoop(
    ctx,
    S,
    () => [0, 0],
    (add) => {
      // a bee drifting past, once a loop
      const beeAt = 2 + rand() * 6;
      const beePan = rand() < 0.5 ? -0.6 : 0.6;
      add(beeAt, 1.6, (t) => {
        const env = Math.sin((Math.PI * t) / 1.6) ** 2;
        const f = 218 + 12 * Math.sin(tau * 3 * t);
        const saw = 2 * ((f * t) % 1) - 1;
        return 0.03 * env * saw * (0.7 + 0.3 * Math.sin(tau * 9 * t));
      }, beePan);
      if (bed) return;
      // a little songbird phrase every couple of seconds, each from somewhere else
      for (let at = 0.4 + rand(); at < S - 0.5; at += 1.4 + rand() * 2.2) {
        const pan = rand() * 1.6 - 0.8;
        const kind = Math.floor(rand() * 3);
        const vol = 0.09 + rand() * 0.05;
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
    this.group = 'fight';
    this.volumes = { ...DEFAULT_VOLUMES };
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
      this.loadSamples().finally(() => this.updateAmbience());
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // Builds the bus on a context (a live AudioContext, or an OfflineAudioContext to render to file).
  attach(ctx) {
    this.ctx = ctx;
    this.volumes ??= { ...DEFAULT_VOLUMES };
    this.group ??= 'fight';
    const rand = mulberry32(0x5eed);
    this.noiseBuffers = { white: noiseBuffer(ctx, 'white', rand), pink: noiseBuffer(ctx, 'pink', rand), brown: noiseBuffer(ctx, 'brown', rand) };
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : VOLUME * this.volumes.master;
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
    // one dry gain and one reverb-send gain per sound group, so a group's volume covers its echo too
    this.groups = {};
    for (const g of SOUND_GROUPS) {
      const dry = ctx.createGain();
      const send = ctx.createGain();
      dry.gain.value = send.gain.value = this.volumes[g];
      dry.connect(this.bus);
      send.connect(this.verbIn);
      this.groups[g] = { dry, send };
    }
    this.ambBuffers = {};
    this.amb = null;
  }

  // Decodes every recorded sample once (sounds fall back to pure synthesis until they're ready).
  loadSamples() {
    if (samplesLoading) return samplesLoading;
    const ctx = this.ctx;
    const entries = Object.entries(SAMPLE_FILES).sort(([a], [b]) => (a < b ? -1 : 1));
    samplesLoading = Promise.all(
      entries.map(async ([path, url]) => {
        try {
          return [path, await ctx.decodeAudioData(await fetchBytes(url))];
        } catch {
          return [path, null]; // a sample that can't load leaves its synthesised fallback
        }
      }),
    ).then((list) => {
      for (const [path, buf] of list) {
        if (!buf) continue;
        const kind = path.split('/').pop().replace(/\.mp3$/, '').replace(/_\d+$/, '');
        if (!decoded.has(kind)) decoded.set(kind, []);
        decoded.get(kind).push(buf);
      }
    });
    return samplesLoading;
  }

  has(kind) {
    return decoded.has(kind);
  }

  // Volume of one group (or 'master'), 0..1.
  setVolume(key, v) {
    this.volumes[key] = Math.max(0, Math.min(1, v));
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (key === 'master') {
      if (!this.muted) this.master.gain.setTargetAtTime(VOLUME * this.volumes.master, t, 0.03);
      return;
    }
    const g = this.groups[key];
    if (!g) return;
    g.dry.gain.setTargetAtTime(this.volumes[key], t, 0.03);
    g.send.gain.setTargetAtTime(this.volumes[key], t, 0.03);
    if (key === 'ambience') this.updateAmbience();
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

  // The ambience loop for a mode: a recorded bed when there is one (plus synthesised details),
  // otherwise fully synthesised.
  ambienceBuffer(mode) {
    return (this.ambBuffers[mode] ??= (mode === 'kids' ? dayAmbience : nightAmbience)(this.ctx, mulberry32(mode === 'kids' ? 23 : 29), decoded.get(mode === 'kids' ? 'amb_day' : 'amb_night')?.[0]));
  }

  // Cross-fades to the current mode's ambience loop (or to silence).
  updateAmbience() {
    const ctx = this.ctx;
    if (!ctx || !this.bus) return;
    const want = this.ambienceOn && this.volumes.ambience > 0 ? this.mode : null;
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
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(MODES[want].ambience, t + 2.5);
    gain.connect(this.groups.ambience.dry);
    const sources = [this.ambienceBuffer(want), decoded.get(want === 'kids' ? 'amb_day' : 'amb_night')?.[0]]
      .filter(Boolean)
      .map((buffer, i) => {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        if (i) {
          // the recorded bed sits a little under the effects
          const bed = ctx.createGain();
          bed.gain.value = 0.55;
          src.connect(bed).connect(gain);
        } else src.connect(gain);
        src.start(t);
        return src;
      });
    this.amb = { mode: want, src: { stop: (at) => sources.forEach((x) => x.stop(at)) }, gain };
  }

  setMuted(m) {
    this.muted = m;
    if (!this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : VOLUME * this.volumes.master, t, 0.03);
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
    const group = this.groups[this.group] ?? this.groups.fight;
    n.connect(group.dry);
    const w = wet ?? MODES[this.mode].wet;
    if (w > 0) {
      const send = ctx.createGain();
      send.gain.value = w;
      n.connect(send).connect(group.send);
    }
  }

  /**
   * A recorded sample: a random variant of `kind` (or `variant`), at `vol`, `rate` (speed and
   * pitch), from `start` s, optionally cut to `dur` s with a fade, and filtered (`lp`, `hp`), plus
   * the routing options of tone(). Returns false when the kind isn't loaded (yet), so callers can
   * fall back to synthesis.
   */
  sample(kind, o = {}) {
    if (!this.ready) return false;
    const list = decoded.get(kind);
    if (!list?.length) return false;
    const { vol = 0.5, rate = 1, delay = 0, start = 0, dur = null, lp = 0, hp = 0 } = o;
    const buf = list[(o.variant ?? Math.floor(Math.random() * list.length)) % list.length];
    const ctx = this.ctx;
    const t0 = ctx.currentTime + Math.max(0, delay);
    const len = Math.max(0.02, dur ?? (buf.duration - start) / rate);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    if (dur) {
      g.gain.setValueAtTime(vol, t0 + len * 0.75);
      g.gain.linearRampToValueAtTime(0, t0 + len);
    }
    let n = src;
    for (const [type, freq] of [
      ['highpass', hp],
      ['lowpass', lp],
    ]) {
      if (!freq) continue;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      n = n.connect(f);
    }
    n.connect(g);
    this.route(g, t0, t0 + len + 0.05, { ...o, dur: len });
    src.start(t0, start);
    src.stop(t0 + len + 0.05);
    return true;
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
    this.group = opt.group ?? GROUP_OF[name] ?? 'fight';
    try {
      fn(this, opt);
    } finally {
      this.basePan = 0;
      this.group = 'fight';
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

// Each animal's own call: a recording when there is one, else its synthesised voice.
const CALLS = {
  tiger: ['roar_bigcat', 1.05, 'roar'],
  wolf: ['snarl_wolf', 1, 'growl'],
  bear: ['roar_bear', 1, 'roar'],
  eagle: ['screech_eagle', 1, 'screech'],
  cobra: ['hiss_snake', 1, 'hiss'],
  shark: ['growl_bigcat', 0.7, 'growl'],
  gorilla: ['roar_gorilla', 1, 'roar'],
  rhino: ['snort_bull', 1, 'snort'],
  scorpion: ['hiss_snake', 1.5, 'hiss'],
  crocodile: ['hiss_croc', 1, 'hiss'],
};
function animalCall(s, animal, vol = 0.6) {
  const [kind, rate, synth] = CALLS[animal] ?? CALLS.tiger;
  if (!s.sample(kind, { vol, rate, dur: 1.6, wet: 0.25 })) SOUNDS[synth](s, { pitch: 1.1 });
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
    const pan = -0.45 * side;
    if (s.kids) {
      // a cushiony "pomf" and a tiny squeak
      if (!s.sample('soft', { vol: 0.5 * power, rate: rnd(1.35, 1.6), pan, wet: 0.08 })) s.tone({ type: 'triangle', freq: 300, to: 480, dur: 0.1, vol: 0.2 * power, pan });
      const f = (side > 0 ? 880 : 740) * rnd(0.97, 1.03);
      s.tone({ type: 'triangle', freq: f, to: f * 1.25, dur: 0.06, vol: 0.045, pan, attack: 0.004 });
      return;
    }
    // a real body blow, pitched a little apart for each side, with some weight underneath
    if (!s.sample('punch', { vol: 0.5 * power, rate: (side > 0 ? 1.04 : 0.92) * rnd(0.95, 1.05), pan, wet: 0.12 })) {
      s.noise({ color: 'pink', dur: 0.06, vol: 0.22 * power, filter: 'bandpass', freq: 1300, q: 1.4, pan, attack: 0.001 });
    }
    s.tone({ freq: side > 0 ? 95 : 80, to: 45, dur: 0.12, vol: 0.2 * power, pan, attack: 0.002, wet: 0.05 });
    if (Math.random() < 0.35) s.sample('scuffle', { vol: 0.16, rate: rnd(0.9, 1.2), pan: -pan * 0.5, dur: 0.25 });
  },
  clashGo: (s) => {
    if (s.kids) {
      // a referee's whistle and a soft bump
      s.tone({ freq: 2350, dur: 0.32, vol: 0.08, vibrato: 90, vibRate: 32, attack: 0.01, hold: 0.7 });
      s.tone({ freq: 2800, dur: 0.32, vol: 0.025, vibrato: 110, vibRate: 32, attack: 0.01, hold: 0.7 });
      s.sample('soft', { vol: 0.5, rate: 1.2, delay: 0.05 });
      return;
    }
    // a heavy blow, a deep bell and a snarl
    s.sample('punch_heavy', { vol: 0.75, rate: 0.75, wet: 0.3 });
    if (!s.sample('bell_heavy', { vol: 0.32, rate: 0.5, wet: 0.45, lp: 2500 })) metal(s, { f: 98, vol: 0.18, dur: 2, ratio: 1.41, index: 4, wet: 0.45 });
    s.tone({ freq: 70, to: 34, dur: 0.6, vol: 0.45, attack: 0.002 });
    s.sample('growl_bigcat', { vol: 0.4, dur: 0.9, delay: 0.08, wet: 0.25 });
  },
  // ------------------------------------------------ impacts
  thud: (s, { power = 1, delay = 0 } = {}) => {
    if (!s.sample('body', { vol: 0.8 * power, rate: rnd(0.82, 0.95), delay, wet: 0.18 })) {
      s.noise({ color: 'brown', dur: 0.4, vol: 0.55 * power, freq: 900, to: 90, delay, wet: 0.2 });
    }
    s.tone({ freq: 110, to: 34, dur: 0.45, vol: 0.5 * power, delay, attack: 0.002, wet: 0.12 });
  },
  boom: (s) => {
    s.sample('punch_heavy', { vol: 0.8, rate: 0.55, wet: 0.35 });
    s.sample('body', { vol: 0.7, rate: 0.5, wet: 0.35 });
    s.tone({ freq: 80, to: 28, dur: 1.2, vol: 0.55, hold: 0.1, wet: 0.3 });
    s.noise({ color: 'brown', dur: 1.3, vol: 0.4, freq: 1800, to: 60, wet: 0.4 });
  },
  drum: (s, { delay = 0, power = 1 } = {}) => {
    // a war drum: a deep body hit with a skin slap
    if (!s.sample('body', { vol: 0.65 * power, rate: 0.72, delay, wet: 0.3 })) s.tone({ freq: 210, to: 130, dur: 0.1, vol: 0.12 * power, delay, attack: 0.001 });
    s.tone({ freq: 115, to: 52, dur: 0.36, vol: 0.4 * power, delay, attack: 0.002, wet: 0.3 });
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
    // lub-dub: two muffled body thumps, with an overtone so small speakers can hear it
    for (const [at, v] of [
      [0, 1],
      [0.24, 0.72],
    ]) {
      if (!s.sample('body', { vol: 0.5 * v, rate: 0.5, lp: 420, delay: at, wet: 0.05 })) s.noise({ color: 'brown', dur: 0.12, vol: 0.25 * v, freq: 300, to: 80, delay: at });
      s.tone({ freq: 58, to: 40, dur: 0.18, vol: 0.3 * v, delay: at, attack: 0.008 });
      s.tone({ freq: 125, to: 85, dur: 0.1, vol: 0.08 * v, delay: at, attack: 0.008 });
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
    // claws through the air, then the cut
    if (!s.sample('swipe', { vol: 0.55, rate: rnd(0.95, 1.1), delay, pan: 0.3 * dir, wet: 0.2 })) {
      s.noise({ dur: 0.13, vol: 0.4, filter: 'bandpass', freq: 5200, to: 1200, q: 1.6, delay, attack: 0.03, pan: -0.5 * dir, panTo: 0.5 * dir });
    }
    s.sample('blade', { vol: 0.18, rate: 1.3, delay: delay + 0.02 });
    SOUNDS.squelch(s, { delay: delay + 0.06 });
  },
  crunch: (s, { delay = 0 } = {}) => {
    // bone giving way: a crack, splintering, a dull blow
    if (!s.sample('crack_bone', { vol: 0.75, rate: rnd(0.9, 1.1), delay })) {
      s.sample('chop', { vol: 0.6, rate: 0.8, delay });
      s.sample('chop', { vol: 0.4, rate: 1.25, delay: delay + 0.045 });
    }
    s.sample('punch_heavy', { vol: 0.35, rate: 1.2, delay });
    s.tone({ freq: 120, to: 45, dur: 0.2, vol: 0.35, delay, attack: 0.002 });
  },
  tear: (s, { delay = 0 } = {}) => {
    // hide ripping: a slow, rough drag with a wet tail
    if (!s.sample('scuffle', { vol: 0.55, rate: 0.55, delay, dur: 0.55, lp: 2600 })) {
      s.noise({ color: 'pink', dur: 0.5, vol: 0.3, filter: 'bandpass', freq: 600, to: 2400, q: 1, delay, am: 38, amDepth: 0.45 });
    }
    s.noise({ color: 'pink', dur: 0.4, vol: 0.12, filter: 'bandpass', freq: 900, to: 1800, q: 1.2, delay: delay + 0.05, am: 31, amDepth: 0.4 });
    SOUNDS.squelch(s, { delay: delay + 0.3 });
  },
  squelch: (s, { delay = 0 } = {}) => {
    if (s.sample('squish', { vol: 0.5, rate: rnd(0.85, 1.15), delay })) return;
    wetSlap(s, { delay, vol: 0.3, f: 360, toF: 1100, dur: 0.17 });
    s.tone({ freq: 190, to: 85, dur: 0.12, vol: 0.18, delay });
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
    s.sample('punch', { vol: 0.5, rate: 1.2 });
    if (!s.sample('crack_bone', { vol: 0.4, rate: 1.3, delay: 0.01 })) s.sample('chop', { vol: 0.45, rate: 1.1, delay: 0.01 });
    s.tone({ freq: 140, to: 50, dur: 0.12, vol: 0.3, attack: 0.002 });
    SOUNDS.squelch(s, { delay: 0.04 });
  },
  pop: (s) => {
    s.sample('punch_heavy', { vol: 0.7, rate: 0.8 });
    s.tone({ freq: 220, to: 50, dur: 0.25, vol: 0.35 });
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
    if (s.sample('roar_bigcat', { vol: 0.75, rate: Math.pow(pitch, 0.7) * rnd(0.96, 1.04), wet: 0.3 })) return;
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
    if (s.sample('growl_bigcat', { vol: 0.65, rate: Math.pow(pitch, 0.6), dur, wet: 0.2 })) return;
    voice(s, { f: 72 * pitch, curve: [[0, 68 * pitch], [0.5, 82 * pitch], [1, 64 * pitch]], dur, vol: 0.3, vowel: 'o', vowelTo: 'u', attack: 0.12, hold: 0.5, am: 26, amDepth: 0.5, dist: 10, detune: 10, wet: 0.2 }); // prettier-ignore
    s.noise({ color: 'pink', dur, vol: 0.14, filter: 'bandpass', freq: 420 * pitch, q: 2, attack: 0.1, hold: 0.4, am: 26, amDepth: 0.4 });
  },
  screech: (s) => {
    if (s.sample('screech_eagle', { vol: 0.55, wet: 0.35 })) return;
    // a raptor's scream: a harsh, wavering cry
    s.tone({ type: 'sawtooth', freq: 2200, curve: [[0, 2200], [0.15, 3000], [1, 1500]], dur: 0.75, vol: 0.11, attack: 0.02, hold: 0.3, vibrato: 120, vibRate: 30, lp: 5500, dist: 12, wet: 0.35 }); // prettier-ignore
    s.tone({ type: 'square', freq: 1500, curve: [[0, 1500], [0.15, 2000], [1, 1000]], dur: 0.7, vol: 0.04, attack: 0.02, vibrato: 90, vibRate: 30, lp: 4000 }); // prettier-ignore
    s.noise({ dur: 0.6, vol: 0.08, filter: 'bandpass', freq: 3500, q: 1, attack: 0.03 });
  },
  howl: (s) => {
    if (s.sample('howl_wolf', { vol: 0.6, wet: 0.5 })) return;
    // a wolf: "ooo-OOOO-ooh", sliding up, holding, and falling away
    voice(s, { type: 'triangle', f: 360, curve: [[0, 360], [0.3, 720], [0.65, 700], [1, 420]], dur: 1.7, vol: 0.22, vowel: 'u', vowelTo: 'o', attack: 0.2, hold: 0.55, vibrato: 7, vibRate: 5.5, detune: 6, wet: 0.5 }); // prettier-ignore
    s.tone({ freq: 360, curve: [[0, 360], [0.3, 720], [0.65, 700], [1, 420]], dur: 1.7, vol: 0.12, attack: 0.25, hold: 0.5, vibrato: 7, vibRate: 5.5, wet: 0.5 }); // prettier-ignore
    s.noise({ color: 'pink', dur: 1.4, vol: 0.03, filter: 'bandpass', freq: 1200, q: 2, attack: 0.3, hold: 0.4 });
  },
  hiss: (s) => {
    if (s.sample('hiss_snake', { vol: 0.5, wet: 0.2 })) return;
    s.noise({ dur: 0.75, vol: 0.28, filter: 'highpass', freq: 4500, q: 0.5, attack: 0.12, hold: 0.4, am: 9, amDepth: 0.15, wet: 0.2 });
    s.noise({ color: 'pink', dur: 0.7, vol: 0.08, filter: 'bandpass', freq: 2600, q: 1.5, attack: 0.15, hold: 0.4 });
  },
  snort: (s) => {
    if (s.sample('snort_bull', { vol: 0.6, wet: 0.15 })) return;
    s.noise({ color: 'pink', dur: 0.3, vol: 0.24, freq: 700, to: 220, attack: 0.02, am: 34, amDepth: 0.4 });
    s.tone({ type: 'sawtooth', freq: 95, to: 70, dur: 0.22, vol: 0.06, lp: 500, am: 34 });
  },

  // ------------------------------------------------ chains, cages, keys
  chain: (s, { dur = 1 } = {}) => {
    // links clinking as the chain is dragged, over a faint metal scrape
    const n = Math.floor(dur * 12);
    for (let i = 0; i < n; i++) {
      const at = i / 12 + Math.random() * 0.04;
      const pan = rnd(-0.35, 0.35);
      if (!s.sample('metal_light', { vol: rnd(0.1, 0.2), rate: rnd(1.2, 2.1), delay: at, pan, wet: 0.15 })) {
        metal(s, { f: rnd(1700, 3400), vol: rnd(0.035, 0.07), dur: rnd(0.07, 0.14), ratio: 2.41, index: 1.4, delay: at, pan, wet: 0.18 });
      }
    }
    s.noise({ dur, vol: 0.025, filter: 'bandpass', freq: 2400, q: 1.2, attack: 0.08, hold: 0.7, am: 13, amDepth: 0.45 });
  },
  clank: (s) => {
    // the cage door slamming home
    if (!s.sample('gate_slam', { vol: 0.55, rate: rnd(0.85, 0.95), wet: 0.3 })) metal(s, { f: 230, vol: 0.2, dur: 0.75, ratio: 1.41, index: 4, wet: 0.35 });
    s.sample('metal_heavy', { vol: 0.55, rate: 0.8, wet: 0.3 });
    s.tone({ freq: 100, to: 55, dur: 0.15, vol: 0.25, attack: 0.002 });
  },
  unlock: (s) => {
    // the shackle springs open
    if (s.kids) {
      s.sample('latch', { vol: 0.3, rate: 1.6 });
      SOUNDS.bubblePop?.(s, { delay: 0.03 });
      return;
    }
    s.sample('latch', { vol: 0.55, rate: 1.2 });
    if (!s.sample('metal_heavy', { vol: 0.4, rate: 1.4, delay: 0.02, wet: 0.25 })) metal(s, { f: 640, vol: 0.12, dur: 0.22, ratio: 1.41, index: 2.5, wet: 0.25 });
    bell(s, { f: 2637, vol: 0.025, delay: 0.03, dur: 0.5, wet: 0.3 });
  },
  creak: (s) => {
    // a heavy hinge
    if (s.sample('hinge_open', { vol: 0.4, rate: rnd(0.85, 1.05), wet: 0.3 })) return;
    s.tone({ type: 'sawtooth', freq: 34, curve: [[0, 34], [0.4, 60], [1, 45]], dur: 0.6, vol: 0.4, attack: 0.04, hold: 0.5, vibrato: 9, vibRate: 7, lp: 700, lpTo: 1100, lpQ: 7, ftype: 'bandpass', wet: 0.3 }); // prettier-ignore
  },
  // ------------------------------------------------ getting out of the cage
  // the golden key arrives
  keyIn: (s) => {
    if (s.kids) {
      [1568, 2093, 2637].forEach((f, i) => bell(s, { f, vol: 0.045, delay: i * 0.06, dur: 0.6, wet: 0.3, pan: -0.3 + i * 0.3 }));
      s.sample('metal_light', { vol: 0.1, rate: 2.4, delay: 0.05 });
      return;
    }
    // a jangle of keys on a ring, swinging in
    for (let i = 0; i < 3; i++) s.sample('metal_light', { vol: 0.2 - i * 0.04, rate: rnd(1.6, 2.2), delay: i * 0.075, pan: -0.25 + i * 0.25, wet: 0.2 });
    s.noise({ color: 'pink', dur: 0.35, vol: 0.06, filter: 'bandpass', freq: 500, to: 1800, q: 1.2, attack: 0.25 });
  },
  // the key goes in and turns: a heavy latch and a click
  keyTurn: (s) => {
    if (s.kids) {
      s.sample('click_metal', { vol: 0.35, rate: 1.5 });
      mallet(s, { f: 1046.5, vol: 0.06, delay: 0.1, dur: 0.3 });
      return;
    }
    s.sample('click_metal', { vol: 0.35, rate: 1.1 });
    if (!s.sample('latch', { vol: 0.7, rate: 0.85, delay: 0.1, wet: 0.2 })) metal(s, { f: 2300, vol: 0.08, dur: 0.05, ratio: 1.7, index: 1.5, delay: 0.1 });
    s.tone({ freq: 160, to: 90, dur: 0.1, vol: 0.18, delay: 0.1, attack: 0.002 });
  },
  // the cage swings up and away
  cageLift: (s) => {
    if (s.kids) {
      SOUNDS.harp?.(s);
      s.noise({ color: 'pink', dur: 0.6, vol: 0.06, filter: 'bandpass', freq: 600, to: 2400, q: 1, attack: 0.3 });
      return;
    }
    if (!s.sample('hinge_open', { vol: 0.42, rate: 0.75, wet: 0.35 })) SOUNDS.creak(s);
    for (let i = 0; i < 4; i++) s.sample('metal_light', { vol: 0.09, rate: rnd(1.3, 1.9), delay: 0.12 + i * 0.11, pan: rnd(-0.3, 0.3), wet: 0.2 });
    s.noise({ color: 'pink', dur: 0.7, vol: 0.12, filter: 'bandpass', freq: 300, to: 1600, q: 1.1, attack: 0.45, delay: 0.1 });
  },
  // the freed animal leaps out with its own call
  release: (s, { animal = 'tiger' } = {}) => {
    if (s.kids) {
      SOUNDS.whee?.(s, { pitch: 1.1 });
      SOUNDS.sparkle(s, { delay: 0.15 });
      return;
    }
    animalCall(s, animal, 0.6);
    SOUNDS.whoosh(s, { dur: 0.45, delay: 0.05 });
    SOUNDS.drum(s, { power: 0.6, delay: 0.02 });
  },
  // a padlock snapping shut
  lockSnap: (s) => {
    if (s.kids) {
      s.sample('click_metal', { vol: 0.35, rate: 1.6 });
      return;
    }
    s.sample('latch', { vol: 0.6, rate: 1 });
    s.sample('click_metal', { vol: 0.3, rate: 1.2, delay: 0.05 });
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
