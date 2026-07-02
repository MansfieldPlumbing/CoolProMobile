// src/shell.js — the Shell: it reads the registry's layout, mounts presenters into the stage,
// and presents the active presenter's contributed verbs. It holds no document truth — it is the
// chrome that projects the namespace (subsystem's Shell.js role, ported to the studio).
//
// The editor is the resting native presenter (kept alive). Paint & 3D are guests,
// mounted on first visit and kept warm so their canvas state survives a tab switch. A guest's
// menu (if it contributes one over the presenter bridge) lands in #shellMenu; both guests ship
// full in-frame UIs today, so the Shell bar is primarily the app switcher.
import * as Registry from './registry.js';
import { presenterFor } from './presenter.js';

let active = null;
let guestHost = null;
const mounted = new Map();   // id -> presenter (warm)
const subs = new Set();      // taskbar et al. — notified when active/warm state changes

// --- multitasking surface (the taskbar reads these) -------------------------------------------
// Every offered surface, with its live state: `warm` = a presenter is mounted and kept alive
// (its document survives a switch), `active` = it's the one on stage right now.
export function openSurfaces() {
  return Registry.tiles().map((r) => ({
    id: r.id, name: r.name, icon: r.icon, kind: r.kind,
    warm: mounted.has(r.id), active: !!active && active.id === r.id,
  }));
}
export function activeId() { return active ? active.id : null; }
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function notify() { for (const f of subs) { try { f(); } catch (_) {} } }

// Close a warm guest to free its memory (iframe + listeners). The native editor is the resting
// surface — never closed. If the closing guest is on stage, leave for the editor first.
export async function closeSurface(id) {
  const rec = Registry.resolve(id);
  const p = mounted.get(id);
  if (!p || !rec || rec.kind !== 'guest') return;
  if (active === p) await switchTo('editor');   // switchTo will notify; reveals editor, hides guests
  p.unmount();
  mounted.delete(id);
  notify();
}

export function initShell() {
  guestHost = document.getElementById('stage-guests');
  buildRail();
  buildLauncher();
  wireChrome();
  const home = Registry.landing() || Registry.layout()[0];
  if (home) switchTo(home.id);
}

function buildRail() {
  const rail = document.getElementById('appRail');
  if (!rail) return;
  rail.innerHTML = Registry.layout().map((r) =>
    `<button class="app-tab" data-app="${r.id}" title="${escAttr(r.blurb)}">
       <span class="ic">${r.icon}</span><span class="nm">${escHtml(r.name)}</span></button>`).join('');
  rail.querySelectorAll('.app-tab').forEach((b) => b.addEventListener('click', () => switchTo(b.dataset.app)));
}

// The Launcher front door — a composable drill-down (settings.obp shape): first-class templates
// across every surface, projected by the nav engine from launcher.js's tree.
function buildLauncher() {
  const host = document.getElementById('navHost'), crumbs = document.getElementById('navCrumbs');
  if (!host || !crumbs) return;
  import('./launcher.js').then((m) => m.initLauncher(host, crumbs, { switchTo }));
}

function wireChrome() {
  const brand = document.getElementById('brandHome');
  if (brand) brand.addEventListener('click', () => switchTo('home'));
}

export async function switchTo(id) {
  const rec = Registry.resolve(id);
  if (!rec || (active && active.id === id)) return;
  if (active) active.hide();

  let p = mounted.get(id);
  if (!p) {
    const host = rec.kind === 'guest' ? guestHost : document.getElementById('surface-' + id);
    p = presenterFor(rec);
    await p.mount(host, { shell: api, registry: Registry });
    mounted.set(id, p);
  } else {
    p.show();
  }
  active = p;

  // Surface split: the native editor lives in #surface-editor; every guest shares #stage-guests
  // (only the active guest's own frame is shown). The Shell owns which container is visible.
  guestHost.hidden = rec.kind !== 'guest';

  document.querySelectorAll('.app-tab').forEach((t) => t.classList.toggle('active', t.dataset.app === id));
  document.body.dataset.app = id;
  renderMenu(p);
  notify();
}

// Hand a message to a surface, mounting it first (e.g. open-media with a File — structured
// clone carries blobs fine). GuestPresenter queues it until the guest reports surface-ready.
export async function sendToSurface(id, msg) {
  await switchTo(id);
  const p = mounted.get(id);
  if (p && p.post) p.post(msg);
}

// Present a presenter's contributed verbs (grouped by menu), or clear when it has none.
function renderMenu(p) {
  const slot = document.getElementById('shellMenu');
  if (!slot) return;
  const verbs = (p && p.verbs) || [];
  if (!verbs.length) { slot.innerHTML = ''; return; }
  const groups = {};
  for (const v of verbs) (groups[v.menu || 'app'] ||= []).push(v);
  slot.innerHTML = Object.entries(groups).map(([menu, items]) =>
    `<div class="shell-menu-group" data-menu="${escAttr(menu)}">
       <span class="mg-label">${escHtml(menu)}</span>
       ${items.map((v) => `<button class="mg-verb" data-verb="${escAttr(v.verb)}"
            ${v.enabled === false ? 'disabled' : ''}>${escHtml(v.label || v.verb)}${v.checked ? ' ✓' : ''}</button>`).join('')}
     </div>`).join('');
  slot.querySelectorAll('.mg-verb').forEach((b) =>
    b.addEventListener('click', () => active && active.invoke(b.dataset.verb)));
}

// The handle the Shell hands each presenter (UiObject ctx.shell).
const api = {
  switchTo,
  onVerbs(p) { if (p === active) renderMenu(p); },   // a guest re-announced its menu
};

const escHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escAttr = (s) => String(s).replace(/"/g, '&quot;');
