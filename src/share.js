// src/share.js — Android share-target + file-handler intake (the phone-first payoff).
//
// Installed on Android, CoolPro shows up in the system SHARE SHEET (manifest `share_target`)
// and as an "Open with" handler (`file_handlers`). Both deliver media here; this drops it
// straight onto the editor timeline.
//
// On a static host there is no server to receive the share POST, so sw.js intercepts it,
// stashes the files in the `coolpro-share` cache, and 303-redirects to the app. We drain that
// cache on boot. File-handler launches arrive via the File Handling API's launchQueue. Either
// path → importFiles → switch to the editor.
import { importFiles } from './media.js';
import { switchTo } from './shell.js';
import { openConvert } from './convert.js';
import { toast } from './hud.js';

const SHARE_CACHE = 'coolpro-share';

export async function initShare() {
  try { await drainSharedCache(); } catch (_) { /* degrade silently */ }
  wireLaunchQueue();
}

// Files the service worker stashed from an Android share POST.
async function drainSharedCache() {
  if (!('caches' in window)) return;
  const cache = await caches.open(SHARE_CACHE);
  const reqs = await cache.keys();
  if (!reqs.length) return;
  const files = [];
  for (const req of reqs) {
    const res = await cache.match(req);
    await cache.delete(req);
    if (!res) continue;
    const blob = await res.blob();
    let name = res.headers.get('x-share-name');
    try { name = name ? decodeURIComponent(name) : null; } catch (_) {}
    files.push(new File([blob], name || 'shared', { type: blob.type || res.headers.get('content-type') || '' }));
  }
  cleanUrl();                       // drop the ?shared marker so a refresh doesn't re-run
  if (files.length) await land(files);
}

// Files from an "Open with → CoolPro" file-handler launch.
function wireLaunchQueue() {
  if (!('launchQueue' in window) || typeof window.launchQueue.setConsumer !== 'function') return;
  window.launchQueue.setConsumer(async (params) => {
    if (!params || !params.files || !params.files.length) return;
    try { await land(await Promise.all(params.files.map((h) => h.getFile()))); } catch (_) {}
  });
}

async function land(files) {
  // A single shared file opens the Convert sheet (your options: extract audio, convert, add to
  // timeline, share back out). Multiple files bulk-import straight onto the timeline.
  if (files.length === 1) { openConvert(files[0]); return; }
  switchTo('editor');
  await importFiles(files);
  toast(`Added ${files.length} shared items to the editor`, { ms: 2600 });
}

function cleanUrl() {
  if (location.search) { try { history.replaceState(null, '', location.pathname); } catch (_) {} }
}
