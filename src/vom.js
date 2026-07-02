// src/vom.js — the VOM (Virtual Object Manager), JS parity of subsystem's kernel.
//
// "JavaScript when it actually comes correct." The same contract as the native VOM
// (subsystem/src/native/vom/vom.h) and the C# VOM (Vom.cs), distilled to the browser:
// ONE namespace of refcounted, generational handles; authority IS the handle; reclaim is
// deterministic — free-on-zero, owner-scoped, cascade-kill on terminate.
//
// The difference from the native seam: a region here holds a live JS *value* (a composable
// node — a clip, a layer, a mesh, a model session), not a byte span. `bytes` is the advisory
// quota the native side enforces over real memory; here it tracks intent. Freeing a region
// calls value.dispose?.() — so a dpx model session that is `vom.alloc`'d frees its GPU memory
// the instant its refcount hits zero, exactly like the kernel frees a region. One discipline,
// CPU bytes to GPU weights to scene nodes.
//
// Discipline (subsystem doctrine, copied): the registry is canonical, nothing holds its own
// truth, the handle is the authority, behaviours are verbs on objects. The UI is a PROJECTION
// of this namespace, never a second store.

const ALIGN = 256;                         // advisory row-pitch parity with VOM-SPEC §3
const GEN_SHIFT = 16, IDX_MASK = 0xffff;   // handle = [16-bit generation | 16-bit index]
export const NULL_HANDLE = 0;

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(reason, owner) { for (const fn of listeners) fn(reason, owner); }

let _owners = 0;
const owners = new Map();   // ownerId -> Owner

// An owner is a handle table + advisory quota + a slice of the path namespace.
class Owner {
  constructor(name, maxBytes, maxElements) {
    this.id = ++_owners;
    this.name = name || ('owner#' + this.id);
    this.maxBytes = maxBytes || Infinity;
    this.maxElements = maxElements || Infinity;
    this.slots = [];          // index -> { gen, refs, value, bytes, path } | null (free)
    this.free = [];           // recycled indices
    this.bytes = 0;
    this.paths = new Map();   // namespace path -> handle (this owner's slice of \…)
    owners.set(this.id, this);
  }

  // Take a handle: a live region at refcount 1. Returns NULL_HANDLE on quota OOM.
  alloc(value, { bytes = 0, path = null } = {}) {
    const aligned = bytes ? Math.ceil(bytes / ALIGN) * ALIGN : 0;
    if (this.live() + 1 > this.maxElements || this.bytes + aligned > this.maxBytes) return NULL_HANDLE;
    let idx = this.free.pop();
    if (idx === undefined) { idx = this.slots.length; this.slots.push(null); }
    const gen = (this.slots[idx]?.gen ?? 0);   // keep the slot's generation across reuse
    this.slots[idx] = { gen, refs: 1, value, bytes: aligned, path };
    this.bytes += aligned;
    if (path) this.paths.set(path, pack(gen, idx));
    emit('alloc', this);
    return pack(gen, idx);
  }

  _slot(h) {
    const idx = h & IDX_MASK, gen = (h >>> GEN_SHIFT) & IDX_MASK;
    const s = this.slots[idx];
    return s && s.gen === gen ? s : null;     // generational O(1) stale check
  }

  isValid(h) { return h !== NULL_HANDLE && !!this._slot(h); }
  resolve(h) { const s = this._slot(h); return s ? s.value : null; }
  resolvePath(path) { const h = this.paths.get(path); return h && this.isValid(h) ? h : NULL_HANDLE; }
  bytesOf(h) { const s = this._slot(h); return s ? s.bytes : 0; }

  open(h) { const s = this._slot(h); if (!s) return false; s.refs++; return true; }   // refcount++

  // refcount--; frees at zero (dispose + recycle the slot, bumping its generation). Returns
  // true iff this call freed the region — the deterministic free-on-zero contract.
  close(h) {
    const s = this._slot(h); if (!s) return false;
    if (--s.refs > 0) return false;
    const idx = h & IDX_MASK;
    if (s.path) this.paths.delete(s.path);
    try { s.value?.dispose?.(); } catch (_) { /* dispose must not break reclaim */ }
    this.bytes -= s.bytes;
    this.slots[idx] = { gen: (s.gen + 1) & IDX_MASK, refs: 0, value: null, bytes: 0, path: null };
    this.free.push(idx);
    emit('free', this);
    return true;
  }

  live() { let n = 0; for (const s of this.slots) if (s && s.refs > 0) n++; return n; }

  // Terminate the owner: free every live handle (cascade), then drop the owner. A wedged
  // value left behind is reclaimed regardless — "let it crash", resourceless.
  terminate() {
    for (let idx = 0; idx < this.slots.length; idx++) {
      const s = this.slots[idx]; if (!s || s.refs <= 0) continue;
      try { s.value?.dispose?.(); } catch (_) {}
      this.slots[idx] = null;
    }
    this.bytes = 0; this.paths.clear(); owners.delete(this.id);
    emit('terminate', this);
  }
}

function pack(gen, idx) { return (((gen & IDX_MASK) << GEN_SHIFT) | (idx & IDX_MASK)) >>> 0; }

// ---- kernel surface (flat, owner-agnostic — drives the SAME namespace) -------------------
export function createOwner(name, maxBytes, maxElements) { return new Owner(name, maxBytes, maxElements); }
export function liveCount() { let n = 0; for (const o of owners.values()) n += o.live(); return n; }
export function currentBytes() { let b = 0; for (const o of owners.values()) b += o.bytes; return b; }
export function ownerList() { return [...owners.values()]; }

// Resolve a fully-qualified path (\Owner\…) across the whole namespace — resolve-known,
// never enumerate-blindly (VOM-SPEC §6a). Returns the live value or null.
export function resolvePath(path) {
  for (const o of owners.values()) { const h = o.resolvePath(path); if (h) return o.resolve(h); }
  return null;
}

export const VOM = { createOwner, resolvePath, liveCount, currentBytes, ownerList, subscribe, NULL_HANDLE };
export default VOM;
