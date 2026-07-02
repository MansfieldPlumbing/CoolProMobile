// src/dpx.js — dpx, the on-device inference runtime for the whole studio.
//
// Formerly the editor's thin "ml" seam; promoted to THE runtime (subsystem's dp-onnx → dpx).
// One provider registry, one capability catalog, one job lock — shared by every surface
// (A/V editor now; paint & 3D fold in next, across the frame boundary). A future dpx-wasm /
// WebNN build of the native engine registers here as a provider and the call sites never move.
//
// The dpx⇄VOM tie (the load-bearing idea): a loaded model is a REGION owned by the `dpx` VOM
// owner. Its refcount is its authority; when it hits zero the region frees and the value's
// dispose() releases the GPU/WASM session — model weights reclaim deterministically, free-on-
// zero, exactly like a kernel region. Inference doesn't leak because the namespace owns it.
import * as S from './store.js';
import { decode } from './audio.js';
import { progress, toast } from './hud.js';
import { createOwner } from './vom.js';

// ---- the dpx memory owner: every model session is a refcounted VOM region ----------------
const dpx = createOwner('dpx', 4 * 1024 * 1024 * 1024 /* advisory 4 GiB ceiling */, 64);
const sessions = new Map();   // sessionKey -> { handle, mod }
// Open (load-or-reuse) a model session as a VOM region. `loader` returns a module/handle whose
// dispose() frees it. Re-opening bumps the refcount; releaseSession() closes → free-on-zero.
async function openSession(key, bytes, loader) {
  const live = sessions.get(key);
  if (live) { dpx.open(live.handle); return live.mod; }
  const mod = await loader();
  const handle = dpx.alloc({ dispose: () => mod.dispose?.() }, { bytes, path: '\\Model\\' + key });
  sessions.set(key, { handle, mod });
  return mod;
}
export function releaseSession(key) {
  const live = sessions.get(key); if (!live) return;
  if (dpx.close(live.handle)) sessions.delete(key);   // freed this call → drop the record
}
export function modelBytes() { return dpx.currentBytes ? dpx.currentBytes() : dpx.bytes; }

// ---- provider registry (the native dpx-wasm runtime plugs in here) -----------------------
const providers = new Map();
export function registerProvider(name, impl) { providers.set(name, impl); }
export function providerFor(capId) {
  for (const [name, p] of providers) if (p.caps?.has(capId)) return { name, p };
  return null;
}
// When the subsystem browser build lands:
//   import('…/dpx.js').then(rt => registerProvider('dpx-native', adapter(rt)))
// and flip the matching capabilities' status to 'ready'.

// ---- capability catalog (merged: CapCut A/V + art4quinn image ML) ------------------------
// status: 'ready' (works now) | 'model' (works, downloads weights on first use) |
//         'native' (waiting on dpx-wasm) | 'soon' (not implemented yet)
export const CAPS = [
  { id: 'autotrim', group: 'audio', label: 'Smart Auto-Trim',  desc: 'Trim silent gaps at the clip edges (Web Audio, no download).', status: 'ready' },
  { id: 'matte',    group: 'image', label: 'Background Removal', desc: 'Subject cut-out via RMBG-1.4 (art4quinn). Runs now on image clips.', status: 'model' },
  { id: 'wand',     group: 'image', label: 'AI Magic Wand',      desc: 'Tap-to-select an object (SlimSAM). Live in the Paint surface.', status: 'model' },
  { id: 'eraser',   group: 'image', label: 'Magic Eraser',       desc: 'Content-aware fill / object removal (LaMa). Live in the Paint surface.', status: 'model' },
  { id: 'pose',     group: 'image', label: 'Pose Capture',       desc: 'Body tracking (MediaPipe) — auto-rigs characters & drives mocap. Live in the Animate surface.', status: 'model' },
  { id: 'captions', group: 'audio', label: 'Auto-Subtitling',    desc: 'Auto-synced subtitles via Whisper (Transformers.js).', status: 'soon' },
  { id: 'tts',      group: 'audio', label: 'Voiceover (TTS)',    desc: 'Kokoro speech — wires to the dpx runtime.', status: 'native' },
  { id: 'denoise',  group: 'audio', label: 'Denoise Audio',      desc: 'Reduce background noise.', status: 'soon' },
  { id: 'stems',    group: 'audio', label: 'Isolate Voice',      desc: 'Separate vocals/music (Demucs). Heavy — planned.', status: 'soon' },
  { id: 'superres', group: 'video', label: 'Super Resolution',   desc: 'Upscale toward 4K on export.', status: 'soon' },
  { id: 'rife',     group: 'video', label: 'RIFE 60fps',         desc: 'AI frame interpolation. Planned.', status: 'soon' },
];

export async function run(capId) {
  const cap = CAPS.find((c) => c.id === capId);
  if (!cap) return;
  if (capId === 'autotrim') return autotrim();
  if (capId === 'matte') return matte();
  const ext = providerFor(capId);
  if (ext) { const pr = progress(`${cap.label}…`); try { await ext.p.run(capId, {}, pr.status); pr.done(); } catch (e) { pr.fail(e.message); } return; }
  if (capId === 'wand' || capId === 'eraser') return toast(`${cap.label} runs in the Paint surface — open Paint and pick a layer.`, { ms: 3200 });
  if (capId === 'pose') return toast('Pose Capture runs in the Animate surface — open Animate and rig a character.', { ms: 3200 });
  if (cap.status === 'native') toast('Waiting on the dpx browser runtime — not wired yet.', { ms: 3000 });
  else toast(`${cap.label} is planned — coming soon.`, { ms: 2600 });
}

// ---- real, model-backed: RMBG background removal on the selected image clip --------------
async function matte() {
  const sel = S.state.selection && S.findClip(S.state.selection);
  if (!sel) return toast('Select a clip first.', { ms: 2200 });
  const m = S.media.get(sel.clip.mediaId);
  if (!m || m.kind !== 'image') return toast('Background Removal runs on an image clip (v1). Pick an image.', { ms: 3200 });
  const pr = progress('Loading AI…');
  try {
    // The model lives as a VOM region — opened here, released when the job is done (free-on-zero).
    const seg = await openSession('rmbg-1.4', 176 * 1024 * 1024, () => import('../vendor/ml/segment.js'));
    const cut = await seg.removeBackground(m.url || m.file, (s) => pr.status(s));
    const blob = await new Promise((r) => cut.toBlob(r, 'image/png'));
    const file = new File([blob], (m.name || 'cutout').replace(/\.\w+$/, '') + '-cutout.png', { type: 'image/png' });
    const url = URL.createObjectURL(file);
    const rec = S.addMedia({ id: 'med_' + Math.random().toString(36).slice(2, 9), name: file.name,
      kind: 'image', file, url, width: cut.width, height: cut.height, thumbUrl: url });
    S.addClipFromMedia(rec.id);
    pr.done('Background removed → added cut-out to the bin');
  } catch (e) { console.error(e); pr.fail(e.message); }
  finally { releaseSession('rmbg-1.4'); }   // close the region — weights free at zero
}

// ---- real, model-free: trim leading/trailing silence on the selected clip ----------------
async function autotrim() {
  const sel = S.state.selection && S.findClip(S.state.selection);
  if (!sel) return toast('Select a clip first.', { ms: 2200 });
  const m = S.media.get(sel.clip.mediaId);
  if (!m || m.kind === 'image' || !m.file) return toast('Auto-Trim needs an audio/video clip.', { ms: 2600 });
  const pr = progress('Analyzing audio…');
  try {
    const buf = await decode(await m.file.arrayBuffer());
    const { startSec, endSec } = silenceBounds(buf);
    if (endSec - startSec < 0.1) { pr.fail('All silent?'); return; }
    const newIn = Math.max(sel.clip.in, startSec);
    const newOut = Math.min(sel.clip.in + sel.clip.dur, endSec);
    const newDur = Math.max(0.1, newOut - newIn);
    const shift = newIn - sel.clip.in;
    S.resizeClip(sel.clip.id, { t0: sel.clip.t0 + shift, inPoint: newIn, dur: newDur });
    pr.done(`Trimmed ${(shift + (sel.clip.dur - newDur - shift)).toFixed(2)}s of silence`);
  } catch (e) { console.error(e); pr.fail(e.message); }
}

// First/last sample above an RMS threshold (in seconds).
function silenceBounds(audioBuffer, thresh = 0.015) {
  const ch = audioBuffer.getChannelData(0), sr = audioBuffer.sampleRate;
  const win = Math.floor(sr * 0.02) || 1;
  let first = -1, lastIdx = 0;
  for (let i = 0; i < ch.length; i += win) {
    let sum = 0; for (let j = 0; j < win && i + j < ch.length; j++) { const v = ch[i + j]; sum += v * v; }
    if (Math.sqrt(sum / win) > thresh) { if (first < 0) first = i; lastIdx = i + win; }
  }
  if (first < 0) return { startSec: 0, endSec: audioBuffer.duration };
  return { startSec: first / sr, endSec: Math.min(audioBuffer.duration, lastIdx / sr) };
}
