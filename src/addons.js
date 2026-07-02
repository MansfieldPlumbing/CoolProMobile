// src/addons.js — Add-ons & Storage panel: CDN package cache management + PWA install/update.
// Lives inside the Settings breadcrumb drill-down (Settings → Storage & Add-ons, src/launcher.js)
// as one nav.js custom node — no separate dialog, same list-row shape as the rest of Settings.
// Also reachable in one tap from the editor's "⋯" overflow menu via openAddons() below, which
// deep-links into that same screen instead of popping a modal.
import { $, $$, fmtBytes } from './util.js';
import * as CDN from './cdn.js';
import * as PWA from './pwa.js';
import { progress, toast } from './hud.js';

export function initAddons() {
  $('#btnAddons')?.addEventListener('click', openAddons);
}

// Editor "⋯" shortcut: jump Home → Settings → Storage & Add-ons in one hop.
export function openAddons() {
  import('./shell.js').then((m) => m.switchTo('home')).then(() =>
    import('./launcher.js').then((m) => m.openStorageSettings()));
}

// The nav.js custom-node entry point (see storageView in launcher.js).
export function mountAddonsPanel(el) {
  render(el);
}

async function render(el) {
  const pkgs = CDN.list();
  const bgFetchOk = 'serviceWorker' in navigator && 'BackgroundFetchManager' in window;
  const bgSync = PWA.backgroundRefreshState();
  const bgSyncLabel = bgSync === 'registered' ? 'On — may refresh while the app is closed'
    : 'Off in this browser — updates happen while the app is open';

  el.innerHTML = `
    <div class="nv-surface">
      <div class="nv-surface-h">This app</div>
      <div class="nv-surface-b">
        <div class="nv-item"><div class="nv-toggle" style="align-items:flex-start">
          <div><div class="nv-label">Install &amp; updates</div>
            <div class="nv-cap">Updating keeps your cached add-ons.</div></div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            <button class="btn ${PWA.canInstall() ? 'primary' : ''}" id="aoInstall" ${PWA.canInstall() ? '' : 'disabled'}>Install</button>
            <button class="btn ghost" id="aoUpdate">Check updates</button>
          </div>
        </div></div>
        <div class="nv-item"><div class="nv-row" style="cursor:default">
          <span class="nv-left"><span class="nv-ic${bgFetchOk ? ' tinted' : ''}"${bgFetchOk ? ' style="--tint: var(--success)"' : ''}>⤓</span>
            <span class="nv-meta"><span class="nv-label">Background downloads</span>
              <span class="nv-cap">${bgFetchOk ? 'On — large packages keep downloading if you leave the app' : 'Off in this browser — keep the app open while caching'}</span></span></span>
        </div></div>
        <div class="nv-item"><div class="nv-row" style="cursor:default">
          <span class="nv-left"><span class="nv-ic${bgSync === 'registered' ? ' tinted' : ''}"${bgSync === 'registered' ? ' style="--tint: var(--success)"' : ''}>↻</span>
            <span class="nv-meta"><span class="nv-label">Background updates</span>
              <span class="nv-cap">${bgSyncLabel}</span></span></span>
        </div></div>
      </div>
    </div>

    <div class="nv-surface">
      <div class="nv-surface-h">CDN packages</div>
      <div class="nv-surface-b" id="aoList"></div>
    </div>

    <div class="nv-surface">
      <div class="nv-surface-h">Add a package</div>
      <div class="nv-surface-b" style="padding:16px">
        <div class="field"><label>Name</label><input id="aoName" type="text" placeholder="My add-on"></div>
        <div class="field"><label>URL(s) — ESM module, wasm or model weights (comma/space separated)</label>
          <input id="aoUrl" type="text" placeholder="https://cdn.jsdelivr.net/npm/…"></div>
        <div class="field"><label>Type</label>
          <select id="aoType"><option value="esm">ESM module</option><option value="wasm">WASM / asset</option><option value="model">Model weights</option></select></div>
        <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn primary" id="aoAdd">＋ Add package</button></div>
      </div>
    </div>`;

  $('#aoList', el).innerHTML = pkgs.map((p) => `
    <div class="nv-item"><div class="nv-row" style="cursor:default">
      <span class="nv-left"><span class="nv-ic${p.cached ? ' tinted' : ''}" ${p.cached ? 'style="--tint: var(--success)"' : ''}>${p.cached ? '●' : '○'}</span>
        <span class="nv-meta"><span class="nv-line"><span class="nv-label">${esc(p.name)}</span><span class="chip">${p.type}</span></span>
          <span class="nv-cap">${esc(p.desc)}${p.cached ? ` · ${fmtBytes(p.bytes)} cached` : ' · not cached'}</span></span></span>
      <span style="display:flex;gap:6px;flex-shrink:0">
        ${p.cached
          ? `<button class="btn ghost" data-uncache="${p.id}">Remove</button>`
          : `<button class="btn" data-warm="${p.id}">Cache</button>`}
        ${p.builtin ? '' : `<button class="btn ghost" data-del="${p.id}" title="Delete add-on">🗑</button>`}
      </span>
    </div></div>`).join('') || `<div class="nv-cap" style="padding:14px 16px">No packages yet.</div>`;

  $('#aoInstall', el).addEventListener('click', PWA.promptInstall);
  $('#aoUpdate', el).addEventListener('click', PWA.checkForUpdates);
  $('#aoAdd', el).addEventListener('click', async () => {
    try {
      await CDN.add({ name: $('#aoName', el).value.trim(), url: $('#aoUrl', el).value.trim(), type: $('#aoType', el).value });
      toast('Add-on added'); render(el);
    } catch (e) { toast(e.message, { err: true, ms: 3200 }); }
  });
  $$('[data-warm]', el).forEach((b) => b.addEventListener('click', async () => {
    const pr = progress('Caching…');
    try {
      const n = await CDN.warm(b.dataset.warm, pr.status);
      if (n && n.backgrounded) pr.done('Continuing in the background…');
      else pr.done(`Cached ${fmtBytes(n)}`);
      render(el);
    } catch (e) { pr.fail(e.message); }
  }));
  $$('[data-uncache]', el).forEach((b) => b.addEventListener('click', async () => { await CDN.uncache(b.dataset.uncache); render(el); }));
  $$('[data-del]', el).forEach((b) => b.addEventListener('click', async () => { await CDN.remove(b.dataset.del); render(el); }));
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
