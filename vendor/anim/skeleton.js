// vendor/anim/skeleton.js — the CoolPro character skeleton (the Animated-Drawings shape).
//
// Meta's AnimatedDrawings (MIT) rigs a drawn humanoid with a 16-joint tree:
// root→hip→torso→neck, arms branching from the torso, legs from the root. We keep that exact
// tree (plus a `head` tip so the head skins as its own bone) because it's proven on drawings
// and it round-trips cleanly to MediaPipe's 33 pose landmarks for mocap.
//
// Conventions (used across vendor/anim + both surfaces):
//   * "rig space" = the character image, normalized by HEIGHT: x ∈ [0, aspect], y ∈ [0, 1],
//     y grows DOWNWARD (image order). Distances are isotropic in this space.
//   * a POSE is a plain map { jointName: [x, y] } in rig space (or template space — same shape).
//   * joint names use the SUBJECT's left/right (like AnimatedDrawings and MediaPipe both do):
//     the character's right hand appears on the viewer's left.

export const JOINTS = [
  { name: 'root',           parent: null },
  { name: 'hip',            parent: 'root' },
  { name: 'torso',          parent: 'hip' },
  { name: 'neck',           parent: 'torso' },
  { name: 'head',           parent: 'neck' },
  { name: 'right_shoulder', parent: 'torso' },
  { name: 'right_elbow',    parent: 'right_shoulder' },
  { name: 'right_hand',     parent: 'right_elbow' },
  { name: 'left_shoulder',  parent: 'torso' },
  { name: 'left_elbow',     parent: 'left_shoulder' },
  { name: 'left_hand',      parent: 'left_elbow' },
  { name: 'right_hip',      parent: 'root' },
  { name: 'right_knee',     parent: 'right_hip' },
  { name: 'right_foot',     parent: 'right_knee' },
  { name: 'left_hip',       parent: 'root' },
  { name: 'left_knee',      parent: 'left_hip' },
  { name: 'left_foot',      parent: 'left_knee' },
];

// Bones = every parented joint, as (parent joint → this joint). Root has no bone.
export const BONES = JOINTS.filter((j) => j.parent).map((j) => ({ name: j.name, from: j.parent, to: j.name }));

export const parentOf = Object.fromEntries(JOINTS.map((j) => [j.name, j.parent]));

// A tidy, symmetric bind pose in a unit box (x,y ∈ [0,1], y down) — the AnimatedDrawings char1
// annotation, symmetrized. Scaled into the silhouette's bounding box when auto-rig has no
// detection to go on, and used as the canonical space procedural motions are authored in.
export const TEMPLATE = {
  root:           [0.50, 0.64],
  hip:            [0.50, 0.60],
  torso:          [0.50, 0.38],
  neck:           [0.50, 0.20],
  head:           [0.50, 0.05],
  right_shoulder: [0.36, 0.26],
  right_elbow:    [0.24, 0.42],
  right_hand:     [0.14, 0.56],
  left_shoulder:  [0.64, 0.26],
  left_elbow:     [0.76, 0.42],
  left_hand:      [0.86, 0.56],
  right_hip:      [0.42, 0.66],
  right_knee:     [0.40, 0.80],
  right_foot:     [0.38, 0.95],
  left_hip:       [0.58, 0.66],
  left_knee:      [0.60, 0.80],
  left_foot:      [0.62, 0.95],
};

// ---- pose helpers -------------------------------------------------------------------------

export function clonePose(pose) {
  const out = {};
  for (const k in pose) out[k] = [pose[k][0], pose[k][1]];
  return out;
}

export function scalePoseToBox(pose, x0, y0, w, h) {
  const out = {};
  for (const k in pose) out[k] = [x0 + pose[k][0] * w, y0 + pose[k][1] * h];
  return out;
}

export function boneLength(pose, bone) {
  const a = pose[bone.from], b = pose[bone.to];
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function boneAngle(pose, bone) {
  const a = pose[bone.from], b = pose[bone.to];
  return Math.atan2(b[1] - a[1], b[0] - a[0]);   // y-down: positive rotates clockwise on screen
}

// Forward kinematics from absolute bone angles: pose[root] given, every other joint placed at
// parent + (cos θ, sin θ) · len. `angles`/`lengths` are keyed by bone (= child joint) name.
export function fkPose(rootXY, angles, lengths) {
  const pose = { root: [rootXY[0], rootXY[1]] };
  for (const b of BONES) {
    const p = pose[b.from];
    const th = angles[b.name], len = lengths[b.name];
    pose[b.to] = [p[0] + Math.cos(th) * len, p[1] + Math.sin(th) * len];
  }
  return pose;
}

export function anglesOf(pose) {
  const out = {};
  for (const b of BONES) out[b.name] = boneAngle(pose, b);
  return out;
}
export function lengthsOf(pose) {
  const out = {};
  for (const b of BONES) out[b.name] = boneLength(pose, b);
  return out;
}

// Retarget a source pose onto a character: keep the character's bone LENGTHS, take the source's
// bone DIRECTIONS (the 2D reading of AnimatedDrawings' BVH retargeting), root pinned/translated
// by the caller. Degenerate source bones fall back to the character's bind direction.
export function retargetPose(srcPose, bindPose, rootXY) {
  const angles = {}, lengths = lengthsOf(bindPose);
  for (const b of BONES) {
    const a = srcPose[b.from], c = srcPose[b.to];
    const ok = a && c && (Math.abs(c[0] - a[0]) + Math.abs(c[1] - a[1]) > 1e-6);
    angles[b.name] = ok ? Math.atan2(c[1] - a[1], c[0] - a[0]) : boneAngle(bindPose, b);
  }
  return fkPose(rootXY, angles, lengths);
}

// ---- MediaPipe PoseLandmarker (33 landmarks) → this skeleton ------------------------------
// Landmark indices per the official spec: 0 nose · 11/12 shoulders · 13/14 elbows ·
// 15/16 wrists · 23/24 hips · 25/26 knees · 27/28 ankles (odd = subject-left).
const LM = { nose: 0, l_sho: 11, r_sho: 12, l_elb: 13, r_elb: 14, l_wri: 15, r_wri: 16,
             l_hip: 23, r_hip: 24, l_kne: 25, r_kne: 26, l_ank: 27, r_ank: 28 };

// `landmarks` = one detection: [{x, y, z?, visibility?} × 33] in normalized image coords
// (x,y ∈ [0,1], y down). Returns a pose in rig space (x scaled by aspect), or null when the
// core joints are missing/low-visibility.
export function poseFromLandmarks(landmarks, aspect = 1, minVis = 0.35) {
  if (!landmarks || landmarks.length < 29) return null;
  const pt = (i) => {
    const l = landmarks[i];
    if (!l || (l.visibility != null && l.visibility < minVis)) return null;
    return [l.x * aspect, l.y];
  };
  const mid = (a, b) => (a && b) ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null;
  const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  const lSho = pt(LM.l_sho), rSho = pt(LM.r_sho), lHip = pt(LM.l_hip), rHip = pt(LM.r_hip);
  const midSho = mid(lSho, rSho), midHip = mid(lHip, rHip);
  if (!midSho || !midHip) return null;                     // no torso — nothing to drive

  const pose = {
    root: midHip, hip: lerp2(midHip, midSho, 0.15),
    torso: lerp2(midHip, midSho, 0.6), neck: midSho,
    head: pt(LM.nose) || lerp2(midHip, midSho, 1.35),
    right_shoulder: rSho, right_elbow: pt(LM.r_elb), right_hand: pt(LM.r_wri),
    left_shoulder: lSho, left_elbow: pt(LM.l_elb), left_hand: pt(LM.l_wri),
    right_hip: rHip, right_knee: pt(LM.r_kne), right_foot: pt(LM.r_ank),
    left_hip: lHip, left_knee: pt(LM.l_kne), left_foot: pt(LM.l_ank),
  };
  // fill gaps (occluded limbs) so FK always has a chain: missing joint = parent (zero-length
  // bone → retarget falls back to the character's bind direction for it).
  for (const j of JOINTS) if (!pose[j.name]) pose[j.name] = pose[parentOf[j.name]] || midHip;
  return pose;
}
