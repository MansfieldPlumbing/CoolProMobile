// src/registry.js — the Shell's capability registry (subsystem's Registry.js, ported to a
// static site). The ONE place that knows how a presenter is LOCATED; everything else resolves
// strictly BY ID and never forms a path. On device this is a Cm query; here it is a static
// manifest — same callers, zero change when the backend lands (that indirection is the point).
//
// Resolve-known, never enumerate-blindly. Degrade to empty, never throw (project rule).

// The presenters CoolPro projects. `kind:'native'` mounts a same-realm module into the stage;
// `kind:'guest'` hosts a self-contained one-HTML-file app in an iframe (the subsystem
// "html-applet as a guest the OS hosts" model) and bridges its menu over postMessage.
const PRESENTERS = [
  { id: 'home',   name: 'Home',    type: 'home',   kind: 'native', role: 'launcher',
    icon: '🏠', blurb: 'Launcher — pick a surface.', path: '\\Shell\\Home' },
  { id: 'editor', name: 'Editor',  type: 'editor', kind: 'native',
    icon: '🎬', blurb: 'CapCut-style multitrack A/V editor — timeline, preview, MP4 export.',
    path: '\\Shell\\Editor' },
  { id: 'paint',  name: 'Paint',   type: 'paint',  kind: 'guest', src: 'apps/paint/index.html',
    icon: '🖌️', blurb: 'Paint-Shop-Pro raster studio — layers, brushes, AI magic wand & eraser.',
    path: '\\Shell\\Paint' },
  { id: 'model',  name: '3D',      type: 'model',  kind: 'guest', src: 'apps/three/index.html',
    icon: '🧊', blurb: 'Image → silhouette → paintable 3D standee. Model maker & massager.',
    path: '\\Shell\\Model' },
  { id: 'animate', name: 'Animate', type: 'animate', kind: 'guest', src: 'apps/animate/index.html',
    icon: '🕺', blurb: 'Draw a character, it gets a skeleton, make it dance — presets or camera mocap.',
    path: '\\Shell\\Animate' },
];

let _records = PRESENTERS.map((r) => ({ ...r }));

export function list() { return _records; }

// Resolve exactly one presenter by id. Null if not known/granted.
export function resolve(id) {
  if (!id) return null;
  const key = String(id).toLowerCase();
  return _records.find((o) => o.id === key) || null;
}

// The landing presenter — the Shell's front door (the Launcher). Phone-first: you arrive at a
// chooser, not dumped into a surface.
export function landing() { return _records.find((o) => o.role === 'launcher') || _records[0] || null; }

// The Shell's layout — which presenters to offer in the app rail, in order.
export function layout() { return _records.length ? _records : (landing() ? [landing()] : []); }

// The launcher's tiles — every surface except the launcher itself.
export function tiles() { return _records.filter((o) => o.role !== 'launcher'); }

// Content URL for a guest presenter — derived ONLY here, so physical layout is confined to one
// function (rename/move a file = a non-event for callers).
export function contentUrl(rec) { return rec && rec.kind === 'guest' && rec.src ? rec.src : null; }
