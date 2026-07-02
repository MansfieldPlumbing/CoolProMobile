/* CoolProMobile — service worker.
   Extends the ArlineArcade pattern (network-first app code, versioned cache,
   cleanup on activate) with additions CoolProMobile needs:
     1. A precached app shell so the studio (editor + paint + 3D) is installable & offline.
     2. A separate, durable "CDN cache" for cross-origin packages (Transformers.js,
        onnxruntime-web, lamejs, ffmpeg.wasm, model weights…). Cross-origin GETs are served
        cache-first from CDN_CACHE so warmed packages work offline; requests to
        known CDN hosts are auto-cached on first network hit.
     3. Background Fetch handlers (backgroundfetchsuccess/fail/abort) so a large package warmed
        via src/cdn.js keeps downloading — and lands in CDN_CACHE — even if the tab backgrounds
        or closes mid-download (Chrome/Android; src/cdn.js falls back to a foreground fetch loop
        where Background Fetch isn't available).
     4. A Periodic Background Sync handler that opportunistically refreshes the small app shell
        while the PWA is closed (Chrome/Android, gated by the site-engagement heuristic — see
        src/pwa.js). It does NOT blindly re-download warmed CDN packages: those are large,
        effectively-immutable model/wasm blobs, and re-fetching them on a timer would just burn
        the user's mobile data for no benefit.
   Update flow is explicit: we do NOT skipWaiting on install — the page detects the
   waiting worker and offers "Update", then posts SKIP_WAITING. */
const VERSION = 'coolpromobile-v14';
const APP_CACHE = VERSION;
const CDN_CACHE = 'nocap-cdn';      // stable bucket name (NOT version-suffixed): survives app updates
const SHARE_CACHE = 'coolpro-share'; // transient: Android share-target hand-off, drained on boot
const FALLBACK = './index.html';

const SHELL = [
  './', './index.html', './theme.css', './app.css', './manifest.webmanifest',
  // editor + shell spine
  './src/app.js', './src/shell.js', './src/registry.js', './src/presenter.js',
  './src/vom.js', './src/dpx.js', './src/ml.js', './src/share.js', './src/convert.js', './src/nav.js', './src/launcher.js', './src/theme-engine.js', './src/contextmenu.js', './src/taskbar.js',
  './src/util.js', './src/hud.js', './src/idb.js', './src/store.js',
  './src/audio.js', './src/media.js', './src/timeline.js', './src/preview.js',
  './src/panels.js', './src/export.js', './src/cdn.js', './src/pwa.js',
  './src/addons.js', './src/ffmpeg.js',
  // shared, reused-everywhere assets
  './shared/presenter.js',
  './vendor/ml/segment.js', './vendor/ml/select.js', './vendor/ml/inpaint.js', './vendor/ml/pose.js', './vendor/ml/gpu-fallback.js',
  './vendor/anim/skeleton.js', './vendor/anim/rig.js', './vendor/anim/motion.js',
  './vendor/ui/flickpaint-ui.css',
  './vendor/ui/fonts/selawk.ttf', './vendor/ui/fonts/CascadiaCodeNF.ttf',
  './vendor/ffmpeg/index.js', './vendor/ffmpeg/classes.js', './vendor/ffmpeg/const.js',
  './vendor/ffmpeg/errors.js', './vendor/ffmpeg/types.js', './vendor/ffmpeg/utils.js',
  './vendor/ffmpeg/worker.js',
  './vendor/ffmpeg-util/index.js', './vendor/ffmpeg-util/errors.js',
  './vendor/ffmpeg-util/const.js', './vendor/ffmpeg-util/types.js',
  // guest surfaces (entry points; heavier guest assets cache on first use)
  './apps/paint/index.html',
  './apps/three/index.html', './apps/three/app.js', './apps/three/characters.json',
  './apps/three/vendor/three.module.min.js', './apps/three/vendor/addons/controls/OrbitControls.js',
  './apps/animate/index.html', './apps/animate/app.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];

// Hosts whose responses we auto-cache on first fetch (the "CDN" in CDN cache).
const CDN_HOSTS = [
  'cdn.jsdelivr.net', 'unpkg.com', 'esm.sh', 'cdnjs.cloudflare.com',
  'huggingface.co', 'cdn-lfs.huggingface.co', 'cas-bridge.xethub.hf.co',
  'storage.googleapis.com',   // MediaPipe .task models
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(APP_CACHE);
    await Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' }))));
    // note: no skipWaiting — let the page drive the update prompt
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const KEEP = [APP_CACHE, CDN_CACHE, SHARE_CACHE];
    await Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  let url; try { url = new URL(req.url); } catch { return; }

  // Android share-target: the system POSTs shared media here. No server on a static host, so we
  // stash the files in SHARE_CACHE and 303-redirect to the app, which drains them on boot.
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(handleShare(req));
    return;
  }
  if (req.method !== 'GET') return;

  if (url.origin !== self.location.origin) {
    // cross-origin: this is the CDN cache lane
    e.respondWith(cdnStrategy(req, url));
    return;
  }
  // same-origin app code: network-first so deploys propagate; cache-first for the rest
  const appCode = req.mode === 'navigate' || /\.(?:js|css|webmanifest|html|json)$/.test(url.pathname);
  e.respondWith(appCode ? networkFirst(req) : cacheFirst(req, APP_CACHE));
});

async function cdnStrategy(req, url) {
  const cache = await caches.open(CDN_CACHE);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;                                   // warmed package → offline-ready
  try {
    const fresh = await fetch(req);
    if (fresh.ok && CDN_HOSTS.includes(url.hostname)) cache.put(req, fresh.clone()).catch(() => {});
    return fresh;
  } catch {
    return hit || Response.error();
  }
}

async function networkFirst(req) {
  try {
    const fresh = await fetch(req, { cache: 'reload' });
    (await caches.open(APP_CACHE)).put(req, fresh.clone()).catch(() => {});
    return fresh;
  } catch {
    const cached = await caches.match(req);
    return cached || (req.mode === 'navigate' ? caches.match(FALLBACK) : Response.error());
  }
}

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    (await caches.open(cacheName)).put(req, fresh.clone()).catch(() => {});
    return fresh;
  } catch { return cached || Response.error(); }
}

// ---- Background Fetch: lands a package src/cdn.js started even if the tab is gone by the time
// it finishes. The registration itself (started from the page) is what makes the download
// survive backgrounding/close; these handlers are what make the *result* durable. ----
self.addEventListener('backgroundfetchsuccess', (e) => {
  const reg = e.registration;
  e.waitUntil((async () => {
    const cache = await caches.open(CDN_CACHE);
    const records = await reg.matchAll();
    await Promise.allSettled(records.map(async (record) => {
      const response = await record.responseReady;
      await cache.put(record.request, response);
    }));
    await reg.updateUI({ title: `${reg.title || 'Package'} — cached for offline use` }).catch(() => {});
    notifyClients({ type: 'bg-fetch-done', id: reg.id });
  })());
});

self.addEventListener('backgroundfetchfail', (e) => {
  const reg = e.registration;
  e.waitUntil((async () => {
    await reg.updateUI({ title: `${reg.title || 'Package'} — download failed` }).catch(() => {});
    notifyClients({ type: 'bg-fetch-failed', id: reg.id });
  })());
});

self.addEventListener('backgroundfetchabort', (e) => {
  notifyClients({ type: 'bg-fetch-aborted', id: e.registration.id });
});

async function notifyClients(msg) {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const c of clients) c.postMessage(msg);
}

// ---- Periodic Background Sync: refresh the app shell opportunistically while closed. ----
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'refresh-shell') e.waitUntil(refreshShell());
});

async function refreshShell() {
  const cache = await caches.open(APP_CACHE);
  await Promise.allSettled(SHELL.map(async (u) => {
    try { await cache.add(new Request(u, { cache: 'reload' })); } catch (_) { /* offline — keep what's cached */ }
  }));
}

// Drain a multipart share POST into SHARE_CACHE, then send the app home to pick it up.
async function handleShare(req) {
  try {
    const form = await req.formData();
    const files = form.getAll('media').filter((f) => f && f.size);
    if (files.length) {
      const cache = await caches.open(SHARE_CACHE);
      let i = 0;
      for (const f of files) {
        const key = new Request('./shared/' + (Date.now()) + '-' + (i++));
        const headers = { 'content-type': f.type || 'application/octet-stream',
          'x-share-name': encodeURIComponent(f.name || ('shared-' + i)) };
        await cache.put(key, new Response(f, { headers }));
      }
    }
  } catch (_) { /* degrade: still navigate home, just with nothing staged */ }
  const dest = new URL('./', self.registration.scope);
  dest.search = '?shared';
  return Response.redirect(dest.href, 303);
}
