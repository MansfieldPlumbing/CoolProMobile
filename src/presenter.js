// src/presenter.js — the host side of the Presenter contract (subsystem UiObject.js +
// presenter.js, ported). A presenter holds NO truth: it is handed a host element + a context,
// renders, and contributes VERBS the Shell's menu presents. Objects compose objects.
//
// Two shapes:
//   NativePresenter — a same-realm surface already in the page (the A/V editor). Mount = reveal.
//   GuestPresenter  — a self-contained one-HTML-file app in an iframe (paint, 3D). The OS hosts
//                     it as a guest; menus bridge over the postMessage protocol in
//                     shared/presenter.js (menu-context in, app-menu-action out). Same contract
//                     the device shell uses for html-applets — reuse, not reinvention.

class UiObject {
  constructor(rec) {
    this.id = rec.id;             // stable identity (resolved from the registry)
    this.type = rec.type;         // editor | paint | model | …
    this.rec = rec;               // the registry record (icon, name, blurb, path)
    this.path = rec.path || ('\\Shell\\' + rec.type);
    this.host = null;             // the element the Shell allotted
    this.ctx = null;              // { shell, registry }
    this.verbs = [];              // [{menu,verb,label,enabled,checked}] — contributed at runtime
  }
  async mount(host, ctx) { this.host = host; this.ctx = ctx; }
  show() {}
  hide() {}
  invoke(_verb) {}
  unmount() { this.host = null; this.ctx = null; this.verbs = []; }
}

export class NativePresenter extends UiObject {
  constructor(rec, el) { super(rec); this.el = el; }   // el: the already-present surface element
  async mount(host, ctx) { await super.mount(host, ctx); this.show(); }
  show() { if (this.el) this.el.hidden = false; }
  hide() { if (this.el) this.el.hidden = true; }
  unmount() { this.hide(); super.unmount(); }
}

export class GuestPresenter extends UiObject {
  constructor(rec) { super(rec); this.frame = null; this._onMsg = null; this._loaded = false; this._ready = false; this._outbox = []; }

  async mount(host, ctx) {
    await super.mount(host, ctx);
    if (!this.frame) {
      const f = document.createElement('iframe');
      f.className = 'guest-frame';
      f.title = this.rec.name;
      // Hosted guest: same-origin (so it reaches shared/ + vendor/), but it owns its input and
      // never reaches the network on its own beyond the lazy ML CDN it already declares.
      f.setAttribute('allow', 'fullscreen; xr-spatial-tracking; camera; microphone');
      f.addEventListener('load', () => { this._loaded = true; });
      f.src = this.ctx.registry.contentUrl(this.rec);
      this.frame = f;
      host.appendChild(f);
      // Listen to this guest — only OUR frame. Two inbound message kinds today:
      //   menu-context   — the verbs it contributes (shared/presenter.js SDK)
      //   surface-ready  — it booted; flush anything the Shell queued for it
      //   export-media   — a rendered deliverable (blob) for the editor timeline
      this._onMsg = (e) => {
        if (e.source !== f.contentWindow) return;       // ignore other frames / the page
        const d = e.data;
        if (!d) return;
        if (d.type === 'menu-context') { this.verbs = d.items || []; this.ctx.shell.onVerbs(this); }
        else if (d.type === 'surface-ready') { this._ready = true; this._flush(); }
        else if (d.type === 'export-media' && d.blob) landExport(d);
      };
      window.addEventListener('message', this._onMsg);
    }
    this.show();
  }

  show() { if (this.frame) this.frame.hidden = false; }
  hide() { if (this.frame) this.frame.hidden = true; }

  // The user picked a verb in the Shell menu — hand it to the guest (it owns the action).
  invoke(verb) {
    try { this.frame?.contentWindow?.postMessage({ type: 'app-menu-action', verb }, '*'); } catch (_) {}
  }

  // Hand the guest a message (e.g. open-media with a File). Queued until the guest says ready —
  // a freshly mounted iframe hasn't booted its module yet.
  post(msg) {
    if (this._ready) { try { this.frame?.contentWindow?.postMessage(msg, '*'); } catch (_) {} }
    else this._outbox.push(msg);
  }
  _flush() { const q = this._outbox; this._outbox = []; for (const m of q) this.post(m); }

  unmount() {
    if (this._onMsg) window.removeEventListener('message', this._onMsg);
    if (this.frame) this.frame.remove();
    this.frame = null; this._loaded = false; this._onMsg = null; this._ready = false; this._outbox = [];
    super.unmount();
  }
}

// A guest handed back a rendered deliverable — land it in the editor's media bin + timeline.
// (The cross-surface flow: Animate's clips, and tomorrow Paint cut-outs / 3D turntables.)
async function landExport(d) {
  try {
    const [{ landGenerated }, { toast }] = await Promise.all([import('./media.js'), import('./hud.js')]);
    await landGenerated({ blob: d.blob, name: d.name, meta: d.meta });
    const { switchTo } = await import('./shell.js');
    switchTo('editor');
    toast(`${d.name || 'clip'} → added to the timeline`);
  } catch (e) { console.error('export-media landing failed', e); }
}

// Factory: build the right presenter for a registry record. Native presenters bind to a surface
// element the page already holds (looked up by `#surface-<id>`); guests get an iframe.
export function presenterFor(rec) {
  if (rec.kind === 'guest') return new GuestPresenter(rec);
  const el = document.getElementById('surface-' + rec.id);
  return new NativePresenter(rec, el);
}
