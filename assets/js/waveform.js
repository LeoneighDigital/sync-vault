/**
 * WaveLane — precomputed-peak waveform renderer.
 *
 * The peak array is rasterised ONCE into two offscreen canvases (dim + hot).
 * Per animation frame we only do two `drawImage` calls and a clipped blit for
 * the "played" region. That is what keeps the playhead non-blocking.
 */

const DPR_CAP = 2;

export class WaveLane {
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.peaks   = null;
    this.progress = 0;
    this.hover    = -1;

    this.w = 0;
    this.h = 0;

    this._dim    = document.createElement('canvas');
    this._hot    = document.createElement('canvas');
    this._dimCtx = null;
    this._hotCtx = null;
    this._ready  = false;
  }

  setPeaks(peaks) {
    this.peaks = peaks;
    this._build();
    this.draw(this.progress, this.hover);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));

    if (w === this.w && h === this.h && this.ctx.getTransform().a === dpr) {
      return;
    }

    this.w = w;
    this.h = h;

    this.canvas.width  = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (const cv of [this._dim, this._hot]) {
      cv.width  = w * dpr;
      cv.height = h * dpr;
    }
    this._dimCtx = this._dim.getContext('2d');
    this._hotCtx = this._hot.getContext('2d');
    this._dimCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._hotCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this._build();
    this.draw(this.progress, this.hover);
  }

  /* ---------------- static rasterisation ---------------- */

  _build() {
    if (!this.peaks || !this.w || !this._dimCtx) {
      this._ready = false;
      return;
    }
    this._paint(this._dimCtx, '#3f3f46', 1);
    this._paint(this._hotCtx, '#dc2626', 1);
    this._ready = true;
  }

  _paint(g, color, alpha) {
    const { w, h, peaks } = this;
    const mid = h / 2;
    const n = peaks.length;

    g.clearRect(0, 0, w, h);
    g.globalAlpha = alpha;
    g.fillStyle = color;

    // 1px bar + 1px gap, DAW style
    for (let x = 0; x < w; x += 2) {
      const a = Math.floor((x / w) * n);
      const b = Math.max(a + 1, Math.floor(((x + 2) / w) * n));

      let peak = 0;
      for (let i = a; i < b; i++) {
        const v = peaks[i] || 0;
        if (v > peak) peak = v;
      }

      const amp = Math.max(0.75, peak * (mid - 3));
      g.fillRect(x, mid - amp, 1, amp * 2);
    }

    g.globalAlpha = 1;
  }

  /* ---------------- per-frame draw ---------------- */

  draw(progress, hover = -1) {
    const { ctx, w, h } = this;
    if (!ctx || !w) return;

    this.progress = progress;
    this.hover = hover;

    ctx.clearRect(0, 0, w, h);

    // lane background
    ctx.fillStyle = 'rgba(255,255,255,.014)';
    ctx.fillRect(0, 0, w, h);

    // centre line
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    ctx.fillRect(0, Math.round(h / 2), w, 1);

    if (this._ready) {
      ctx.drawImage(this._dim, 0, 0, w, h);

      const px = Math.round(progress * w);
      if (px > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, px, h);
        ctx.clip();
        ctx.drawImage(this._hot, 0, 0, w, h);
        ctx.restore();
      }

      // playhead
      ctx.fillStyle = '#f4f4f5';
      ctx.fillRect(px - 0.5, 0, 1, h);

      // playhead cap
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(px - 0.5, 0, 1, 3);
    }

    // hover cursor
    if (hover >= 0) {
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.fillRect(Math.round(hover), 0, 1, h);
    }
  }
}

/* ============================================================
   Peak extraction
   ============================================================ */

/**
 * Reduce an AudioBuffer to a normalised peak array for canvas rendering.
 * @param {AudioBuffer} buffer
 * @param {number} buckets
 * @returns {Float32Array}
 */
export function computePeaks(buffer, buckets = 2048) {
  const out = new Float32Array(buckets);
  const channels = buffer.numberOfChannels;
  const len = buffer.length;
  if (!len) return out;

  const perBucket = len / buckets;
  const stride = Math.max(1, Math.floor(perBucket / 64));

  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let b = 0; b < buckets; b++) {
      const start = Math.floor(b * perBucket);
      const end = Math.min(len, Math.floor((b + 1) * perBucket));
      let peak = out[b];
      for (let i = start; i < end; i += stride) {
        const v = data[i] < 0 ? -data[i] : data[i];
        if (v > peak) peak = v;
      }
      out[b] = peak;
    }
  }

  // per-lane normalisation + gentle perceptual curve
  let max = 0;
  for (let i = 0; i < buckets; i++) if (out[i] > max) max = out[i];
  if (max > 0) {
    for (let i = 0; i < buckets; i++) {
      out[i] = Math.pow(out[i] / max, 0.72);
    }
  }
  return out;
}