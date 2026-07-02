// vendor/ml/gpu-fallback.js — shared WebGPU -> WASM fallback for the on-device ML modules
// (segment.js / select.js / inpaint.js). One localStorage flag, one retry policy, one
// human-friendly error path, so a broken mobile GPU driver never leaks an "OrtRun / MatMul /
// ShaderModule" stack trace at the user — it just quietly switches modes and works.
//
// Why a reload-on-second-failure, not just an in-place retry: once onnxruntime-web hits a
// WebGPU shader-validation error, the browser's underlying GPUDevice can be left in a state
// that no amount of JS-level session teardown recovers from (the wasm module's internal
// bookkeeping for that device is what's actually wedged). We still try one in-place retry on
// WASM first (cheap, and it resolves the common case — e.g. a transient adapter hiccup) but if
// THAT also throws a GPU-flavored error, the only reliable fix is a fresh module instance: we've
// already persisted the "always use WASM" flag, so reloading boots straight past WebGPU.
const KEY = 'a4q-ml-wasm';

let _forceWasm = (() => { try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; } })();

export function forcedWasm() { return _forceWasm; }
export function gpuAvailable() { return !_forceWasm && typeof navigator !== 'undefined' && !!navigator.gpu; }

// Some mobile GPUs (e.g. Samsung Adreno) fail certain WebGPU ops at run time — a
// "CreateBindGroup Softmax" / shader-validation error, not a load-time failure — so this has
// to be checked around every inference call, not just around model loading.
export function isGpuError(e) {
  return /webgpu|gpu|ortrun|bind ?group|validation|createbindgroup|shader|device lost/i.test(String((e && e.message) || e));
}

function markForceWasm() {
  _forceWasm = true;
  try { localStorage.setItem(KEY, '1'); } catch (_) {}
}

// run(): the inference call to try. dispose(): drops the cached session/model so a retry
// rebuilds fresh on the new device. onStatus(text): the existing progress/status sink (already
// wired to the on-screen HUD in every caller) — used here for plain-language status, never the
// raw runtime error.
export async function withGpuFallback(run, dispose, onStatus) {
  try {
    return await run();
  } catch (e) {
    if (_forceWasm || !isGpuError(e)) throw e;
    onStatus?.('Your device’s graphics accelerator hit a snag — switching to a more compatible mode…');
    markForceWasm();
    await dispose();
    try {
      return await run();
    } catch (e2) {
      if (!isGpuError(e2)) throw e2;
      onStatus?.('Almost there — finishing the switch, one moment…');
      setTimeout(() => { try { location.reload(); } catch (_) {} }, 900);
      throw new Error('Switching to a more compatible mode — try again in a second.');
    }
  }
}
