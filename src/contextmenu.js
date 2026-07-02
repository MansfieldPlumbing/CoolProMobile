// src/contextmenu.js — a homespun contextual verb menu: long-press (touch) or right-click (desktop)
// pops a flyout of verbs for the object you pressed. This is the one "contextual verb surface" the
// subsystem shell's Menu/Charms are (a flyout of _btn(label,{icon,danger,onClick})), generalized so
// every object in the suite — tracks, clips, bin items, layers, later the taskbar — reuses it.
//
// items: [{ label, icon, danger, disabled, checked, run }] or '-' for a separator.

let _open = null;

// Is a context menu currently up? Other pointer handlers (the taskbar's tap-to-switch) check this so
// a long-press that opened a menu doesn't also fire the tap action underneath it.
export function isMenuOpen() { return !!_open; }

export function closeMenu() {
  if (!_open) return;
  _open.remove(); _open = null;
  document.removeEventListener('pointerdown', onDocDown, true);
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('blur', closeMenu);
}
function onDocDown(e) { if (_open && !_open.contains(e.target)) closeMenu(); }
function onKey(e) { if (e.key === 'Escape') closeMenu(); }

export function openMenu(x, y, items) {
  closeMenu();
  const m = document.createElement('div'); m.className = 'ctx-menu acrylic';
  for (const it of (items || [])) {
    if (it === '-' || it.sep) { const s = document.createElement('div'); s.className = 'ctx-sep'; m.appendChild(s); continue; }
    const b = document.createElement('button');
    b.className = 'ctx-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : '');
    if (it.disabled) b.disabled = true;
    b.innerHTML = `<span class="ctx-ic"></span><span class="ctx-lb"></span>`;
    b.querySelector('.ctx-ic').textContent = it.checked ? '✓' : (it.icon || '');
    b.querySelector('.ctx-lb').textContent = it.label;
    if (!it.disabled) b.addEventListener('click', () => { closeMenu(); try { it.run && it.run(); } catch (_) {} });
    m.appendChild(b);
  }
  document.body.appendChild(m);
  // clamp on-screen
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
  _open = m;
  // defer the outside-tap listener so the opening press doesn't immediately close it
  setTimeout(() => { document.addEventListener('pointerdown', onDocDown, true); window.addEventListener('keydown', onKey, true); window.addEventListener('blur', closeMenu); }, 0);
  return m;
}

// Wire long-press (touch, 480ms) + right-click on an element. itemsFn(event) is called at press time
// so the verb list reflects current state. Returns a detach fn.
export function attachContextMenu(el, itemsFn) {
  let timer = null, sx = 0, sy = 0;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const start = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;   // right-click goes through contextmenu
    sx = e.clientX; sy = e.clientY; clear();
    timer = setTimeout(() => { timer = null; const items = itemsFn(e); if (items && items.length) openMenu(sx, sy, items); }, 480);
  };
  const move = (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) clear(); };
  const ctx = (e) => { e.preventDefault(); const items = itemsFn(e); if (items && items.length) openMenu(e.clientX, e.clientY, items); };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', clear);
  el.addEventListener('pointercancel', clear);
  el.addEventListener('contextmenu', ctx);
  return () => { for (const [ev, fn] of [['pointerdown', start], ['pointermove', move], ['pointerup', clear], ['pointercancel', clear], ['contextmenu', ctx]]) el.removeEventListener(ev, fn); };
}
