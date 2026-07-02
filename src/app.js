// src/app.js — entry point. Boots the modules and wires global UI:
// media bin, top bar, transport, keyboard shortcuts, persistence.
import { $, $$, fmtTime } from './util.js';
import * as S from './store.js';
import { importFiles } from './media.js';
import { initTimeline, render as renderTimeline } from './timeline.js';
import { initPreview, play, pause, toggle, seek, toStart, toEnd, drawAt } from './preview.js';
import { initPanels, openExport } from './panels.js';
import { initAddons } from './addons.js';
import { attachContextMenu, openMenu } from './contextmenu.js';
import { initPWA } from './pwa.js';
import * as CDN from './cdn.js';
import { toast } from './hud.js';

function boot() {
  initTimeline();
  initPreview();
  initPanels();
  initAddons();
  wireMediaBin();
  wireTopbar();
  wireDeckMenu();
  wireProjections();
  wireTransport();
  wireKeyboard();
  // PWA install/update + CDN package cache
  initPWA((s) => { if (s.canInstall !== undefined) { installAvail = s.canInstall; const b = $('#btnInstall'); if (b) b.hidden = !s.canInstall; } });
  CDN.init().catch(() => {});
  // restore any saved project
  S.load().then((ok) => { if (ok) { renderBin(); toast('Restored your last project'); } });
  S.subscribe((r) => {
    if (['media','load'].includes(r)) renderBin();
    if (r === 'transport' || r === 'load') renderTransport();
    if (r === 'project') $('#projName').value = S.state.project.name;
    renderStatus();
  });
  // Viewport reflow (rotation, address-bar collapse/expand): the canvas-based timeline &
  // preview must recompute against their new container widths.
  let reflowRaf = 0;
  const reflow = () => { cancelAnimationFrame(reflowRaf); reflowRaf = requestAnimationFrame(() => { renderTimeline(); drawAt(S.state.transport.time); }); };
  window.addEventListener('resize', reflow);
  window.addEventListener('orientationchange', reflow);
  renderBin(); renderTransport(); renderStatus();
}

// ---- deck overflow (⋯): the homespun context menu replaces the obp hamburger sheet. Items
// proxy-click the real (hidden) buttons, so addons.js / pwa.js / the timeline toolbar keep their wiring.
let installAvail = false;
function wireDeckMenu() {
  const more = $('#edMore');
  if (!more) return;
  const proxy = (id) => () => document.getElementById(id)?.click();
  const items = () => {
    const list = [
      { label: 'Add video track', icon: '＋', run: proxy('btnAddVideoTrack') },
      { label: 'Add audio track', icon: '＋', run: proxy('btnAddAudioTrack') },
      '-',
      { label: 'Storage & Add-ons', icon: '⚙', run: proxy('btnAddons') },
    ];
    if (installAvail) list.push({ label: 'Install app', icon: '⤓', run: proxy('btnInstall') });
    return list;
  };
  more.addEventListener('click', () => { const r = more.getBoundingClientRect(); openMenu(r.right - 8, r.bottom + 4, items()); });
}

// ---- projections (Blackmagic Resolve pages): set #app[data-projection]; the timeline grip is the
// quick bring-up / drop-down. The grid reflows; the canvas timeline + preview repaint to fit. ----
const PROJECTIONS = ['edit', 'wide', 'preview'];
function wireProjections() {
  const app = $('#app'), sw = $('#edProj'), grip = $('#tlGrip');
  if (!app) return;
  let cur = localStorage.getItem('coolpro-projection');
  if (!PROJECTIONS.includes(cur)) cur = 'edit';
  const set = (p) => {
    if (!PROJECTIONS.includes(p)) return;
    cur = p; app.dataset.projection = p;
    try { localStorage.setItem('coolpro-projection', p); } catch (_) {}
    if (sw) $$('button', sw).forEach((b) => b.classList.toggle('on', b.dataset.proj === p));
    requestAnimationFrame(() => { renderTimeline(); drawAt(S.state.transport.time); });
  };
  if (sw) $$('button', sw).forEach((b) => b.addEventListener('click', () => set(b.dataset.proj)));
  if (grip) grip.addEventListener('click', () => set(cur === 'preview' ? 'edit' : 'preview'));
  set(cur);
}

// ---- status bar: selection on the left, project facts on the right ----
function renderStatus() {
  const p = S.state.project, clips = S.allClips().length;
  const res = $('#stRes'), fps = $('#stFps'), cl = $('#stClips'), left = $('#stLeft');
  if (res) res.textContent = `${p.width}×${p.height}`;
  if (fps) fps.textContent = `${p.fps || 30} fps`;
  if (cl) cl.textContent = `${clips} clip${clips === 1 ? '' : 's'}`;
  if (!left) return;
  const sel = S.state.selection && S.findClip(S.state.selection);
  if (sel) { const m = S.media.get(sel.clip.mediaId); left.textContent = `${m ? m.name : 'Clip'} · ${sel.clip.kind} · ${fmtTime(sel.clip.dur)}`; }
  else left.textContent = clips ? 'Ready' : 'Drop media to begin';
}

// ---- media bin ----------------------------------------------------------
function wireMediaBin() {
  const dz = $('#dropzone'), picker = $('#filePicker');
  dz.addEventListener('click', () => picker.click());
  picker.addEventListener('change', (e) => { importFiles(e.target.files); picker.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files); });
  // also accept drops anywhere on the window
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); if (e.target.closest('#dropzone')) return; if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files); });
}

function renderBin() {
  const bin = $('#bin'), empty = $('#binEmpty');
  const items = [...S.media.values()];
  empty.style.display = items.length ? 'none' : '';
  bin.innerHTML = items.map((m) => `
    <div class="item" data-id="${m.id}" title="Click to add to timeline">
      ${m.thumbUrl ? `<img src="${m.thumbUrl}" alt="">` : `<div style="display:grid;place-items:center;height:100%;color:var(--muted)">${m.kind}</div>`}
      <span class="k">${m.kind}</span><span class="lbl">${esc(m.name)}</span>
    </div>`).join('');
  $$('.item', bin).forEach((it) => {
    const id = it.dataset.id;
    it.addEventListener('click', () => { S.addClipFromMedia(id); toast('Added to timeline'); });
    attachContextMenu(it, () => binMenu(id));
  });
}
function binMenu(id) {
  const m = S.media.get(id); if (!m) return [];
  return [
    { label: 'Add to timeline', icon: '＋', run: () => { S.addClipFromMedia(id); toast('Added to timeline'); } },
    { label: 'Convert…', icon: '⇄', disabled: !m.file, run: () => { if (m.file) import('./convert.js').then((c) => c.openConvert(m.file)); } },
    '-',
    { label: 'Remove from bin', icon: '🗑', danger: true, run: () => { S.removeMedia(id); toast('Removed from bin'); } },
  ];
}

// ---- top bar ------------------------------------------------------------
function wireTopbar() {
  $('#btnInstall').addEventListener('click', () => import('./pwa.js').then((m) => m.promptInstall()));
  $('#projName').addEventListener('change', (e) => S.setProject({ name: e.target.value || 'Untitled project' }));
  $('#btnSave').addEventListener('click', async () => { try { await S.save(); toast('Project saved to browser storage'); } catch (e) { toast('Save failed: ' + e.message, { err: true }); } });
  $('#btnExport').addEventListener('click', openExport);
  $('#btnAddVideoTrack').addEventListener('click', () => S.addTrack('video'));
  $('#btnAddAudioTrack').addEventListener('click', () => S.addTrack('audio'));
}

// ---- transport ----------------------------------------------------------
function wireTransport() {
  $('#btnPlay').addEventListener('click', toggle);
  $('#btnToStart').addEventListener('click', toStart);
  $('#btnToEnd').addEventListener('click', toEnd);
  $('#btnSplit').addEventListener('click', splitAtPlayhead);
  $('#btnDelete').addEventListener('click', deleteSelected);
}
function renderTransport() {
  $('#tCur').textContent = fmtTime(S.state.transport.time);
  $('#tDur').textContent = fmtTime(S.duration());
  $('#btnPlay').textContent = S.state.transport.playing ? '⏸' : '▶';
}

function splitAtPlayhead() {
  const t = S.state.transport.time;
  let id = S.state.selection;
  if (!id || !overlaps(id, t)) { const u = clipUnderTime(t); id = u && u.id; }
  if (id) S.splitClipAt(id, t); else toast('No clip under the playhead', { ms: 1800 });
}
function deleteSelected() {
  if (S.state.selection) S.removeClip(S.state.selection);
  else toast('No clip selected', { ms: 1600 });
}
function overlaps(id, t) { const f = S.findClip(id); return f && t > f.clip.t0 && t < f.clip.t0 + f.clip.dur; }
function clipUnderTime(t) {
  for (const { clip } of S.allClips()) if (t >= clip.t0 && t < clip.t0 + clip.dur) return clip;
  return null;
}

// ---- keyboard -----------------------------------------------------------
function wireKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    switch (e.key) {
      case ' ': e.preventDefault(); toggle(); break;
      case 's': case 'S': splitAtPlayhead(); break;
      case 'Delete': case 'Backspace': deleteSelected(); break;
      case 'Home': toStart(); break;
      case 'End': toEnd(); break;
      case 'ArrowLeft': seek(S.state.transport.time - (e.shiftKey ? 1 : 1 / (S.state.project.fps || 30))); break;
      case 'ArrowRight': seek(S.state.transport.time + (e.shiftKey ? 1 : 1 / (S.state.project.fps || 30))); break;
    }
  });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
