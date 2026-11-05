import { StemEngine } from './audio-engine.js';
import { WaveLane, computePeaks } from './waveform.js';
import { buildDemoTrack } from './demo-stems.js';
import { TRACK, RIGHTS, TECH, CONTACT } from './catalog.js';

/* ============================================================
   Stem definitions (UI order)
   ============================================================ */

const STEM_DEFS = [
  { id: 'master', label: 'Master',        gain: 0.86 },
  { id: 'vocals', label: 'Vocals',        gain: 0.86 },
  { id: 'bass',   label: 'Bass',          gain: 0.86 },
  { id: 'drums',  label: 'Drums / Perc',  gain: 0.86 },
];

/* ============================================================
   DOM
   ============================================================ */

const $ = (id) => document.getElementById(id);

const els = {
  status:    $('engine-status'),
  btnLoad:   $('btn-load'),
  fileInput: $('file-input'),
  btnPlay:   $('btn-play'),
  timeNow:   $('time-now'),
  timeTotal: $('time-total'),
  masterVol: $('master-vol'),
  ruler:     $('ruler'),
  lanes:     $('lanes'),
  catId:     $('cat-id'),
  title:     $('track-title'),
  artist:    $('track-artist'),
  meta:      $('track-meta'),
  rights:    $('rights-list'),
  tech:      $('tech-list'),
  btnLic:    $('btn-license'),
  modal:     $('modal'),
  preview:   $('preview'),
  btnCopy:   $('btn-copy'),
  btnMail:   $('btn-mail'),
  toast:     $('toast'),
};

const engine = new StemEngine();
const lanes = [];           // { def, wave, rowEl, muteBtn, soloBtn, laneEl }
let hoverVersion = 0;
let scrubbing = false;
let lastKey = '';

/* ============================================================
   Boot
   ============================================================ */

boot();

async function boot() {
  $('year').textContent = new Date().getFullYear();

  renderStaticMeta();
  setStatus('busy', 'ENGINE · BUILDING');

  try {
    await engine.init();
    await loadDemo();
    setStatus('ready', 'ENGINE · READY');
  } catch (err) {
    console.error(err);
    setStatus('idle', 'ENGINE · ERROR');
    toast('Audio engine failed to initialise.');
  }

  bindTransport();
  bindMixControls();
  bindModal();
  bindFileLoader();
  startRenderLoop();
}

/* ============================================================
   Loading
   ============================================================ */

async function loadDemo() {
const buffers = await buildDemoTrack(engine.ctx);

  const payload = STEM_DEFS
    .filter((d) => buffers[d.id])
    .map((d) => ({
      ...d,
      buffer: buffers[d.id],
      peaks: computePeaks(buffers[d.id]),
    }));

  engine.load(payload);
  buildLanes();
  onLoaded();
}

async function loadFiles(files) {
  setStatus('busy', 'DECODING');

  try {
    const decoded = [];

    for (const file of files) {
      const bytes = await file.arrayBuffer();
      const buffer = await engine.ctx.decodeAudioData(bytes);
      decoded.push({ name: file.name.toLowerCase(), buffer });
    }

    const picked = {};
    const unmatched = [];

    for (const item of decoded) {
      const id = guessStemId(item.name);
      if (id && !picked[id]) picked[id] = item.buffer;
      else unmatched.push(item);
    }
    for (const item of unmatched) {
      const free = STEM_DEFS.find((d) => !picked[d.id]);
      if (free) picked[free.id] = item.buffer;
    }

    const payload = STEM_DEFS
      .filter((d) => picked[d.id])
      .map((d) => ({ ...d, buffer: picked[d.id], peaks: computePeaks(picked[d.id]) }));

    if (payload.length < 2) {
      toast('Need at least 2 stems to build a session.');
      setStatus('ready', 'ENGINE · READY');
      return;
    }

    engine.load(payload);
    buildLanes();
    onLoaded();
    setStatus('ready', 'ENGINE · READY');
    toast(`Loaded ${payload.length} stems.`);
  } catch (err) {
    console.error(err);
    setStatus('ready', 'ENGINE · READY');
    toast('Could not decode those files.');
  }
}

function guessStemId(name) {
  if (/master|mix(down)?|full/.test(name)) return 'master';
  if (/vocal|vox|voice|acap|a\s?cap/.test(name)) return 'vocals';
  if (/bass|sub|808/.test(name)) return 'bass';
  if (/drum|perc|beat|kick|snare/.test(name)) return 'drums';
  return null;
}

function onLoaded() {
  els.btnPlay.disabled = false;
  els.timeTotal.textContent = formatTime(engine.duration);
  renderRuler();
  updateMixUI();
}

/* ============================================================
   Lane construction
   ============================================================ */

function buildLanes() {
  els.lanes.innerHTML = '';
  lanes.length = 0;

  for (const stem of engine.stems) {
    const row = document.createElement('div');
    row.className = 'stem-row';

    row.innerHTML = `
      <div class="strip">
        <div class="strip-top">
          <span class="strip-label"></span>
          <div class="strip-btns">
            <button class="ms-btn" data-act="mute" aria-label="Mute ${stem.label}" aria-pressed="false">M</button>
            <button class="ms-btn" data-act="solo" aria-label="Solo ${stem.label}" aria-pressed="false">S</button>
          </div>
        </div>
        <input class="strip-gain" type="range" min="0" max="1" step="0.01"
               value="${stem.gain}" aria-label="${stem.label} level">
      </div>
      <div class="lane"><canvas></canvas></div>
    `;

    row.querySelector('.strip-label').textContent = stem.label;

    const laneEl  = row.querySelector('.lane');
    const canvas  = row.querySelector('canvas');
    const muteBtn = row.querySelector('[data-act="mute"]');
    const soloBtn = row.querySelector('[data-act="solo"]');
    const gainEl  = row.querySelector('.strip-gain');

    const wave = new WaveLane(canvas);
    wave.setPeaks(stem.peaks);

    const record = { stem, wave, rowEl: row, laneEl, muteBtn, soloBtn };
    lanes.push(record);

    /* ---- mute / solo ---- */
    muteBtn.addEventListener('click', () => {
      engine.setMute(stem.id, !stem.muted);
      updateMixUI();
    });
    soloBtn.addEventListener('click', () => {
      engine.setSolo(stem.id, !stem.soloed);
      updateMixUI();
    });

    /* ---- per-stem gain ---- */
    gainEl.addEventListener('input', () => {
      engine.setStemGain(stem.id, parseFloat(gainEl.value));
    });

    /* ---- scrubbing ---- */
    laneEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      laneEl.setPointerCapture(e.pointerId);
      scrubbing = true;
      seekFromPointer(laneEl, e);
    });
    laneEl.addEventListener('pointermove', (e) => {
      const r = laneEl.getBoundingClientRect();
      wave.hover = e.clientX - r.left;
      hoverVersion++;
      if (scrubbing) seekFromPointer(laneEl, e);
    });
    laneEl.addEventListener('pointerup', (e) => {
      scrubbing = false;
      try { laneEl.releasePointerCapture(e.pointerId); } catch (_) {}
    });
    laneEl.addEventListener('pointercancel', () => { scrubbing = false; });
    laneEl.addEventListener('pointerleave', () => {
      wave.hover = -1;
      hoverVersion++;
    });

    els.lanes.appendChild(row);

    // canvas sizing must happen after insertion
    requestAnimationFrame(() => wave.resize());
  }

  const ro = new ResizeObserver(() => {
    for (const l of lanes) l.wave.resize();
  });
  ro.observe(els.lanes);

  window.addEventListener('resize', () => {
    for (const l of lanes) l.wave.resize();
    renderRuler();
  });
}

function seekFromPointer(laneEl, e) {
  if (!engine.duration) return;
  const r = laneEl.getBoundingClientRect();
  const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  engine.seek(p * engine.duration);
}

/* ============================================================
   UI sync
   ============================================================ */

function updateMixUI() {
  const anySolo = engine.stems.some((s) => s.soloed);

  for (const l of lanes) {
    const s = l.stem;
    l.muteBtn.classList.toggle('is-on', s.muted);
    l.muteBtn.setAttribute('aria-pressed', String(s.muted));
    l.soloBtn.classList.toggle('is-on', s.soloed);
    l.soloBtn.setAttribute('aria-pressed', String(s.soloed));
    l.rowEl.classList.toggle('is-dimmed', !engine.isAudible(s));
  }
  // `anySolo` reserved for future strip-level indicators
  void anySolo;
}

function setPlayUI(playing) {
  els.btnPlay.classList.toggle('is-playing', playing);
  els.btnPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

function setStatus(state, text) {
  els.status.dataset.state = state;
  els.status.textContent = text;
}

/* ============================================================
   Render loop — redraws only when something actually changed
   ============================================================ */

function startRenderLoop() {
  const frame = () => {
    engine.tick();

    const t = engine.currentTime;
    const key = `${t.toFixed(3)}|${hoverVersion}|${engine.playing}`;

    if (key !== lastKey) {
      lastKey = key;

      const p = engine.duration ? t / engine.duration : 0;
      for (const l of lanes) l.wave.draw(p, l.wave.hover);
      els.timeNow.textContent = formatTime(t);

      if (els.btnPlay.classList.contains('is-playing') !== engine.playing) {
        setPlayUI(engine.playing);
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* ============================================================
   Transport
   ============================================================ */

function bindTransport() {
  els.btnPlay.addEventListener('click', async () => {
    await engine.toggle();
    setPlayUI(engine.playing);
  });

  els.masterVol.addEventListener('input', () => {
    engine.setMasterGain(parseFloat(els.masterVol.value));
  });

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
    engine.toggle();
    setPlayUI(engine.playing);
  });
}

function bindMixControls() {
  engine.on('loaded', updateMixUI);
  engine.on('mix', updateMixUI);
  engine.on('statechange', () => setPlayUI(engine.playing));
}

/* ============================================================
   Ruler
   ============================================================ */

function renderRuler() {
  const dur = engine.duration || 0;
  els.ruler.innerHTML = '';
  if (!dur) return;

  const step = dur > 90 ? 30 : dur > 45 ? 15 : 5;
  let first = true;

  for (let t = 0; t <= dur + 0.001; t += step) {
    const tick = document.createElement('span');
    tick.className = 'tick' + (first ? ' is-first' : '');
    tick.style.left = `${(t / dur) * 100}%`;
    tick.textContent = formatTime(t);
    els.ruler.appendChild(tick);
    first = false;
  }
}

/* ============================================================
   Static metadata
   ============================================================ */

function renderStaticMeta() {
  els.catId.textContent = TRACK.catalogId;
  els.title.textContent = TRACK.title;
  els.artist.textContent = `${TRACK.artist} — ${TRACK.version}`;

  const chips = [
    ['BPM', TRACK.bpm],
    ['Key', TRACK.key],
    ['ISRC', TRACK.isrc],
    ['Catalog', TRACK.catalogId],
  ];
  els.meta.innerHTML = chips
    .map(([k, v]) => `<span class="chip">${esc(k)} <b>${esc(String(v))}</b></span>`)
    .join('');

  fillKv(els.rights, RIGHTS);
  fillKv(els.tech, TECH);
}

function fillKv(list, rows) {
  list.innerHTML = rows
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join('');
}

/* ============================================================
   License modal
   ============================================================ */

function bindModal() {
  els.btnLic.addEventListener('click', openModal);

  els.modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.modal.hidden) closeModal();
  });

  const inputs = els.modal.querySelectorAll('input, select, textarea');
  inputs.forEach((el) => {
    el.addEventListener('input', refreshPreview);
    el.addEventListener('change', refreshPreview);
  });

  els.btnCopy.addEventListener('click', async () => {
    const { subject, body } = buildRequest();
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      toast('Request copied to clipboard.');
    } catch (_) {
      toast('Clipboard unavailable — select the preview manually.');
    }
  });
}

function openModal() {
  refreshPreview();
  els.modal.hidden = false;
  els.modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  const first = els.modal.querySelector('#f-name');
  if (first) setTimeout(() => first.focus(), 40);
}

function closeModal() {
  els.modal.hidden = true;
  els.modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function refreshPreview() {
  const { subject, body } = buildRequest();
  els.preview.textContent = `${subject}\n\n${body}`;
  els.btnMail.href =
    `mailto:${CONTACT.email}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;
}

function buildRequest() {
  const v = (id) => (($(id) && $(id).value) || '').trim() || '—';

  const subject = `Sync License Inquiry — ${TRACK.title} [${TRACK.catalogId}]`;

  const body = [
    'Hello Leoneigh Unfiltered,',
    '',
    `I would like to license "${TRACK.title}" (${TRACK.catalogId}) for the project below.`,
    '',
    'PROJECT',
    `Licensee:   ${v('f-name')}`,
    `Company:    ${v('f-company')}`,
    `Project:    ${v('f-project')}`,
    `Usage:      ${v('f-usage')}`,
    `Term:       ${v('f-term')}`,
    `Territory:  ${v('f-territory')}`,
    '',
    'TRACK',
    `Catalog ID: ${TRACK.catalogId}`,
    `ISRC:       ${TRACK.isrc}`,
    `BPM / Key:  ${TRACK.bpm} / ${TRACK.key}`,
    `SAMRO:      ${TRACK.samro}`,
    'Master:     100% Leoneigh Unfiltered',
    'Publishing: 100% Leoneigh Unfiltered',
    '',
    'NOTES',
    v('f-notes'),
    '',
    'Thank you,',
    v('f-name') === '—' ? '' : v('f-name'),
  ].join('\n');

  return { subject, body };
}

/* ============================================================
   File loader
   ============================================================ */

function bindFileLoader() {
  els.btnLoad.addEventListener('click', () => els.fileInput.click());

  els.fileInput.addEventListener('change', async () => {
    const files = Array.from(els.fileInput.files || []);
    els.fileInput.value = '';
    if (!files.length) return;
    await loadFiles(files);
  });
}

/* ============================================================
   Helpers
   ============================================================ */

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let toastTimer;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 2600);
}