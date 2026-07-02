// src/audio.js — Web Audio engine.
// Patterns adapted from ArlineArcade's sfx.js/music.js: one shared AudioContext,
// a master gain, and lazily-built per-element gain nodes so the preview can mix
// several media elements with independent volume. The same context is reused for
// waveform decoding (media.js) and the offline mixdown at export time.
let _ctx = null;
let _master = null;
const graphs = new WeakMap();   // HTMLMediaElement -> { source, gain }

export function ctx() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
    _master = _ctx.createGain();
    _master.gain.value = 1;
    _master.connect(_ctx.destination);
  }
  return _ctx;
}
export function master() { ctx(); return _master; }

export function unlock() {
  const c = ctx();
  if (c.state === 'suspended') c.resume();
}

// Build (once) the source→gain→master chain for a media element. A media element
// can only ever back ONE MediaElementSourceNode, so we cache it.
export function graphFor(el) {
  let g = graphs.get(el);
  if (g) return g;
  const c = ctx();
  let source;
  try { source = c.createMediaElementSource(el); }
  catch (_) { return { gain: null, source: null }; } // already connected elsewhere
  const gain = c.createGain();
  gain.gain.value = 1;
  source.connect(gain);
  gain.connect(_master);
  g = { source, gain };
  graphs.set(el, g);
  return g;
}

export function setMaster(v) { master().gain.value = v; }

// Decode an ArrayBuffer to an AudioBuffer using the shared context.
export function decode(arrayBuffer) {
  return ctx().decodeAudioData(arrayBuffer.slice(0));
}
