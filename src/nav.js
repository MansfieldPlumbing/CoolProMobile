// src/nav.js — a reusable breadcrumb drill-down, the settings.obp shape distilled to a composable
// JS engine. A view is { title, children:[node…] }; nodes project to DOM by type; an `action` with
// `to` drills into a sub-view (animated), with `open`/`run` it fires a closure. The Shell's launcher
// AND its settings are the same engine over different trees — "easy to compose workflows."
//
// Node types:
//   { type:'action', label, caption, icon, to?:view, open?:fn, run?:fn }
//   { type:'group',  title, children:[…] }                         // a titled surface card
//   { type:'segment',label, caption, value, options:[{k,v}], onChange }
//   { type:'toggle', label, caption, value, onChange }
//   { type:'slider', label, caption, min, max, step, value, unit, mult, onChange }
//   { type:'color',  label, caption, value, onChange }
//   { type:'header', title, subtitle, note }
//   { type:'custom', mount:(el)=>{} }

export function mountNav(host, crumbsHost, rootView) {
  let stack = [rootView];
  let animating = false;

  function renderCrumbs() {
    crumbsHost.innerHTML = '';
    stack.forEach((v, i) => {
      const last = i === stack.length - 1;
      const b = el('button', 'crumb-btn' + (last ? ' active' : ''), v.title || 'Home');
      if (!last) b.addEventListener('click', () => navTo(i));
      crumbsHost.appendChild(b);
      if (!last) crumbsHost.appendChild(el('span', 'crumb-sep', '›'));
    });
    // A deep trail overflows a phone-width bar — always reveal the current (rightmost) crumb
    // rather than leaving it clipped off-screen.
    crumbsHost.scrollLeft = crumbsHost.scrollWidth;
  }
  function navTo(i) { if (animating || i >= stack.length - 1) return; stack = stack.slice(0, i + 1); transition(stack[stack.length - 1], -1); renderCrumbs(); }
  function drill(view) { if (animating || !view) return; stack.push(view); transition(view, 1); renderCrumbs(); }
  function back() { if (stack.length > 1) navTo(stack.length - 2); }

  function buildNode(node) {
    if (typeof node === 'function') node = node();        // lazy node (re-read live state)
    if (!node) return document.createComment('');
    switch (node.type) {
      case 'group': {
        const card = el('div', 'nv-surface');
        if (node.title) card.appendChild(el('div', 'nv-surface-h', node.title));
        const body = el('div', 'nv-surface-b');
        (node.children || []).forEach((c) => { const item = el('div', 'nv-item'); item.appendChild(buildNode(c)); body.appendChild(item); });
        card.appendChild(body); return card;
      }
      case 'action': {
        const a = el('button', 'nv-row');
        const tint = node.tint ? ` style="--tint: var(${node.tint})"` : '';
        a.innerHTML = `<span class="nv-left"><span class="nv-ic${node.tint ? ' tinted' : ''}"${tint}>${node.icon || '›'}</span>
          <span class="nv-meta"><span class="nv-line"><span class="nv-label"></span>${node.badge ? '<span class="nv-badge"></span>' : ''}</span>${node.caption ? '<span class="nv-cap"></span>' : ''}</span></span>
          <span class="nv-chev">${node.to ? '›' : ''}</span>`;
        a.querySelector('.nv-label').textContent = node.label || '';
        if (node.badge) a.querySelector('.nv-badge').textContent = node.badge;
        if (node.caption) a.querySelector('.nv-cap').textContent = node.caption;
        a.addEventListener('click', () => { if (node.to) drill(typeof node.to === 'function' ? node.to() : node.to); else if (node.open) node.open(); else if (node.run) node.run(); });
        return a;
      }
      case 'segment': {
        const wrap = el('div', 'nv-ctrl');
        wrap.appendChild(el('div', 'nv-label', node.label || ''));
        if (node.caption) wrap.appendChild(el('div', 'nv-cap', node.caption));
        const seg = el('div', 'nv-segment');
        (node.options || []).forEach((o) => {
          const b = el('button', 'nv-seg' + (node.value === o.k ? ' on' : ''), o.v);
          b.addEventListener('click', () => { seg.querySelectorAll('.nv-seg').forEach((x) => x.classList.remove('on')); b.classList.add('on'); node.onChange && node.onChange(o.k); });
          seg.appendChild(b);
        });
        wrap.appendChild(seg); return wrap;
      }
      case 'toggle': {
        const wrap = el('div', 'nv-toggle');
        const left = el('div'); left.appendChild(el('div', 'nv-label', node.label || '')); if (node.caption) left.appendChild(el('div', 'nv-cap', node.caption));
        const r = el('button', 'nv-rocker' + (node.value ? ' on' : '')); r.appendChild(el('span', 'nv-knob'));
        r.addEventListener('click', () => { r.classList.toggle('on'); node.onChange && node.onChange(r.classList.contains('on')); });
        wrap.appendChild(left); wrap.appendChild(r); return wrap;
      }
      case 'slider': {
        const wrap = el('div', 'nv-ctrl');
        const mult = node.mult || 1;
        const head = el('div', 'nv-ctrl-h'); head.appendChild(el('span', null, node.label || ''));
        const val = el('span', 'nv-val', (node.value * mult).toFixed(0) + (node.unit || '')); head.appendChild(val);
        wrap.appendChild(head);
        const inp = document.createElement('input'); inp.type = 'range'; inp.min = node.min; inp.max = node.max; inp.step = node.step || (node.max - node.min) / 100; inp.value = node.value; inp.className = 'nv-range';
        inp.addEventListener('input', (e) => { const v = parseFloat(e.target.value); val.textContent = (v * mult).toFixed(0) + (node.unit || ''); node.onChange && node.onChange(v); });
        wrap.appendChild(inp);
        if (node.caption) wrap.appendChild(el('div', 'nv-cap', node.caption));
        return wrap;
      }
      case 'color': {
        const wrap = el('div', 'nv-toggle');
        const left = el('div'); left.appendChild(el('div', 'nv-label', node.label || '')); if (node.caption) left.appendChild(el('div', 'nv-cap', node.caption));
        const lbl = el('label', 'nv-swatch'); const ci = document.createElement('input'); ci.type = 'color'; ci.value = node.value || '#5b8cff';
        ci.addEventListener('input', (e) => { lbl.style.background = e.target.value; node.onChange && node.onChange(e.target.value); });
        lbl.style.background = node.value || '#5b8cff'; lbl.appendChild(ci);
        wrap.appendChild(left); wrap.appendChild(lbl); return wrap;
      }
      case 'header': {
        const h = el('div', 'nv-header');
        h.innerHTML = `<div class="nv-hero">›_</div>`;
        h.appendChild(el('h2', null, node.title || ''));
        if (node.subtitle) h.appendChild(el('p', 'nv-sub', node.subtitle));
        if (node.note) h.appendChild(el('p', 'nv-note', node.note));
        return h;
      }
      case 'custom': { const d = el('div', 'nv-custom'); try { node.mount && node.mount(d); } catch (_) {} return d; }
      default: return document.createComment('');
    }
  }

  function buildView(view) {
    const pane = el('div', 'nv-pane');
    const inner = el('div', 'nv-pane-in');
    (view.children || []).forEach((c) => inner.appendChild(buildNode(c)));
    pane.appendChild(inner);
    return pane;
  }

  function transition(view, dir) {
    animating = true;
    const pane = buildView(view);
    host.appendChild(pane);
    const old = host.firstElementChild;
    if (old && old !== pane) {
      const off = dir > 0 ? '40px' : '-40px', offL = dir > 0 ? '-40px' : '40px';
      pane.style.transform = `translateX(${off})`; pane.style.opacity = '0'; void pane.offsetWidth;
      pane.style.transform = 'translateX(0)'; pane.style.opacity = '1';
      old.style.transform = `translateX(${offL})`; old.style.opacity = '0';
      setTimeout(() => { old.remove(); animating = false; }, 200);
    } else animating = false;
  }

  // Jump straight to a nested view (e.g. a shortcut elsewhere in the app that wants to land on
  // Settings → Storage & Add-ons in one hop) — sets the whole crumb trail at once, one transition.
  function open(path) {
    if (!Array.isArray(path) || !path.length || animating) return;
    stack = path.slice();
    renderCrumbs();
    transition(stack[stack.length - 1], 1);
  }

  renderCrumbs();
  transition(rootView, 1);
  return { back, open, reset() { stack = [rootView]; host.replaceChildren(); renderCrumbs(); transition(rootView, 1); } };
}

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
