// src/ml.js — back-compat shim. The on-device AI layer is now `dpx` (src/dpx.js), the studio-
// wide inference runtime (subsystem's dp-onnx → dpx). This module re-exports it so existing
// call sites (panels.js: ML.CAPS / ML.run) keep working unchanged while the runtime is unified.
// New code should import from './dpx.js' directly.
export { CAPS, run, registerProvider, providerFor, releaseSession, modelBytes } from './dpx.js';
