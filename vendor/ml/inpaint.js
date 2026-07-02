// assets/ml/inpaint.js
// ---------------------------------------------------------------------------
// Magic Eraser — content-aware fill (object removal), powered by MI-GAN.
//
// LaMa was ~200MB and slow/soft. MI-GAN (Picsart, ICCV-2023) is built for
// mobile: ~29MB, an order of magnitude faster, and it ships as a *pipeline*
// ONNX that takes a raw uint8 image + mask and does the crop-around-mask,
// resize-to-512, normalize, run, and blend-back internally — so we just hand
// it the picture and the mask and get the finished image back.
//
// Runs on WebGPU (Dawn) first for speed, WASM fallback, in a proxy Worker so the
// UI never hangs.
//
//   model input  : "image" uint8 RGB,  "mask" uint8 gray (255 = keep, 0 = erase)
//   model output : uint8 RGB, full image already blended
// Tensor SHAPES aren't documented, so we read the names at runtime and try
// NHWC then NCHW (both in and out are auto-detected from dims).
//
// API:  const patched = await inpaint(imageCanvas, maskCanvas, onStatus)
//        maskCanvas = white/opaque where to erase. Returns a NEW canvas.
// ---------------------------------------------------------------------------

const ORT_VER = '1.20.1';
const ORT = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/ort.webgpu.bundle.min.mjs`;
const MODEL_URL = 'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx';
const SIZE = 512;      // MI-GAN pipeline runs at a FIXED 512x512
const PAD = 0.012;     // dilate the mask by ~1.2% so we catch the object's edge/halo

let _ready = null, _busy = false;
let _forceWasm = (() => { try { return localStorage.getItem('a4q-ml-wasm') === '1'; } catch (_) { return false; } })();

export function inpaintBusy() { return _busy; }

function isGpuError(e) { return /webgpu|gpu|ortrun|bind ?group|validation|createbindgroup|shader|device lost/i.test(String((e && e.message) || e)); }
async function withWasmFallback(run, onStatus) {
  try { return await run(); }
  catch (e) {
    if (_forceWasm || !isGpuError(e)) throw e;
    onStatus && onStatus('GPU not supported here — switching to compatibility mode…');
    _forceWasm = true; try { localStorage.setItem('a4q-ml-wasm', '1'); } catch (_) {} await disposeInpainter();
    return await run();
  }
}

async function fetchWithProgress(url, onStatus) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('model ' + res.status);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !total) return await res.arrayBuffer();
  const reader = res.body.getReader(); const chunks = []; let got = 0, last = -1;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    chunks.push(value); got += value.length;
    const pct = Math.round(got / total * 100);
    if (onStatus && pct !== last) { last = pct; onStatus(`downloading eraser ${pct}%`); }
  }
  const buf = new Uint8Array(got); let p = 0; for (const c of chunks) { buf.set(c, p); p += c.length; }
  return buf.buffer;
}

async function ensure(onStatus) {
  if (_ready) return _ready;
  _ready = (async () => {
    onStatus && onStatus('loading magic eraser…');
    const ort = await import(/* @vite-ignore */ ORT);
    ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`;
    ort.env.wasm.simd = true;
    const providers = (!_forceWasm && typeof navigator !== 'undefined' && navigator.gpu) ? ['webgpu', 'wasm'] : ['wasm'];
    const buf = await fetchWithProgress(MODEL_URL, onStatus);
    onStatus && onStatus('warming up eraser…');
    const opts = { executionProviders: providers };
    let session;
    try { ort.env.wasm.proxy = true; session = await ort.InferenceSession.create(buf, opts); }   // off-main-thread
    catch (e) { ort.env.wasm.proxy = false; const b2 = await fetchWithProgress(MODEL_URL); session = await ort.InferenceSession.create(b2, opts); }
    return { ort, session };
  })().catch((e) => { _ready = null; throw e; });
  return _ready;
}

export async function disposeInpainter() {
  if (!_ready) return;
  try { const r = await _ready; await r.session?.release?.(); } catch (_) {}
  _ready = null;
}

// Grow the mask by ~r px so the erase covers the object's edge/halo.
function dilateMask(mask, r) {
  if (r <= 0) return mask;
  const c = document.createElement('canvas'); c.width = mask.width; c.height = mask.height;
  const g = c.getContext('2d');
  g.filter = `blur(${r}px)`; g.drawImage(mask, 0, 0); g.filter = 'none';
  const id = g.getImageData(0, 0, c.width, c.height), d = id.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 8 ? 255 : 0;
  g.putImageData(id, 0, 0); return c;
}

export async function inpaint(imageCanvas, maskCanvas, onStatus) {
  if (_busy) throw new Error('eraser is busy');
  _busy = true;
  try { return await withWasmFallback(() => _inpaintInfer(imageCanvas, maskCanvas, onStatus), onStatus); }
  finally { _busy = false; }
}

async function _inpaintInfer(imageCanvas, maskCanvas, onStatus) {
  const { ort, session } = await ensure(onStatus);
  onStatus && onStatus('erasing…');
  const W = imageCanvas.width, H = imageCanvas.height;

  const pad = Math.max(3, Math.min(40, Math.round(Math.max(W, H) * PAD)));
  const mask = dilateMask(maskCanvas, pad);                         // original-res, opaque where erased

  // The MI-GAN pipeline runs at a FIXED 512x512 — feed exactly that (the proven path);
  // feeding native resolution scrambles the model's internal reshape -> noise.
  const S = SIZE, N = S * S;
  const ic = document.createElement('canvas'); ic.width = S; ic.height = S;
  const igc = ic.getContext('2d'); igc.imageSmoothingQuality = 'high'; igc.drawImage(imageCanvas, 0, 0, W, H, 0, 0, S, S);
  const mc = document.createElement('canvas'); mc.width = S; mc.height = S;
  const mgc = mc.getContext('2d'); mgc.imageSmoothingEnabled = false; mgc.drawImage(mask, 0, 0, W, H, 0, 0, S, S);
  const rgba = igc.getImageData(0, 0, S, S).data;
  const mrgba = mgc.getImageData(0, 0, S, S).data;

  // image NCHW planar uint8 [1,3,512,512]; mask [1,1,512,512] (0 = erase, 255 = keep)
  const imgT = new Uint8Array(3 * N), mskT = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    imgT[i] = rgba[i * 4]; imgT[N + i] = rgba[i * 4 + 1]; imgT[2 * N + i] = rgba[i * 4 + 2];
    mskT[i] = mrgba[i * 4 + 3] > 128 ? 0 : 255;
  }
  const names = session.inputNames;
  const inImg = names.find((n) => /image|img|input/i.test(n)) || names[0];
  const inMask = names.find((n) => /mask/i.test(n)) || names[1];
  const feeds = {};
  feeds[inImg] = new ort.Tensor('uint8', imgT, [1, 3, S, S]);
  feeds[inMask] = new ort.Tensor('uint8', mskT, [1, 1, S, S]);
  const out = (await session.run(feeds))[session.outputNames[0]];

  // output is uint8 NCHW planar [1,3,512,512] -> interleaved RGBA
  const d = out.data;
  const oc = document.createElement('canvas'); oc.width = S; oc.height = S;
  const oid = oc.getContext('2d').createImageData(S, S);
  for (let i = 0; i < N; i++) {
    oid.data[i * 4] = d[i]; oid.data[i * 4 + 1] = d[N + i]; oid.data[i * 4 + 2] = d[2 * N + i]; oid.data[i * 4 + 3] = 255;
  }
  oc.getContext('2d').putImageData(oid, 0, 0);

  // resize the 512 result back to full size, then keep ONLY the (dilated) hole — the rest stays full-res original
  const patch = document.createElement('canvas'); patch.width = W; patch.height = H;
  const pg = patch.getContext('2d'); pg.imageSmoothingQuality = 'high';
  pg.drawImage(oc, 0, 0, S, S, 0, 0, W, H);
  pg.globalCompositeOperation = 'destination-in'; pg.drawImage(mask, 0, 0);
  const result = document.createElement('canvas'); result.width = W; result.height = H;
  const rg = result.getContext('2d'); rg.drawImage(imageCanvas, 0, 0); rg.drawImage(patch, 0, 0);
  onStatus && onStatus('erased ✨');
  return result;
}
