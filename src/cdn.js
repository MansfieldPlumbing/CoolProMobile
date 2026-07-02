// src/cdn.js — CDN package cache + manager (the bundle's "CDN Marketplace").
// Lets the user add/remove CDN packages (ESM modules, wasm/assets, model weights)
// and "warm" them into a durable Cache Storage bucket (the same CDN_CACHE the
// service worker serves cache-first), so add-ons keep working offline. The
// registry persists to IndexedDB. art4quinn lazy-loads ML libs from a CDN on first
// use; this makes that explicit and manageable.
import { kvGet, kvSet } from './idb.js';
import { CORE_URLS as FFMPEG_CORE_URLS } from './ffmpeg.js';
import { POSE_URLS } from '../vendor/ml/pose.js';

const CDN_CACHE = 'nocap-cdn';
const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(); }

// Built-in packages mirror the AI/export capabilities. `urls` are warmed on demand.
const BUILTIN = [
  { id: 'transformers', name: 'Transformers.js', type: 'esm', builtin: true,
    desc: 'Whisper captions & RMBG background removal (HF).',
    urls: ['https://cdn.jsdelivr.net/npm/@huggingface/transformers@4'] },
  { id: 'lamejs', name: 'lamejs (MP3)', type: 'esm', builtin: true,
    desc: 'MP3 export encoder.',
    urls: ['https://cdn.jsdelivr.net/npm/@breezystack/lamejs@1.2.7/+esm'] },
  { id: 'ffmpeg', name: 'ffmpeg.wasm core', type: 'wasm', builtin: true,
    desc: 'True MP4 (H.264/AAC) export. ~30 MB core — warm it for offline MP4.',
    urls: FFMPEG_CORE_URLS },
  { id: 'ortweb', name: 'onnxruntime-web', type: 'wasm', builtin: true,
    desc: 'Generic ONNX runtime (until dp-onnx web build lands).',
    urls: ['https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.webgpu.min.js'] },
  { id: 'mediapipe', name: 'MediaPipe pose', type: 'wasm', builtin: true,
    desc: 'Body tracking for the Animate surface (~15 MB incl. model) — warm it for offline mocap.',
    urls: POSE_URLS },
];

let user = [];                  // user-added packages
const cachedBytes = new Map();  // id -> bytes (0/undefined = not cached)

export async function init() {
  const saved = await kvGet('cdn-packages');
  if (saved) {
    user = saved.user || [];
    for (const [id, b] of Object.entries(saved.cached || {})) cachedBytes.set(id, b);
  }
  // reconcile cached flags with what's actually in the cache bucket
  await reconcile();
  emit();
  // A Background Fetch can finish after this page stopped watching it (tab was backgrounded
  // past the poll window, or a fresh tab is open now) — the SW tells every open client when
  // one lands, so we pick up the result whenever it arrives.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (!e.data || (e.data.type !== 'bg-fetch-done' && e.data.type !== 'bg-fetch-failed')) return;
      const p = find(e.data.id);
      if (p && e.data.type === 'bg-fetch-done') {
        reconcileOne(p);
        import('./hud.js').then((m) => m.toast(`${p.name} finished caching in the background`));
      } else {
        reconcile().then(() => { persist(); emit(); });
        if (p) import('./hud.js').then((m) => m.toast(`Background download of ${p.name} failed`, { err: true }));
      }
    });
  }
}

function persist() {
  const cached = {}; for (const [id, b] of cachedBytes) cached[id] = b;
  return kvSet('cdn-packages', { user, cached });
}

export function list() {
  return [...BUILTIN, ...user].map((p) => ({ ...p, cached: cachedBytes.has(p.id), bytes: cachedBytes.get(p.id) || 0 }));
}
function find(id) { return BUILTIN.find((p) => p.id === id) || user.find((p) => p.id === id); }

export async function add({ name, url, type = 'esm' }) {
  const urls = String(url).split(/[\s,]+/).filter(Boolean);
  if (!urls.length) throw new Error('Enter at least one URL');
  for (const u of urls) { try { new URL(u); } catch { throw new Error('Invalid URL: ' + u); } }
  const id = 'u-' + Math.random().toString(36).slice(2, 9);
  user.push({ id, name: name || hostname(urls[0]), type, urls, desc: 'User add-on', builtin: false });
  await persist(); emit();
  return id;
}

export async function remove(id) {
  await uncache(id);
  user = user.filter((p) => p.id !== id);
  await persist(); emit();
}

// Fetch every URL of a package and store it in the durable CDN cache. Prefers the Background
// Fetch API (Chrome/Android) for packages with real weight — the download then survives the tab
// backgrounding or closing, with an OS-level progress notification. Falls back to a plain
// foreground fetch loop everywhere else (iOS Safari, Firefox, or if Background Fetch errors).
// Returns the cached byte count, or `{ backgrounded: true }` if handed off and still running
// after we stop waiting on it (the SW's backgroundfetchsuccess handler finishes the job either
// way — see sw.js).
export async function warm(id, onStatus) {
  const p = find(id); if (!p) return;
  const bg = await tryBackgroundFetch(p, onStatus);
  if (bg) return bg;
  return foregroundWarm(p, onStatus);
}

async function foregroundWarm(p, onStatus) {
  const cache = await caches.open(CDN_CACHE);
  let bytes = 0;
  for (let i = 0; i < p.urls.length; i++) {
    onStatus?.(`Caching ${p.name}… (${i + 1}/${p.urls.length})`, Math.round((i / p.urls.length) * 100));
    const res = await fetch(p.urls[i], { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${p.urls[i]}`);
    const buf = await res.clone().arrayBuffer();
    bytes += buf.byteLength;
    await cache.put(p.urls[i], res);
  }
  cachedBytes.set(p.id, bytes);
  await persist(); emit();
  return bytes;
}

const BG_ICONS = [
  { src: new URL('../icons/icon-192.png', import.meta.url).href, sizes: '192x192', type: 'image/png' },
];
const BG_POLL_MS = 500, BG_POLL_MAX = 360;   // ~3 minutes of foreground waiting, then hand off

// Returns a byte count / { backgrounded: true } on success, or null to fall back to the
// foreground loop (no Background Fetch support, or the background download itself failed).
async function tryBackgroundFetch(p, onStatus) {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.backgroundFetch) return null;
    let bg = await reg.backgroundFetch.get(p.id);
    if (!bg) {
      onStatus?.(`Starting a background download of ${p.name}…`, 0);
      bg = await reg.backgroundFetch.fetch(p.id, p.urls, { title: `Caching ${p.name}`, icons: BG_ICONS });
    }
    for (let i = 0; i < BG_POLL_MAX; i++) {
      if (bg.result === 'success') {
        await reconcileOne(p);
        return cachedBytes.get(p.id) ?? 0;
      }
      if (bg.result === 'failure' || bg.failureReason) return null;   // fall back to foreground
      const pct = bg.downloadTotal ? Math.round((bg.downloaded / bg.downloadTotal) * 100) : undefined;
      onStatus?.(`Caching ${p.name} in the background…`, pct);
      await new Promise((r) => setTimeout(r, BG_POLL_MS));
    }
    // Still running after ~3 minutes of watching — the SW finishes it whenever it lands
    // (backgroundfetchsuccess in sw.js), even if this tab closes in the meantime.
    onStatus?.(`${p.name} is downloading in the background — keep the app installed to finish it.`);
    return { backgrounded: true };
  } catch (_) {
    return null;   // any Background Fetch error → plain foreground fetch, same result to the user
  }
}

async function reconcileOne(p) {
  const cache = await caches.open(CDN_CACHE);
  let bytes = 0;
  for (const u of p.urls) {
    const r = await cache.match(u, { ignoreVary: true });
    if (r) { try { bytes += (await r.clone().arrayBuffer()).byteLength; } catch (_) {} }
  }
  cachedBytes.set(p.id, bytes);
  await persist(); emit();
}

export async function uncache(id) {
  const p = find(id); if (!p) return;
  const cache = await caches.open(CDN_CACHE);
  for (const u of p.urls) await cache.delete(u, { ignoreVary: true });
  cachedBytes.delete(id);
  await persist(); emit();
}

// Convenience: dynamic-import a package's entry module (SW serves it cache-first).
export function importModule(id) {
  const p = find(id); if (!p) throw new Error('Unknown package: ' + id);
  return import(/* @vite-ignore */ p.urls[0]);
}

// Total bytes & overall storage estimate.
export function totalBytes() { let t = 0; for (const b of cachedBytes.values()) t += b; return t; }
export async function estimate() {
  if (navigator.storage?.estimate) { try { return await navigator.storage.estimate(); } catch (_) {} }
  return null;
}

async function reconcile() {
  if (!('caches' in window)) return;
  let cache; try { cache = await caches.open(CDN_CACHE); } catch { return; }
  for (const p of [...BUILTIN, ...user]) {
    const present = await cache.match(p.urls[0], { ignoreVary: true });
    if (!present && cachedBytes.has(p.id)) cachedBytes.delete(p.id);
  }
}

const hostname = (u) => { try { return new URL(u).hostname; } catch { return u; } };
