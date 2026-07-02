// vendor/ml/pose.js — on-device body tracking (MediaPipe PoseLandmarker).
//
// The `pose` capability behind dpx: 33 body landmarks from a still image or a video stream,
// feeding vendor/anim (skeleton.poseFromLandmarks) to auto-rig characters and to drive mocap.
// Same shape as the other vendor/ml modules: lazy CDN load on first use, one job at a time,
// GPU first with automatic CPU fallback (headless/older devices), disposable session.
//
// Assets (all cached by the service worker's durable nocap-cdn lane, warmable via cdn.js):
//   * @mediapipe/tasks-vision ESM bundle + wasm fileset — jsDelivr (Apache-2.0)
//   * pose_landmarker_lite.task model (~5.5 MB) — storage.googleapis.com (Apache-2.0)

const VER = '0.10.14';
export const POSE_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}`;
export const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
// Every URL the capability needs — cdn.js registers these as the warmable "mediapipe" package.
// Both wasm variants: FilesetResolver picks SIMD or not per device, so an offline warm must
// cover whichever this phone will ask for.
export const POSE_URLS = [
  `${POSE_BASE}/vision_bundle.mjs`,
  `${POSE_BASE}/wasm/vision_wasm_internal.js`,
  `${POSE_BASE}/wasm/vision_wasm_internal.wasm`,
  `${POSE_BASE}/wasm/vision_wasm_nosimd_internal.js`,
  `${POSE_BASE}/wasm/vision_wasm_nosimd_internal.wasm`,
  POSE_MODEL,
];

// Test/self-host override: window.__DPX_POSE__ = { base, model } before first use.
function urls() {
  const o = (typeof window !== 'undefined' && window.__DPX_POSE__) || {};
  return { base: o.base || POSE_BASE, model: o.model || POSE_MODEL };
}

let _ready = null;        // memoised { PoseLandmarker, landmarker, mode, delegate }
let _busy = false;

async function create(onStatus, delegate, runningMode) {
  const { base, model } = urls();
  onStatus && onStatus('loading pose AI…');
  const vision = await import(/* @vite-ignore */ `${base}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${base}/wasm`);
  onStatus && onStatus('downloading pose model…');
  const landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: model, delegate },
    runningMode, numPoses: 1,
  });
  onStatus && onStatus('pose AI ready');
  return { vision, landmarker, mode: runningMode, delegate };
}

// Load (once) the landmarker, switching runningMode in place when a caller needs the other one.
export async function ensurePose(runningMode = 'IMAGE', onStatus) {
  if (!_ready) {
    _ready = (async () => {
      try { return await create(onStatus, 'GPU', runningMode); }
      catch (e) {
        // headless / blocklisted GPU / WebGL-less contexts — fall back to CPU inference
        onStatus && onStatus('GPU unavailable — pose AI on CPU…');
        return create(onStatus, 'CPU', runningMode);
      }
    })().catch((e) => { _ready = null; throw e; });
  }
  const r = await _ready;
  if (r.mode !== runningMode) {
    await r.landmarker.setOptions({ runningMode });
    r.mode = runningMode;
  }
  return r;
}

// One detection on a still image / canvas / ImageBitmap.
// Returns the landmark array ([{x,y,z,visibility} × 33], normalized, y-down) or null.
export async function detectImage(imageLike, onStatus) {
  if (_busy) throw new Error('pose AI is busy — let the current job finish');
  _busy = true;
  try {
    const r = await ensurePose('IMAGE', onStatus);
    const res = r.landmarker.detect(imageLike);
    return (res && res.landmarks && res.landmarks[0]) || null;
  } finally { _busy = false; }
}

// One detection on a playing <video>. Caller owns the loop; no lock here — it's one
// synchronous call on the video thread. MediaPipe demands STRICTLY increasing timestamps
// for the lifetime of the landmarker, but our callers legitimately restart clocks (camera
// uses performance.now(), a video file uses currentTime·1000 from ~0) — so keep our own
// monotonic clock and only use the caller's timestamp when it moves forward.
let _lastTs = 0;
export async function detectVideo(video, tsMs, onStatus) {
  const r = await ensurePose('VIDEO', onStatus);
  _lastTs = Math.max(_lastTs + 1, Math.round(tsMs) || 0);
  const res = r.landmarker.detectForVideo(video, _lastTs);
  return (res && res.landmarks && res.landmarks[0]) || null;
}

export function poseBusy() { return _busy; }

// Free the wasm session (weights re-download from cache on next use).
export async function disposePose() {
  if (!_ready) return;
  try { const r = await _ready; r.landmarker.close(); } catch (_) {}
  _ready = null;
}
