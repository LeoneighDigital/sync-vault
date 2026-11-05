/**
 * Procedural demo track — 8 bars @ 92 BPM in F minor.
 *
 * This exists so Phase 1 is auditionable the moment it deploys, with no
 * binary assets in the repo. Replace it entirely by loading real stems
 * (the "LOAD STEMS" button) once masters are exported.
 */

const BPM   = 92;
const BARS  = 8;

const NOTE = {
  F1: 43.65, Ab1: 51.91, C2: 65.41, Db2: 69.30, Eb2: 77.78,
  F4: 349.23, Ab4: 415.30, C5: 523.25, Db5: 554.37, Eb5: 622.25,
};

/* ---------------- public entry point ---------------- */

export async function buildDemoTrack(ctx, opts = {}) {
  const sampleRate = ctx.sampleRate;
  const beat  = 60 / (opts.bpm || BPM);
  const bars  = opts.bars || BARS;
  const len   = Math.ceil(bars * beat * 4 * sampleRate);

  const [drums, bass, vocals] = await Promise.all([
    renderStem(sampleRate, len, (c, out, noise) => scheduleDrums(c, out, noise, beat, bars)),
    renderStem(sampleRate, len, (c, out) => scheduleBass(c, out, beat, bars)),
    renderStem(sampleRate, len, (c, out) => scheduleVocals(c, out, beat, bars)),
  ]);

  const master = mixBuffers(ctx, [drums, bass, vocals], [0.62, 0.50, 0.44]);
  return { master, vocals, bass, drums };
}

/* ---------------- offline plumbing ---------------- */

async function renderStem(sampleRate, len, schedule) {
  const oac = new OfflineAudioContext(2, len, sampleRate);
  const bus = oac.createGain();
  bus.gain.value = 0.9;
  bus.connect(oac.destination);
  schedule(oac, bus, makeNoise(oac));
  return oac.startRendering();
}

function makeNoise(ctx, seconds = 1.2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/* ---------------- drums ---------------- */

function scheduleDrums(ctx, out, noise, beat, bars) {
  const bar = beat * 4;
  for (let b = 0; b < bars; b++) {
    const t = b * bar;
    kick(ctx, out, t);
    kick(ctx, out, t + beat * 2.5);
    snare(ctx, out, noise, t + beat * 1);
    snare(ctx, out, noise, t + beat * 3);
    for (let i = 0; i < 8; i++) {
      hat(ctx, out, noise, t + i * beat * 0.5, i % 2 ? 0.11 : 0.19);
    }
    if (b % 4 === 3) hat(ctx, out, noise, t + beat * 3.75, 0.13);
  }
}

function kick(ctx, out, t, gain = 0.95) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(145, t);
  o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + 0.46);
}

function snare(ctx, out, noise, t, gain = 0.42) {
  const n = ctx.createBufferSource();
  n.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.9;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
  n.connect(bp).connect(g).connect(out);
  n.start(t); n.stop(t + 0.24);

  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(195, t);
  const og = ctx.createGain();
  og.gain.setValueAtTime(gain * 0.55, t);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  o.connect(og).connect(out);
  o.start(t); o.stop(t + 0.12);
}

function hat(ctx, out, noise, t, gain = 0.16) {
  const n = ctx.createBufferSource();
  n.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 7600;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  n.connect(hp).connect(g).connect(out);
  n.start(t); n.stop(t + 0.08);
}

/* ---------------- bass ---------------- */

const BASS_ROOTS = [NOTE.F1, NOTE.F1, NOTE.Ab1, NOTE.Eb2];
const BASS_SHAPE = [1, 1, 1.5, 1, 1, 2, 1.5, 1];

function scheduleBass(ctx, out, beat, bars) {
  const bar = beat * 4;
  for (let b = 0; b < bars; b++) {
    const root = BASS_ROOTS[b % BASS_ROOTS.length];
    for (let i = 0; i < 8; i++) {
      const t = b * bar + i * beat * 0.5;
      const freq = root * BASS_SHAPE[i];
      const dur = beat * (i % 4 === 3 ? 0.72 : 0.42);
      bassNote(ctx, out, t, freq, dur, i % 2 ? 0.38 : 0.5);
    }
  }
}

function bassNote(ctx, out, t, freq, dur, gain) {
  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.value = freq;

  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = freq;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 5.5;
  lp.frequency.setValueAtTime(880, t);
  lp.frequency.exponentialRampToValueAtTime(210, t + dur);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  saw.connect(lp);
  sub.connect(lp);
  lp.connect(g).connect(out);

  saw.start(t); sub.start(t);
  saw.stop(t + dur + 0.02); sub.stop(t + dur + 0.02);
}

/* ---------------- vocals (formant placeholder) ---------------- */

const PHRASE = [
  [0.0, NOTE.F4,  1.2],
  [1.2, NOTE.Ab4, 0.8],
  [2.0, NOTE.C5,  1.6],
  [4.0, NOTE.Eb5, 1.0],
  [5.0, NOTE.Db5, 0.9],
  [6.0, NOTE.C5,  1.6],
];

function scheduleVocals(ctx, out, beat, bars) {
  const bar = beat * 4;
  for (let b = 0; b < bars; b++) {
    if (b % 4 === 3) continue; // breathing room
    const base = b * bar;
    for (const [pos, freq, durBeats] of PHRASE) {
      const t = base + pos * beat;
      if (t > (bars - 0.25) * bar) continue;
      voxNote(ctx, out, t, freq, durBeats * beat, 0.24);
    }
  }
}

function voxNote(ctx, out, t, freq, dur, gain) {
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(gain, t + 0.055);
  env.gain.setValueAtTime(gain, t + dur * 0.65);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  const mix = ctx.createGain();
  mix.gain.value = 0.5;

  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass'; f1.frequency.value = 720; f1.Q.value = 7;

  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass'; f2.frequency.value = 1240; f2.Q.value = 9;
  const f2g = ctx.createGain(); f2g.gain.value = 0.62;

  for (const detune of [-7, 7]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    o.detune.value = detune;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.1;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = freq * 0.012;
    lfo.connect(lfoAmt).connect(o.frequency);
    lfo.start(t); lfo.stop(t + dur + 0.05);

    o.connect(f1);
    o.connect(f2);
    o.start(t); o.stop(t + dur + 0.05);
  }

  f1.connect(mix);
  f2.connect(f2g).connect(mix);
  mix.connect(env).connect(out);
}

/* ---------------- mastering ---------------- */

function mixBuffers(ctx, buffers, weights) {
  const len = buffers.reduce((m, b) => Math.max(m, b.length), 0);
  const out = ctx.createBuffer(2, len, buffers[0].sampleRate);
  let peak = 0;

  for (let c = 0; c < out.numberOfChannels; c++) {
    const dst = out.getChannelData(c);
    const src = buffers.map((b) => b.getChannelData(Math.min(c, b.numberOfChannels - 1)));

    for (let i = 0; i < len; i++) {
      let v = 0;
      for (let k = 0; k < src.length; k++) v += (src[k][i] || 0) * weights[k];
      dst[i] = v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
  }

  if (peak > 0.94) {
    const scale = 0.94 / peak;
    for (let c = 0; c < out.numberOfChannels; c++) {
      const d = out.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] *= scale;
    }
  }
  return out;
}