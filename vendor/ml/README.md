# assets/ml — on-device ML harness

Shared, build-free ML for art4quinn. Four modules power the AI tools across the
apps:

- `segment.js` — **background erase / cut-out** (RMBG-1.4). Used by paint, three, gallery.
- `select.js` — **AI Magic Wand**: tap-to-select an object (SlimSAM). Used by paint.
- `inpaint.js` — **Magic Eraser**: content-aware fill / object removal (LaMa, onnxruntime-web). Used by paint.
- `pose.js` — **Pose Capture**: 33 body landmarks (MediaPipe PoseLandmarker, Apache-2.0 —
  JS package and `.task` model). Auto-rigs characters and drives live mocap in the Animate
  surface (`vendor/anim` consumes it via `skeleton.poseFromLandmarks`). Same pattern:
  lazy CDN load, single-job lock, GPU→CPU fallback, `disposePose()`.

All three follow the same memory-safe pattern (downscale before inference, GPU
compositing, single-job lock, `dispose*()` to free memory). `select.js`/`inpaint.js`
chain through paint's existing selection: the Wand makes a mask selection, the
Eraser consumes it.

> ⚠ `inpaint.js` (LaMa) talks raw ONNX and downloads a ~200MB model. Its tensor
> I/O names + value range are auto-detected but **should be verified on-device**;
> see the header comment in `inpaint.js`.

Below documents the original background-erase (`segment.js`).

## How it works
- Lazy-loads [Transformers.js](https://huggingface.co/docs/transformers.js) from the
  jsDelivr CDN **on first use** (nothing ships in the page payload).
- Runs **RMBG-1.4** (`briaai/RMBG-1.4`) for foreground matting.
- **WebGPU first** (Chrome 121+, incl. Android/Pixel), automatic **WASM fallback**;
  quantized (`q8`) weights on the WASM path to stay light on phones.
- Model weights are cached by the browser (Cache Storage) → downloaded once per device.

## API
```js
import { removeBackground, foregroundMask, mlDevice } from '../assets/ml/segment.js';

// src = URL string | <img> | <canvas>.  onStatus(text) is optional (for a HUD).
const cutout = await removeBackground(src, msg => console.log(msg)); // -> <canvas>, transparent bg
const { width, height, data } = await foregroundMask(src);          // data[i] = subject alpha 0..255
```

## Where it's wired
- **paint/** — "Erase Background" (top blind) mattes the active layer in place (undoable).
- **three/** — "AI cut-out" toggle (Scene panel) uses the matte for a clean silhouette/extrude
  from any background (replaces the corner flood-fill key).
- **gallery.html** — per-image ✂︎ button downloads a transparent PNG.

## Notes
- To bump the library, edit `CDN` in `segment.js` (the RMBG/RawImage/AutoModel API is
  stable across v3/v4).
- RMBG-1.4 is a BRIA model under a research/non-commercial license — fine for Quinn's
  personal studio; swap the `MODEL` constant if a different license is needed.
- First run downloads the model (~tens of MB); subsequent runs are instant from cache.
