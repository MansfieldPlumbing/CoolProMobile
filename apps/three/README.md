# flickpaint3d — the 3D studio (`/art4quinn/three/`)

A self-contained, build-free 3D paint studio that lives **inside this Vite app** as static files
under `public/`. Vite copies `public/three/` verbatim into the build, so it deploys at
`https://mansfieldplumbing.github.io/art4quinn/three/` with the rest of the site — no React, no
bundler step, nothing to wire into `src/`.

## What it does (M1)
Loads Quinn's **T-pose character sheets** (the `Q0000xx` images in `../gallery/`) as **grounded,
paintable 3D standees**, then lets you paint directly on them:

1. The sheets all share a flat gray (~140) background → a border flood-fill keys it out → silhouette.
2. The silhouette is extruded into a **2-sided relief** (front face + UV-mirrored back + a flat dark
   die-cut side wall) and **dropped onto the floor** (y=0) with a soft contact shadow.
3. **Paint** = raycast the pointer → `hit.uv` → splat a brush into the skin canvas (the mesh texture).
   This is the "Surface shim" from `SPEC.md` (a layer is a texture; in 3D it's a mesh skin).
4. Eraser is **non-destructive** (a separate paint layer, `destination-out`, reveals her art underneath).
   Brush / size / opacity / swatches, clear, recenter, save-skin-PNG, scene-screenshot. Drag the model
   to paint, drag the background to orbit; multi-touch hands off to OrbitControls.

## Files
- `index.html` — DOM chrome (kid-friendly, touch-first) + the Three.js import map.
- `app.js` — the engine: image→silhouette→extrude, the floor/shadow, and the raycast→UV paint loop.
- `characters.json` — the loadable cast; `front` paths point at `../gallery/Q0000xx.*`.
- `vendor/` — Three.js r160 + OrbitControls, vendored (offline; no runtime CDN, per SPEC law #4).

## Loadable set
`Q000028`–`Q000047` (17 sheets, named in `characters.json`). `Q000001`–`Q000021` are cinematic renders
and `Q000031/32/33/48` are real-person pose photos — excluded because their backgrounds don't match the
flat-gray key.

## Next (the 3D arena)
- **Inflate to real volume** (Monster Mash style): displace the relief's z by the silhouette distance
  transform → a rounded body instead of a flat slab. Pure geometry, no ML — the next visible 3D win.
- **Front/back dual-texture**: today both faces share one skin; map a real back sheet to the back group.
- **Auto-rig** (M2): MediaPipe Pose in-browser → skeleton + skinning → poseable avatar.
- **ML image→3D** (M7): this app already ships `onnxruntime-web` + `tfjs` — a real candidate for a
  textured-GLB path (SF3D / TripoSR / CharacterGen) feeding the same painter.
- **Reactify** (optional): wrap this as a route/component in `src/` if you want it inside the app shell
  rather than a sibling page. The engine in `app.js` is framework-agnostic and ports as-is.

Verify locally without a build: serve the `public/` folder and open `/three/`. The paths are relative,
so it works both at the server root and under the deployed `/art4quinn/` base.
