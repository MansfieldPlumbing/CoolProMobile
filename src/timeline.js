// src/timeline.js — multi-track timeline: canvas render + pointer interactions
// (scrub, select, drag-move, edge-trim) and a DOM playhead. Reads/writes the store.
import { $, clamp } from './util.js';
import * as S from './store.js';
import { attachContextMenu, openMenu } from './contextmenu.js';

const RULER_H = 24, TRACK_H = 58, GAP = 6;
let cv, ctx, scroll, wrap, playhead, heads, headsInner;
let pxPerSec = 90;
const C = {};   // resolved theme colors
let drag = null; // { mode, id, grabDx, edge, startT0, startDur, startIn }

export function initTimeline() {
  cv = $('#tl-canvas'); ctx = cv.getContext('2d');
  scroll = $('#tlScroll'); wrap = $('#tlWrap'); playhead = $('#tl-playhead');
  heads = $('#tlHeaders'); headsInner = $('#tlHeadersInner');
  // the header column doesn't scroll horizontally; vertical scroll is mirrored from the lanes.
  if (scroll && headsInner) scroll.addEventListener('scroll', () => { headsInner.style.transform = `translateY(${-scroll.scrollTop}px)`; });
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['--surface','--surface-2','--panel','--border','--border-2','--muted','--fg',
    '--clip-video','--clip-audio','--clip-image','--accent','--track-video','--track-audio'])
    C[k] = cs.getPropertyValue(k).trim();

  $('#tlZoom').addEventListener('input', (e) => { pxPerSec = +e.target.value; render(); });
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('contextmenu', (e) => { e.preventDefault(); const { x, y } = localXY(e); if (y >= RULER_H) canvasMenu(e.clientX, e.clientY, x, y); });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  S.subscribe((reason) => {
    if (reason === 'transport') return setPlayhead(S.state.transport.time, true);
    render();
    renderHeaders();
  });
  render();
  renderHeaders();
}

// ---- track headers (the strip left of the lanes: name · Mute · Solo · volume) ----
// Rows are rebuilt only when the track COUNT changes; otherwise state updates in place so a
// volume drag (the active range input) is never recreated under the user's finger.
function renderHeaders() {
  if (!headsInner) return;
  const tracks = S.state.project.tracks;
  let rows = [...headsInner.querySelectorAll('.trk-head')];
  if (rows.length !== tracks.length) {
    headsInner.innerHTML = `<div class="tl-head-spacer" style="height:${RULER_H}px"></div>` + tracks.map(headHTML).join('');
    rows = [...headsInner.querySelectorAll('.trk-head')];
    rows.forEach((row) => wireHeaderRow(row));
  }
  rows.forEach((row, i) => {
    const t = tracks[i]; if (!t) return;
    row.dataset.id = t.id; row.dataset.kind = t.kind;
    row.querySelector('.trk-name').textContent = t.name;
    row.querySelector('.trk-m').classList.toggle('on', !!t.muted);
    row.querySelector('.trk-s').classList.toggle('on', !!t.solo);
    const vol = row.querySelector('.trk-vol');
    if (vol !== document.activeElement) vol.value = Math.round((t.volume ?? 1) * 100);
  });
}
function headHTML(t) {
  return `<div class="trk-head" data-id="${t.id}" data-kind="${t.kind}" style="height:${TRACK_H}px;margin-bottom:${GAP}px">
    <div class="trk-top">
      <span class="trk-ic"></span><span class="trk-name"></span>
      <button class="trk-btn trk-m" title="Mute track">M</button>
      <button class="trk-btn trk-s" title="Solo track">S</button>
    </div>
    <input class="trk-vol" type="range" min="0" max="150" value="100" title="Track volume">
  </div>`;
}
function wireHeaderRow(row) {
  const id = row.dataset.id;
  const get = () => S.state.project.tracks.find((x) => x.id === id);
  row.querySelector('.trk-m').addEventListener('click', () => { const t = get(); if (t) S.setTrack(id, { muted: !t.muted }); });
  row.querySelector('.trk-s').addEventListener('click', () => { const t = get(); if (t) S.setTrack(id, { solo: !t.solo }); });
  // live during drag: mutate volume + nudge (preview re-applies the gain); persisted on the same emit.
  row.querySelector('.trk-vol').addEventListener('input', (e) => { const t = get(); if (t) { t.volume = +e.target.value / 100; S.nudge('tracks'); } });
  attachContextMenu(row, () => trackMenu(get()));
}

// ---- context menus (long-press / right-click) ----
function trackMenu(t) {
  if (!t) return [];
  const last = S.state.project.tracks.length <= 1;
  return [
    { label: 'Rename track…', icon: '✎', run: () => { const n = prompt('Track name', t.name); if (n != null && n.trim()) S.setTrack(t.id, { name: n.trim() }); } },
    '-',
    { label: 'Mute', icon: '🔇', checked: !!t.muted, run: () => S.setTrack(t.id, { muted: !t.muted }) },
    { label: 'Solo', icon: '◉', checked: !!t.solo, run: () => S.setTrack(t.id, { solo: !t.solo }) },
    '-',
    { label: 'Add video track', icon: '＋', run: () => S.addTrack('video') },
    { label: 'Add audio track', icon: '＋', run: () => S.addTrack('audio') },
    '-',
    { label: 'Delete track', icon: '🗑', danger: true, disabled: last, run: () => S.removeTrack(t.id) },
  ];
}
function clipMenu(clip) {
  return [
    { label: 'Split at playhead', icon: '✂', run: () => S.splitClipAt(clip.id, S.state.transport.time) },
    { label: 'Duplicate', icon: '⧉', run: () => S.duplicateClip(clip.id) },
    '-',
    { label: 'Delete clip', icon: '🗑', danger: true, run: () => S.removeClip(clip.id) },
  ];
}
// Open the right menu for whatever is under a canvas point (screen px for placement, local px to hit-test).
function canvasMenu(clientX, clientY, x, y) {
  const hit = hitClip(x, y);
  if (hit) { S.select(hit.clip.id); openMenu(clientX, clientY, clipMenu(hit.clip)); return; }
  const ti = trackAtY(y); const t = ti >= 0 && S.state.project.tracks[ti];
  if (t) openMenu(clientX, clientY, trackMenu(t));
}

// long-press on the canvas → context menu (fires only if held still over a lane; cancels the drag).
let lpTimer = null, lpCX = 0, lpCY = 0;
function armLongPress(e, x, y) {
  clearLongPress();
  if (y < RULER_H) return;
  lpCX = e.clientX; lpCY = e.clientY;
  lpTimer = setTimeout(() => { lpTimer = null; drag = null; canvasMenu(lpCX, lpCY, x, y); }, 480);
}
function clearLongPress() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } }
function lpMoveCheck(e) { if (lpTimer && Math.hypot(e.clientX - lpCX, e.clientY - lpCY) > 10) clearLongPress(); }

// ---- geometry ----
const xForT = (t) => t * pxPerSec;
const tForX = (x) => x / pxPerSec;
const trackTop = (i) => RULER_H + i * (TRACK_H + GAP);
function trackAtY(y) {
  if (y < RULER_H) return -1;
  return Math.floor((y - RULER_H) / (TRACK_H + GAP));
}

export function getPxPerSec() { return pxPerSec; }

// ---- render ----
export function render() {
  if (!ctx) return;
  const tracks = S.state.project.tracks;
  const viewSecs = Math.max(S.duration() + 4, scroll.clientWidth / pxPerSec, 12);
  const W = Math.ceil(viewSecs * pxPerSec);
  const H = RULER_H + tracks.length * (TRACK_H + GAP);
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== W * dpr || cv.height !== H * dpr) {
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  }
  playhead.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // track lanes
  tracks.forEach((t, i) => {
    const y = trackTop(i);
    ctx.fillStyle = C['--panel'];
    ctx.fillRect(0, y, W, TRACK_H);
    ctx.fillStyle = (t.kind === 'video' ? C['--track-video'] : C['--track-audio']);
    ctx.globalAlpha = 0.18; ctx.fillRect(0, y, W, TRACK_H); ctx.globalAlpha = 1;
    ctx.fillStyle = C['--muted']; ctx.font = '10px ' + 'system-ui'; ctx.textBaseline = 'top';
    ctx.fillText(t.name + (t.muted ? '  (muted)' : ''), 6, y + 4);
  });

  // ruler
  ctx.fillStyle = C['--surface']; ctx.fillRect(0, 0, W, RULER_H);
  const step = niceStep(pxPerSec);
  ctx.strokeStyle = C['--border']; ctx.fillStyle = C['--muted'];
  ctx.font = '10px ' + 'monospace'; ctx.textBaseline = 'alphabetic';
  for (let t = 0; t <= viewSecs; t += step) {
    const x = Math.round(xForT(t)) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, RULER_H); ctx.stroke();
    ctx.fillText(label(t), x + 3, 16);
  }

  // clips
  tracks.forEach((t, i) => {
    const y = trackTop(i);
    for (const clip of t.clips) drawClip(clip, t, y);
  });
}

function drawClip(clip, track, y) {
  const x = xForT(clip.t0), w = Math.max(2, xForT(clip.dur));
  const col = clip.kind === 'audio' ? C['--clip-audio'] : clip.kind === 'image' ? C['--clip-image'] : C['--clip-video'];
  const sel = S.state.selection === clip.id;
  roundRect(x + 1, y + 4, w - 2, TRACK_H - 8, 5);
  ctx.fillStyle = col; ctx.globalAlpha = sel ? 1 : 0.85; ctx.fill(); ctx.globalAlpha = 1;
  if (sel) { ctx.lineWidth = 2; ctx.strokeStyle = C['--fg']; ctx.stroke(); }

  // waveform for audio clips
  const m = S.media.get(clip.mediaId);
  if (m && m.kind === 'audio' && m.waveform && w > 8) {
    ctx.save();
    roundRect(x + 1, y + 4, w - 2, TRACK_H - 8, 5); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,.45)';
    const mid = y + TRACK_H / 2, span = TRACK_H / 2 - 8;
    const startFrac = (clip.in) / Math.max(0.001, m.duration);
    const endFrac = (clip.in + clip.dur) / Math.max(0.001, m.duration);
    const i0 = Math.floor(startFrac * m.waveform.length), i1 = Math.floor(endFrac * m.waveform.length);
    ctx.beginPath();
    for (let px = 0; px < w; px++) {
      const idx = i0 + Math.floor((px / w) * (i1 - i0));
      const v = m.waveform[clamp(idx, 0, m.waveform.length - 1)] || 0;
      ctx.moveTo(x + px, mid - v * span); ctx.lineTo(x + px, mid + v * span);
    }
    ctx.stroke(); ctx.restore();
  } else if (m && m.thumbUrl && w > 20) {
    // (poster handled lazily via cached Image)
    const img = thumbImg(m);
    if (img && img.complete && img.naturalWidth) {
      ctx.save(); roundRect(x + 1, y + 4, w - 2, TRACK_H - 8, 5); ctx.clip();
      const ih = TRACK_H - 8, iw = ih * (img.naturalWidth / img.naturalHeight);
      ctx.globalAlpha = 0.55; ctx.drawImage(img, x + 2, y + 4, iw, ih); ctx.globalAlpha = 1; ctx.restore();
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.font = '11px system-ui'; ctx.textBaseline = 'top';
  ctx.save(); roundRect(x + 1, y + 4, w - 2, TRACK_H - 8, 5); ctx.clip();
  ctx.fillText((m ? m.name : 'clip'), x + 7, y + 8); ctx.restore();
}

const _thumbs = new Map();
function thumbImg(m) {
  if (!m.thumbUrl) return null;
  let img = _thumbs.get(m.id);
  if (!img) { img = new Image(); img.onload = () => render(); img.src = m.thumbUrl; _thumbs.set(m.id, img); }
  return img;
}

// ---- interactions ----
function localXY(e) {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function hitClip(x, y) {
  const ti = trackAtY(y); if (ti < 0) return null;
  const track = S.state.project.tracks[ti]; if (!track) return null;
  const top = trackTop(ti);
  if (y < top + 4 || y > top + TRACK_H - 4) return null;
  for (let k = track.clips.length - 1; k >= 0; k--) {
    const c = track.clips[k];
    const cx = xForT(c.t0), cw = xForT(c.dur);
    if (x >= cx && x <= cx + cw) {
      const edge = x - cx < 8 ? 'l' : (cx + cw) - x < 8 ? 'r' : null;
      return { clip: c, track, edge };
    }
  }
  return null;
}

function onDown(e) {
  const { x, y } = localXY(e);
  armLongPress(e, x, y);
  if (y < RULER_H) { drag = { mode: 'scrub' }; scrubTo(x); return; }
  const hit = hitClip(x, y);
  if (!hit) { S.select(null); drag = { mode: 'scrub' }; scrubTo(x); return; }
  S.select(hit.clip.id);
  cv.setPointerCapture?.(e.pointerId);
  if (hit.edge) drag = { mode: 'trim', edge: hit.edge, id: hit.clip.id,
    startT0: hit.clip.t0, startDur: hit.clip.dur, startIn: hit.clip.in, downX: x };
  else drag = { mode: 'move', id: hit.clip.id, grabDx: x - xForT(hit.clip.t0) };
}

function onMove(e) {
  lpMoveCheck(e);
  if (!drag) { return; }
  const { x } = localXY(e);
  if (drag.mode === 'scrub') return scrubTo(x);
  if (drag.mode === 'move') {
    let t0 = tForX(x - drag.grabDx);
    t0 = snap(t0, drag.id);
    S.moveClip(drag.id, Math.max(0, t0));
  } else if (drag.mode === 'trim') {
    const f = S.findClip(drag.id); if (!f) return;
    const m = S.media.get(f.clip.mediaId);
    const srcDur = m ? (m.kind === 'image' ? Infinity : m.duration) : Infinity;
    if (drag.edge === 'r') {
      let dur = tForX(x) - drag.startT0;
      dur = clamp(dur, 0.1, srcDur - drag.startIn);
      S.resizeClip(drag.id, { dur });
    } else {
      let t0 = clamp(tForX(x), 0, drag.startT0 + drag.startDur - 0.1);
      const delta = t0 - drag.startT0;
      const inPoint = clamp(drag.startIn + delta, 0, srcDur);
      S.resizeClip(drag.id, { t0, inPoint, dur: drag.startDur - delta });
    }
  }
}
function onUp() { drag = null; clearLongPress(); }

function scrubTo(x) { S.setTransport({ time: Math.max(0, tForX(x)) }); }

// snap clip start to nearby clip edges / playhead (within 7px)
function snap(t0, selfId) {
  const thr = 7 / pxPerSec, edges = [S.state.transport.time];
  for (const { clip } of S.allClips()) {
    if (clip.id === selfId) continue;
    edges.push(clip.t0, clip.t0 + clip.dur);
  }
  for (const e of edges) if (Math.abs(t0 - e) < thr) return e;
  return t0;
}

// ---- playhead ----
export function setPlayhead(time, follow = false) {
  if (!playhead) return;
  const x = xForT(time);
  playhead.style.left = x + 'px';
  if (follow) {
    const left = scroll.scrollLeft, right = left + scroll.clientWidth;
    if (x < left + 40) scroll.scrollLeft = Math.max(0, x - 40);
    else if (x > right - 60) scroll.scrollLeft = x - scroll.clientWidth + 60;
  }
}

// ---- helpers ----
function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function niceStep(pps) {
  const cands = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  for (const s of cands) if (s * pps >= 64) return s;
  return 600;
}
function label(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${t % 1 ? t.toFixed(1) : s}s`;
}
