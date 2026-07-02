# CoolPro — North Star

> Trajectory, not a spec. This is *where it's going* and *why*; the near-term order is decided
> per-PR. It exists so every refactor has a reference and nothing drifts back into being disjointed.

CoolPro should be **more powerful than Krita on desktop and more libre than any cloud offering** —
a single no-build, on-device, phone-first FOSS studio for video · audio · image · 3D.

## 1. One shell, panes do double-duty

The disjointedness came from skinning each surface differently (an obp ribbon for the editor, the
flickpaint panes for paint). The fix is the proven model of every serious creative suite: **one
constant shell; only the pane *contents* swap by context; the asset pool is shared and persistent.**

flickpaint's pane system (`vendor/ui/flickpaint-ui.css` + its `data-view` edge-tabs / mica drawers)
is that shell. Each surface fills the same panes:

| pane | Paint | Editor | 3D | recipe to steal from |
| --- | --- | --- | --- | --- |
| **Top blind** | New/Open/Save/Export · **Assets** | same asset manager | imports | DaVinci Resolve **Media Pool** (one pool, every page) |
| **Left** | brush / select tools | **selection · masking · keying · clip tools** | scene / transform | **Affinity Personas**, Blender editor-type |
| **Right** | **Layers** | layers **= live frame compositing** (tracks) | scene graph | Resolve **Fusion** / Blender compositor |
| **Bottom** | Image Filters | **drill-down adjustments** (HSL, color, CapCut FX) | materials / light | **CapCut** mobile bottom drill-down |
| **Center** | canvas | preview + timeline | viewport | — |
| **(free)** | pasteboard | **infinite pasteboard** | orbit space | tldraw / Excalidraw / Figma |

**Surfaces (Editor / Paint / 3D) ≈ Resolve Pages / Affinity Personas / Blender Workspaces.**
The flickpaint panes ≈ Blender areas that change editor-type. The top blind ≈ Resolve's Media Pool.
We're porting a 20-year-proven model to a no-build, phone-first, FOSS browser app (the genuinely new
part; closest web precedents are Photopea and Figma).

## 2. Workflows are atomized verbs, composed in the drill-down

`settings.obp`'s breadcrumb drill-down (now `src/nav.js`) becomes a **workflow** drill-down. The win
is decomposition: most "tools" are compositions of a few shared **atoms**.

- **`select`** — tap-subject (SAM) · magic wand · lasso · box · by-color. The shared atom.
- **`matte`** (cut subject) · **`inpaint`** (fill/remove) · **`erase`** · **`copy-to-layer`** · **`keep/delete`**.

Then the "tools" are just recipes over the same atoms:

- **Magic Eraser** = `select` → `inpaint`
- **Remove Background** = `select(subject)` → `delete(bg)`
- **Extract / cut-out** = `select` → `copy-to-layer`
- **Replace** = `select` → `inpaint(prompt)` *(generative — see §4)*

So a workflow walks you through its steps ("Magic Eraser → make a selection → erase → here's a
brush to clean up"), and selection refinement is shared by *all* of them. This is the VOM doctrine
made literal: **behaviours are verbs on objects, registrable and composable.** Selection becomes
**Google-Photos-shaped** (tap the subject, refine), because it's one atom every workflow reuses.

## 3. The top bar: contextual + pinnable (because phones have no cut/paste)

A phone has no good cut/paste, so the verbs you need must be **at the top, in thumb reach**, the
moment they're relevant:

- **Contextual by default** — the top tools change with what's selected / the active tool (Affinity's
  "context toolbar shows only relevant controls"). Make a selection → cut-to-layer · fill · erase ·
  extract appear up top.
- **Pinnable, optional** — long-press any tool and **drag it up to the top bar to pin it**, arbitrarily
  — the *Firefox "Customize Toolbar"* model. Defaults stay contextual; power users curate.

## 4. Inference: DPX everywhere; QNN SD1.5 is the generative rung

**DPX** (the bespoke inferencer, subsystem's `dp-onnx` → `dpx`) is the one runtime, behind the
provider seam already in `src/dpx.js`:

- **Android, hosted in subsystem** → DPX routes to **QNN** (Hexagon NPU): **Stable Diffusion 1.5**
  img2img / inpaint, seconds on-device — *Local Dream*-style. Reached through Paint's existing
  `__SUBSYSTEM_PROVIDER__` / bridge seam.
- **Standalone web** → fall back to WebGPU / onnxruntime-web / Transformers.js (today: RMBG · SlimSAM ·
  LaMa).

Because every AI op already routes through one `dpx.run(cap, …)` call site, **Magic Eraser graduates
from LaMa to SD-inpaint with zero UI change** — the generative rung just registers as a better
provider for the `inpaint` atom. Inspiration: **Local Dream** (NPU SD on Android), **subsystem** +
**DPX** (the bespoke inferencer).

## 5. Animation: a character is a rigged object (author's directive, 2026-07)

The suite is an **A/V editing super-app**, and animation is a medium in it, not a gimmick:
**Meta's AnimatedDrawings method** (MIT — silhouette mesh · humanoid skeleton · retargeted
motion) lives in `vendor/anim` as shared vanilla JS, and **MediaPipe pose** is the sensing rung
behind the `pose` capability in dpx.

- **The rig is one engine, every surface projects it** — the Animate studio deforms a flat
  stage mesh; the 3D standee binds the *same* rig to its extruded grid. One skeleton, one
  skinning, two projections (the §1 doctrine applied to motion).
- **Motion is a source-agnostic clip** — procedural presets, camera mocap, or any video of a
  person (MediaPipe → baked clip); retargeting transfers bone *directions* onto the
  character's bone *lengths*, so any motion drives any drawing.
- **Animations are clips** — the stage records and the result lands on the editor timeline
  through the guests' `export-media` bridge. The editor stays the hub.
- Upgrade path: ARAP behind `deformPoints` · a BVH library · multi-character scenes ·
  Paint cut-out → Animate hand-off · drawn-figure pose model when one ships small enough.

## Order of attack (near-term, revisable)

1. Shared **flickpaint shell** scaffold; bring the Editor into its panes (retire the obp ribbon).
2. **Bottom adjustments drill-down** (reuses `nav.js`) — HSL · levels · CapCut-style FX.
3. **Atomized selection** (`select` atom, Google-Photos-shaped) shared by matte / erase / extract.
4. Contextual top bar → then drag-to-pin customization.
5. Generative rung: SD1.5 inpaint via DPX/QNN behind the same `inpaint` call site.
6. Animation deepening per §5 — ARAP · clip library · multi-character.

> This document changes as the vision sharpens — but the **one-shell / atomized-verbs / DPX-everywhere**
> spine does not without the author's say-so.
