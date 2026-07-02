// src/pwa.js — installable PWA + explicit update checking.
// Registers the root service worker, captures the install prompt (topbar button),
// and surfaces an "Update available" banner when a new worker is waiting (we drive
// the update rather than silently reloading, so the user is in control).
import { toast } from './hud.js';

let reg = null;
let deferredPrompt = null;
let reloading = false;
let onState = () => {};   // UI hook (install availability / update availability)
let bgRefreshState = 'unknown';   // 'registered' | 'unsupported' | 'unknown' (not checked yet)

export function initPWA(stateHook) {
  if (typeof stateHook === 'function') onState = stateHook;
  if (!('serviceWorker' in navigator)) { bgRefreshState = 'unsupported'; return; }

  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((r) => {
    reg = r;
    if (r.waiting && navigator.serviceWorker.controller) showUpdate();
    r.addEventListener('updatefound', () => {
      const nw = r.installing; if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate();
      });
    });
    // periodic + focus-based update checks
    setInterval(() => r.update().catch(() => {}), 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) r.update().catch(() => {}); });
    registerPeriodicRefresh(r).then((s) => { bgRefreshState = s; onState({ bgRefresh: s }); });
  }).catch(() => { bgRefreshState = 'unsupported'; });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return; reloading = true; location.reload();
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredPrompt = e; onState({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null; onState({ canInstall: false }); toast('CoolProMobile installed');
  });
}

// Periodic Background Sync (Chrome/Android only): lets the SW opportunistically refresh the app
// shell while the PWA is closed. Gated behind both feature detection and Chrome's site-engagement
// permission — it's "may refresh in the background," not a guarantee, so callers should present
// it that way rather than as a reliability promise.
async function registerPeriodicRefresh(r) {
  if (!('periodicSync' in r)) return 'unsupported';
  try {
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (status.state !== 'granted') return 'unsupported';
    await r.periodicSync.register('refresh-shell', { minInterval: 24 * 60 * 60 * 1000 });
    return 'registered';
  } catch (_) { return 'unsupported'; }
}
export function backgroundRefreshState() { return bgRefreshState; }

export function canInstall() { return !!deferredPrompt; }
export async function promptInstall() {
  if (!deferredPrompt) { toast('Install isn’t available here (already installed, or unsupported).', { ms: 3200 }); return; }
  deferredPrompt.prompt();
  await deferredPrompt.userChoice.catch(() => {});
  deferredPrompt = null; onState({ canInstall: false });
}

// Manual "Check for updates" (used by the Add-ons panel).
export async function checkForUpdates() {
  if (!reg) { toast('Service worker not active yet.', { ms: 2400 }); return false; }
  await reg.update().catch(() => {});
  if (reg.waiting && navigator.serviceWorker.controller) { showUpdate(); return true; }
  if (reg.installing) { toast('Downloading update… (your cached add-ons are kept)', { ms: 3000 }); return true; }
  toast('You’re on the latest version.', { ms: 2200 });
  return false;
}

function applyUpdate() {
  if (reg?.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  else location.reload();
}

let banner = null;
function showUpdate() {
  onState({ updateReady: true });
  if (banner) return;
  banner = document.createElement('div');
  banner.className = 'toast';
  banner.style.pointerEvents = 'auto';
  banner.innerHTML = `<span>A new version of CoolProMobile is ready.</span>`;
  const btn = document.createElement('button');
  btn.className = 'btn primary'; btn.style.padding = '4px 10px'; btn.textContent = 'Update';
  btn.onclick = applyUpdate;
  const later = document.createElement('button');
  later.className = 'btn ghost'; later.style.padding = '4px 8px'; later.textContent = 'Later';
  later.onclick = () => { banner.remove(); banner = null; };
  banner.append(btn, later);
  document.getElementById('hud').appendChild(banner);
}
