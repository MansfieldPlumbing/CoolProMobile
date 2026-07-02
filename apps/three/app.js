// flickpaint3d — extrude studio (fast path).
// Chrome stays DOM; tools are unchanged — painting is raycast -> hit.uv -> dab into a 2D canvas
// (the texture-painter trick), so the same brush code works in 3D. This pass adds:
//   * island-cleaned grounding (drop stray sparkles/signatures below the feet so it sits ON the floor)
//   * true FRONT/BACK dual-texture (front sheet on the front face, back sheet on the back face)
//   * procedural SHADER sky + floor + contact-AO (ported in spirit from shader-ui get_water_surface + its SDF shadow)
//   * measuring tools (height / floor-gap readout, Y nudge, bounds box) + camera presets

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// the shared character rig engine (vendor/anim) — the standee can dance now
import { TEMPLATE, retargetPose } from '../../vendor/anim/skeleton.js';
import { presetById, samplePreset, rootFor } from '../../vendor/anim/motion.js';
import { buildRig, bindPoints, deformPoints } from '../../vendor/anim/rig.js';

// ---------------------------------------------------------------- tuning
const TARGET_HEIGHT = 2.4;
const GRID_LONG     = 150;
const REL_DEPTH     = 0.05;
const MAX_TEX       = 1024;
const BG_TOL        = 46;
const ISLAND_FRAC   = 0.03;   // drop silhouette islands smaller than 3% of the biggest part

// ---------------------------------------------------------------- scene
const viewport = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, viewport.clientWidth / viewport.clientHeight, 0.1, 400);
camera.position.set(0, 1.6, 5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.target.set(0, 1.1, 0);
controls.minDistance = 1.2; controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * 0.95;

// ---------------------------------------------------------------- procedural SKY (shader, not a raster)
const skyUniforms = { uTime: { value: 0 } };
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(120, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: skyUniforms,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform float uTime;
      void main(){
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 top = vec3(0.09, 0.09, 0.18);
        vec3 horizon = vec3(0.34, 0.27, 0.55);
        vec3 col = mix(horizon, top, pow(h, 0.8));
        // gentle sin/cos shimmer near the horizon (the get_water_surface idea)
        float s = sin(vDir.x * 3.0 + uTime * 0.2) * cos(vDir.z * 3.0 - uTime * 0.15);
        col += vec3(0.03, 0.06, 0.05) * s * (1.0 - h);
        gl_FragColor = vec4(col, 1.0);
      }`
  })
);
scene.add(sky);

// ---------------------------------------------------------------- procedural FLOOR (shader grid + soft contact AO)
const floorUniforms = {
  uColor: { value: new THREE.Color(0x14141c) },
  uLine:  { value: new THREE.Color(0x39ff14) },
  uFootR: { value: 0.6 },   // contact-AO radius under the feet (world units)
  uFade:  { value: 18.0 },  // distance fade radius
};
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(140, 140),
  new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: floorUniforms,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      varying vec3 vW;
      uniform vec3 uColor; uniform vec3 uLine; uniform float uFootR; uniform float uFade;
      void main(){
        vec2 p = vW.xz;
        float r = length(p);
        vec2 q = abs(fract(p + 0.5) - 0.5);        // 0 at integer grid lines
        float lw = 0.02 + r * 0.0010;              // widen slightly with distance to curb aliasing
        float g = 1.0 - smoothstep(0.0, lw, min(q.x, q.y));
        vec3 col = mix(uColor, uLine, g * 0.5);
        float ao = smoothstep(uFootR, 0.0, r);     // soft contact shadow right under the model
        col = mix(col, vec3(0.0), ao * 0.55);
        float a = 1.0 - smoothstep(uFade * 0.4, uFade, r);
        a = max(a, ao);                            // keep the shadow even past the fade
        gl_FragColor = vec4(col, a * 0.95);
      }`
  })
);
floor.rotation.x = -Math.PI / 2; floor.position.y = -0.002;
scene.add(floor);

// ---------------------------------------------------------------- image -> silhouette mask (unchanged)
function processImage(img) {
  let w = img.naturalWidth, h = img.naturalHeight;
  const scale = Math.min(1, MAX_TEX / Math.max(w, h));
  w = Math.round(w * scale); h = Math.round(h * scale);

  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;

  const corners = [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]];
  let br = 0, bg = 0, bb = 0;
  for (const [x, y] of corners) { const i = (y * w + x) * 4; br += px[i]; bg += px[i + 1]; bb += px[i + 2]; }
  br /= 4; bg /= 4; bb /= 4;

  const isBgColour = (i) => {
    const a = px[i + 3];
    if (a < 16) return true;
    const dr = px[i] - br, dg = px[i + 1] - bg, db = px[i + 2] - bb;
    return Math.sqrt(dr * dr + dg * dg + db * db) < BG_TOL;
  };

  const isBg = new Uint8Array(w * h);
  const stack = [];
  const pushIf = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (isBg[p]) return;
    if (isBgColour(p * 4)) { isBg[p] = 1; stack.push(p); }
  };
  for (let x = 0; x < w; x++) { pushIf(x, 0); pushIf(x, h - 1); }
  for (let y = 0; y < h; y++) { pushIf(0, y); pushIf(w - 1, y); }
  while (stack.length) {
    const p = stack.pop(); const x = p % w, y = (p - x) / w;
    pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1);
  }

  const base = document.createElement('canvas'); base.width = w; base.height = h;
  const bctx = base.getContext('2d');
  const out = bctx.createImageData(w, h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    out.data[i] = px[i]; out.data[i + 1] = px[i + 1]; out.data[i + 2] = px[i + 2];
    out.data[i + 3] = isBg[p] ? 0 : 255;
  }
  bctx.putImageData(out, 0, 0);
  return { w, h, isBg, base };
}

// ---------------------------------------------------------------- AI silhouette (on-device matte)
// Same { w, h, isBg, base } shape as processImage, but the alpha comes from RMBG-1.4 instead of a
// corner flood-fill — so characters on non-flat backgrounds key out cleanly.
let aiSilhouette = false, lastCh = null;
async function processImageAI(img) {
  const { foregroundMask } = await import('../../vendor/ml/segment.js?v=' + Math.floor(Date.now() / 86400000));
  const m = await foregroundMask(img, setStatus);            // m.data[i] = subject alpha 0..255
  const scale = Math.min(1, MAX_TEX / Math.max(m.width, m.height));
  const w = Math.round(m.width * scale), h = Math.round(m.height * scale);
  const base = document.createElement('canvas'); base.width = w; base.height = h;
  const bctx = base.getContext('2d');
  bctx.drawImage(img, 0, 0, w, h);
  const id = bctx.getImageData(0, 0, w, h), d = id.data;
  const isBg = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const mx = Math.min(m.width - 1, Math.floor((x + 0.5) / w * m.width));
    const my = Math.min(m.height - 1, Math.floor((y + 0.5) / h * m.height));
    const p = y * w + x;
    if (m.data[my * m.width + mx] < 128) { isBg[p] = 1; d[p * 4 + 3] = 0; } else { d[p * 4 + 3] = 255; }
  }
  bctx.putImageData(id, 0, 0);
  return { w, h, isBg, base };
}
const maskImage = (img) => aiSilhouette ? processImageAI(img) : Promise.resolve(processImage(img));

// ---------------------------------------------------------------- mask -> 3-group extruded geometry
// groups: 0 = front faces (front skin), 1 = back faces (back skin), 2 = side walls (edge)
function buildGeometry(mask) {
  const { w, h, isBg } = mask;
  const aspect = w / h;
  let gw, gh;
  if (aspect >= 1) { gw = GRID_LONG; gh = Math.max(1, Math.round(GRID_LONG / aspect)); }
  else { gh = GRID_LONG; gw = Math.max(1, Math.round(GRID_LONG * aspect)); }

  const occ = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const sx = Math.min(w - 1, Math.floor((gx + 0.5) / gw * w));
      const sy = Math.min(h - 1, Math.floor((gy + 0.5) / gh * h));
      occ[gy * gw + gx] = isBg[sy * w + sx] ? 0 : 1;
    }
  }

  // remove small disconnected islands (corner sparkles, signatures) so grounding hits the feet
  const label = new Int32Array(gw * gh).fill(-1);
  const sizes = [];
  for (let i = 0; i < gw * gh; i++) {
    if (!occ[i] || label[i] >= 0) continue;
    const id = sizes.length; let cnt = 0; const stk = [i]; label[i] = id;
    while (stk.length) {
      const p = stk.pop(); cnt++; const x = p % gw, y = (p - x) / gw;
      const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const q = ny * gw + nx;
        if (occ[q] && label[q] < 0) { label[q] = id; stk.push(q); }
      }
    }
    sizes.push(cnt);
  }
  if (sizes.length) {
    const maxSz = Math.max(...sizes);
    const keepMin = Math.max(4, maxSz * ISLAND_FRAC);
    for (let i = 0; i < gw * gh; i++) if (occ[i] && sizes[label[i]] < keepMin) occ[i] = 0;
  }
  const occAt = (gx, gy) => (gx < 0 || gy < 0 || gx >= gw || gy >= gh) ? 0 : occ[gy * gw + gx];

  const pos = [], uv = [], nor = [], col = [];
  const d = REL_DEPTH;
  const X = (gx) => gx / gw * aspect;
  const Y = (gy) => 1 - gy / gh;
  const U = (gx) => gx / gw;
  const V = (gy) => 1 - gy / gh;
  const WHITE = [1, 1, 1];
  const quad = (a, b, c2, e, n, uvs, c) => {
    c = c || WHITE;
    for (const [vx, t] of [[a, 0], [b, 1], [c2, 2], [a, 0], [c2, 2], [e, 3]]) {
      pos.push(vx[0], vx[1], vx[2]); nor.push(n[0], n[1], n[2]); uv.push(uvs[t][0], uvs[t][1]); col.push(c[0], c[1], c[2]);
    }
  };

  // Seam fill: tint the side walls with the silhouette's own edge colour (slightly
  // shaded) so the rim reads as the character's edge instead of a hard black seam.
  const bctx = mask.base.getContext('2d', { willReadFrequently: true });
  const bw = mask.base.width, bh = mask.base.height;
  const bdata = bctx.getImageData(0, 0, bw, bh).data;
  const RIM = 0.82;
  const rimColor = (gx, gy) => {
    const sx = Math.min(bw - 1, Math.floor((gx + 0.5) / gw * bw));
    const sy = Math.min(bh - 1, Math.floor((gy + 0.5) / gh * bh));
    const i = (sy * bw + sx) * 4;
    return [bdata[i] / 255 * RIM, bdata[i + 1] / 255 * RIM, bdata[i + 2] / 255 * RIM];
  };

  // group 0 — FRONT faces
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    if (!occ[gy * gw + gx]) continue;
    const x0 = X(gx), x1 = X(gx + 1), y0 = Y(gy + 1), y1 = Y(gy);
    const u0 = U(gx), u1 = U(gx + 1), v0 = V(gy + 1), v1 = V(gy);
    quad([x0, y0, d], [x1, y0, d], [x1, y1, d], [x0, y1, d], [0, 0, 1],
         [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  }
  const frontCount = pos.length / 3;

  // group 1 — BACK faces (u mirrored: a back sheet reads correctly when viewed from behind)
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    if (!occ[gy * gw + gx]) continue;
    const x0 = X(gx), x1 = X(gx + 1), y0 = Y(gy + 1), y1 = Y(gy);
    const u0 = U(gx), u1 = U(gx + 1), v0 = V(gy + 1), v1 = V(gy);
    quad([x1, y0, -d], [x0, y0, -d], [x0, y1, -d], [x1, y1, -d], [0, 0, -1],
         [[1 - u1, v0], [1 - u0, v0], [1 - u0, v1], [1 - u1, v1]]);
  }
  const backCount = pos.length / 3 - frontCount;

  // group 2 — side walls
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    if (!occ[gy * gw + gx]) continue;
    const x0 = X(gx), x1 = X(gx + 1), y0 = Y(gy + 1), y1 = Y(gy);
    const uv0 = [[0, 0], [0, 0], [0, 0], [0, 0]];
    const rc = rimColor(gx, gy);
    if (!occAt(gx - 1, gy)) quad([x0, y0, -d], [x0, y1, -d], [x0, y1, d], [x0, y0, d], [-1, 0, 0], uv0, rc);
    if (!occAt(gx + 1, gy)) quad([x1, y0, d], [x1, y1, d], [x1, y1, -d], [x1, y0, -d], [1, 0, 0], uv0, rc);
    if (!occAt(gx, gy - 1)) quad([x0, y1, d], [x1, y1, d], [x1, y1, -d], [x0, y1, -d], [0, 1, 0], uv0, rc);
    if (!occAt(gx, gy + 1)) quad([x0, y0, -d], [x1, y0, -d], [x1, y0, d], [x0, y0, d], [0, -1, 0], uv0, rc);
  }
  const wallCount = pos.length / 3 - frontCount - backCount;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.addGroup(0, frontCount, 0);
  geo.addGroup(frontCount, backCount, 1);
  geo.addGroup(frontCount + backCount, wallCount, 2);
  geo.computeBoundingBox();
  return geo;
}

// ---------------------------------------------------------------- skin (base art + a live paint layer)
class Skin {
  constructor(base) {
    this.w = base.width; this.h = base.height;
    this.base = base;
    this.paint = document.createElement('canvas'); this.paint.width = this.w; this.paint.height = this.h;
    this.pctx = this.paint.getContext('2d');
    this.comp = document.createElement('canvas'); this.comp.width = this.w; this.comp.height = this.h;
    this.cctx = this.comp.getContext('2d');
    this.cctx.drawImage(this.base, 0, 0);
    this.tex = new THREE.CanvasTexture(this.comp);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
  }
  dab(x, y, r, color, opacity, erase) {
    const ctx = this.pctx;
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = erase ? 1 : opacity;
    g.addColorStop(0, rgba(color, a)); g.addColorStop(0.7, rgba(color, a)); g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    this._recomposite(x - r - 2, y - r - 2, r * 2 + 4, r * 2 + 4);
  }
  _recomposite(x, y, w, h) {
    x = Math.max(0, x | 0); y = Math.max(0, y | 0);
    w = Math.min(this.w - x, Math.ceil(w)); h = Math.min(this.h - y, Math.ceil(h));
    if (w <= 0 || h <= 0) return;
    this.cctx.clearRect(x, y, w, h);
    this.cctx.drawImage(this.base, x, y, w, h, x, y, w, h);
    this.cctx.drawImage(this.paint, x, y, w, h, x, y, w, h);
    this.tex.needsUpdate = true;
  }
  clearPaint() {
    this.pctx.clearRect(0, 0, this.w, this.h);
    this.cctx.clearRect(0, 0, this.w, this.h);
    this.cctx.drawImage(this.base, 0, 0);
    this.tex.needsUpdate = true;
  }
}
function rgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }

// ---------------------------------------------------------------- character lifecycle
let current = null;   // { mesh, front, back, size, s, mask }
let baseY = 0, yNudge = 0, boundsOn = false, boundsHelper = null;

function disposeCurrent() {
  if (!current) return;
  stopAnim(false);
  scene.remove(current.mesh);
  current.mesh.geometry.dispose();
  for (const m of current.mesh.material) m.dispose();
  current.front.tex.dispose(); current.back.tex.dispose();
  if (boundsHelper) { scene.remove(boundsHelper); boundsHelper.geometry.dispose(); boundsHelper = null; }
  current = null;
}
function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error('load ' + url)); im.src = url; });
}

async function loadCharacter(ch) {
  lastCh = ch;
  const _h = document.getElementById('open-hero'); if (_h) _h.style.display = 'none';
  setStatus(`loading ${ch.name}…`);
  try {
    const frontImg = await loadImage(ch.front);
    const mask = await maskImage(frontImg);        // silhouette comes from the FRONT sheet
    const geo = buildGeometry(mask);
    const frontSkin = new Skin(mask.base);
    let backSkin;
    if (ch.back) { const backImg = await loadImage(ch.back); backSkin = new Skin((await maskImage(backImg)).base); }
    else { backSkin = new Skin(mask.base); }       // single sheet -> back mirrors the front

    const frontMat = new THREE.MeshBasicMaterial({ map: frontSkin.tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
    const backMat  = new THREE.MeshBasicMaterial({ map: backSkin.tex,  transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
    const edgeMat  = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });   // seam tinted from the art
    const mesh = new THREE.Mesh(geo, [frontMat, backMat, edgeMat]);

    const bb = geo.boundingBox, size = new THREE.Vector3(); bb.getSize(size);
    const s = TARGET_HEIGHT / size.y;
    mesh.scale.setScalar(s);
    mesh.position.x = -((bb.min.x + bb.max.x) / 2) * s;
    mesh.position.z = -((bb.min.z + bb.max.z) / 2) * s;
    baseY = -bb.min.y * s;                          // feet on y = 0
    mesh.position.y = baseY + yNudge;

    disposeCurrent();
    scene.add(mesh);
    current = { mesh, front: frontSkin, back: backSkin, size, s, mask };

    floorUniforms.uFootR.value = Math.max(0.4, size.x * s * 0.6);
    setAnim('none');                                // fresh geometry — rig rebuilds on demand
    if (boundsOn) rebuildBounds();
    frameModel(size.y * s);
    updateMeasure();
    setStatus(`${ch.name}${ch.back ? ' (front+back)' : ''} — drag the model to paint, drag the background to spin`);
  } catch (e) { console.error(e); setStatus('could not build that one: ' + e.message); }
}

function frameModel(height) {
  controls.target.set(0, height * 0.5, 0);
  camera.position.set(height * 0.55, height * 0.62, height * 1.55);
  controls.update();
}
function setView(which) {
  if (!current) return;
  const H = current.size.y * current.s, d = H * 1.7;
  controls.target.set(0, H * 0.5, 0);
  const map = { front: [0, H * 0.5, d], back: [0, H * 0.5, -d], side: [d, H * 0.5, 0], '34': [d * 0.6, H * 0.62, d * 0.7], top: [0, d, 0.001] };
  const p = map[which] || map.front;
  camera.position.set(p[0], p[1], p[2]);
  controls.update();
}

// ---------------------------------------------------------------- measuring tools
function updateMeasure() {
  const el = document.getElementById('measure'); if (!el) return;
  if (!current) { el.textContent = ''; return; }
  const bb = current.mesh.geometry.boundingBox;
  const lowest = bb.min.y * current.mesh.scale.y + current.mesh.position.y;   // world-space feet height
  const H = current.size.y * current.s;
  el.innerHTML = `h <b>${H.toFixed(2)}</b> · gap <b>${lowest.toFixed(3)}</b>`;
}
function applyY() { if (!current) return; current.mesh.position.y = baseY + yNudge; if (boundsOn) rebuildBounds(); updateMeasure(); }
function rebuildBounds() {
  if (boundsHelper) { scene.remove(boundsHelper); boundsHelper.geometry.dispose(); boundsHelper = null; }
  if (boundsOn && current) { boundsHelper = new THREE.Box3Helper(new THREE.Box3().setFromObject(current.mesh), 0xff3b5c); scene.add(boundsHelper); }
}

// ---------------------------------------------------------------- animate (vendor/anim rig on the standee)
// The extruded grid's vertices live in rig space already (x = gx/gw·aspect, y = 1 − gy/gh), so
// the shared 2D rig deforms the 3D geometry directly: build the rig from the same silhouette,
// bind every vertex once, then per frame write deformed x/y back — z (the extrusion) never moves.
let anim = null;      // { rig, binding, bind3, out, motion, t }
let animSpeed = 1;

function stopAnim(restore = true) {
  if (!anim) return;
  if (restore && current) {
    const attr = current.mesh.geometry.attributes.position;
    attr.array.set(anim.bind3); attr.needsUpdate = true;
    current.mesh.geometry.computeBoundingSphere();
  }
  anim = null;
}

function setAnim(id) {
  document.querySelectorAll('[data-anim]').forEach((b) => b.classList.toggle('active', b.dataset.anim === id));
  if (id === 'none') { stopAnim(); return; }
  if (!current) { setStatus('open an image first — then it can dance'); return; }
  const motion = presetById(id);
  if (!motion) return;
  if (!anim) {
    try {
      const rig = buildRig(current.mask.base, { longSide: 64 });
      const attr = current.mesh.geometry.attributes.position;
      const n = attr.count;
      const pts = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { pts[i * 2] = attr.array[i * 3]; pts[i * 2 + 1] = 1 - attr.array[i * 3 + 1]; }
      anim = { rig, binding: bindPoints(rig, pts), bind3: attr.array.slice(), out: new Float32Array(n * 2), motion, t: 0 };
    } catch (e) { console.error(e); setStatus('could not rig that one: ' + e.message); return; }
  }
  anim.motion = motion;
  setStatus(`${motion.label} — painting still works while it moves`);
}

function stepAnim(dt) {
  if (!anim || !current) return;
  anim.t += dt * animSpeed;
  const src = samplePreset(anim.motion, anim.t);
  const posed = retargetPose(src, anim.rig.bind, rootFor(src, TEMPLATE, anim.rig.bind));
  deformPoints(anim.rig, posed, anim.binding, anim.out);
  const attr = current.mesh.geometry.attributes.position;
  const n = attr.count;
  for (let i = 0; i < n; i++) { attr.array[i * 3] = anim.out[i * 2]; attr.array[i * 3 + 1] = 1 - anim.out[i * 2 + 1]; }
  attr.needsUpdate = true;
  current.mesh.geometry.computeBoundingSphere();   // keep raycast-painting honest while it moves
}

// ---------------------------------------------------------------- painting (face-aware: front vs back skin)
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tool = { color: '#39ff14', size: 26, opacity: 0.9, erase: false };
let painting = false, lastUV = null, lastSkin = null;
const activePointers = new Set();

function pointerNDC(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}
function hitSkin(e) {
  if (!current) return null;
  pointerNDC(e);
  raycaster.setFromCamera(ndc, camera);
  const h = raycaster.intersectObject(current.mesh, false)[0];
  if (!h || !h.uv || !h.face) return null;
  if (Math.abs(h.face.normal.z) < 0.5) return null;            // ignore the thin side walls
  return { uv: h.uv, skin: h.face.normal.z >= 0 ? current.front : current.back };
}
function paintAt(uv, skin) {
  const x = uv.x * skin.w, y = (1 - uv.y) * skin.h;
  if (lastUV && lastSkin === skin) {
    const x0 = lastUV.x * skin.w, y0 = (1 - lastUV.y) * skin.h;
    const dist = Math.hypot(x - x0, y - y0);
    const step = Math.max(1, tool.size * 0.35);
    const n = Math.ceil(dist / step);
    for (let i = 1; i <= n; i++) { const t = i / n; skin.dab(x0 + (x - x0) * t, y0 + (y - y0) * t, tool.size, tool.color, tool.opacity, tool.erase); }
  } else { skin.dab(x, y, tool.size, tool.color, tool.opacity, tool.erase); }
  lastUV = uv; lastSkin = skin;
}

const dom = renderer.domElement;
dom.addEventListener('pointerdown', (e) => {
  activePointers.add(e.pointerId);
  if (activePointers.size > 1) { painting = false; lastUV = null; controls.enabled = true; return; }
  const hr = hitSkin(e);
  if (hr) { painting = true; lastUV = null; lastSkin = null; controls.enabled = false; paintAt(hr.uv, hr.skin); }
});
dom.addEventListener('pointermove', (e) => {
  if (!painting || activePointers.size > 1) return;
  const hr = hitSkin(e);
  if (hr) paintAt(hr.uv, hr.skin);
});
function endStroke(e) {
  activePointers.delete(e.pointerId);
  if (activePointers.size === 0) { painting = false; lastUV = null; lastSkin = null; controls.enabled = true; }
}
dom.addEventListener('pointerup', endStroke);
dom.addEventListener('pointercancel', endStroke);
dom.addEventListener('pointerleave', endStroke);

// ---------------------------------------------------------------- DOM chrome
const statusEl = document.getElementById('status');
function setStatus(t) { statusEl.textContent = t; }
const $ = (id) => document.getElementById(id);

async function buildTray() {
  const tray = document.getElementById('tray');
  let data;
  try { data = await (await fetch('characters.json')).json(); }
  catch (e) { setStatus('could not load characters.json (serve over http, not file://)'); return; }
  // CoolPro: open ANY image as a model — the generic maker path. (The bundled sample cast
  // needs the art4quinn /gallery art, which isn't vendored here; those tiles self-remove.)
  const opener = document.createElement('button'); opener.className = 'char open-image'; opener.title = 'Open an image';
  opener.innerHTML = '<span class="ic" style="font-size:26px">📂</span><span>Open image</span>';
  const fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.accept = 'image/*'; fileIn.hidden = true;
  opener.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', () => {
    const f = fileIn.files && fileIn.files[0]; if (!f) return;
    const url = URL.createObjectURL(f);
    document.querySelectorAll('.char.active').forEach((n) => n.classList.remove('active'));
    opener.classList.add('active');
    loadCharacter({ name: f.name.replace(/\.\w+$/, ''), front: url });
  });
  tray.append(opener, fileIn);

  // CoolPro: a prominent centered opener on the empty stage, so "open an image" is unmissable.
  if (!document.getElementById('open-hero')) {
    const hero = document.createElement('button'); hero.id = 'open-hero';
    hero.textContent = '📂 Open an image to start';
    hero.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:30;' +
      'padding:14px 22px;border-radius:999px;border:0;background:var(--accent,#5b8cff);color:#fff;' +
      'font-size:16px;font-weight:600;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.45)';
    hero.addEventListener('click', () => fileIn.click());
    (document.getElementById('viewport') || document.body).appendChild(hero);
  }

  for (const ch of data.characters) {
    const b = document.createElement('button'); b.className = 'char'; b.title = ch.name;
    const im = document.createElement('img'); im.loading = 'lazy'; im.src = ch.front; im.alt = ch.name;
    im.addEventListener('error', () => b.remove());   // sample art not bundled → drop the dead tile
    const cap = document.createElement('span'); cap.textContent = ch.name;
    b.append(im, cap);
    b.addEventListener('click', () => {
      document.querySelectorAll('.char.active').forEach((n) => n.classList.remove('active'));
      b.classList.add('active');
      loadCharacter(ch);
    });
    tray.appendChild(b);
  }
  setStatus('Open an image (📂) to build a paintable 3D standee — drag to paint, drag the background to spin.');
}

// tools
$('size').addEventListener('input', (e) => { tool.size = +e.target.value; $('sizeVal').textContent = e.target.value; });
$('opacity').addEventListener('input', (e) => { tool.opacity = +e.target.value / 100; $('opacityVal').textContent = e.target.value + '%'; });
$('color').addEventListener('input', (e) => { tool.color = e.target.value; tool.erase = false; syncTool(); });
document.querySelectorAll('.swatch').forEach(s => s.addEventListener('click', () => { tool.color = s.dataset.c; tool.erase = false; $('color').value = s.dataset.c; syncTool(); }));
$('brush').addEventListener('click', () => { tool.erase = false; syncTool(); });
$('eraser').addEventListener('click', () => { tool.erase = true; syncTool(); });
function syncTool() {
  $('brush').classList.toggle('active', !tool.erase);
  $('eraser').classList.toggle('active', tool.erase);
  $('color').value = tool.color;
  document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', !tool.erase && s.dataset.c.toLowerCase() === tool.color.toLowerCase()));
}
$('clear').addEventListener('click', () => { if (current) { current.front.clearPaint(); current.back.clearPaint(); } });
$('reset').addEventListener('click', () => { if (current) frameModel(current.size.y * current.s); });

// view presets + measuring controls (data-cam, so it doesn't collide with the shell's body[data-view])
document.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => setView(b.dataset.cam)));
$('ynudge').addEventListener('input', (e) => { yNudge = +e.target.value; applyY(); });
$('snap').addEventListener('click', () => { yNudge = 0; $('ynudge').value = 0; applyY(); });
$('showbox').addEventListener('click', () => { boundsOn = !boundsOn; $('showbox').classList.toggle('active', boundsOn); rebuildBounds(); });

// animate: motion presets from the shared rig engine + a speed knob
document.querySelectorAll('[data-anim]').forEach((b) => b.addEventListener('click', () => setAnim(b.dataset.anim)));
$('animspeed').addEventListener('input', (e) => {
  animSpeed = +e.target.value / 100;
  $('animSpeedVal').textContent = e.target.value + '%';
});

// AI silhouette: cut the subject from any background, then re-extrude the current character
$('aicut').addEventListener('click', () => {
  aiSilhouette = !aiSilhouette;
  $('aicut').classList.toggle('active', aiSilhouette);
  if (lastCh) loadCharacter(lastCh);
});

// panel show/hide is handled by the shared glass shell (body[data-view] + tabs/joystick) in index.html

$('save').addEventListener('click', () => {
  if (!current) return;
  const a = document.createElement('a'); a.download = 'flickpaint3d-skin.png'; a.href = current.front.comp.toDataURL('image/png'); a.click();
});
$('shot').addEventListener('click', () => {
  renderer.render(scene, camera);
  const a = document.createElement('a'); a.download = 'flickpaint3d.png'; a.href = renderer.domElement.toDataURL('image/png'); a.click();
});

// ---------------------------------------------------------------- loop + resize
function onResize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
}
addEventListener('resize', onResize);
const clock = new THREE.Clock();
function tick() {
  const dt = clock.getDelta();
  skyUniforms.uTime.value += dt;
  stepAnim(Math.min(0.1, dt));
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

syncTool();
buildTray();
tick();
