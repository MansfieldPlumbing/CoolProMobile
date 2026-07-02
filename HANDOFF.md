# Handoff — the animation arc (2026-07-02)

Status: **shipped to `main`**, verified, one round of review-driven fixes landed. This note is
for whoever (human or Claude) picks this up next — it is a working note, not permanent project
docs; delete it once the open items below are triaged or fixed.

## What shipped

The "2D animation studio via MediaPipe" ask from this session, landed as 5 commits directly to
`main` (no PR — pushed straight per instruction), in order:

1. `vendor/anim/{skeleton,rig,motion}.js` — the character rig engine: a vanilla-JS
   reimplementation of Meta's **AnimatedDrawings** method (MIT) — 17-joint skeleton, occupancy-
   grid mesh from cutout alpha, **geodesic** (BFS-inside-silhouette) skinning weights, FK +
   angle-transfer retargeting, 6 procedural motion presets, baked mocap clips.
2. `vendor/ml/pose.js` — MediaPipe PoseLandmarker behind the same lazy-CDN-load pattern as
   `segment.js`/`select.js`; registered as the `pose` capability in `src/dpx.js`, warmable via
   `src/cdn.js`, cached through `sw.js`'s `nocap-cdn` lane.
3. `apps/animate/` — the fourth surface ("flickmotion"): open a drawing → auto-skeleton (pose AI
   or template) → drag-the-dots joint fix-up → preset motions or live camera/video mocap → record
   → send to the editor timeline. Registered in `src/registry.js`, reachable from the taskbar,
   the launcher's new Animate drill-down (`src/launcher.js`), and Convert's "🕺 Animate character"
   option (`src/convert.js`).
4. **Cross-surface flow** (closes a README roadmap item): guests can now post
   `{ type: 'export-media', blob, name, meta }` and `src/presenter.js` lands it on the editor
   timeline via a new `media.landGenerated()`; `src/shell.js` grew `sendToSurface(id, msg)` to
   carry files (e.g. shared photos) *into* a guest, queued until it signals `surface-ready`.
5. `apps/three/app.js` — the 3D standee binds the *same* rig to its extruded grid vertices (they
   already live in rig space), so the paintable statue can wave/walk/dance/etc. while you paint it.

Docs updated: `README.md` (4th surface row, architecture tree, roadmap), `NORTHSTAR.md` (new §5,
the animation doctrine), `vendor/anim/README.md` (new), `vendor/ml/README.md` (pose.js entry).

## Verification performed

- **Engine unit smoke test** (Node, no browser): builds a rig from a synthetic silhouette,
  samples all 6 presets, checks identity-pose = zero drift, runs the MediaPipe-landmarks →
  clip → retarget → deform path, checks external-point binding (the 3D path), checks rebind
  after a joint edit. All passed both before and after the fix-up pass below.
- **Headless Playwright suite** (18 checks, 1 skip, 0 fails) against a local static server +
  a locally-mirrored copy of the MediaPipe CDN assets (the sandbox can't reach
  storage.googleapis.com/jsdelivr for the real model, so `window.__DPX_POSE__` override points
  at `http://127.0.0.1:8081/mediapipe/...` — see `vendor/ml/pose.js`'s override hook). Covers:
  taskbar/launcher wiring, Animate boot, drawing→cutout→rig, motion animates the mesh *and* the
  actual stage pixels (not just data), camera mocap starts (fake device), MediaRecorder capture,
  export→timeline landing with duration override, 3D standee build + animate (pixel diff), zero
  JS errors on both a 1440×900 desktop viewport and a 390×844 phone viewport.
- The one **skip**: pose-AI auto-rig on a synthetic 5-stroke stick figure falls back to the
  template skeleton in headless SwiftShader (no real GPU) — expected; not a code defect. Worth
  re-checking on a real device/GPU.
- Both the Node script and the Playwright script + its local MediaPipe mirror live in this
  session's scratchpad (ephemeral, not in the repo). If you need to re-verify from scratch:
  `python3 -m http.server 8080` at the repo root, a second static server for the MediaPipe CDN
  files (jsdelivr `@mediapipe/tasks-vision@0.10.14` bundle + wasm + the `pose_landmarker_lite`
  `.task` from `storage.googleapis.com/mediapipe-models/...`), then drive it with
  `playwright-core` + the vendored Chromium at `/opt/pw-browsers/chromium*/chrome-linux/chrome`.

## Review pass: what got fixed vs what's still open

An adversarial review workflow (5 reviewers × verify-by-refute-and-reproduce) surfaced **23
findings** across the new code before it was interrupted partway through verification (~20/~46
verify calls completed). Of the findings that came back **confirmed by both refute and
reproduce lenses**, these are now fixed (commit `4514baa`):

- ✅ **[critical]** Mocap timestamps could go backwards across sessions (camera uses
  `performance.now()`, video files use `currentTime*1000`, but MediaPipe's landmarker demands
  one strictly-increasing clock for its lifetime) → `pose.js` `detectVideo` now keeps its own
  monotonic clock.
- ✅ **[major]** `three.module.min.js` + `OrbitControls.js` were never precached, so 3D *and*
  Animate broke offline despite the SW explicitly shipping the rig engine for offline mocap →
  added to `sw.js`, version bumped to v12.
- ✅ **[minor]** `sampleClip` froze on the last frame for a whole period then snapped to frame 0
  at the loop boundary → wrap now interpolates into frame 0.
- ✅ **[minor]** `rootFor` only guarded exact-zero torso length → floored at a small epsilon.
- ✅ **[minor]** Record button had no re-entry guard (double-tap → two overlapping
  `MediaRecorder`s) → guarded; also now exits joint-edit mode itself before recording.
- ✅ **[major]** Clicking the camera button again during the permission prompt leaked a second
  `getUserMedia` stream → guarded with a pending flag.

**Still open** (confirmed real by at least one verify pass, not yet fixed — ranked by severity;
file:line references are from the finding, re-check against current `main` before fixing since
line numbers may have shifted):

| # | severity | where | what |
|---|---|---|---|
| 1 | major | `apps/animate/app.js` ~138 | Opening a new drawing while camera mocap is running makes `detectImage` (IMAGE mode) and the live `detectVideo` loop (VIDEO mode) fight over the *one* shared `PoseLandmarker`'s `runningMode` — auto-rig randomly fails. Fix idea: `stopMocap()` before `guessJoints()`, or give `pose.js` two landmarker instances (one per mode) instead of one that flips modes. |
| 2 | major | `apps/animate/app.js` ~378 | Starting Camera mocap while a video file is still being read (`baking` from the video path) leaves `baking` stuck true and mixes both timebases into one clip. Needs a single mocap-session state machine instead of the current loose `camStream`/`baking`/`mocapRun` trio. |
| 3 | major | `apps/animate/app.js` ~419 | An unsupported/corrupt video file → the `onloadedmetadata`/`onerror` race is `.catch(() => null)`'d away, then the code unconditionally proceeds to "reading motion…" forever with `baking` stuck and an infinite rAF loop. Needs the error path to actually reset state and tell the user. |
| 4 | major | `vendor/ml/pose.js` ~88 | `detectVideo` doesn't take the `_busy` lock and the `runningMode` switch inside `ensurePose` isn't serialized against concurrent callers — same root cause as #1, worth fixing at the `pose.js` layer instead of (or in addition to) the app layer. |
| 5 | major | `apps/three/app.js` ~463 | `stepAnim` only refreshes `computeBoundingSphere()`, but three.js's raycast also consults the (never-updated) `computeBoundingBox()` — the code comment claims raycast-painting stays honest while animating but it can miss hits on limbs that have moved outside the rest-pose bounding box. Fix: also recompute the bounding box each frame, or raycast against a padded static box. |
| 6 | minor | `apps/animate/app.js` ~0 (framing, not a line bug) | `poseFromLandmarks(lm, 1)` is called with aspect=1 for mocap sources, but `retargetPose` reads bone *angles* (`atan2`), and MediaPipe's landmarks are normalized per-axis against the video's own aspect ratio — a non-square camera/video feed will systematically skew retargeted limb angles. One verify lens called this real, one refuted it (disagreement — needs a closer look, possibly moot if the practical skew is small for near-square webcam feeds, but worth a real-camera check). |
| 7 | minor | `apps/animate/app.js` ~367 | `stopMocap()` doesn't pause/revoke the `<video>` element when switching from one "From video" file to another mid-read — leaks the old blob URL and leaves the old video decoding. |
| 8 | minor | `apps/animate/app.js` ~354 | `mocapLoop`'s `step()` only checks the `mocapRun` generation guard *before* the awaited `detectVideo` call, not after — a session swap during that await (e.g. first-use model download) can let a stale frame write into the new session's `livePose`/`bakeFrames`. |
| 9 | minor | `apps/animate/app.js` ~327 | Joint-dot dragging only cleans up and rebinds on `pointerup`; a `pointercancel` (incoming call, tab switch, orientation change mid-drag) leaves a dangling `pointermove` listener and skips the rebind. |
| 10 | minor | `src/presenter.js` ~71 | `GuestPresenter.hide()` just sets `iframe.hidden` — it never tells the guest to stop. Concrete case: record a mocap clip → "Send to editor" auto-switches away → the camera keeps streaming (and the mocap rAF loop keeps running) in the now-hidden Animate iframe. Consider posting a `surface-hidden`/`surface-shown` message the guest can act on (Animate would call `stopMocap()`). |
| 11 | minor | `src/presenter.js` ~83 | `GuestPresenter.post()` queues messages forever if the guest never posts `surface-ready` (e.g. a boot-time exception before that call), with no timeout/feedback; `closeSurface()` also silently drops anything still queued. |
| 12 | minor | `apps/animate/app.js` ~458 | `pickMime()`'s fallback (`'video/webm'` when nothing in the candidate list is supported) isn't itself checked — on a browser with neither WebM nor the MP4 candidate supported (older iOS Safari), `MediaRecorder` construction throws and the capture `MediaStream`'s tracks are never stopped. |
| 13 | minor | `apps/three/app.js` ~434 | `setAnim` toggles the preset button's active/highlighted state *before* validating `current` exists — tapping a motion button with no character loaded shows it as "on" while nothing is animating. |
| 14 | minor | `apps/three/app.js` ~453 | On a photo opened without the AI cut-out (so the flood-fill silhouette keeps a lot of background), `GRID_LONG=150` can produce on the order of 10^5 vertices; combined with a per-frame `computeBoundingSphere()` in `stepAnim`, this is a plausible sub-30fps stutter on a phone. Not urgent, but worth a vertex-count cap or a cheaper per-frame bounds update if animation-while-painting feels sluggish on real hardware. |
| 15 | minor | `vendor/ml/pose.js` ~54 | The GPU→CPU fallback `catch` is unconditional — a network failure fetching the model (nothing to do with the GPU) gets mislabeled "GPU unavailable" in the status text and triggers a full duplicate load attempt on CPU, which will just fail again for the same reason. Should distinguish GPU-specific failures (context creation, `WebGL`/`WebGPU` errors) from generic fetch/network failures. |

None of the open items are data-loss or crash-the-app severity; they're all "a specific
sequence of taps under specific conditions gives a degraded/wrong result." Recommended order of
attack: **#1/#2/#4 together** (they're the same underlying issue — the single shared
`PoseLandmarker`'s mode/lock isn't safe under concurrent camera+image or camera+video use; a
proper fix is probably two landmarker instances or a real mutex in `pose.js`, not more app-level
guards), then **#5** (raycast bounding box) since it's a one-line-ish fix with a clear repro,
then the rest as time allows.

## Where things stand structurally

- Branch: everything landed directly on `main` (the task instructions for this session said to
  push to `main`, not open a PR). `claude/repo-completion-l0xb41` still exists as a stale branch
  from an earlier task setup and was not used this session — probably safe to ignore/delete
  later, it has no unique commits beyond what's already on `main`.
- No build step, no `package.json`, no test runner committed — this is intentional (the whole
  project is no-build vanilla JS/PWA). The verification scripts from this session live only in
  the ephemeral session scratchpad; if persistent CI-style checks become a project goal, that'd
  be a deliberate follow-up decision, not something to add unilaterally.
- The MediaPipe pose model is pulled live from `storage.googleapis.com` / jsdelivr at runtime;
  this sandbox's network egress couldn't reach either during interactive testing (hence the
  `window.__DPX_POSE__` override + local mirror for headless verification) but both were
  reachable via plain `curl` earlier in the session — likely fine on real deployments/CI with
  normal internet access. Worth a real-device sanity check of pose auto-rig + live mocap before
  calling this fully proven end-to-end (the headless pass proves the *plumbing*, not that
  MediaPipe's model quality is good on hand-drawn figures specifically).

## User's stated follow-up asks (not yet started)

Two feature requests came in during this session that were **not** acted on — flagging them
here so they aren't lost:

1. **Fix the seams on extruded 3D models + intuitive reshaping.** The standee's extrusion
   (`apps/three/app.js` `buildGeometry`) currently tints side-wall seams with a sampled rim
   color (`rimColor`) rather than truly closing them; "intuitive" reshaping wasn't scoped further
   in the request — likely means direct-manipulation handles (drag a limb/region) rather than
   only the raycast-paint + Y-nudge/bounds tools that exist today. Needs a scoping conversation
   before implementation: what does "fix the seams" mean concretely (geometry-level welding vs.
   a shader-level fix vs. a different extrusion topology), and what does "shape them" cover
   (per-vertex sculpt? cage/lattice deform? Now that `vendor/anim`'s rig+skinning exists, one
   natural answer is "expose the joint-drag editor from Animate as a 3D pose tool too" — worth
   discussing with the user rather than assuming).
2. **The ML CDN cache system is blocking and not properly threaded.** Refers to `src/cdn.js` /
   the model-loading path in `vendor/ml/*.js` — `cdn.js`'s `warm()` does sequential
   `fetch`→`arrayBuffer`→`cache.put` per URL with no concurrency, and none of the ONNX/
   Transformers.js/MediaPipe inference itself runs on a Worker (it all runs on the main thread,
   which is exactly why the existing `_busy` single-job locks exist as a workaround — they
   serialize instead of parallelizing because a second concurrent inference would jank the UI
   thread). A real fix is a bigger architectural piece (move inference to a dedicated Worker per
   `dpx` provider, make `cdn.js.warm()` fetch packages concurrently with a small concurrency cap)
   — scope and confirm the direction with the user before starting, since it touches the shared
   `dpx` runtime every surface depends on.
3. **2D→3D model conversion.** Not scoped at all yet — likely follow-on to the 3D reshaping work
   above (e.g., using the Animate rig's mesh/pose as an input to build a proper 3D mesh rather
   than a flat extrusion). Needs a design conversation: is this "make the standee less flat" (a
   depth-from-silhouette or multi-view approach) or "port a 2D animated character into the 3D
   scene as a fully 3D asset"? Both are real projects, not a quick add.

Recommend opening with the user on these three before writing code — they're architecturally
significant (especially #2, which is a cross-cutting change to the shared inference runtime) and
were flagged mid-session without a chance to scope them together.
