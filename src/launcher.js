// src/launcher.js — the Launcher as a composable drill-down (settings.obp shape). The home tree
// is first-class templates across every surface: Create (sized video projects · canvas · 3D),
// Edit (open a surface), Quick tools (the ffmpeg/dpx workflows), and Settings (live theme). One
// nav engine, one tree; add a workflow by adding a node.
//
// Icons are Cascadia Code NF (Font Awesome 4 PUA) glyphs via .nv-ic's font, not emoji — one flat,
// single-color icon vocabulary. No per-category tint either: every tile wears the same neutral
// treatment (see .nv-ic in app.css); color is reserved for state, not decoration.
import { mountNav } from './nav.js';
import * as Theme from './theme-engine.js';
import { mountAddonsPanel } from './addons.js';

let nav = null;
let views = null;   // { settingsView, storageView } — cached so a deep link can jump straight in

export function initLauncher(host, crumbsHost, api) {
  const home = buildHome(api);
  nav = mountNav(host, crumbsHost, home);
}

// Deep link for the editor's "⋯ → Add-ons & CDN cache" shortcut: land on Settings → Storage &
// Add-ons in one hop, same breadcrumb engine, no separate dialog.
export function openStorageSettings() {
  if (!nav || !views) return;
  nav.open([views.home, views.settingsView, views.storageView]);
}

function buildHome(api) {
  const vp = (label, w, h, icon) => ({ type: 'action', icon: icon || '', label, caption: `${w}×${h}`, run: () => newVideoProject(label, w, h, api) });
  const pick = (fn, arg) => () => import('./convert.js').then((m) => m[fn] && m[fn](arg));

  // ---- Audio (Cool Edit Pro / Audition shaped — on device, no Adobe) ----
  const audioView = { title: 'Audio', children: [
    { type: 'group', title: 'Make', children: [
      { type: 'action', icon: '', label: 'Ringtone maker', caption: 'Trim any track down to a clip → MP3', run: pick('pickAndTrim', 'audio/*') },
      { type: 'action', icon: '', label: 'Multitrack compose', caption: 'Layer & mix on the timeline — Audition-style', open: () => api.switchTo('editor') },
    ] },
    { type: 'group', title: 'From a file', children: [
      { type: 'action', icon: '', label: 'Cut audio', caption: 'Top, tail, or shorten a clip', run: pick('pickAndTrim', 'audio/*') },
      { type: 'action', icon: '', label: 'Extract from video', caption: 'Pull the audio out of a video → MP3 / WAV', run: pick('pickAndConvert') },
      { type: 'action', icon: '', label: 'Convert format', caption: 'MP3 ⇄ WAV', run: pick('pickAndConvert') },
    ] },
  ] };

  // ---- Video ----
  const videoView = { title: 'Video', children: [
    { type: 'group', title: 'Make', children: [
      { type: 'action', icon: '', label: 'New project', caption: 'Reel · Square · Widescreen · Cinematic', to: newVideoView(api, vp) },
      { type: 'action', icon: '', label: 'Multitrack editor', caption: 'CapCut-style timeline — Split · FX · Export', open: () => api.switchTo('editor') },
    ] },
    { type: 'group', title: 'From a file', children: [
      { type: 'action', icon: '', label: 'Trim video', caption: 'Cut the in & out points', run: pick('pickAndTrim', 'video/*') },
      { type: 'action', icon: '', label: 'Stitch videos', caption: 'Join several clips end to end', run: pick('pickAndStitch', 'video/*') },
      { type: 'action', icon: '', label: 'Outpaint', caption: 'Extend the frame — rough, not CapCut-grade yet', badge: 'beta', run: pick('pickAndConvert') },
    ] },
  ] };

  // ---- Image ----
  const imageView = { title: 'Image', children: [
    { type: 'group', children: [
      { type: 'action', icon: '', label: 'Paint studio', caption: 'Layers · brushes · AI select & erase', open: () => api.switchTo('paint') },
      { type: 'action', icon: '', label: 'Remove background', caption: 'One-tap AI cutout → PNG', run: pick('pickAndConvert') },
      { type: 'action', icon: '', label: 'New canvas', caption: 'A blank artboard to paint on', open: () => api.switchTo('paint') },
    ] },
  ] };

  // ---- Animate (draw a character → skeleton → make it move) ----
  const toAnimate = (file) => import('./shell.js').then((m) => m.sendToSurface('animate', { type: 'open-media', file }));
  const pickToAnimate = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.addEventListener('change', () => { if (inp.files && inp.files[0]) toAnimate(inp.files[0]); });
    inp.click();
  };
  const animView = { title: 'Animate', children: [
    { type: 'group', title: 'Make it move', children: [
      { type: 'action', icon: '', label: 'Animate a drawing', caption: 'Auto-skeleton → wave · walk · dance · jumping jacks', run: pickToAnimate },
      { type: 'action', icon: '', label: 'Mocap studio', caption: 'Act it out on camera — your character follows live', open: () => api.switchTo('animate') },
      { type: 'action', icon: '', label: 'Motion from a video', caption: 'Any clip of a person becomes a reusable move', open: () => api.switchTo('animate') },
    ] },
    { type: 'group', title: 'Then', children: [
      { type: 'action', icon: '', label: 'Send clips to the editor', caption: 'Rendered animations land straight on the timeline', open: () => api.switchTo('animate') },
    ] },
  ] };

  // Storage & Add-ons: its own drill-down level (not a bolted-on modal) — install/update the app,
  // warm CDN packages for offline use, add your own, see & clear on-device storage. One screen,
  // reached from Settings *or* the editor's "⋯" shortcut (see openStorageSettings above).
  const storageView = { title: 'Storage & Add-ons', children: [
    { type: 'custom', mount: mountAddonsPanel },
    { type: 'group', title: 'Storage', children: [{ type: 'custom', mount: mountStorage }] },
  ] };

  const settingsView = { title: 'Settings', children: [
    { type: 'group', title: 'Appearance', children: [
      { type: 'segment', label: 'Theme', caption: 'Reskins every open surface instantly', value: Theme.getMode(),
        options: [{ k: 'dark', v: 'Dark' }, { k: 'light', v: 'Light' }, { k: 'auto', v: 'Auto' }], onChange: (m) => Theme.setMode(m) },
      { type: 'color', label: 'Accent', caption: 'The chrome highlight color', value: cssVar('--accent'), onChange: (h) => Theme.setAccent(h) },
      { type: 'toggle', label: 'Glass (mica)', caption: 'Frosted blur on bars and panels', value: Theme.getMica(), onChange: (v) => Theme.setMica(v) },
      { type: 'slider', label: 'Opacity', caption: 'Surface translucency while glass is on', min: 0.4, max: 1, step: 0.05, value: Theme.getOpacity(), mult: 100, unit: '%', onChange: (v) => Theme.setOpacity(v) },
    ] },
    { type: 'group', title: 'Add-ons', children: [
      { type: 'action', icon: '', label: 'Storage & Add-ons', caption: 'Models, packages, on-device cache — and app updates', to: storageView },
    ] },
    { type: 'header', title: 'CoolProMobile', subtitle: 'FOSS on-device studio — video · audio · image · 3D',
      note: 'Merged from nocap · art4quinn · arlinearcade, on the subsystem doctrine. Mobile only. MIT.' },
  ] };

  // Home: by medium, not by verb — one high-signal row per category, each a Fluent icon tile.
  const home = { title: 'Home', children: [
    { type: 'group', title: 'Studio', children: [
      { type: 'action', icon: '', label: 'Audio', caption: 'Ringtone maker · cut · extract · multitrack', to: audioView },
      { type: 'action', icon: '', label: 'Video', caption: 'Trim · stitch · outpaint · multitrack editor', to: videoView },
      { type: 'action', icon: '', label: 'Image', caption: 'Paint · select · remove background', to: imageView },
      { type: 'action', icon: '', label: '3D', caption: 'Image → silhouette → paintable standee', open: () => api.switchTo('model') },
      { type: 'action', icon: '', label: 'Animate', caption: 'Skeleton a drawing · mocap with the camera', to: animView },
    ] },
    { type: 'group', title: 'Handy', children: [
      { type: 'action', icon: '', label: 'Convert', caption: 'Any file → the format you need, on device', run: () => import('./convert.js').then((m) => m.pickAndConvert()) },
      { type: 'action', icon: '', label: 'Settings', caption: 'Appearance · storage · about', to: settingsView },
    ] },
  ] };

  views = { home, settingsView, storageView };
  return home;
}

// The sized-video-project picker (its own drill so Video → New project stays one tap deep).
function newVideoView(api, vp) {
  return { title: 'New project', children: [
    { type: 'group', title: 'Choose a canvas', children: [
      vp('Reel / Short', 1080, 1920, ''),
      vp('Square', 1080, 1080, ''),
      vp('Widescreen', 1920, 1080, ''),
      vp('Cinematic', 1920, 816, ''),
    ] },
  ] };
}

async function newVideoProject(label, w, h, api) {
  const S = await import('./store.js');
  S.setProject({ name: `${label}`, width: w, height: h });
  const c = document.getElementById('preview'); if (c) { c.width = w; c.height = h; }
  api.switchTo('editor');
  try { const P = await import('./preview.js'); P.drawAt && P.drawAt(S.state.transport.time); } catch (_) {}
  try { const { toast } = await import('./hud.js'); toast(`New project — ${label} ${w}×${h}`); } catch (_) {}
}

async function mountStorage(el) {
  el.innerHTML = `<div class="nv-cap" style="padding:4px 0">Reading storage…</div>`;
  let usage = 'Storage estimate unavailable';
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      usage = `${(e.usage / 1e6).toFixed(0)} MB used${e.quota ? ` · ${(e.quota / 1e9).toFixed(1)} GB available` : ''}`;
    }
  } catch (_) {}
  el.innerHTML = `<div class="nv-ctrl"><div class="nv-ctrl-h"><span>On-device storage</span></div>
    <div class="nv-cap">${usage}</div>
    <button class="btn ghost" data-clear style="margin-top:10px;align-self:flex-start"><span class="nf"></span> Clear downloaded models &amp; packages</button></div>`;
  el.querySelector('[data-clear]').addEventListener('click', async () => {
    try { await caches.delete('nocap-cdn'); } catch (_) {}
    try { const { toast } = await import('./hud.js'); toast('Cleared the model & package cache'); } catch (_) {}
    mountStorage(el);
  });
}

function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#5b8cff'; }
