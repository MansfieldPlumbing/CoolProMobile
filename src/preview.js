// src/preview.js — playback engine.
// Advances a transport clock, composites the active video/image clip onto the
// preview canvas, and drives per-media HTMLMediaElements whose audio is routed
// through audio.js (per-element gain → master). Sample-accurate mixing is left to
// export.js (OfflineAudioContext); this is a robust real-time *preview*.
import { $, clamp } from './util.js';
import * as S from './store.js';
import { ctx as audioCtx, graphFor, unlock } from './audio.js';
import { setPlayhead } from './timeline.js';

let canvas, g;
const els = new Map();      // mediaId -> HTMLMediaElement
let raf = 0, last = 0;
let throughTick = null, throughDone = null;

export function initPreview() {
  canvas = $('#preview'); g = canvas.getContext('2d');
  sizeCanvas();
  initPreviewViewport();
  S.subscribe((reason) => {
    if (reason === 'project' || reason === 'load') sizeCanvas();
    if (reason === 'transport' && !S.state.transport.playing) drawAt(S.state.transport.time);
    if (['load', 'clip-add', 'clip-remove', 'tracks'].includes(reason)) drawAt(S.state.transport.time);
  });
  drawAt(0);
}

// ---- pasteboard pan/zoom (flickpaint's #stage transform, ported) ----------------------------
// The artboard (#preview) sits on the infinite checker; #previewStage is the transform host.
// The preview is output-only here (painting happens in the paint guest), so a pan/zoom transform
// is purely visual and never interferes with input.
let pvStage, pv = { s: 1, x: 0, y: 0 };
function applyPv() { if (pvStage) pvStage.style.transform = `translate(${pv.x}px,${pv.y}px) scale(${pv.s})`; }
function zoomBy(f) { pv.s = clamp(pv.s * f, 0.2, 8); applyPv(); }
export function fitPreview() { pv = { s: 1, x: 0, y: 0 }; applyPv(); }
function initPreviewViewport() {
  pvStage = $('#previewStage');
  const vp = pvStage && pvStage.parentElement;       // .viewport.pasteboard
  if (!vp) return;
  vp.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
  let drag = false, sx = 0, sy = 0, ox = 0, oy = 0;
  vp.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.pv-zoom')) return;        // let the HUD buttons click
    drag = true; sx = e.clientX; sy = e.clientY; ox = pv.x; oy = pv.y;
    try { vp.setPointerCapture(e.pointerId); } catch (_) {}
  });
  vp.addEventListener('pointermove', (e) => { if (!drag) return; pv.x = ox + (e.clientX - sx); pv.y = oy + (e.clientY - sy); applyPv(); });
  const end = (e) => { drag = false; try { vp.releasePointerCapture(e.pointerId); } catch (_) {} };
  vp.addEventListener('pointerup', end); vp.addEventListener('pointercancel', end);
  vp.addEventListener('dblclick', fitPreview);
  $('#pvZoomIn')?.addEventListener('click', () => zoomBy(1.25));
  $('#pvZoomOut')?.addEventListener('click', () => zoomBy(1 / 1.25));
  $('#pvZoomFit')?.addEventListener('click', fitPreview);
  applyPv();
}

function sizeCanvas() {
  const p = S.state.project;
  canvas.width = p.width; canvas.height = p.height;
}

function elFor(m) {
  let el = els.get(m.id);
  if (!el) {
    el = document.createElement(m.kind === 'audio' ? 'audio' : 'video');
    el.src = m.url; el.preload = 'auto'; el.crossOrigin = 'anonymous';
    el.playsInline = true;
    els.set(m.id, el);
  }
  return el;
}

const imgCache = new Map();
function imgFor(m) {
  let im = imgCache.get(m.id);
  if (!im) { im = new Image(); im.src = m.url; imgCache.set(m.id, im); }
  return im;
}

// Which clips are live at time t, per track.
function activeAt(t) {
  const res = [];
  for (const track of S.state.project.tracks) {
    for (const c of track.clips) {
      if (t >= c.t0 && t < c.t0 + c.dur) { res.push({ clip: c, track }); break; }
    }
  }
  return res;
}

export function play() {
  if (S.state.transport.playing) return;
  if (S.duration() <= 0) return;
  unlock();
  if (S.state.transport.time >= S.duration() - 0.01) S.setTransport({ time: 0 });
  S.setTransport({ playing: true });
  last = performance.now();
  loop();
}
export function pause() {
  S.setTransport({ playing: false });
  cancelAnimationFrame(raf); raf = 0;
  for (const el of els.values()) el.pause();
}
export function toggle() { S.state.transport.playing ? pause() : play(); }
export function seek(t) { S.setTransport({ time: clamp(t, 0, Math.max(0, S.duration())) }); }
export function toStart() { seek(0); }
export function toEnd() { seek(S.duration()); }

function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  let t = S.state.transport.time + dt;
  const dur = S.duration();
  if (t >= dur) {
    t = dur; S.setTransport({ time: t }); render(t, true);
    pause();
    if (throughDone) { throughTick?.(t); const d = throughDone; throughTick = throughDone = null; d(); }
    return;
  }
  S.setTransport({ time: t });
  render(t, true);
  throughTick?.(t);
  raf = requestAnimationFrame(loop);
}

// Play the whole timeline once in realtime; resolve when it reaches the end.
// Used by export.js to drive a MediaRecorder capture.
export function playThrough(onTick) {
  return new Promise((resolve) => {
    throughTick = onTick; throughDone = resolve;
    seek(0); play();
  });
}

// paused single-frame render
export function drawAt(t) { render(t, false); }

function render(t, playing) {
  setPlayhead(t, playing);
  const active = activeAt(t);
  const liveMedia = new Set();

  // ---- audio: every active audio/video clip drives its element ----
  for (const { clip, track } of active) {
    const m = S.media.get(clip.mediaId); if (!m || m.kind === 'image') continue;
    liveMedia.add(m.id);
    const el = elFor(m);
    const target = clip.in + (t - clip.t0);
    const gain = graphFor(el).gain;
    const vol = S.trackGain(track, clip);
    if (gain) gain.gain.value = vol;
    if (playing) {
      if (Math.abs(el.currentTime - target) > 0.3 || el.seeking) { try { el.currentTime = target; } catch (_) {} }
      if (el.paused) el.play().catch(() => {});
    } else {
      try { el.currentTime = target; } catch (_) {}
      if (!el.paused) el.pause();
    }
  }
  // pause / silence everything not live this frame
  for (const [id, el] of els) {
    if (!liveMedia.has(id)) { if (!el.paused) el.pause(); const gg = graphFor(el).gain; if (gg) gg.gain.value = 0; }
  }

  // ---- video: topmost active visual clip wins ----
  g.fillStyle = '#000'; g.fillRect(0, 0, canvas.width, canvas.height);
  let visual = null;
  for (const a of active) { const m = S.media.get(a.clip.mediaId); if (m && (m.kind === 'video' || m.kind === 'image')) visual = a; }
  if (visual) {
    const m = S.media.get(visual.clip.mediaId);
    const src = m.kind === 'image' ? imgFor(m) : elFor(m);
    const sw = m.width || src.videoWidth || canvas.width, sh = m.height || src.videoHeight || canvas.height;
    drawFit(src, sw, sh);
  }
}

function drawFit(src, sw, sh) {
  if (!sw || !sh) return;
  const scale = Math.min(canvas.width / sw, canvas.height / sh);
  const w = sw * scale, h = sh * scale;
  const x = (canvas.width - w) / 2, y = (canvas.height - h) / 2;
  try { g.drawImage(src, x, y, w, h); } catch (_) {}
}
