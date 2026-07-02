// src/ffmpeg.js — true MP4 export via ffmpeg.wasm (the "@ffmpeg JS module").
// Cross-origin loading of ffmpeg.wasm is finicky: passing classWorkerURL forces a
// module worker, and the ESM worker has relative imports that break when blobbed.
// Proven-working recipe (verified end-to-end in headless Chromium): vendor the tiny
// @ffmpeg ESM *glue* same-origin (vendor/ffmpeg, vendor/ffmpeg-util) so the worker
// loads natively, and pull only the heavy ~30MB core/wasm from the CDN (warmable &
// cacheable through the Add-ons manager). Single-threaded core → no cross-origin
// isolation / COOP-COEP needed, so it runs on plain GitHub Pages and the CDN add-ons
// keep working.
const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
export const CORE_URLS = [`${CORE_BASE}/ffmpeg-core.js`, `${CORE_BASE}/ffmpeg-core.wasm`];

let _ff = null;
let _loading = null;

export function isLoaded() { return !!_ff; }

export async function loadFFmpeg(onStatus) {
  if (_ff) return _ff;
  if (_loading) return _loading;
  _loading = (async () => {
    onStatus?.('Loading ffmpeg…');
    const { FFmpeg } = await import('../vendor/ffmpeg/index.js');
    const { toBlobURL } = await import('../vendor/ffmpeg-util/index.js');
    const ff = new FFmpeg();
    ff.on('log', ({ message }) => { /* console.debug('[ffmpeg]', message) */ });
    ff.on('progress', ({ progress }) => {
      if (progress >= 0 && progress <= 1) onStatus?.(`Transcoding… ${Math.round(progress * 100)}%`, Math.round(progress * 100));
    });
    onStatus?.('Downloading ffmpeg core (~30 MB, cached after first use)…');
    await ff.load({
      coreURL: await toBlobURL(CORE_URLS[0], 'text/javascript'),
      wasmURL: await toBlobURL(CORE_URLS[1], 'application/wasm'),
    });
    _ff = ff;
    return ff;
  })().catch((e) => { _loading = null; throw e; });
  return _loading;
}

// Extract the audio track of ANY media (video or audio, any codec) to a 48k stereo PCM WAV.
// This is the codec-agnostic, never-hangs path that the browser's decodeAudioData can't give us
// for video containers — it's what makes "video → audio" reliable (export + the Convert sheet).
export async function extractWav(blob, { onStatus } = {}) {
  const ff = await loadFFmpeg(onStatus);
  const { fetchFile } = await import('../vendor/ffmpeg-util/index.js');
  const inName = 'in', outName = 'out.wav';
  await ff.writeFile(inName, await fetchFile(blob));
  onStatus?.('Extracting audio…');
  await ff.exec(['-i', inName, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', outName]);
  const data = await ff.readFile(outName);
  try { await ff.deleteFile(inName); await ff.deleteFile(outName); } catch (_) {}
  if (!data || !data.length) throw new Error('No audio track found');
  return new Blob([data.buffer], { type: 'audio/wav' });
}

// Trim an audio (or any) file to [startSec, endSec] → PCM WAV. The ringtone-maker / cut-audio
// primitive; pcm is a guaranteed codec (no libmp3lame gamble), and convert.js re-encodes to MP3
// via the same lamejs path extract-audio already uses.
export async function trimAudioWav(blob, { startSec = 0, endSec, onStatus } = {}) {
  const ff = await loadFFmpeg(onStatus);
  const { fetchFile } = await import('../vendor/ffmpeg-util/index.js');
  await ff.writeFile('in', await fetchFile(blob));
  const dur = Math.max(0.05, (endSec ?? 0) - startSec);
  onStatus?.('Trimming audio…');
  await ff.exec(['-ss', String(startSec), '-i', 'in', '-t', String(dur),
    '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', 'out.wav']);
  const data = await ff.readFile('out.wav');
  try { await ff.deleteFile('in'); await ff.deleteFile('out.wav'); } catch (_) {}
  if (!data || !data.length) throw new Error('No audio track found');
  return new Blob([data.buffer], { type: 'audio/wav' });
}

const H264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-crf', '23'];

// Trim a video to [startSec, endSec] — accurate re-encode from the seek point.
export async function trimVideo(blob, { startSec = 0, endSec, onStatus } = {}) {
  const ff = await loadFFmpeg(onStatus);
  const { fetchFile } = await import('../vendor/ffmpeg-util/index.js');
  await ff.writeFile('in', await fetchFile(blob));
  const dur = Math.max(0.05, (endSec ?? 0) - startSec);
  onStatus?.('Trimming…');
  await ff.exec(['-ss', String(startSec), '-i', 'in', '-t', String(dur),
    ...H264, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'out.mp4']);
  const data = await ff.readFile('out.mp4');
  try { await ff.deleteFile('in'); await ff.deleteFile('out.mp4'); } catch (_) {}
  return new Blob([data.buffer], { type: 'video/mp4' });
}

// Outpaint "only so far": grow the frame by `factor` and fill the new border with a blurred,
// scaled copy of the frame (the CapCut/Reels look). Cheap, no model — falls out of ffmpeg.
export async function outpaintVideo(blob, { factor = 1.3, onStatus } = {}) {
  const ff = await loadFFmpeg(onStatus);
  const { fetchFile } = await import('../vendor/ffmpeg-util/index.js');
  await ff.writeFile('in', await fetchFile(blob));
  onStatus?.('Outpainting…');
  const f = Math.max(1.05, Math.min(2, factor));
  // even dimensions for yuv420p: round the padded canvas to /2
  const fc = `[0:v]split=2[o][b];` +
    `[b]scale=ceil(iw*${f}/2)*2:ceil(ih*${f}/2)*2,boxblur=30:2[bg];` +
    `[bg][o]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`;
  await ff.exec(['-i', 'in', '-filter_complex', fc, '-map', '[v]', '-map', '0:a?',
    ...H264, '-c:a', 'copy', '-movflags', '+faststart', 'out.mp4']);
  const data = await ff.readFile('out.mp4');
  try { await ff.deleteFile('in'); await ff.deleteFile('out.mp4'); } catch (_) {}
  return new Blob([data.buffer], { type: 'video/mp4' });
}

// Stitch videos end to end. Each is normalized (scale+pad to a common 1280×720, SAR 1) so clips of
// different sizes concat cleanly. Assumes each clip has an audio track (typical phone video).
export async function stitchVideos(blobs, { width = 1280, height = 720, onStatus } = {}) {
  const ff = await loadFFmpeg(onStatus);
  const { fetchFile } = await import('../vendor/ffmpeg-util/index.js');
  const n = blobs.length;
  if (n < 2) throw new Error('Pick at least two videos to stitch');
  for (let i = 0; i < n; i++) await ff.writeFile('in' + i, await fetchFile(blobs[i]));
  onStatus?.(`Stitching ${n} clips…`);
  let fc = '';
  for (let i = 0; i < n; i++)
    fc += `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}];`;
  for (let i = 0; i < n; i++) fc += `[v${i}][${i}:a]`;
  fc += `concat=n=${n}:v=1:a=1[v][a]`;
  const inputs = []; for (let i = 0; i < n; i++) inputs.push('-i', 'in' + i);
  await ff.exec([...inputs, '-filter_complex', fc, '-map', '[v]', '-map', '[a]',
    ...H264, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'out.mp4']);
  const data = await ff.readFile('out.mp4');
  try { for (let i = 0; i < n; i++) await ff.deleteFile('in' + i); await ff.deleteFile('out.mp4'); } catch (_) {}
  return new Blob([data.buffer], { type: 'video/mp4' });
}

// Transcode a recorded blob (WebM from MediaRecorder) to H.264/AAC MP4.
export async function transcodeToMp4(blob, { onStatus } = {}) {
  const ff = await loadFFmpeg(onStatus);
  const { fetchFile } = await import('../vendor/ffmpeg-util/index.js');
  const inName = 'input', outName = 'output.mp4';
  await ff.writeFile(inName, await fetchFile(blob));
  onStatus?.('Transcoding to MP4…', 0);
  await ff.exec([
    '-i', inName,
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-crf', '23',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    outName,
  ]);
  const data = await ff.readFile(outName);
  try { await ff.deleteFile(inName); await ff.deleteFile(outName); } catch (_) {}
  return new Blob([data.buffer], { type: 'video/mp4' });
}
