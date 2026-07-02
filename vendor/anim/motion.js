// vendor/anim/motion.js — motion for the character rig.
//
// Two sources, one output shape:
//   * PRESETS — procedural clips authored as per-bone ANGLE OFFSETS over the template skeleton
//     (the 2D analog of AnimatedDrawings' bundled BVH clips: dab, wave, jumping jacks…). Being
//     parametric they loop perfectly and cost nothing to ship.
//   * mocap clips — baked frames of MediaPipe-derived poses (vendor/ml/pose.js →
//     skeleton.poseFromLandmarks), recorded from the camera or a video file.
//
// Either way, `samplePose(motion, t)` yields a SOURCE pose; the caller retargets it onto the
// character with skeleton.retargetPose (directions from the motion, bone lengths from the rig).

import { TEMPLATE, BONES, anglesOf, lengthsOf, fkPose } from './skeleton.js';

const TAU = Math.PI * 2;
const T_ANGLES = anglesOf(TEMPLATE);
const T_LENGTHS = lengthsOf(TEMPLATE);
const T_ROOT = TEMPLATE.root;

// One procedural preset = { id, label, icon, period (s), offsets(phase) -> {bone: Δangle},
// root(phase) -> [dx, dy] } with phase ∈ [0,1) over one period. Angles are y-down radians
// (positive = clockwise on screen). Subject-right limbs render on the viewer's left.
const S = Math.sin, C = Math.cos;
const sp = (ph) => S(ph * TAU), cp = (ph) => C(ph * TAU);

export const PRESETS = [
  {
    id: 'wave', label: 'Wave', icon: '👋', period: 1.6,
    offsets(ph) {
      return {
        left_elbow: -1.9,                       // raise the (subject-)left upper arm
        left_hand: -2.4 + 0.7 * sp(ph * 2),     // forearm up, waving side to side
        right_elbow: 0.12 * sp(ph),
        head: 0.06 * sp(ph),
        torso: 0.03 * sp(ph),
      };
    },
    root: (ph) => [0, 0.006 * sp(ph * 2)],
  },
  {
    id: 'walk', label: 'Walk', icon: '🚶', period: 1.1,
    offsets(ph) {
      const a = 0.55 * sp(ph);                  // thigh swing, legs antiphase
      const kneeL = 0.5 * Math.max(0, sp(ph + 0.25));
      const kneeR = 0.5 * Math.max(0, sp(ph + 0.75));
      return {
        left_knee: a, left_foot: a + kneeL,
        right_knee: -a, right_foot: -a + kneeR,
        left_elbow: -0.4 * sp(ph), left_hand: -0.4 * sp(ph) - 0.2,
        right_elbow: 0.4 * sp(ph), right_hand: 0.4 * sp(ph) + 0.2,
        torso: 0.04 * sp(ph * 2), head: -0.04 * sp(ph * 2),
      };
    },
    root: (ph) => [0, -0.015 * Math.abs(sp(ph))],
  },
  {
    id: 'dance', label: 'Dance', icon: '🕺', period: 2.0,
    offsets(ph) {
      const l = sp(ph), r = sp(ph + 0.5);
      return {
        left_elbow: -0.9 - 0.9 * l, left_hand: -1.4 - 1.0 * l,
        right_elbow: 0.9 + 0.9 * r, right_hand: 1.4 + 1.0 * r,
        torso: 0.12 * sp(ph * 2), neck: -0.08 * sp(ph * 2), head: -0.10 * sp(ph * 2),
        left_knee: 0.16 * l, right_knee: -0.16 * l,
        left_foot: 0.2 * l, right_foot: -0.2 * l,
      };
    },
    root: (ph) => [0.02 * sp(ph), -0.02 * Math.abs(sp(ph * 2))],
  },
  {
    id: 'jacks', label: 'Jumping jacks', icon: '⭐', period: 1.0,
    offsets(ph) {
      const u = (1 - cp(ph)) / 2;               // 0 (arms down) → 1 (arms up) and back
      return {
        left_elbow: -2.4 * u, left_hand: -2.4 * u,
        right_elbow: 2.4 * u, right_hand: 2.4 * u,
        left_knee: 0.35 * u, left_foot: 0.35 * u,
        right_knee: -0.35 * u, right_foot: -0.35 * u,
      };
    },
    root: (ph) => [0, -0.05 * Math.max(0, sp(ph))],
  },
  {
    id: 'zombie', label: 'Zombie', icon: '🧟', period: 2.4,
    offsets(ph) {
      const sh = 0.1 * sp(ph * 2);
      // both arms toward horizontal-forward; in a front view they reach out to the sides
      return {
        right_elbow: (Math.PI - T_ANGLES.right_elbow) + sh,       // → screen-left horizontal
        right_hand: (Math.PI - T_ANGLES.right_hand) + 0.25 + sh,
        left_elbow: (0 - T_ANGLES.left_elbow) - sh,               // → screen-right horizontal
        left_hand: (0 - T_ANGLES.left_hand) - 0.25 - sh,
        head: 0.22 + 0.1 * sp(ph), neck: 0.12,
        torso: 0.1 + 0.05 * sp(ph),
        left_knee: 0.22 * sp(ph), right_knee: -0.22 * sp(ph),
        left_foot: 0.3 * sp(ph), right_foot: -0.3 * sp(ph),
      };
    },
    root: (ph) => [0.012 * sp(ph), 0.008 * Math.abs(sp(ph * 2))],
  },
  {
    id: 'bounce', label: 'Bounce', icon: '🏀', period: 0.9,
    offsets(ph) {
      const d = Math.max(0, sp(ph));            // crouch amount
      return {
        left_knee: 0.35 * d, left_foot: -0.5 * d,
        right_knee: -0.35 * d, right_foot: 0.5 * d,
        left_elbow: -0.25 * d, right_elbow: 0.25 * d,
        torso: 0, head: -0.06 * d,
      };
    },
    root: (ph) => [0, 0.05 * Math.max(0, sp(ph)) - 0.03 * Math.max(0, -sp(ph))],
  },
];

export function presetById(id) { return PRESETS.find((p) => p.id === id) || null; }

// Sample a preset at time t (seconds, speed already applied by the caller if desired):
// FK over the template with the preset's angle offsets → a source pose in template space.
export function samplePreset(preset, t) {
  const ph = ((t / preset.period) % 1 + 1) % 1;
  const off = preset.offsets(ph);
  const angles = {};
  for (const b of BONES) angles[b.name] = T_ANGLES[b.name] + (off[b.name] || 0);
  const [dx, dy] = preset.root ? preset.root(ph) : [0, 0];
  return fkPose([T_ROOT[0] + dx, T_ROOT[1] + dy], angles, T_LENGTHS);
}

// ---- mocap clips ---------------------------------------------------------------------------
// A clip is { kind:'clip', fps, frames:[pose…], duration }. Frames are SOURCE poses (whatever
// space the landmarks came in — retargeting only reads directions, plus root deltas normalized
// by the source's own torso length).

export function makeClip(frames, fps = 30) {
  const f = frames.filter(Boolean);
  return f.length ? { kind: 'clip', fps, frames: f, duration: f.length / fps } : null;
}

export function sampleClip(clip, t, loop = true) {
  const n = clip.frames.length;
  if (!n) return null;
  if (n === 1) return clip.frames[0];
  let ft = t * clip.fps;
  if (loop) ft = ((ft % n) + n) % n; else ft = Math.min(n - 1, Math.max(0, ft));
  const i0 = Math.floor(ft), u = ft - i0;
  // looping wraps the last frame into the first instead of holding it, so playback doesn't
  // freeze for the whole final-frame period and then jump on the exact wrap boundary
  const i1 = loop ? (i0 + 1) % n : Math.min(n - 1, i0 + 1);
  const a = clip.frames[i0], b = clip.frames[i1];
  const out = {};
  for (const k in a) {
    const p = a[k], q = b[k] || p;
    out[k] = [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
  }
  return out;
}

// Uniform sampler: motion is either a preset (parametric) or a baked clip.
export function samplePose(motion, t, loop = true) {
  if (!motion) return null;
  return motion.kind === 'clip' ? sampleClip(motion, t, loop) : samplePreset(motion, t);
}

// Root motion for retargeting: where should the character's root be, given the source pose?
// Anchor at the character's bind root, displaced by the source root's travel from ITS first/bind
// root — scaled torso-to-torso so a tall human driving a squat blob doesn't launch it offscreen.
export function rootFor(srcPose, srcRefPose, bindPose) {
  const bindRoot = bindPose.root;
  if (!srcRefPose) return [bindRoot[0], bindRoot[1]];
  // floor, not just a zero-guard: a near-degenerate first detection (mid-shoulders almost
  // touching mid-hips) must not blow the scale factor up and fling the character offscreen
  const MIN_TORSO = 0.05;
  const srcTorso = Math.max(MIN_TORSO, Math.hypot(srcRefPose.neck[0] - srcRefPose.root[0], srcRefPose.neck[1] - srcRefPose.root[1]));
  const chrTorso = Math.max(MIN_TORSO, Math.hypot(bindPose.neck[0] - bindPose.root[0], bindPose.neck[1] - bindPose.root[1]));
  const s = chrTorso / srcTorso;
  return [bindRoot[0] + (srcPose.root[0] - srcRefPose.root[0]) * s,
          bindRoot[1] + (srcPose.root[1] - srcRefPose.root[1]) * s];
}
