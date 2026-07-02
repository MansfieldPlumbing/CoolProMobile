// src/theme-engine.js — the live theme, settings.obp-style. Holds NO color truth: it writes CSS
// custom properties onto :root (the cascade re-skins every open surface instantly) and persists
// the choices. Dark is theme.css's baseline; light overrides a handful of vars; accent/mica/opacity
// are single-knob overrides on top. Applied before first paint by an inline snippet in index.html.
const K = { mode: 'coolpro-mode', accent: 'coolpro-accent', mica: 'coolpro-mica', opacity: 'coolpro-opacity' };

// Light palette — only the vars that differ from the dark baseline in theme.css.
const LIGHT = {
  '--bg': '#eef1f6', '--surface': '#ffffff', '--surface-2': '#e7eaf1', '--panel': '#f4f6fa',
  '--border': '#d7dce6', '--border-2': '#c2c9d8', '--fg': '#1a1d24', '--muted': '#5c6474', '--faint': '#9aa2b2',
  '--mica-rgb': '255 255 255', '--shadow': '0 8px 24px rgba(20,28,50,.14)',
};

const get = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

export function getMode() { return get(K.mode, 'dark'); }
export function getAccent() { return get(K.accent, ''); }
export function getMica() { return get(K.mica, 'on') !== 'off'; }
export function getOpacity() { return parseFloat(get(K.opacity, '1')) || 1; }

// Apply everything to :root. Safe to call repeatedly; this is the single application point.
export function applyTheme() {
  const root = document.documentElement;
  const mode = getMode();
  if (mode === 'light') for (const [k, v] of Object.entries(LIGHT)) root.style.setProperty(k, v);
  else for (const k of Object.keys(LIGHT)) root.style.removeProperty(k);
  root.dataset.mode = mode;

  const accent = getAccent();
  if (accent) { root.style.setProperty('--accent', accent); root.style.setProperty('--accent-2', shift(accent, 18)); }
  else { root.style.removeProperty('--accent'); root.style.removeProperty('--accent-2'); }

  root.dataset.mica = getMica() ? 'on' : 'off';
  root.style.setProperty('--transparency', String(getOpacity()));
}

export function setMode(m) { set(K.mode, m === 'light' ? 'light' : (m === 'auto' ? 'auto' : 'dark')); resolveAuto(); applyTheme(); }
export function setAccent(hex) { set(K.accent, hex || ''); applyTheme(); }
export function setMica(on) { set(K.mica, on ? 'on' : 'off'); applyTheme(); }
export function setOpacity(v) { set(K.opacity, String(v)); applyTheme(); }

// Auto = follow the OS. We store 'auto' but resolve to light/dark for application.
function resolveAuto() {
  if (get(K.mode, 'dark') !== 'auto') return;
  const dark = !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.mode = dark ? 'dark' : 'light';
}
// effective mode for the UI to reflect (auto → resolved)
export function effectiveMode() {
  const m = getMode();
  if (m !== 'auto') return m;
  return (!window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

// nudge a hex toward another hue for the derived secondary accent.
function shift(hex, deg) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex;
  let n = parseInt(m[1], 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // rotate slightly toward violet — cheap, good-enough secondary
  r = Math.min(255, r + deg); b = Math.min(255, b + deg);
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function initThemeEngine() {
  applyTheme();
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (getMode() === 'auto') applyTheme(); });
}
