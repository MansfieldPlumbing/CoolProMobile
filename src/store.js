// src/store.js — single source of truth for the editor.
// Project model + mutations + a tiny pub/sub. Media blobs and the project
// graph persist to IndexedDB so "saved to browser storage" survives reload.
import { uid, clamp } from './util.js';
import { kvGet, kvSet, blobGet, blobSet } from './idb.js';

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(reason) { for (const fn of listeners) fn(reason); }

// ---- in-memory state ----------------------------------------------------
export const media = new Map();   // id -> { id, name, kind, url, file, duration, width, height, waveform, thumbUrl }

export const state = {
  project: defaultProject(),
  selection: null,                // clipId
  transport: { time: 0, playing: false },
};

function defaultProject() {
  return {
    name: 'Untitled project',
    fps: 30, width: 1280, height: 720,
    tracks: [
      { id: uid('trk'), kind: 'video', name: 'Video 1', muted: false, solo: false, volume: 1, clips: [] },
      { id: uid('trk'), kind: 'audio', name: 'Audio 1', muted: false, solo: false, volume: 1, clips: [] },
    ],
  };
}

// ---- derived ------------------------------------------------------------
export function duration() {
  let d = 0;
  for (const t of state.project.tracks)
    for (const c of t.clips) d = Math.max(d, c.t0 + c.dur);
  return d;
}
export function allClips() {
  return state.project.tracks.flatMap((t) => t.clips.map((c) => ({ clip: c, track: t })));
}
export function findClip(id) {
  for (const t of state.project.tracks)
    for (const c of t.clips) if (c.id === id) return { clip: c, track: t };
  return null;
}

// ---- mutations ----------------------------------------------------------
export function addMedia(m) { media.set(m.id, m); emit('media'); return m; }

export function addTrack(kind) {
  const n = state.project.tracks.filter((t) => t.kind === kind).length + 1;
  state.project.tracks.push({ id: uid('trk'), kind, name: `${kind === 'video' ? 'Video' : 'Audio'} ${n}`,
    muted: false, solo: false, volume: 1, clips: [] });
  emit('tracks');
}

// Per-track mutation (mute / solo / volume / name) — the timeline header strip drives this.
export function setTrack(id, props) {
  const t = state.project.tracks.find((x) => x.id === id); if (!t) return;
  Object.assign(t, props); emit('tracks');
}

// The audible gain for a clip = track gain × clip gain, with mute and solo applied. Solo on ANY
// track silences every non-soloed track. Both preview (live) and export (mixdown) read this.
export function trackGain(track, clip) {
  const anySolo = state.project.tracks.some((t) => t.solo);
  const muted = track.muted || (anySolo && !track.solo);
  return muted ? 0 : (track.volume ?? 1) * (clip.volume ?? 1);
}

// Place a media item on the first compatible track at time t0 (default: end of that track).
export function addClipFromMedia(mediaId, trackId = null, t0 = null) {
  const m = media.get(mediaId); if (!m) return null;
  const wantKind = m.kind === 'audio' ? 'audio' : 'video';
  let track = trackId ? state.project.tracks.find((t) => t.id === trackId) : null;
  if (!track || track.kind !== wantKind) track = state.project.tracks.find((t) => t.kind === wantKind);
  if (!track) { addTrack(wantKind); track = state.project.tracks.find((t) => t.kind === wantKind); }
  const dur = m.kind === 'image' ? 5 : (m.duration || 5);
  if (t0 == null) t0 = track.clips.reduce((mx, c) => Math.max(mx, c.t0 + c.dur), 0);
  const clip = { id: uid('clip'), mediaId, kind: m.kind, t0: Math.max(0, t0), dur,
    in: 0, volume: 1, fx: {} };
  track.clips.push(clip);
  state.selection = clip.id;
  emit('clip-add');
  return clip;
}

export function moveClip(id, t0) {
  const f = findClip(id); if (!f) return;
  f.clip.t0 = Math.max(0, t0);
  emit('clip-move');
}
export function resizeClip(id, { t0, dur, inPoint }) {
  const f = findClip(id); if (!f) return;
  if (t0 != null) f.clip.t0 = Math.max(0, t0);
  if (inPoint != null) f.clip.in = Math.max(0, inPoint);
  if (dur != null) f.clip.dur = Math.max(0.05, dur);
  emit('clip-resize');
}
export function splitClipAt(id, tAbs) {
  const f = findClip(id); if (!f) return;
  const { clip, track } = f;
  const local = tAbs - clip.t0;
  if (local <= 0.02 || local >= clip.dur - 0.02) return;
  const right = { ...clip, id: uid('clip'), t0: clip.t0 + local, in: clip.in + local, dur: clip.dur - local, fx: { ...clip.fx } };
  clip.dur = local;
  track.clips.push(right);
  state.selection = right.id;
  emit('clip-split');
}
export function removeClip(id) {
  for (const t of state.project.tracks) {
    const i = t.clips.findIndex((c) => c.id === id);
    if (i >= 0) { t.clips.splice(i, 1); if (state.selection === id) state.selection = null; emit('clip-remove'); return; }
  }
}
export function duplicateClip(id) {
  const f = findClip(id); if (!f) return null;
  const copy = { ...f.clip, id: uid('clip'), t0: f.clip.t0 + f.clip.dur, fx: { ...f.clip.fx } };
  f.track.clips.push(copy); state.selection = copy.id; emit('clip-add'); return copy;
}
export function removeTrack(id) {
  const ts = state.project.tracks;
  if (ts.length <= 1) return;                       // keep at least one track
  const i = ts.findIndex((t) => t.id === id); if (i < 0) return;
  if (ts[i].clips.some((c) => c.id === state.selection)) state.selection = null;
  ts.splice(i, 1); emit('tracks');
}
export function removeMedia(id) {
  for (const t of state.project.tracks) t.clips = t.clips.filter((c) => c.mediaId !== id);
  const m = media.get(id); if (m && m.url) { try { URL.revokeObjectURL(m.url); } catch (_) {} }
  media.delete(id);
  if (state.selection && !findClip(state.selection)) state.selection = null;
  emit('media');
}
export function select(id) { state.selection = id; emit('select'); }
export function setTransport(p) { Object.assign(state.transport, p); emit('transport'); }
export function setProject(p) { Object.assign(state.project, p); emit('project'); }
export function nudge(reason = 'nudge') { emit(reason); }   // force redraw after in-place edits

// ---- persistence --------------------------------------------------------
export async function save() {
  // store any unsaved media blobs
  for (const m of media.values()) {
    if (m.file && !m._saved) { await blobSet(m.id, { file: m.file, name: m.name, kind: m.kind,
      duration: m.duration, width: m.width, height: m.height }); m._saved = true; }
  }
  const snapshot = {
    project: state.project,
    media: [...media.values()].map((m) => ({ id: m.id, name: m.name, kind: m.kind })),
  };
  await kvSet('project', snapshot);
}

export async function load() {
  const snap = await kvGet('project');
  if (!snap) return false;
  state.project = snap.project;
  for (const ref of snap.media || []) {
    const rec = await blobGet(ref.id);
    if (!rec || !rec.file) continue;
    media.set(ref.id, { id: ref.id, name: rec.name, kind: rec.kind, file: rec.file,
      url: URL.createObjectURL(rec.file), duration: rec.duration, width: rec.width, height: rec.height,
      _saved: true });
  }
  state.selection = null;
  state.transport.time = 0;
  emit('load');
  return true;
}

export { clamp };
