// src/hud.js — transient toasts + a single reusable progress toast.
// Mirrors the art4quinn ML harness "onStatus(text)" HUD contract so ML modules
// can report download/inference progress through the same surface.
import { $ } from './util.js';

const host = () => $('#hud');

export function toast(msg, { ms = 2200, err = false } = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  host().appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, ms - 300);
  setTimeout(() => el.remove(), ms);
  return el;
}

// A persistent progress toast. Returns { status(text, pct), done(text?), fail(text) }.
export function progress(initial = 'Working…') {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="lbl"></span><span class="bar"><i></i></span>`;
  el.querySelector('.lbl').textContent = initial;
  host().appendChild(el);
  const lbl = el.querySelector('.lbl');
  const bar = el.querySelector('.bar');
  const fill = el.querySelector('.bar i');
  return {
    el,
    status(text, pct) {
      if (text != null) lbl.textContent = text;
      if (typeof pct === 'number') { bar.style.display = ''; fill.style.width = pct + '%'; }
      else bar.style.display = 'none';
    },
    done(text) {
      if (text) lbl.textContent = text;
      fill.style.width = '100%';
      setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 700);
      setTimeout(() => el.remove(), 1100);
    },
    fail(text) {
      el.classList.add('err'); bar.style.display = 'none';
      lbl.textContent = text || 'Failed';
      setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2600);
      setTimeout(() => el.remove(), 3000);
    },
  };
}
