// src/util.js — tiny shared helpers (no deps)
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const uid = (p = 'id') => p + '-' + Math.random().toString(36).slice(2, 9);

// 73.4 -> "1:13.40"
export function fmtTime(s) {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s * 100) % 100);
  return `${m}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export const fmtBytes = (n) => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};

export function mediaKind(file) {
  const t = (file.type || '').toLowerCase();
  if (t.startsWith('video')) return 'video';
  if (t.startsWith('audio')) return 'audio';
  if (t.startsWith('image')) return 'image';
  // fall back to extension
  const ext = (file.name || '').toLowerCase().split('.').pop();
  if (['mp4', 'webm', 'mov', 'mkv', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(ext)) return 'image';
  return 'video';
}
