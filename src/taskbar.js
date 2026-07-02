// src/taskbar.js — the multitasking dock (subsystem Taskbar.js, ported to the studio).
//
// A persistent bottom strip of the studio's surfaces — phone-first, in thumb reach. Each chip is
// a surface (Editor · Paint · 3D); a live dot marks the WARM ones (kept-alive presenters), so the
// art you started in Paint is plainly still running when you flip to the Editor. That is the whole
// "compose a video and do its art with a shared asset space" workflow made visible: the Shell keeps
// every surface warm, the taskbar is the window into what's open.
//
// Tap a chip to switch · long-press (or right-click) for the per-task menu (the same context-menu
// atom the tracks/clips/bin use) · drag to reorder (spring physics lifted from subsystem's tabbar).
import * as Shell from './shell.js';
import { attachContextMenu, isMenuOpen } from './contextmenu.js';
import { toast } from './hud.js';

const CHIP = 52;                 // 46px chip + 6px gap — the slot width the spring snaps to
const STIFF = 0.082, DAMP = 0.64;
const ORDER_KEY = 'coolpro-taskbar-order';

let strip = null;
let pos = {};                    // id -> { x, t, v }  (current, target, velocity)
let order = [];                  // ids, left→right (persisted)
let dragId = null, moved = false, raf = 0;

export function initTaskbar() {
  const host = document.getElementById('taskbar');
  if (!host) return;
  host.innerHTML =
    '<button id="tbLaunch" class="tb-launch" title="Home — all surfaces" aria-label="Home">' +
      '<span class="tb-launch-ic">⊞</span></button>' +
    '<div class="tb-strip" role="tablist"></div>';
  strip = host.querySelector('.tb-strip');
  host.querySelector('#tbLaunch').addEventListener('click', () => Shell.switchTo('home'));
  order = loadOrder();
  render();
  loop();
  Shell.subscribe(syncState);    // active/live can change without the chip set changing
}

function loadOrder() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'); } catch (_) {}
  const ids = Shell.openSurfaces().map((s) => s.id);
  const o = saved.filter((id) => ids.includes(id));            // honour saved order…
  for (const id of ids) if (!o.includes(id)) o.push(id);       // …then append any newcomers
  return o;
}
function saveOrder() { try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch (_) {} }

function byOrder() {
  const map = new Map(Shell.openSurfaces().map((s) => [s.id, s]));
  return order.map((id) => map.get(id)).filter(Boolean);
}

// The chip set is static (every surface is always a chip; warm is just a dot), so this runs once.
function render() {
  strip.replaceChildren();
  byOrder().forEach((s, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tb-chip' + (s.active ? ' active' : '') + (s.warm ? ' live' : '');
    chip.dataset.id = s.id;
    chip.title = s.name;
    chip.setAttribute('role', 'tab');
    chip.innerHTML = `<span class="tb-ic">${s.icon}</span><span class="tb-dot"></span>`;
    chip.addEventListener('pointerdown', (e) => down(e, chip, s.id));
    attachContextMenu(chip, () => chipMenu(s.id));
    if (pos[s.id] === undefined) pos[s.id] = { x: i * CHIP, t: i * CHIP, v: 0 };
    else pos[s.id].t = i * CHIP;
    chip.style.transform = `translateX(${Math.round(pos[s.id].x)}px)`;
    strip.appendChild(chip);
  });
  for (const id of Object.keys(pos)) if (!order.includes(id)) delete pos[id];
}

// A switch/close changed which surface is active or warm — just retoggle the classes (no rebuild,
// so a drag in flight is never interrupted).
function syncState() {
  if (!strip) return;
  const map = new Map(Shell.openSurfaces().map((s) => [s.id, s]));
  for (const chip of strip.children) {
    const s = map.get(chip.dataset.id); if (!s) continue;
    chip.classList.toggle('active', s.active);
    chip.classList.toggle('live', s.warm);
  }
}

function chipMenu(id) {
  const s = Shell.openSurfaces().find((x) => x.id === id);
  if (!s) return [];
  const items = [
    { label: s.active ? 'Current surface' : `Open ${s.name}`, icon: s.icon,
      disabled: s.active, run: () => Shell.switchTo(id) },
  ];
  // Guests can be closed to free memory; the native editor is the resting surface (always on).
  if (s.kind === 'guest') {
    items.push('-', {
      label: s.warm ? 'Close (free memory)' : 'Not running', icon: '✕',
      danger: s.warm, disabled: !s.warm,
      run: () => { Shell.closeSurface(id); toast(`Closed ${s.name}`); },
    });
  }
  return items;
}

// --- spring drag-reorder (subsystem tabbar.js) — pointerdown coexists with the context-menu atom:
// a real long-press opens the menu, and we suppress the tap-switch when it does. ---
function down(e, el, id) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;     // right-click → the contextmenu path
  e.preventDefault();
  try { el.setPointerCapture(e.pointerId); } catch (_) {}
  dragId = id; moved = false;
  const sx = e.clientX, startX = pos[id] ? pos[id].x : 0;
  const move = (ev) => {
    const d = ev.clientX - sx;
    if (Math.abs(d) > 4) moved = true;
    if (!moved) return;
    const max = Math.max(0, order.length * CHIP - CHIP);
    const x = Math.min(max, Math.max(0, startX + d));
    if (pos[id]) { pos[id].x = x; pos[id].t = x; }
    swap(id, x);
  };
  const up = (ev) => {
    try { el.releasePointerCapture(ev.pointerId); } catch (_) {}
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
    dragId = null;
    if (!moved) { if (!isMenuOpen()) Shell.switchTo(id); }     // tap = switch (unless long-press won)
    else { retarget(); saveOrder(); }
  };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
}

function swapped(a, i, j) { const c = a.slice(); [c[i], c[j]] = [c[j], c[i]]; return c; }
function swap(id, x) {
  const i = order.indexOf(id);
  if (i < 0) return;
  if (i > 0 && x < (i - 1) * CHIP + CHIP / 2) { order = swapped(order, i, i - 1); retarget(); return; }
  if (i < order.length - 1 && x > (i + 1) * CHIP - CHIP / 2) { order = swapped(order, i, i + 1); retarget(); }
}
function retarget() { order.forEach((id, i) => { if (pos[id]) pos[id].t = i * CHIP; }); }

function loop() {
  const step = () => {
    if (!strip) return;
    for (const chip of strip.children) {
      const s = pos[chip.dataset.id]; if (!s) continue;
      if (dragId === chip.dataset.id) { chip.style.transform = `translateX(${s.x}px)`; chip.style.zIndex = '100'; continue; }
      const dx = s.t - s.x; s.v += dx * STIFF; s.v *= DAMP; s.x += s.v;
      if (Math.abs(dx) < 0.5 && Math.abs(s.v) < 0.5) { s.x = s.t; s.v = 0; }   // settle: kill sub-pixel jitter
      chip.style.transform = `translateX(${Math.round(s.x)}px)`;
      chip.style.zIndex = chip.classList.contains('active') ? '50' : '10';
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
