// src/convert.js — the Convert sheet. Share (or open) a media file in, pick an output, get it
// back out. This is the phone-first "share a video → receive an audio file" workflow: conversions
// run on-device (ffmpeg.wasm for audio/video, RMBG for image cut-out) and the result goes to the
// OS share sheet (→ Files, messaging, anywhere), a download, or onto the editor timeline.
import { toast } from './hud.js';
import { extractWav, transcodeToMp4, trimVideo, trimAudioWav, outpaintVideo, stitchVideos } from './ffmpeg.js';
import { encodeMp3, shareOrDownload, download, safe } from './export.js';
import { ctx as audioCtx } from './audio.js';
import { importFiles } from './media.js';
import { switchTo, sendToSurface } from './shell.js';

const $ = (sel, root = document) => root.querySelector(sel);

// Output options per media kind. `run(file, onStatus) -> { blob, name }`; `timeline` = drop as-is.
function optionsFor(file) {
  const kind = kindOf(file);
  const stem = (file.name || 'media').replace(/\.\w+$/, '');
  if (kind === 'video') return [
    { label: '🎵 Extract audio → MP3', run: (f, s) => toAudio(f, 'mp3', stem, s) },
    { label: '🎵 Extract audio → WAV', run: (f, s) => toAudio(f, 'wav', stem, s) },
    { label: '✂️ Trim video', trim: true },
    { label: '🖼️ Outpaint (blurred extend)', run: (f, s) => toOutpaint(f, stem, s) },
    { label: '🎬 Convert video → MP4', run: (f, s) => toMp4(f, stem, s) },
    { label: '➕ Add to timeline', timeline: true },
  ];
  if (kind === 'audio') return [
    { label: '✂️ Trim / ringtone → MP3', trim: true },
    { label: '🎵 Convert → MP3', run: (f, s) => toAudio(f, 'mp3', stem, s) },
    { label: '🎵 Convert → WAV', run: (f, s) => toAudio(f, 'wav', stem, s) },
    { label: '➕ Add to timeline', timeline: true },
  ];
  if (kind === 'image') return [
    { label: '✂️ Remove background → PNG', run: (f, s) => removeBg(f, stem, s) },
    { label: '🕺 Animate character', animate: true },
    { label: '🖼️ Convert → PNG', run: (f, s) => toImage(f, 'png', stem, s) },
    { label: '🖼️ Convert → JPG', run: (f, s) => toImage(f, 'jpg', stem, s) },
    { label: '➕ Add to timeline', timeline: true },
  ];
  return [{ label: '➕ Add to timeline', timeline: true }];
}

export function openConvert(file) {
  if (!file) return;
  const back = document.createElement('div');
  back.className = 'cv-back';
  back.innerHTML = `
    <div class="cv-card">
      <div class="cv-head">
        <div><b>Convert</b><span class="cv-file">${esc(file.name || 'media')} · ${kindOf(file)} · ${fmtBytes(file.size)}</span></div>
        <button class="cv-x" title="Close">✕</button>
      </div>
      <div class="cv-body"></div>
    </div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  $('.cv-x', back).addEventListener('click', close);
  renderOptions(back, file, close);
}

function renderOptions(back, file, close) {
  const body = $('.cv-body', back);
  const opts = optionsFor(file);
  body.innerHTML = `<div class="cv-grid">${opts.map((o, i) => `<button class="cv-opt" data-i="${i}">${o.label}</button>`).join('')}</div>`;
  body.querySelectorAll('.cv-opt').forEach((b) => b.addEventListener('click', async () => {
    const opt = opts[+b.dataset.i];
    if (opt.timeline) { await importFiles([file]); switchTo('editor'); close(); toast('Added to the timeline'); return; }
    if (opt.animate) { await sendToSurface('animate', { type: 'open-media', file }); close(); return; }
    if (opt.trim) { renderTrim(back, file, close); return; }
    await convertAndShow(back, file, opt, close);
  }));
}

// Trim: a tiny start/end form (prefilled from the video's duration), then run the ffmpeg trim.
async function renderTrim(back, file, close) {
  const body = $('.cv-body', back);
  const stem = (file.name || 'video').replace(/\.\w+$/, '');
  body.innerHTML = `<div class="cv-progress"><div class="cv-status">Reading duration…</div></div>`;
  const dur = await probeDuration(file).catch(() => 0);
  body.innerHTML = `
    <div class="cv-form">
      <label>Start (s)<input id="cvA" type="number" min="0" step="0.1" value="0"></label>
      <label>End (s)<input id="cvB" type="number" min="0" step="0.1" value="${dur ? dur.toFixed(1) : ''}"></label>
      ${dur ? `<div class="cv-hint">Clip is ${dur.toFixed(1)}s long.</div>` : ''}
      <div class="cv-actions">
        <button class="btn primary" data-go>✂️ Trim</button>
        <button class="cv-again">Back</button>
      </div>
    </div>`;
  $('.cv-again', body).addEventListener('click', () => renderOptions(back, file, close));
  $('[data-go]', body).addEventListener('click', () => {
    const a = parseFloat($('#cvA', body).value) || 0;
    const b = parseFloat($('#cvB', body).value) || (dur || a + 1);
    if (b <= a) return toast('End must be after start', { ms: 2200 });
    const run = kindOf(file) === 'audio' ? (f, s) => toRingtone(f, a, b, stem, s) : (f, s) => toTrim(f, a, b, stem, s);
    convertAndShow(back, file, { run }, close);
  });
}
function probeDuration(file) {
  return new Promise((res, rej) => {
    const v = document.createElement('video'); v.preload = 'metadata';
    v.onloadedmetadata = () => { res(v.duration); URL.revokeObjectURL(v.src); };
    v.onerror = () => rej(new Error('probe failed'));
    v.src = URL.createObjectURL(file);
  });
}

async function convertAndShow(back, file, opt, close) {
  const body = $('.cv-body', back);
  body.innerHTML = `<div class="cv-progress"><div class="cv-spin"></div><div class="cv-status">Starting…</div></div>`;
  const status = (t) => { const el = $('.cv-status', body); if (el) el.textContent = t; };
  try {
    const { blob, name } = await opt.run(file, status);
    body.innerHTML = `
      <div class="cv-result">
        <div class="cv-ok">✓ ${esc(name)} · ${fmtBytes(blob.size)}</div>
        <div class="cv-actions">
          <button class="btn primary" data-act="share">📤 Share / Save</button>
          <button class="btn ghost" data-act="dl">⤓ Download</button>
          <button class="btn ghost" data-act="tl">➕ To timeline</button>
        </div>
        <button class="cv-again">Convert something else</button>
      </div>`;
    $('[data-act=share]', body).addEventListener('click', async () => {
      const how = await shareOrDownload(blob, name);
      if (how !== 'cancelled') { toast(how === 'shared' ? 'Shared' : 'Saved'); close(); }
    });
    $('[data-act=dl]', body).addEventListener('click', () => { download(blob, name); toast('Downloaded'); close(); });
    $('[data-act=tl]', body).addEventListener('click', async () => {
      await importFiles([new File([blob], name, { type: blob.type })]); switchTo('editor'); close(); toast('Added to the timeline');
    });
    $('.cv-again', body).addEventListener('click', () => renderOptions(back, file, close));
  } catch (e) {
    console.error(e);
    body.innerHTML = `<div class="cv-result"><div class="cv-err">Couldn't convert: ${esc(e.message || e)}</div>
      <button class="cv-again">Back</button></div>`;
    $('.cv-again', body).addEventListener('click', () => renderOptions(back, file, close));
  }
}

// ---- conversions (on-device) --------------------------------------------------------------
async function toAudio(file, fmt, stem, onStatus) {
  const wav = await extractWav(file, { onStatus });          // ffmpeg: any codec → PCM WAV (never hangs)
  if (fmt === 'wav') return { blob: wav, name: `${safe(stem)}.wav` };
  onStatus('Encoding MP3…');
  const buf = await audioCtx().decodeAudioData(await wav.arrayBuffer());   // WAV always decodes fast
  return { blob: await encodeMp3(buf), name: `${safe(stem)}.mp3` };
}
async function toMp4(file, stem, onStatus) {
  return { blob: await transcodeToMp4(file, { onStatus }), name: `${safe(stem)}.mp4` };
}
async function toTrim(file, a, b, stem, onStatus) {
  return { blob: await trimVideo(file, { startSec: a, endSec: b, onStatus }), name: `${safe(stem)}-trim.mp4` };
}
// Ringtone / cut audio: ffmpeg trims to a guaranteed WAV, then lamejs encodes MP3 (the extract-audio path).
async function toRingtone(file, a, b, stem, onStatus) {
  const wav = await trimAudioWav(file, { startSec: a, endSec: b, onStatus });
  onStatus?.('Encoding MP3…');
  const buf = await audioCtx().decodeAudioData(await wav.arrayBuffer());
  return { blob: await encodeMp3(buf), name: `${safe(stem)}-clip.mp3` };
}
async function toOutpaint(file, stem, onStatus) {
  return { blob: await outpaintVideo(file, { factor: 1.3, onStatus }), name: `${safe(stem)}-outpaint.mp4` };
}
async function toStitch(files, onStatus) {
  return { blob: await stitchVideos(files, { onStatus }), name: `stitched-${files.length}.mp4` };
}
async function toImage(file, fmt, stem, onStatus) {
  onStatus('Converting…');
  const img = await loadImg(URL.createObjectURL(file));
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  if (fmt === 'jpg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }   // flatten alpha
  g.drawImage(img, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, fmt === 'jpg' ? 'image/jpeg' : 'image/png', 0.92));
  return { blob, name: `${safe(stem)}.${fmt}` };
}
async function removeBg(file, stem, onStatus) {
  onStatus('Loading AI…');
  const { removeBackground } = await import('../vendor/ml/segment.js');
  const out = await removeBackground(URL.createObjectURL(file), onStatus);
  return { blob: await new Promise((r) => out.toBlob(r, 'image/png')), name: `${safe(stem)}-cutout.png` };
}

// ---- helpers ------------------------------------------------------------------------------
function kindOf(file) {
  const t = (file.type || '').toLowerCase();
  if (t.startsWith('video')) return 'video';
  if (t.startsWith('audio')) return 'audio';
  if (t.startsWith('image')) return 'image';
  const ext = (file.name || '').toLowerCase().split('.').pop();
  if (['mp4', 'webm', 'mov', 'mkv', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) return 'image';
  return 'file';
}
function loadImg(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); }
function fmtBytes(b) { if (!b) return '—'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return b.toFixed(b < 10 && i ? 1 : 0) + ' ' + u[i]; }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The launcher "Convert" entry: pick a file from disk and open the sheet (no project needed).
export function pickAndConvert() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'video/*,audio/*,image/*';
  inp.addEventListener('change', () => { if (inp.files && inp.files[0]) openConvert(inp.files[0]); });
  inp.click();
}

// The launcher "Trim / cut / ringtone" entries: pick one file (of `accept`) and jump straight to
// the trim form — audio yields an MP3 clip, video an MP4.
export function pickAndTrim(accept = 'video/*,audio/*') {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = accept;
  inp.addEventListener('change', () => { if (inp.files && inp.files[0]) openTrim(inp.files[0]); });
  inp.click();
}
export function openTrim(file) {
  if (!file) return;
  const back = document.createElement('div');
  back.className = 'cv-back';
  back.innerHTML = `
    <div class="cv-card">
      <div class="cv-head"><div><b>Trim</b><span class="cv-file">${esc(file.name || 'media')} · ${kindOf(file)} · ${fmtBytes(file.size)}</span></div>
        <button class="cv-x" title="Close">✕</button></div>
      <div class="cv-body"></div>
    </div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  $('.cv-x', back).addEventListener('click', close);
  renderTrim(back, file, close);
}

// The launcher "Stitch" entry: pick several clips (of `accept`) and concatenate them end to end.
export function pickAndStitch(accept = 'video/*') {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = accept; inp.multiple = true;
  inp.addEventListener('change', () => {
    const files = [...(inp.files || [])].filter(Boolean);
    if (files.length < 2) return toast('Pick at least two files to stitch.', { ms: 2800 });
    openStitch(files);
  });
  inp.click();
}
export function openStitch(files) {
  const back = document.createElement('div');
  back.className = 'cv-back';
  back.innerHTML = `
    <div class="cv-card">
      <div class="cv-head"><div><b>Stitch</b><span class="cv-file">${files.length} videos · end to end</span></div>
        <button class="cv-x" title="Close">✕</button></div>
      <div class="cv-body"></div>
    </div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  $('.cv-x', back).addEventListener('click', close);
  convertAndShow(back, files, { run: (fs, s) => toStitch(fs, s) }, close);
}
