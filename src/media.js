// src/media.js — import files into the media bin.
// Builds a media record { id, name, kind, url, file, duration, width, height,
// waveform, thumbUrl } with a generated poster thumbnail and (for audio/video)
// a downsampled waveform for the timeline.
import { uid, mediaKind } from './util.js';
import { addMedia, addClipFromMedia } from './store.js';
import { decode } from './audio.js';
import { toast } from './hud.js';

export async function importFiles(fileList, { autoPlace = true } = {}) {
  const files = [...fileList];
  for (const file of files) {
    try {
      const m = await importFile(file);
      addMedia(m);
      if (autoPlace) addClipFromMedia(m.id);
    } catch (e) {
      console.error(e);
      toast(`Couldn't import ${file.name}: ${e.message}`, { err: true, ms: 3500 });
    }
  }
}

async function importFile(file) {
  const kind = mediaKind(file);
  const url = URL.createObjectURL(file);
  const base = { id: uid('med'), name: file.name, kind, url, file };
  if (kind === 'image') return { ...base, ...(await probeImage(url)) };
  if (kind === 'audio') return { ...base, ...(await probeAudio(file, url)) };
  return { ...base, ...(await probeVideo(url)) };
}

// Land a GENERATED blob (a guest's rendered clip, an AI result) in the bin + timeline. The
// generator knows its own duration/size — and MediaRecorder WebM ships broken duration
// metadata (Infinity), so the supplied meta overrides whatever probing reports.
export async function landGenerated({ blob, name = 'generated.webm', meta = {} }) {
  const type = blob.type || (/\.mp4$/i.test(name) ? 'video/mp4' : 'video/webm');
  const file = new File([blob], name, { type });
  const kind = meta.kind || mediaKind(file);
  const url = URL.createObjectURL(file);
  let probed = {};
  try {
    probed = kind === 'image' ? await probeImage(url)
           : kind === 'audio' ? await probeAudio(file, url)
           : await probeVideo(url);
  } catch (_) { /* generated media may resist probing — meta carries the truth */ }
  const rec = { id: uid('med'), name, kind, url, file, ...probed };
  if (Number.isFinite(meta.duration) && meta.duration > 0) rec.duration = meta.duration;
  if (!Number.isFinite(rec.duration) || rec.duration <= 0) rec.duration = 5;
  if (meta.width) rec.width = meta.width;
  if (meta.height) rec.height = meta.height;
  addMedia(rec);
  addClipFromMedia(rec.id);
  return rec;
}

function probeImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res({ duration: 5, width: img.naturalWidth, height: img.naturalHeight,
      thumbUrl: url });
    img.onerror = () => rej(new Error('image decode failed'));
    img.src = url;
  });
}

function probeVideo(url) {
  return new Promise((res, rej) => {
    const v = document.createElement('video');
    v.preload = 'metadata'; v.muted = true; v.src = url;
    v.onloadedmetadata = () => {
      const w = v.videoWidth, h = v.videoHeight, duration = v.duration || 0;
      // grab a poster frame a little into the clip
      v.currentTime = Math.min(0.2, duration / 2 || 0);
      v.onseeked = () => {
        const c = document.createElement('canvas');
        const s = Math.min(1, 240 / Math.max(w, 1));
        c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
        try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); } catch (_) {}
        res({ duration, width: w, height: h, thumbUrl: c.toDataURL('image/jpeg', 0.6) });
      };
      // some browsers won't fire seeked for tiny seeks — fall back
      setTimeout(() => res({ duration, width: w, height: h, thumbUrl: null }), 1200);
    };
    v.onerror = () => rej(new Error('video metadata failed'));
  });
}

async function probeAudio(file, url) {
  const buf = await file.arrayBuffer();
  let audioBuffer;
  try { audioBuffer = await decode(buf); }
  catch (_) {
    // fall back to <audio> metadata if decode fails (e.g. unsupported codec for WebAudio)
    return { duration: await audioDuration(url), waveform: null, thumbUrl: waveThumb(null) };
  }
  const waveform = peaks(audioBuffer, 600);
  return { duration: audioBuffer.duration, waveform, thumbUrl: waveThumb(waveform) };
}

function audioDuration(url) {
  return new Promise((res) => {
    const a = document.createElement('audio'); a.preload = 'metadata'; a.src = url;
    a.onloadedmetadata = () => res(a.duration || 0);
    a.onerror = () => res(0);
  });
}

// Downsample an AudioBuffer to N min/max peak pairs in [0,1].
export function peaks(audioBuffer, n = 600) {
  const ch = audioBuffer.getChannelData(0);
  const block = Math.floor(ch.length / n) || 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let max = 0;
    const start = i * block;
    for (let j = 0; j < block; j++) { const v = Math.abs(ch[start + j] || 0); if (v > max) max = v; }
    out[i] = max;
  }
  return out;
}

function waveThumb(wave) {
  const c = document.createElement('canvas'); c.width = 240; c.height = 150;
  const g = c.getContext('2d');
  g.fillStyle = '#1c2a26'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#2fa37f'; g.lineWidth = 1;
  if (wave) {
    const mid = c.height / 2, step = c.width / wave.length;
    g.beginPath();
    for (let i = 0; i < wave.length; i++) {
      const x = i * step, h = wave[i] * mid;
      g.moveTo(x, mid - h); g.lineTo(x, mid + h);
    }
    g.stroke();
  } else {
    g.fillStyle = '#2fa37f'; g.font = '14px sans-serif'; g.textAlign = 'center';
    g.fillText('audio', c.width / 2, mid_or(c.height / 2));
  }
  return c.toDataURL('image/jpeg', 0.7);
}
const mid_or = (v) => v + 5;
