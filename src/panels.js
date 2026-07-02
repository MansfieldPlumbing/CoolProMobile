// src/panels.js — right-side inspector: Clip props, Audio FX, Video FX, AI.
// Renders from store state; writes back through store mutations. The AI tab is
// driven by ml.CAPS so it stays honest about what's actually wired.
import { $, $$, fmtTime } from './util.js';
import * as S from './store.js';
import * as ML from './ml.js';
import { exportAudio, exportVideo } from './export.js';
import * as preview from './preview.js';

let activeTab = 'props';

export function initPanels() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    activeTab = t.dataset.tab;
    $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
    $$('.tabpane').forEach((p) => (p.hidden = p.dataset.pane !== activeTab));
    renderPanels();
  }));
  S.subscribe((r) => { if (['select','clip-add','clip-remove','clip-resize','tracks','load','transport'].includes(r)) renderPanels(); });
  renderPanels();
}

export function renderPanels() {
  renderProps($('[data-pane=props]'));
  renderFx($('[data-pane=afx]'), 'audio');
  renderFx($('[data-pane=vfx]'), 'video');
  renderAI($('[data-pane=ai]'));
}

function renderProps(el) {
  const sel = S.state.selection && S.findClip(S.state.selection);
  if (!sel) { el.innerHTML = `<div class="empty">Select a clip to edit its properties.</div>`; return; }
  const { clip, track } = sel;
  const m = S.media.get(clip.mediaId);
  el.innerHTML = `
    <div class="fx-group">
      <div class="fx-row"><div class="t"><b>${m ? esc(m.name) : 'Clip'}</b>
        <span>${clip.kind} · on ${esc(track.name)}</span></div></div>
      <div class="field"><label>Start <span>${fmtTime(clip.t0)}</span></label></div>
      <div class="field"><label>Duration <span>${fmtTime(clip.dur)}</span></label></div>
      <div class="field"><label>Clip volume <span id="cvollbl">${Math.round((clip.volume ?? 1) * 100)}%</span></label>
        <input id="cvol" type="range" min="0" max="150" value="${(clip.volume ?? 1) * 100}"></div>
      <div class="field"><label>Track volume <span id="tvollbl">${Math.round((track.volume ?? 1) * 100)}%</span></label>
        <input id="tvol" type="range" min="0" max="150" value="${(track.volume ?? 1) * 100}"></div>
      <div class="fx-row"><div class="t"><b>Mute track</b><span>${esc(track.name)}</span></div>
        <div class="toggle ${track.muted ? 'on' : ''}" id="tmute"></div></div>
    </div>`;
  $('#cvol', el).addEventListener('input', (e) => { clip.volume = +e.target.value / 100; $('#cvollbl', el).textContent = e.target.value + '%'; S.nudge('clip-resize'); });
  $('#tvol', el).addEventListener('input', (e) => { track.volume = +e.target.value / 100; $('#tvollbl', el).textContent = e.target.value + '%'; S.nudge('clip-resize'); });
  $('#tmute', el).addEventListener('click', (e) => { track.muted = !track.muted; e.target.classList.toggle('on', track.muted); S.nudge('tracks'); });
}

// Audio/Video FX list — toggles persisted on clip.fx (applied progressively).
const FX = {
  audio: [
    { id: 'bass', label: 'Bass Boost', desc: 'Lift the low end.' },
    { id: 'leveler', label: 'Dialogue Leveler', desc: 'Even out loud/quiet speech.' },
    { id: 'denoise', label: 'Denoise', desc: 'Reduce hiss/hum.' },
    { id: 'enhance', label: 'Voice Enhance', desc: 'Clarity boost.' },
  ],
  video: [
    { id: 'colormatch', label: 'Deep ColorMatch', desc: 'Match color across clips.' },
    { id: 'flare', label: 'Cinematic Flare', desc: 'Filmic glow.' },
    { id: 'edge', label: 'Edge Detect', desc: 'Stylized outlines.' },
    { id: 'enhance', label: 'AI Enhance', desc: 'Sharpen & denoise.' },
  ],
};
function renderFx(el, group) {
  const sel = S.state.selection && S.findClip(S.state.selection);
  const head = `<h3 style="padding-left:4px">${group === 'audio' ? 'Audio' : 'Video'} FX</h3>`;
  if (!sel) { el.innerHTML = head + `<div class="empty">Select a clip to apply ${group} effects.</div>`; return; }
  const clip = sel.clip;
  el.innerHTML = head + FX[group].map((fx) => `
    <div class="fx-row"><div class="t"><b>${fx.label}</b><span>${fx.desc}</span></div>
      <div class="toggle ${clip.fx?.[fx.id] ? 'on' : ''}" data-fx="${fx.id}"></div></div>`).join('');
  $$('[data-fx]', el).forEach((t) => t.addEventListener('click', () => {
    clip.fx = clip.fx || {}; clip.fx[t.dataset.fx] = !clip.fx[t.dataset.fx];
    t.classList.toggle('on', clip.fx[t.dataset.fx]); S.nudge('clip-resize');
  }));
}

const BADGE = { ready: ['var(--success)', 'ready'], model: ['var(--accent)', 'downloads model'],
  native: ['var(--accent-2)', 'dp-onnx'], soon: ['var(--warning)', 'soon'] };
function renderAI(el) {
  el.innerHTML = `<h3 style="padding-left:4px">AI tools</h3>` + ML.CAPS.map((c) => {
    const [col, txt] = BADGE[c.status] || BADGE.soon;
    return `<div class="fx-row"><div class="t"><b>${c.label}</b><span>${c.desc}</span>
        <span class="chip" style="color:${col};border-color:${col};margin-top:4px;display:inline-block">${txt}</span></div>
      <button class="btn ${c.status === 'ready' ? 'primary' : 'ghost'}" data-cap="${c.id}">Run</button></div>`;
  }).join('');
  $$('[data-cap]', el).forEach((b) => b.addEventListener('click', () => ML.run(b.dataset.cap)));
}

// ---- export dialog ------------------------------------------------------
export function openExport() {
  const p = S.state.project;
  const back = document.createElement('div');
  back.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.55);display:grid;place-items:center';
  back.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
      box-shadow:var(--shadow);width:min(420px,92vw);padding:18px">
      <h3 style="margin:0 0 12px">Export</h3>
      <div class="field"><label>Format</label>
        <select id="exFmt">
          <option value="mp4">MP4 — Video (H.264 / AAC via ffmpeg.wasm)</option>
          <option value="webm">WebM — Video (fast, no transcode)</option>
          <option value="mp3">MP3 — Audio</option>
          <option value="wav">WAV — Audio (lossless)</option>
        </select></div>
      <div class="field" id="exVidOpts"><label>Frame rate (FPS)</label>
        <select id="exFps"><option>24</option><option selected>30</option><option>60</option></select></div>
      <div style="font-size:11px;color:var(--muted);margin:6px 2px 14px">
        Video records the preview in realtime. MP4 then transcodes via ffmpeg.wasm
        (first run downloads a ~30 MB core — warm it in Add-ons for offline MP4).</div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn ghost" id="exCancel">Cancel</button>
        <button class="btn primary" id="exGo">⤓ Export</button>
      </div>
    </div>`;
  document.body.appendChild(back);
  const fmt = $('#exFmt', back), vid = $('#exVidOpts', back);
  const isVideo = () => fmt.value === 'mp4' || fmt.value === 'webm';
  const sync = () => (vid.style.display = isVideo() ? '' : 'none');
  fmt.addEventListener('change', sync); sync();
  const close = () => back.remove();
  $('#exCancel', back).addEventListener('click', close);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  $('#exGo', back).addEventListener('click', () => {
    const f = fmt.value;
    if (isVideo()) { p.fps = +$('#exFps', back).value; exportVideo(preview, f); }
    else exportAudio(f);
    close();
  });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
