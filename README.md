# CoolProMobile

**FOSS relief from Play Store slop** — a client-side, no-build, vanilla-JS creative studio,
**mobile only**. One A/V editing super-app for your phone: a **CapCut**-style A/V editor, a
**Paint-Shop-Pro**-style raster studio, a **3D model maker**, and a **2D animation studio** (draw
a character, it gets a skeleton, make it dance — or act it out on camera) — sharing one inference
runtime and one object model, running entirely on-device (no accounts, no uploads, no backend).

> **CoolProMobile is the mobile-only fork of CoolPro.** There is no desktop mode, no "Desktop
> site" escape hatch, no `data-vp` toggle — one layout, phone-shaped, full stop. If you want a
> desktop-shaped creative suite, that's a different project; this one is a movie studio that
> lives in your pocket.

> Merged from three sibling repos — the **nocap** A/V editor (this repo's origin), **art4quinn**
> (paint + 3D + image ML), and **arlinearcade** (the shared painter + audio helpers) — onto the
> architectural spine of **subsystem** (the VOM object model and the dp-onnx → **dpx** runtime).
> The shared code is shared *on purpose*: one ML harness and one UI chrome power every surface.

## The four surfaces (one shell)

The Shell mounts one *presenter* at a time; the acrylic taskbar switches. Everything shares
the same media, the same ML runtime, and the same house style.

| surface | what it is | brings |
| --- | --- | --- |
| 🎬 **Editor** | CapCut-style multitrack A/V editor | timeline, preview compositor, Web-Audio mix, WAV/MP3/WebM/**MP4** (ffmpeg.wasm) export |
| 🖌️ **Paint** | Paint-Shop-Pro raster studio (`apps/paint`) | layers, blend modes, brush/pencil/marker/fill, blur/smudge/dodge/burn, **AI Magic Wand** (SlimSAM), **Magic Eraser** (LaMa), **Erase Background** (RMBG) |
| 🧊 **3D** | image → silhouette → paintable standee (`apps/three`) | drop any image, extrude to a 2-sided relief on a floor, paint on the mesh by raycast, **AI cut-out** (RMBG), **motion presets** — the statue dances while you paint it |
| 🕺 **Animate** | 2D animation studio (`apps/animate`) | the **AnimatedDrawings** method in vanilla JS (`vendor/anim`): auto-skeleton (**MediaPipe** pose, template fallback), drag-the-dots joint fix-up, geodesic-skinned mesh, preset moves (wave · walk · dance · jacks · zombie · bounce), **live camera mocap**, motion baked **from any video of a person**, record → clip lands on the editor timeline |

## Architecture — the subsystem doctrine, in the browser

CoolPro mirrors **subsystem**'s discipline: *one namespace of refcounted objects, the UI is a
projection of it, nothing holds its own truth, behaviours are verbs on objects.*

- **`src/vom.js` — the VOM (Virtual Object Manager).** JS parity of subsystem's `vom.h`/`Vom.cs`
  kernel: one namespace of refcounted, **generational handles**; authority *is* the handle;
  reclaim is deterministic — **free-on-zero**, owner-scoped, cascade-kill on terminate. The
  difference from the native seam: a region holds a live JS *node* (a clip, a layer, a mesh, a
  model session) instead of a byte span. "JavaScript when it actually comes correct."
- **`src/dpx.js` — the inference runtime.** Formerly the editor's thin `ml` seam; promoted to
  *the* runtime (subsystem's **dp-onnx → dpx**). One provider registry, one capability catalog,
  one job lock — and the load-bearing tie-in: **a loaded model is a VOM region.** Its refcount is
  its authority; at zero the region frees and the session's `dispose()` releases the GPU/WASM
  weights. Inference can't leak because the namespace owns it. A future **dpx-wasm/WebNN** build
  of the native engine registers as a provider and the call sites never move.
- **`src/registry.js` — resolve-by-id.** The one place that knows how a presenter is *located*
  (static manifest now; a `Cm` query later — callers don't change). Resolve-known, degrade-to-empty.
- **`src/presenter.js` + `src/shell.js` — the chrome.** A presenter holds no truth: it is handed
  a host + context, renders, and contributes **verbs** the Shell presents. Native presenters
  (the editor) mount in-realm; **guests** (paint, 3D) are hosted one-HTML-file apps in an iframe,
  with menus bridged over the postMessage protocol in `shared/presenter.js` — the exact
  html-applet-as-guest model subsystem uses. (Paint already ships as an `.obp` object-presenter
  with a `Sys.vom` of its own, designed to bind a host-injected provider with zero UI change.)

```
index.html ── Shell (taskbar dock)
   ├─ src/shell.js · registry.js · presenter.js   the chrome (projects the namespace)
   ├─ src/vom.js                                   the model (one refcounted namespace)
   ├─ src/dpx.js  → vendor/ml/{segment,select,inpaint,pose}.js   the runtime (RMBG · SlimSAM · LaMa · MediaPipe)
   ├─ vendor/anim/{skeleton,rig,motion}.js         the character rig engine (AnimatedDrawings method)
   ├─ surface: Editor  (native)  src/{store,timeline,preview,audio,export,panels,…}.js
   ├─ surface: Paint   (guest)   apps/paint/    ← shared vendor/ml + vendor/ui
   ├─ surface: 3D      (guest)   apps/three/    ← shared vendor/ml + vendor/ui + vendor/anim
   └─ surface: Animate (guest)   apps/animate/  ← shared vendor/ml + vendor/ui + vendor/anim
```

`theme.css` holds the editor's design tokens; `vendor/ui/flickpaint-ui.css` is the guests' shared
glass chrome. `sw.js` precaches the whole studio (offline) and serves a durable `nocap-cdn` cache
for cross-origin packages; the app cache and CDN cache are independent, so updates and add-ons
don't step on each other.

## Run it

It's static — serve the folder and open `index.html`:

```sh
python3 -m http.server 8080
# open http://localhost:8080
```

No special headers needed: MP4 export uses the **single-threaded** ffmpeg.wasm core, so it works
without cross-origin isolation (COOP/COEP) — on plain static hosting and on GitHub Pages.
Installing the PWA and full offline both require **HTTPS** (or `localhost`).

## Mobile-only

CoolProMobile has exactly one layout: a single scrollable column, phone-shaped, always — there is
no desktop grid, no "Desktop site" escape hatch, no view toggle. The front door is a **Launcher**,
not a surface — a breadcrumb/drill-down (`src/nav.js`) that's the standard template for every
chrome/config screen (Launcher, Settings, Storage & Add-ons); direct-manipulation surfaces (the
editor timeline, Paint's canvas, the 3D viewport, Animate's stage) stay direct-manipulation, on
purpose. Installed on Android, CoolProMobile registers a **share target** and **file handlers** —
share a clip from Gallery (or "Open with → CoolProMobile") and it lands on the editor timeline
(`manifest.webmanifest` + `sw.js` stash the share POST, `src/share.js` drains it).

## Roadmap (the merge, continued)

Landed: the spine (`vom`/`dpx`/`registry`/`shell`/`presenter`); the four surfaces, switchable;
shared ML/UI deduplicated; real RMBG matte through `dpx`; phone/desktop awareness + Launcher;
Android share-target + file-handlers; the **Animate** studio (`vendor/anim` rig engine +
MediaPipe `pose` capability) with the same rig animating the 3D standee; **cross-surface flow**
— guests post `export-media` blobs that land on the editor timeline (Animate's rendered clips
ride it today), and `sendToSurface` carries files into guests (Convert's "Animate character").
Next:

- **Hoist ML into `dpx` across the frame boundary** — today each guest realm loads its own ML
  instance; route paint/3D/animate inference through the host `dpx` so the model loads once,
  governed by the VOM.
- **Bind the guests' `Sys.vom` to `src/vom.js`** — paint's `__SUBSYSTEM_PROVIDER__` seam already
  exists; make CoolPro the injected provider so layers live in the real namespace.
- **dpx-wasm** — register the native engine's browser build as the `dpx` provider; flip `tts`
  (Kokoro) and the heavier video caps from `native`/`soon` to `ready`.
- **Animation, deeper** — true ARAP deformation behind `deformPoints`, a BVH clip library,
  multi-character scenes, Paint cut-out → Animate hand-off.
- **Audio surface** (Cool-Edit-Pro side) — a dedicated waveform editor reusing `vendor/audio/`.
- Frame-accurate MP4 export, transitions & keyframes, single-file build.
