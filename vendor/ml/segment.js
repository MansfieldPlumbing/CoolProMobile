// assets/ml/segment.js
// ---------------------------------------------------------------------------
// Shared, on-device ML harness for art4quinn — "background erase" / cut-out.
//
// One module, used by all three apps (paint / three / gallery). It lazy-loads
// Transformers.js from the CDN on first use, runs the RMBG-1.4 matting model,
// and returns either the foreground alpha mask or a ready-made transparent
// cut-out canvas. Nothing is downloaded until a feature actually asks for it,
// and the model weights are cached by the browser (Cache Storage) so a phone
// only fetches them once.
//
// MEMORY SAFETY (this is the important part on phones):
//   * Input is downscaled to MAX_IN before inference. RMBG already runs at
//     ~1024px internally, so a full 4K/8K photo is pure waste — and holding a
//     full-res RawImage + a full-res getImageData buffer is what OOM-crashed an
//     8GB S23. We never hold a full-res pixel buffer.
//   * The mask is applied with GPU canvas compositing (destination-in), not a
//     CPU getImageData loop, and the cut-out is capped at MAX_OUT.
//   * A single-job lock stops two inferences from doubling peak memory.
//
// Runtime policy (June 2026 best practice):
//   * WebGPU first  — default on Chrome 121+ (incl. Android / Pixel), 3–10x WASM.
//   * WASM fallback — automatic when navigator.gpu is missing.
//   * Quantized (q8) weights on the WASM path to stay light on mobile data/RAM.
//
// To bump the library, change CDN below. The RMBG / RawImage / AutoModel API
// used here is stable across Transformers.js v3 and v4.
// ---------------------------------------------------------------------------

const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4';
const MODEL = 'briaai/RMBG-1.4';
const MAX_IN  = 1024;   // working resolution for inference (RMBG runs near this anyway)
const MAX_OUT = 3072;   // cap the produced cut-out so phones don't OOM

let _ready = null;      // memoised { T, model, processor, device }
let _busy = false;      // single-job lock
let _forceWasm = false; // set true after a WebGPU run failure (e.g. Adreno Softmax bug)

export function mlDevice() { return (!_forceWasm && typeof navigator !== 'undefined' && navigator.gpu) ? 'webgpu' : 'wasm'; }
export function mlBusy() { return _busy; }

// Some mobile GPUs (e.g. Samsung Adreno) fail certain WebGPU ops at run time
// ("CreateBindGroup Softmax", bind group validation). Detect that and retry on WASM.
function isGpuError(e) { return /webgpu|gpu|ortrun|bind ?group|validation|createbindgroup|shader|device lost/i.test(String((e && e.message) || e)); }
async function withWasmFallback(run, onStatus) {
  try { return await run(); }
  catch (e) {
    if (_forceWasm || !isGpuError(e)) throw e;
    onStatus && onStatus('GPU not supported here — switching to compatibility mode…');
    _forceWasm = true; try { localStorage.setItem('a4q-ml-wasm', '1'); } catch (_) {} await disposeSegmenter();   // drop the WebGPU model, rebuild on WASM
    return await run();
  }
}

// Load (once) the library + model. onStatus(text) is called with progress lines.
async function ensureModel(onStatus) {
  if (_ready) return _ready;
  _ready = (async () => {
    const device = mlDevice();
    onStatus && onStatus('loading AI…');
    const T = await import(/* @vite-ignore */ CDN);
    T.env.allowLocalModels = false;             // always pull from the Hub/CDN
    const dtype = device === 'webgpu' ? 'fp32' : 'q8';   // light weights on mobile WASM
    // The model can ship as several files, each reporting progress 0→100% — funneling
    // that into one bar looks like multiple downloads. Aggregate by bytes into one bar.
    const _dl = new Map(); let lastPct = -1;
    const progress_callback = (p) => {
      if (!onStatus || !p || !p.file) return;
      if (p.status === 'progress' && typeof p.loaded === 'number' && typeof p.total === 'number' && p.total > 0) _dl.set(p.file, { loaded: p.loaded, total: p.total });
      else if (p.status === 'done' && _dl.has(p.file)) { const e = _dl.get(p.file); _dl.set(p.file, { loaded: e.total, total: e.total }); }
      else if (p.status === 'ready') { onStatus('AI ready'); return; }
      else return;
      let l = 0, t = 0; for (const v of _dl.values()) { l += v.loaded; t += v.total; }
      if (t <= 0) return;
      const pct = Math.min(100, Math.round(l / t * 100));
      if (pct !== lastPct) { lastPct = pct; onStatus(`downloading AI model ${pct}%`); }
    };
    const model = await T.AutoModel.from_pretrained(MODEL, { device, dtype, progress_callback });
    const processor = await T.AutoProcessor.from_pretrained(MODEL, { progress_callback });
    return { T, model, processor, device };
  })().catch((e) => { _ready = null; throw e; });   // allow retry after a failure
  return _ready;
}

// Free the model/session and its GPU memory. Re-loading is automatic on next use.
export async function disposeSegmenter() {
  if (!_ready) return;
  try { const r = await _ready; await r.model?.dispose?.(); } catch (_) {}
  _ready = null;
}

// Resolve a URL string / <img> / <canvas> to a drawable + its natural size.
async function loadDrawable(src) {
  if (typeof src === 'string') {
    const img = await new Promise((res, rej) => {
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => res(im); im.onerror = () => rej(new Error('load ' + src)); im.src = src;
    });
    return { img, w: img.naturalWidth, h: img.naturalHeight };
  }
  return { img: src, w: src.naturalWidth || src.width, h: src.naturalHeight || src.height };
}

// Draw `img` into a fresh canvas, downscaled so the longest side <= maxSide.
function scaledCanvas(img, w, h, maxSide) {
  const s = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, cw, ch);
  return c;
}

async function _maskInfer(src, onStatus) {
  const { T, model, processor } = await ensureModel(onStatus);
  const { img, w, h } = await loadDrawable(src);
  const inCanvas = scaledCanvas(img, w, h, MAX_IN);      // never hold a full-res buffer
  onStatus && onStatus('finding the subject…');
  const blob = await new Promise((r) => inCanvas.toBlob(r, 'image/png'));
  const image = await T.RawImage.read(blob);
  const { pixel_values } = await processor(image);
  const { output } = await model({ input: pixel_values });
  const mask = await T.RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(inCanvas.width, inCanvas.height);
  return { width: inCanvas.width, height: inCanvas.height, data: mask.data, img, origW: w, origH: h };
}

// Foreground matte at the (downscaled) working resolution. Returns
// { width, height, data:Uint8Array(w*h) (subject alpha 0..255), img, origW, origH }.
export async function foregroundMask(src, onStatus) {
  if (_busy) throw new Error('AI is busy — let the current job finish');
  _busy = true;
  try { return await withWasmFallback(() => _maskInfer(src, onStatus), onStatus); }
  finally { _busy = false; }
}

// Background erase: returns a NEW canvas (subject kept, background transparent),
// capped at MAX_OUT. Mask is applied with GPU compositing — no full-res CPU loop.
export async function removeBackground(src, onStatus) {
  const m = await foregroundMask(src, onStatus);

  // tiny mask canvas (working res) whose ALPHA channel is the matte
  const mc = document.createElement('canvas'); mc.width = m.width; mc.height = m.height;
  const mctx = mc.getContext('2d');
  const mid = mctx.createImageData(m.width, m.height);
  for (let i = 0; i < m.data.length; i++) mid.data[i * 4 + 3] = m.data[i];
  mctx.putImageData(mid, 0, 0);

  // output canvas capped at MAX_OUT; draw the (full-res) art then keep where mask is opaque
  const s = Math.min(1, MAX_OUT / Math.max(m.origW, m.origH));
  const ow = Math.max(1, Math.round(m.origW * s)), oh = Math.max(1, Math.round(m.origH * s));
  const out = document.createElement('canvas'); out.width = ow; out.height = oh;
  const octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(m.img, 0, 0, ow, oh);
  octx.globalCompositeOperation = 'destination-in';
  octx.drawImage(mc, 0, 0, ow, oh);                       // soft matte, scaled on the GPU
  onStatus && onStatus('background erased');
  return out;
}
