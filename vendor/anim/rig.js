// vendor/anim/rig.js — build a deformable rig from a character cutout (the AnimatedDrawings
// method, sized for the browser).
//
//   cutout canvas (alpha = silhouette)
//     → occupancy grid (small islands dropped, like the 3D standee builder)
//     → triangle mesh over the occupied cells (indexed; corners shared)
//     → skinning weights per vertex: GEODESIC distance to each bone, BFS'd INSIDE the
//       silhouette — so an arm crossing the belly doesn't drag torso pixels with it. This is
//       the honest 2D stand-in for AnimatedDrawings' ARAP handles.
//     → deform(pose): per-bone rigid transforms (bind→posed), linear-blend skinned.
//
// Rig space: x ∈ [0, aspect], y ∈ [0, 1] downward (see skeleton.js). The mesh, the joints and
// every deform result live in that one space; renderers map it to their own axes.

import { JOINTS, BONES, TEMPLATE, scalePoseToBox, clonePose, boneAngle } from './skeleton.js';

const MAX_INFL = 4;            // bone influences per vertex
const W_POW = 3;               // weight falloff: w = 1/(d + d0)^W_POW
const ISLAND_FRAC = 0.03;      // drop silhouette islands below 3% of the biggest

export function buildRig(maskCanvas, { longSide = 64, joints = null } = {}) {
  const w = maskCanvas.width, h = maskCanvas.height, aspect = w / h;

  // ---- occupancy grid off the alpha channel -------------------------------------------------
  let gw, gh;
  if (aspect >= 1) { gw = longSide; gh = Math.max(2, Math.round(longSide / aspect)); }
  else { gh = longSide; gw = Math.max(2, Math.round(longSide * aspect)); }
  const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  const px = ctx.getImageData(0, 0, w, h).data;
  const occ = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    // sample a few points per cell so thin limbs survive the downsample
    let hit = 0;
    for (const [ox, oy] of [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
      const sx = Math.min(w - 1, Math.floor((gx + ox) / gw * w));
      const sy = Math.min(h - 1, Math.floor((gy + oy) / gh * h));
      if (px[(sy * w + sx) * 4 + 3] > 40) { hit = 1; break; }
    }
    occ[gy * gw + gx] = hit;
  }
  dropSmallIslands(occ, gw, gh);

  // occupied bbox (grid coords) — the box the template pose scales into
  let minX = gw, minY = gh, maxX = -1, maxY = -1, count = 0;
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) if (occ[gy * gw + gx]) {
    count++; if (gx < minX) minX = gx; if (gx > maxX) maxX = gx; if (gy < minY) minY = gy; if (gy > maxY) maxY = gy;
  }
  if (!count) throw new Error('empty silhouette — nothing to rig');

  const cellW = aspect / gw, cellH = 1 / gh;   // ≈ equal; both kept for exactness
  const toRig = (gx, gy) => [gx * cellW, gy * cellH];

  // ---- bind pose -----------------------------------------------------------------------------
  const bind = joints ? clonePose(joints)
    : scalePoseToBox(TEMPLATE, minX * cellW, minY * cellH, (maxX - minX + 1) * cellW, (maxY - minY + 1) * cellH);

  // ---- indexed mesh over occupied cells -------------------------------------------------------
  const cornerId = new Int32Array((gw + 1) * (gh + 1)).fill(-1);
  const positions = [], uvs = [];
  const cornerAt = (cx, cy) => {
    const k = cy * (gw + 1) + cx;
    if (cornerId[k] < 0) {
      cornerId[k] = positions.length / 2;
      positions.push(cx * cellW, cy * cellH);
      uvs.push(cx / gw, cy / gh);              // v measured top-down; renderers flip as needed
    }
    return cornerId[k];
  };
  const indices = [];
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    if (!occ[gy * gw + gx]) continue;
    const a = cornerAt(gx, gy), b = cornerAt(gx + 1, gy), c = cornerAt(gx + 1, gy + 1), d = cornerAt(gx, gy + 1);
    indices.push(a, b, c, a, c, d);
  }

  const rig = {
    w, h, aspect, gw, gh, occ, cellW, cellH, bind,
    mesh: { positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) },
    cornerId,
  };
  rebind(rig);
  return rig;
}

// Recompute skinning weights against rig.bind — call after the user drags joints around.
export function rebind(rig) {
  const dists = boneDistanceFields(rig);
  rig.vertexBind = bindPointsToBones(rig, rig.mesh.positions, dists);
  rig.boneDists = dists;
}

// Bind an EXTERNAL point set (e.g. the 3D standee's geometry, mapped into rig space) to the
// current bind pose. Returns a binding for deformPoints().
export function bindPoints(rig, pts /* Float32Array [x,y,…] */) {
  return bindPointsToBones(rig, pts, rig.boneDists || boneDistanceFields(rig));
}

// ---- deform ---------------------------------------------------------------------------------
// Per-bone rigid transform bind→posed (rotate about the bind FROM-joint, translate to the posed
// one), blended by the precomputed weights. Writes [x,y…] into `out` (or a new array).
export function deformPoints(rig, pose, binding, out = null) {
  const { pts, bones, weights } = binding;
  const n = pts.length / 2;
  out = out || new Float32Array(pts.length);
  // precompute per-bone transforms
  const nb = BONES.length;
  const tf = new Float32Array(nb * 6);   // cos, sin, px, py, qx, qy
  for (let bi = 0; bi < nb; bi++) {
    const b = BONES[bi];
    const P = rig.bind[b.from], Q = pose[b.from] || P;
    const th = angleOf(pose, b) - boneAngle(rig.bind, b);
    tf[bi * 6] = Math.cos(th); tf[bi * 6 + 1] = Math.sin(th);
    tf[bi * 6 + 2] = P[0]; tf[bi * 6 + 3] = P[1];
    tf[bi * 6 + 4] = Q[0]; tf[bi * 6 + 5] = Q[1];
  }
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], y = pts[i * 2 + 1];
    let ox = 0, oy = 0, wsum = 0;
    for (let k = 0; k < MAX_INFL; k++) {
      const wgt = weights[i * MAX_INFL + k];
      if (wgt <= 0) break;
      const bi = bones[i * MAX_INFL + k] * 6;
      const c = tf[bi], s = tf[bi + 1];
      const dx = x - tf[bi + 2], dy = y - tf[bi + 3];
      ox += wgt * (tf[bi + 4] + c * dx - s * dy);
      oy += wgt * (tf[bi + 5] + s * dx + c * dy);
      wsum += wgt;
    }
    if (wsum > 0) { out[i * 2] = ox / wsum; out[i * 2 + 1] = oy / wsum; }
    else { out[i * 2] = x; out[i * 2 + 1] = y; }
  }
  return out;
}

// Deform the rig's own mesh: convenience over deformPoints with the built-in vertex binding.
export function deformMesh(rig, pose, out = null) {
  return deformPoints(rig, pose, rig.vertexBind, out);
}

function angleOf(pose, b) {
  const a = pose[b.from], c = pose[b.to];
  if (!a || !c) return 0;
  const dx = c[0] - a[0], dy = c[1] - a[1];
  return (Math.abs(dx) + Math.abs(dy) < 1e-9) ? 0 : Math.atan2(dy, dx);
}

// ---- geodesic bone distance fields ----------------------------------------------------------
// For each bone: rasterize its segment onto the occupied grid (seeds), then BFS through occupied
// cells only. Distance is in RIG units. Cells no bone can reach geodesically (stray islands)
// fall back to straight-line distance so everything still moves with something sensible.
function boneDistanceFields(rig) {
  const { gw, gh, occ, cellW, cellH, bind } = rig;
  const nCells = gw * gh, nb = BONES.length;
  const cell = Math.min(cellW, cellH);
  const fields = [];
  const queue = new Int32Array(nCells);

  for (let bi = 0; bi < nb; bi++) {
    const b = BONES[bi];
    const dist = new Float32Array(nCells).fill(Infinity);
    let qh = 0, qt = 0;
    // seed: sample the bind segment every half-cell; snap each sample to its cell if occupied
    const P = bind[b.from], Q = bind[b.to];
    const len = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
    const steps = Math.max(1, Math.ceil(len / (cell * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const gx = Math.min(gw - 1, Math.max(0, Math.floor((P[0] + (Q[0] - P[0]) * t) / cellW)));
      const gy = Math.min(gh - 1, Math.max(0, Math.floor((P[1] + (Q[1] - P[1]) * t) / cellH)));
      const c = gy * gw + gx;
      if (occ[c] && dist[c] === Infinity) { dist[c] = 0; queue[qt++] = c; }
    }
    // a bone drawn fully outside the silhouette: seed from the occupied cell nearest its midpoint
    if (qt === 0) {
      const mx = (P[0] + Q[0]) / 2, my = (P[1] + Q[1]) / 2;
      let best = -1, bd = Infinity;
      for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
        if (!occ[gy * gw + gx]) continue;
        const [cx, cy] = [(gx + 0.5) * cellW, (gy + 0.5) * cellH];
        const d = (cx - mx) * (cx - mx) + (cy - my) * (cy - my);
        if (d < bd) { bd = d; best = gy * gw + gx; }
      }
      if (best >= 0) { dist[best] = 0; queue[qt++] = best; }
    }
    // BFS (uniform cost ≈ one cell per hop — plenty for weights)
    while (qh < qt) {
      const c = queue[qh++];
      const cx = c % gw, cy = (c - cx) / gw, d = dist[c] + cell;
      if (cx > 0)      relax(c - 1, d);
      if (cx < gw - 1) relax(c + 1, d);
      if (cy > 0)      relax(c - gw, d);
      if (cy < gh - 1) relax(c + gw, d);
    }
    // eslint-disable-next-line no-inner-declarations
    function relax(c2, d) { if (occ[c2] && d < dist[c2]) { dist[c2] = d; queue[qt++] = c2; } }
    fields.push(dist);
  }
  return fields;
}

// Weight a point set against the distance fields. Each point reads the field at its cell
// (clamped into the grid; unoccupied cells borrow the nearest occupied neighbor ring).
function bindPointsToBones(rig, pts, fields) {
  const { gw, gh, occ, cellW, cellH, bind } = rig;
  const nb = BONES.length, n = pts.length / 2;
  const bones = new Uint8Array(n * MAX_INFL);
  const weights = new Float32Array(n * MAX_INFL);
  const d0 = 2 * Math.min(cellW, cellH);
  const cand = new Float32Array(nb);

  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], y = pts[i * 2 + 1];
    const c = cellFor(x, y);
    for (let bi = 0; bi < nb; bi++) {
      let d = c >= 0 ? fields[bi][c] : Infinity;
      if (d === Infinity) d = segDist(x, y, bind[BONES[bi].from], bind[BONES[bi].to]) + 0.35; // fallback, de-prioritized
      cand[bi] = d;
    }
    // pick the MAX_INFL nearest bones
    for (let k = 0; k < MAX_INFL; k++) {
      let best = -1, bd = Infinity;
      for (let bi = 0; bi < nb; bi++) if (cand[bi] < bd) { bd = cand[bi]; best = bi; }
      if (best < 0) break;
      bones[i * MAX_INFL + k] = best;
      weights[i * MAX_INFL + k] = 1 / Math.pow(bd + d0, W_POW);
      cand[best] = Infinity;
    }
    // normalize
    let sum = 0;
    for (let k = 0; k < MAX_INFL; k++) sum += weights[i * MAX_INFL + k];
    if (sum > 0) for (let k = 0; k < MAX_INFL; k++) weights[i * MAX_INFL + k] /= sum;
  }
  return { pts: pts.slice(), bones, weights };

  function cellFor(x, y) {
    let gx = Math.min(gw - 1, Math.max(0, Math.floor(x / cellW)));
    let gy = Math.min(gh - 1, Math.max(0, Math.floor(y / cellH)));
    if (occ[gy * gw + gx]) return gy * gw + gx;
    // mesh corners sit on cell boundaries — check the 8 neighbors for an occupied cell
    for (const [ox, oy] of [[-1, 0], [0, -1], [0, 0], [-1, -1], [1, 0], [0, 1], [1, 1], [-1, 1], [1, -1]]) {
      const nx = gx + ox, ny = gy + oy;
      if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && occ[ny * gw + nx]) return ny * gw + nx;
    }
    return -1;
  }
}

function segDist(x, y, A, B) {
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((x - A[0]) * dx + (y - A[1]) * dy) / L2)) : 0;
  const px = A[0] + t * dx, py = A[1] + t * dy;
  return Math.hypot(x - px, y - py);
}

function dropSmallIslands(occ, gw, gh) {
  const label = new Int32Array(gw * gh).fill(-1);
  const sizes = [];
  const stack = [];
  for (let i = 0; i < gw * gh; i++) {
    if (!occ[i] || label[i] >= 0) continue;
    const id = sizes.length; let cnt = 0;
    stack.length = 0; stack.push(i); label[i] = id;
    while (stack.length) {
      const p = stack.pop(); cnt++;
      const x = p % gw, y = (p - x) / gw;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const q = ny * gw + nx;
        if (occ[q] && label[q] < 0) { label[q] = id; stack.push(q); }
      }
    }
    sizes.push(cnt);
  }
  if (!sizes.length) return;
  const keepMin = Math.max(4, Math.max(...sizes) * ISLAND_FRAC);
  for (let i = 0; i < gw * gh; i++) if (occ[i] && sizes[label[i]] < keepMin) occ[i] = 0;
}
