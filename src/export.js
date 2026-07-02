// src/export.js — render & export.
// Audio: deterministic OfflineAudioContext mixdown → WAV (built-in) or MP3
//        (lamejs, lazy-loaded from CDN, matching the bundle's libmp3lame intent).
// Video: realtime capture of the preview canvas + master audio via MediaRecorder
//        (WebM). A true MP4 mux via ffmpeg.wasm is the planned enhancement; the
//        provider seam is here so it can replace the capture path.
import * as S from './store.js';
import { ctx as audioCtx, master } from './audio.js';
import { importModule } from './cdn.js';
import { progress, toast } from './hud.js';

// decodeAudioData can HANG forever on a video container (esp. mobile), which used to deadlock
// audio export. Never await it unbounded — race it against a timeout; null on timeout/failure.
function decodeWithTimeout(ab, ms = 15000) {
  return Promise.race([
    audioCtx().decodeAudioData(ab),
    new Promise((_, rej) => setTimeout(() => rej(new Error('decode timeout')), ms)),
  ]).catch(() => null);
}

const _bufCache = new Map();   // mediaId -> AudioBuffer
async function bufferFor(m) {
  if (_bufCache.has(m.id)) return _bufCache.get(m.id);
  if (!m.file || m.kind === 'image') return null;
  // 1) fast path: let the browser decode it (works for audio files), but bounded so it can't wedge.
  try {
    const ab = await m.file.arrayBuffer();
    const buf = await decodeWithTimeout(ab.slice(0));
    if (buf) { _bufCache.set(m.id, buf); return buf; }
  } catch (_) {}
  // 2) video (or a codec the browser won't decode): extract the audio track via ffmpeg, then
  //    decode the resulting PCM WAV (which always decodes fast). This is the reliable fallback.
  if (m.kind === 'video') {
    try {
      const { extractWav } = await import('./ffmpeg.js');
      const wav = await extractWav(m.file);
      const buf = await audioCtx().decodeAudioData(await wav.arrayBuffer());
      _bufCache.set(m.id, buf); return buf;
    } catch (_) {}
  }
  return null;
}

// ---- offline audio mixdown → AudioBuffer --------------------------------
async function mixdown(onStatus) {
  const dur = S.duration();
  if (dur <= 0) throw new Error('Timeline is empty');
  const sr = 48000;
  const off = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  const masterGain = off.createGain(); masterGain.connect(off.destination);
  let n = 0; const clips = S.allClips().filter(({ clip }) => clip.kind !== 'image');
  for (const { clip, track } of clips) {
    const m = S.media.get(clip.mediaId); if (!m) continue;
    onStatus?.(`Mixing ${++n}/${clips.length}…`, Math.round((n / clips.length) * 100));
    const buf = await bufferFor(m); if (!buf) continue;
    const src = off.createBufferSource(); src.buffer = buf;
    const g = off.createGain();
    g.gain.value = S.trackGain(track, clip);
    src.connect(g); g.connect(masterGain);
    src.start(clip.t0, clip.in, clip.dur);
  }
  return off.startRendering();
}

export async function exportAudio(format = 'wav') {
  const pr = progress('Rendering audio…');
  try {
    const buf = await mixdown(pr.status);
    let blob, ext;
    if (format === 'mp3') { pr.status('Encoding MP3…'); blob = await encodeMp3(buf); ext = 'mp3'; }
    else { pr.status('Encoding WAV…'); blob = encodeWav(buf); ext = 'wav'; }
    const how = await shareOrDownload(blob, `${safe(S.state.project.name)}.${ext}`);
    pr.done(how === 'shared' ? 'Shared' : how === 'cancelled' ? 'Cancelled' : 'Export ready');
  } catch (e) { console.error(e); pr.fail(e.message); }
}

// ---- video: realtime capture (canvas + master audio), optional MP4 transcode ----
export async function exportVideo(onFrame, format = 'mp4') {
  const dur = S.duration();
  if (dur <= 0) return toast('Timeline is empty', { ms: 2200 });
  const canvas = document.getElementById('preview');
  const fps = S.state.project.fps || 30;
  const pr = progress('Recording video…');
  try {
    const vStream = canvas.captureStream(fps);
    const dest = audioCtx().createMediaStreamDestination();
    master().connect(dest);
    const stream = new MediaStream([...vStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = pickMime();
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((res) => { rec.onstop = res; });
    rec.start(100);

    // play the timeline through once, in realtime
    await onFrame.playThrough((t) => pr.status(`Recording… ${Math.round((t / dur) * 100)}%`, Math.round((t / dur) * 100)));
    rec.stop();
    await done;
    try { master().disconnect(dest); } catch (_) {}
    let blob = new Blob(chunks, { type: mime });

    // If the user asked for MP4 and we didn't already capture MP4, transcode via ffmpeg.wasm.
    let outName;
    if (format === 'mp4' && !mime.includes('mp4')) {
      const { transcodeToMp4 } = await import('./ffmpeg.js');
      blob = await transcodeToMp4(blob, { onStatus: pr.status });
      outName = `${safe(S.state.project.name)}.mp4`;
    } else {
      outName = `${safe(S.state.project.name)}.${mime.includes('mp4') ? 'mp4' : 'webm'}`;
    }
    const how = await shareOrDownload(blob, outName);
    pr.done(how === 'shared' ? 'Shared' : how === 'cancelled' ? 'Cancelled' : 'Export ready');
  } catch (e) { console.error(e); pr.fail(e.message); }
}

function pickMime() {
  const cands = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const c of cands) if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
  return 'video/webm';
}

// ---- encoders -----------------------------------------------------------
function encodeWav(audioBuffer) {
  const numCh = audioBuffer.numberOfChannels, sr = audioBuffer.sampleRate;
  const len = audioBuffer.length;
  const out = new DataView(new ArrayBuffer(44 + len * numCh * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + len * numCh * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, numCh, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * numCh * 2, true);
  out.setUint16(32, numCh * 2, true); out.setUint16(34, 16, true); w(36, 'data');
  out.setUint32(40, len * numCh * 2, true);
  let off = 44;
  const chans = []; for (let c = 0; c < numCh; c++) chans.push(audioBuffer.getChannelData(c));
  for (let i = 0; i < len; i++) for (let c = 0; c < numCh; c++) {
    const s = Math.max(-1, Math.min(1, chans[c][i])); out.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2;
  }
  return new Blob([out], { type: 'audio/wav' });
}

let _lame = null;
export async function encodeMp3(audioBuffer) {
  if (!_lame) {
    const mod = await importModule('lamejs');   // managed + cached via the CDN package manager
    _lame = mod.default || mod;
  }
  const sr = audioBuffer.sampleRate, numCh = Math.min(2, audioBuffer.numberOfChannels);
  const enc = new _lame.Mp3Encoder(numCh, sr, 192);
  const L = audioBuffer.getChannelData(0);
  const R = numCh > 1 ? audioBuffer.getChannelData(1) : L;
  const to16 = (f) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); o[i] = s < 0 ? s * 0x8000 : s * 0x7fff; } return o; };
  const l16 = to16(L), r16 = to16(R), block = 1152, data = [];
  for (let i = 0; i < l16.length; i += block) {
    const buf = enc.encodeBuffer(l16.subarray(i, i + block), r16.subarray(i, i + block));
    if (buf.length) data.push(new Uint8Array(buf));
  }
  const end = enc.flush(); if (end.length) data.push(new Uint8Array(end));
  return new Blob(data, { type: 'audio/mpeg' });
}

export function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// Phone-first "save": hand the file to the OS share sheet (→ Files, messaging, anywhere) when the
// browser can share files; otherwise fall back to a download. Returns 'shared'|'cancelled'|'downloaded'.
export async function shareOrDownload(blob, name) {
  try {
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return 'shared'; }
      catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }   // user dismissed — don't also download
    }
  } catch (_) {}
  download(blob, name);
  return 'downloaded';
}
export const safe = (s) => (s || 'coolpro').replace(/[^\w.-]+/g, '_').slice(0, 64);
