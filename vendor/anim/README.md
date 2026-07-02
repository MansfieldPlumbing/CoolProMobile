# vendor/anim — the character rig engine

The 2D-animation spine shared by the **Animate** surface (`apps/animate/`) and the **3D**
standee (`apps/three/`). It is a no-build vanilla-JS implementation of the method behind
Meta's [AnimatedDrawings](https://github.com/facebookresearch/AnimatedDrawings) (MIT):
silhouette → mesh → skeleton → skinning → motion retargeting. No code is copied from that
repo — the pipeline is re-derived for the browser — but the skeleton shape and the
"fix the joints" UX are deliberately theirs, because they're proven on children's drawings.

- `skeleton.js` — the 17-joint humanoid tree (root→hip→torso→neck→head, arms off the torso,
  legs off the root), a symmetric template bind pose, FK, angle-transfer retargeting
  (source bone *directions*, character bone *lengths*), and the MediaPipe-33 → skeleton map.
- `rig.js` — cutout alpha → occupancy-grid triangle mesh → **geodesic** skinning weights
  (per-bone BFS *inside* the silhouette, so an arm crossing the belly doesn't drag torso
  pixels) → linear-blend deformation. The stand-in for AnimatedDrawings' ARAP handles;
  a true ARAP solve can replace `deformPoints` later without moving any call site.
- `motion.js` — six procedural preset clips (wave · walk · dance · jumping jacks · zombie ·
  bounce) authored as per-bone angle offsets over the template (they loop perfectly and
  weigh nothing), plus baked mocap clips (`makeClip`/`sampleClip`) recorded from
  `vendor/ml/pose.js` landmarks.

Conventions: "rig space" is the character image normalized by height — x ∈ [0, aspect],
y ∈ [0, 1] **downward**. A pose is `{ jointName: [x, y] }`. Renderers flip y themselves.
