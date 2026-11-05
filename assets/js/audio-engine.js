/**
 * StemEngine — synchronous multi-stem playback on a single AudioContext timeline.
 *
 * Design notes:
 *  - All stems are started with the SAME `when` timestamp, so they share one
 *    clock. No drift, no per-stem timers.
 *  - Solo/Mute is implemented purely as GainNode automation — never by
 *    restarting sources. Switching states mid-playback is glitch-free.
 *  - Position is derived from the AudioContext clock, not from a JS counter,
 *    so the playhead cannot desync from audio under main-thread load.
 */

const LOOKAHEAD  = 0.06;  // s — schedule slightly ahead to avoid first-frame jitter
const FADE       = 0.015; // s — gain smoothing time constant
const END_EPS    = 0.012; // s

export class StemEngine {
  constructor() {
    this.ctx        = null;
    this.masterGain = null;
    this.stems      = [];
    this.duration   = 0;
    this.playing    = false;
    this._offset    = 0;
    this._startAt   = 0;
    this._listeners = new Map();
  }

  /* ---------------- lifecycle ---------------- */

  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.9;
    this.masterGain.connect(this.ctx.destination);
    return this.ctx;
  }

  async resume() {
    if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume();
  }

  /* ---------------- loading ---------------- */

  /**
   * @param {Array<{id,label,buffer,peaks,gain?}>} list
   */
  load(list) {
    this.stopAll();
    this.playing = false;
    this._offset = 0;

    this.stems = list.map((s) => {
      const gainNode = this.ctx.createGain();
      gainNode.gain.value = 0;
      gainNode.connect(this.masterGain);
      return {
        id: s.id,
        label: s.label,
        buffer: s.buffer,
        peaks: s.peaks,
        gainNode,
        gain: typeof s.gain === 'number' ? s.gain : 0.85,
        muted: false,
        soloed: false,
        source: null,
      };
    });

    this.duration = this.stems.reduce(
      (max, s) => Math.max(max, s.buffer ? s.buffer.duration : 0), 0
    );

    this._applyGains(0);
    this._emit('loaded');
  }

  /* ---------------- transport ---------------- */

  get currentTime() {
    if (!this.playing) return this._offset;
    const t = this._offset + (this.ctx.currentTime - this._startAt);
    return Math.max(0, Math.min(t, this.duration));
  }

  async play() {
    if (!this.ctx || !this.stems.length || this.playing) return;
    await this.resume();

    if (this._offset >= this.duration - END_EPS) this._offset = 0;

    const when = this.ctx.currentTime + LOOKAHEAD;
    this._startAt = when;

    for (const stem of this.stems) {
      const buf = stem.buffer;
      if (!buf || this._offset >= buf.duration) continue;

      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(stem.gainNode);
      src.start(when, this._offset);
      stem.source = src;
    }

    this.playing = true;
    this._emit('statechange');
  }

  pause() {
    if (!this.playing) return;
    this._offset = this.currentTime;
    this._killSources();
    this.playing = false;
    this._emit('statechange');
  }

  toggle() {
    return this.playing ? this.pause() : this.play();
  }

  seek(time) {
    const t = Math.max(0, Math.min(time, this.duration || 0));
    const wasPlaying = this.playing;

    if (wasPlaying) {
      this._killSources();
      this.playing = false;
    }

    this._offset = t;

    if (wasPlaying) this.play();
    else this._emit('seek');
  }

  stop() {
    this._killSources();
    this.playing = false;
    this._offset = 0;
    this._emit('statechange');
  }

  /** Called by the render loop; handles natural end-of-track. */
  tick() {
    if (!this.playing) return;
    if (this.currentTime >= this.duration - END_EPS) {
      this._killSources();
      this.playing = false;
      this._offset = 0;
      this._emit('statechange');
    }
  }

  /* ---------------- mixing ---------------- */

  setMute(id, value) {
    const s = this._find(id); if (!s) return;
    s.muted = !!value;
    this._applyGains(FADE);
    this._emit('mix');
  }

  setSolo(id, value) {
    const s = this._find(id); if (!s) return;
    s.soloed = !!value;
    this._applyGains(FADE);
    this._emit('mix');
  }

  setStemGain(id, value) {
    const s = this._find(id); if (!s) return;
    s.gain = Math.max(0, Math.min(1, value));
    this._applyGains(FADE);
  }

  setMasterGain(value) {
    if (!this.masterGain) return;
    const v = Math.max(0, Math.min(1, value));
    this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, FADE);
  }

  /** True when the stem is currently audible under the solo matrix. */
  isAudible(stem) {
    const anySolo = this.stems.some((s) => s.soloed);
    return anySolo ? stem.soloed : !stem.muted;
  }

  /* ---------------- internals ---------------- */

  _find(id) { return this.stems.find((s) => s.id === id); }

  _applyGains(ramp = FADE) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const anySolo = this.stems.some((s) => s.soloed);

    for (const s of this.stems) {
      const audible = anySolo ? s.soloed : !s.muted;
      const target = audible ? s.gain : 0;
      if (ramp > 0) s.gainNode.gain.setTargetAtTime(target, now, ramp);
      else s.gainNode.gain.value = target;
    }
  }

  _killSources() {
    for (const s of this.stems) {
      if (!s.source) continue;
      try { s.source.onended = null; s.source.stop(); } catch (_) { /* already ended */ }
      try { s.source.disconnect(); } catch (_) { /* noop */ }
      s.source = null;
    }
  }

  stopAll() {
    this._killSources();
    for (const s of this.stems) {
      try { s.gainNode.disconnect(); } catch (_) {}
    }
    this.stems = [];
  }

  /* ---------------- events ---------------- */

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this._listeners.get(event).delete(fn);
  }

  _emit(event) {
    const set = this._listeners.get(event);
    if (set) for (const fn of set) fn(this);
  }
}