// flickmotion — the CoolPro 2D animation studio.
// Open a drawing → silhouette → skeleton (pose AI or template, user-fixable) → geodesic-skinned
// mesh (vendor/anim, the AnimatedDrawings method) → drive it with preset clips or LIVE MediaPipe
// mocap (camera / any video of a person) → record the stage → send the clip to the editor.
//
// Rendering is three.js (the vendored module the 3D surface already ships) on an orthographic
// stage: the rig deforms in 2D, the GPU just draws textured triangles.

import * as THREE from 'three';
import { JOINTS, BONES, TEMPLATE, retargetPose, poseFromLandmarks, clonePose } from '../../vendor/anim/skeleton.js';
import { PRESETS, presetById, samplePose, makeClip, rootFor } from '../../vendor/anim/motion.js';
import { buildRig, rebind, deformMesh } from '../../vendor/anim/rig.js';

const MAX_TEX = 1024;
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const setStatus = (t) => { statusEl.textContent = t; };

// ---------------------------------------------------------------- stage
const viewport = $('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
viewport.insertBefore(renderer.domElement, viewport.firstChild);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
camera.position.z = 5;

// soft contact shadow under the feet
const shadowTex = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 32, 4, 128, 32, 120);
  grad.addColorStop(0, 'rgba(0,0,0,.42)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.translate(128, 32); g.scale(1, 0.26); g.translate(-128, -32);
  g.fillStyle = grad; g.beginPath(); g.arc(128, 32, 120, 0, Math.PI * 2); g.fill(); g.restore();
  return new THREE.CanvasTexture(c);
})();
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.25),
  new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
shadow.visible = false;
scene.add(shadow);

// ---------------------------------------------------------------- character state
let rig = null;                 // vendor/anim rig
let cutout = null;              // the character texture canvas (alpha = silhouette)
let charName = 'character';
let mesh = null, tex = null;
let scratch = null;             // Float32Array deform target
let motion = null, motionRef = TEMPLATE;
let playing = true, speed = 1, t = 0;
let editMode = false;
let livePose = null, liveRef = null;   // camera/video mocap drive (bypasses `motion` while set)

function frameStage() {
  const vw = Math.max(1, viewport.clientWidth), vh = Math.max(1, viewport.clientHeight);
  const va = vw / vh;
  const ca = rig ? rig.aspect : 1;
  const h = Math.max(1.2, (ca / va) * 1.1);        // fit width for wide characters
  camera.left = ca / 2 - (h * va) / 2; camera.right = ca / 2 + (h * va) / 2;
  camera.top = 0.5 + h / 2; camera.bottom = 0.5 - h / 2;
  camera.updateProjectionMatrix();
}
function onResize() {
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
  frameStage();
  if (editMode) placeJointDots();
}
addEventListener('resize', onResize);

// world = rig space with y flipped: (rx, 1 - ry)
const wx = (rx) => rx, wy = (ry) => 1 - ry;
function worldToRig(x, y) { return [x, 1 - y]; }

// ---------------------------------------------------------------- image → cutout canvas
// Pre-cut PNGs keep their own alpha; flat backgrounds get the corner flood-fill (the 3D
// surface's proven silhouette path); photos can opt into the RMBG AI cut-out.
let aiCut = false;
async function toCutout(img) {
  let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const s = Math.min(1, MAX_TEX / Math.max(w, h));
  w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);

  if (aiCut) {
    setStatus('cutting out the subject…');
    const seg = await import('../../vendor/ml/segment.js');
    const cut = await seg.removeBackground(c, setStatus);
    const oc = document.createElement('canvas'); oc.width = w; oc.height = h;
    oc.getContext('2d').drawImage(cut, 0, 0, w, h);
    return oc;
  }

  const id = g.getImageData(0, 0, w, h), px = id.data;
  // already transparent? (a paint cut-out / sticker) — trust its alpha
  let clear = 0;
  for (let i = 3; i < px.length; i += 4 * 97) if (px[i] < 16) clear++;
  if (clear > (px.length / (4 * 97)) * 0.05) return c;

  // corner flood-fill: treat the corner color as background
  const corners = [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]];
  let br = 0, bg = 0, bb = 0;
  for (const [x, y] of corners) { const i = (y * w + x) * 4; br += px[i]; bg += px[i + 1]; bb += px[i + 2]; }
  br /= 4; bg /= 4; bb /= 4;
  const TOL = 46;
  const isBgColour = (i) => {
    if (px[i + 3] < 16) return true;
    const dr = px[i] - br, dg = px[i + 1] - bg, db = px[i + 2] - bb;
    return Math.sqrt(dr * dr + dg * dg + db * db) < TOL;
  };
  const isBg = new Uint8Array(w * h);
  const stack = [];
  const pushIf = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (!isBg[p] && isBgColour(p * 4)) { isBg[p] = 1; stack.push(p); }
  };
  for (let x = 0; x < w; x++) { pushIf(x, 0); pushIf(x, h - 1); }
  for (let y = 0; y < h; y++) { pushIf(0, y); pushIf(w - 1, y); }
  while (stack.length) {
    const p = stack.pop(), x = p % w, y = (p - x) / w;
    pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1);
  }
  for (let p = 0; p < w * h; p++) if (isBg[p]) px[p * 4 + 3] = 0;
  g.putImageData(id, 0, 0);
  return c;
}

// ---------------------------------------------------------------- auto-rig (pose AI → template)
async function guessJoints(cut) {
  try {
    setStatus('finding the skeleton…');
    const pose = await import('../../vendor/ml/pose.js');
    const lm = await pose.detectImage(cut, setStatus);
    const guess = lm && poseFromLandmarks(lm, cut.width / cut.height);
    if (!guess) return null;
    // sanity: most joints must land inside the frame, or the guess is noise
    let inside = 0;
    const a = cut.width / cut.height;
    for (const j of JOINTS) {
      const p = guess[j.name];
      p[0] = Math.min(a, Math.max(0, p[0])); p[1] = Math.min(1, Math.max(0, p[1]));
      if (p[0] > 0.01 && p[0] < a - 0.01 && p[1] > 0.01 && p[1] < 0.99) inside++;
    }
    return inside >= 12 ? guess : null;
  } catch (e) {
    console.warn('pose auto-rig unavailable:', e.message);
    return null;
  }
}

// ---------------------------------------------------------------- build / rebuild the character
async function loadFromFile(file) {
  charName = (file.name || 'character').replace(/\.\w+$/, '');
  const url = URL.createObjectURL(file);
  try { await loadFromUrl(url); } finally { URL.revokeObjectURL(url); }
}
async function loadFromUrl(url) {
  setStatus('reading the drawing…');
  const img = await new Promise((res, rej) => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => res(im); im.onerror = () => rej(new Error('could not load that image'));
    im.src = url;
  });
  cutout = await toCutout(img);
  const joints = await guessJoints(cutout);
  buildCharacter(joints);
  setStatus(joints ? 'skeleton found — fix any joints, then pick a motion'
                   : 'used the template skeleton — tap 🦴 Fix joints to line it up');
  if (!joints) setEditMode(true);
}

function buildCharacter(joints) {
  try { rig = buildRig(cutout, { longSide: 64, joints }); }
  catch (e) { setStatus(e.message); return; }

  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
  if (tex) tex.dispose();

  tex = new THREE.CanvasTexture(cutout);
  tex.colorSpace = THREE.SRGBColorSpace;
  const { positions, uvs, indices } = rig.mesh;
  const nv = positions.length / 2;
  const pos3 = new Float32Array(nv * 3);
  const uv2 = new Float32Array(nv * 2);
  for (let i = 0; i < nv; i++) {
    pos3[i * 3] = wx(positions[i * 2]); pos3[i * 3 + 1] = wy(positions[i * 2 + 1]);
    uv2[i * 2] = uvs[i * 2]; uv2[i * 2 + 1] = 1 - uvs[i * 2 + 1];   // flipY texture
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos3, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv2, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
  }));
  scene.add(mesh);
  scratch = new Float32Array(nv * 2);

  // shadow under the silhouette's lowest occupied row
  let footY = 1;
  for (let gy = rig.gh - 1; gy >= 0; gy--) {
    let any = false;
    for (let gx = 0; gx < rig.gw; gx++) if (rig.occ[gy * rig.gw + gx]) { any = true; break; }
    if (any) { footY = (gy + 1) * rig.cellH; break; }
  }
  shadow.position.set(rig.aspect / 2, wy(footY), -0.5);
  shadow.scale.set(rig.aspect * 1.1, 1, 1);
  shadow.visible = true;

  t = 0;
  frameStage();
  if (!motion) setMotion('wave');
  if (editMode) placeJointDots();
}

// ---------------------------------------------------------------- playback
function applyPose(srcPose, refPose) {
  if (!rig || !mesh) return;
  const posed = retargetPose(srcPose, rig.bind, rootFor(srcPose, refPose, rig.bind));
  deformMesh(rig, posed, scratch);
  const attr = mesh.geometry.attributes.position;
  const n = scratch.length / 2;
  for (let i = 0; i < n; i++) { attr.array[i * 3] = wx(scratch[i * 2]); attr.array[i * 3 + 1] = wy(scratch[i * 2 + 1]); }
  attr.needsUpdate = true;
}
function showBindPose() {
  if (!rig || !mesh) return;
  const attr = mesh.geometry.attributes.position;
  const p = rig.mesh.positions, n = p.length / 2;
  for (let i = 0; i < n; i++) { attr.array[i * 3] = wx(p[i * 2]); attr.array[i * 3 + 1] = wy(p[i * 2 + 1]); }
  attr.needsUpdate = true;
}

requestAnimationFrame(onResize);   // re-measure after first layout (fonts/CSS settle)

const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, clock.getDelta());
  if (rig && mesh && !editMode) {
    if (livePose) applyPose(livePose, liveRef);
    else if (motion && playing) { t += dt * speed; applyPose(samplePose(motion, t), motionRef); }
  }
  renderer.render(scene, camera);
}
tick();

function setMotion(id) {
  const p = presetById(id);
  if (p) { motion = p; motionRef = TEMPLATE; }
  if (editMode) setEditMode(false);              // playing a motion always leaves joint-editing
  document.querySelectorAll('#motions .gridbtn').forEach((b) => b.classList.toggle('active', b.dataset.m === id));
  playing = true; syncPlay();
}
function setClipMotion(clip) {
  motion = clip; motionRef = clip.frames[0];
  if (editMode) setEditMode(false);
  document.querySelectorAll('#motions .gridbtn').forEach((b) => b.classList.remove('active'));
  playing = true; syncPlay();
}

// ---------------------------------------------------------------- joint fix-up overlay
const bonesHost = $('bones');
let boneCanvas = null;
function setEditMode(on) {
  editMode = !!on && !!rig;
  $('editJoints').classList.toggle('active', editMode);
  bonesHost.innerHTML = '';
  boneCanvas = null;
  if (editMode) { showBindPose(); placeJointDots(); setStatus('drag the dots onto the body — release to re-bind'); }
}
function worldToScreen(rx, ry) {
  const v = new THREE.Vector3(wx(rx), wy(ry), 0).project(camera);
  return [(v.x + 1) / 2 * viewport.clientWidth, (1 - v.y) / 2 * viewport.clientHeight];
}
function screenToRig(px, py) {
  const v = new THREE.Vector3(px / viewport.clientWidth * 2 - 1, 1 - py / viewport.clientHeight * 2, 0);
  v.unproject(camera);
  return worldToRig(v.x, v.y);
}
function placeJointDots() {
  if (!rig) return;
  bonesHost.innerHTML = '<canvas style="position:absolute;inset:0;width:100%;height:100%"></canvas>';
  boneCanvas = bonesHost.firstChild;
  for (const j of JOINTS) {
    const d = document.createElement('div');
    d.className = 'joint'; d.dataset.j = j.name; d.dataset.name = j.name.replace(/_/g, ' ');
    d.style.pointerEvents = 'auto';
    positionDot(d);
    wireDot(d, j.name);
    bonesHost.appendChild(d);
  }
  drawBones();
}
function positionDot(d) {
  const p = rig.bind[d.dataset.j];
  const [sx, sy] = worldToScreen(p[0], p[1]);
  d.style.left = sx + 'px'; d.style.top = sy + 'px';
}
function drawBones() {
  if (!boneCanvas) return;
  const c = boneCanvas;
  c.width = viewport.clientWidth; c.height = viewport.clientHeight;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(91,140,255,.8)'; g.lineWidth = 2.5; g.lineCap = 'round';
  for (const b of BONES) {
    const [x1, y1] = worldToScreen(rig.bind[b.from][0], rig.bind[b.from][1]);
    const [x2, y2] = worldToScreen(rig.bind[b.to][0], rig.bind[b.to][1]);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  }
}
function wireDot(d, name) {
  d.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    try { d.setPointerCapture(e.pointerId); } catch (_) {}
    const move = (ev) => {
      const r = viewport.getBoundingClientRect();
      const [rx, ry] = screenToRig(ev.clientX - r.left, ev.clientY - r.top);
      rig.bind[name] = [Math.min(rig.aspect, Math.max(0, rx)), Math.min(1, Math.max(0, ry))];
      positionDot(d); drawBones();
    };
    const up = (ev) => {
      d.removeEventListener('pointermove', move); d.removeEventListener('pointerup', up);
      try { d.releasePointerCapture(ev.pointerId); } catch (_) {}
      rebind(rig);                       // re-skin against the corrected skeleton
      setStatus('re-bound — pick a motion or keep fixing');
    };
    d.addEventListener('pointermove', move); d.addEventListener('pointerup', up);
  });
}

// ---------------------------------------------------------------- mocap (camera / video file)
const pip = $('pip');
let camStream = null, mocapRun = 0;
let baking = false, bakeFrames = [], bakeT0 = 0;

async function mocapLoop(video, isCamera) {
  const run = ++mocapRun;
  const pose = await import('../../vendor/ml/pose.js');
  liveRef = null;
  const step = async () => {
    if (run !== mocapRun) return;
    if (video.readyState >= 2 && !video.paused && !video.ended) {
      const ts = isCamera ? performance.now() : video.currentTime * 1000;
      try {
        const lm = await pose.detectVideo(video, ts, setStatus);
        const p = lm && poseFromLandmarks(lm, 1);      // directions only — aspect is irrelevant
        if (p) {
          if (!liveRef) liveRef = clonePose(p);
          livePose = p;
          if (baking) bakeFrames.push({ t: ts, pose: clonePose(p) });
        }
      } catch (e) { console.warn('mocap frame failed', e); }
      if (!isCamera) setStatus(`reading motion… ${Math.round(video.currentTime / video.duration * 100)}%`);
    }
    if (!isCamera && video.ended) { finishVideoBake(); return; }
    requestAnimationFrame(step);
  };
  step();
}

function stopMocap() {
  mocapRun++;
  livePose = null; liveRef = null; baking = false;
  $('mocapBake').disabled = true;
  $('mocapBake').innerHTML = '⏺ Record a clip from the mocap';
  if (camStream) { for (const tr of camStream.getTracks()) tr.stop(); camStream = null; }
  pip.srcObject = null;
  document.body.dataset.mocap = 'off';
  $('mocapCam').classList.remove('active');
}

let camPending = false;
$('mocapCam').addEventListener('click', async () => {
  if (camStream) { stopMocap(); setStatus('camera off'); return; }
  if (camPending) return;                    // permission prompt already up — don't stack requests
  if (!rig) return setStatus('open a drawing first');
  camPending = true;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
  } catch (e) { camPending = false; return setStatus('camera unavailable: ' + e.message); }
  camPending = false;
  if (camStream) { for (const tr of stream.getTracks()) tr.stop(); return; }   // toggled off mid-prompt
  camStream = stream;
  pip.srcObject = camStream;
  await pip.play().catch(() => {});
  document.body.dataset.mocap = 'on';
  $('mocapCam').classList.add('active');
  $('mocapBake').disabled = false;
  setStatus('act it out — the character follows');
  mocapLoop(pip, true);
});

$('mocapBake').addEventListener('click', () => {
  if (!baking) {
    baking = true; bakeFrames = []; bakeT0 = performance.now();
    $('mocapBake').innerHTML = '<span class="rec-dot"></span>Stop & keep the clip';
  } else {
    baking = false;
    $('mocapBake').innerHTML = '⏺ Record a clip from the mocap';
    if (bakeFrames.length > 4) {
      const dur = (bakeFrames[bakeFrames.length - 1].t - bakeFrames[0].t) / 1000 || 1;
      const clip = makeClip(bakeFrames.map((f) => f.pose), Math.max(5, Math.round(bakeFrames.length / dur)));
      stopMocap();
      if (clip) { setClipMotion(clip); setStatus(`kept a ${clip.duration.toFixed(1)}s motion clip — it loops`); }
    } else setStatus('too short — hold the pose capture a little longer');
  }
});

let vidEl = null;
$('mocapVid').addEventListener('click', () => { if (rig) $('vidFile').click(); else setStatus('open a drawing first'); });
$('vidFile').addEventListener('change', async () => {
  const f = $('vidFile').files && $('vidFile').files[0];
  $('vidFile').value = '';
  if (!f) return;
  stopMocap();
  vidEl = document.createElement('video');
  vidEl.muted = true; vidEl.playsInline = true;
  vidEl.src = URL.createObjectURL(f);
  await new Promise((res, rej) => { vidEl.onloadedmetadata = res; vidEl.onerror = () => rej(new Error('bad video')); }).catch(() => null);
  baking = true; bakeFrames = [];
  setStatus('reading motion from the video…');
  await vidEl.play().catch(() => {});
  mocapLoop(vidEl, false);
});
function finishVideoBake() {
  baking = false;
  const frames = bakeFrames; bakeFrames = [];
  if (vidEl) { URL.revokeObjectURL(vidEl.src); vidEl = null; }
  livePose = null; liveRef = null;
  if (frames.length > 4) {
    const dur = (frames[frames.length - 1].t - frames[0].t) / 1000 || 1;
    const clip = makeClip(frames.map((f) => f.pose), Math.max(5, Math.round(frames.length / dur)));
    if (clip) { setClipMotion(clip); setStatus(`motion learned — ${clip.duration.toFixed(1)}s, looping`); return; }
  }
  setStatus('no person found in that video');
}

// ---------------------------------------------------------------- record & export
let lastBlob = null, lastName = null, lastMeta = null;
let exportDur = 4;
$('durs').querySelectorAll('[data-dur]').forEach((b) => b.addEventListener('click', () => {
  exportDur = +b.dataset.dur;
  $('durs').querySelectorAll('.btn-soft').forEach((x) => x.classList.toggle('active', x === b));
}));

function pickMime() {
  const cands = ['video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const c of cands) if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
  return 'video/webm';
}

let recording = false;
$('recBtn').addEventListener('click', async () => {
  if (recording) return;
  if (!rig || !mesh) return setStatus('open a drawing first');
  if (!motion && !livePose) return setStatus('pick a motion first');
  recording = true;
  if (editMode) setEditMode(false);          // never record the frozen bind pose
  playing = true; syncPlay();
  const mime = pickMime();
  const stream = renderer.domElement.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((res) => { rec.onstop = res; });
  rec.start(100);
  $('recBtn').innerHTML = '<span class="rec-dot"></span>Recording…';
  const t0 = performance.now();
  const timer = setInterval(() => {
    const left = exportDur - (performance.now() - t0) / 1000;
    setStatus(`recording… ${Math.max(0, left).toFixed(1)}s`);
    if (left <= 0) { clearInterval(timer); rec.stop(); }
  }, 100);
  await done;
  for (const tr of stream.getTracks()) tr.stop();
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  lastBlob = new Blob(chunks, { type: mime.split(';')[0] });
  lastName = `${charName}-${motion?.id || motion?.kind || 'motion'}.${ext}`;
  lastMeta = { duration: exportDur, width: renderer.domElement.width, height: renderer.domElement.height };
  $('recBtn').innerHTML = '⏺ Record clip';
  $('resultRow').style.display = 'flex';
  setStatus(`clip ready — ${(lastBlob.size / 1e6).toFixed(1)} MB`);
  recording = false;
});

$('pngBtn').addEventListener('click', () => {
  if (!mesh) return;
  renderer.render(scene, camera);
  renderer.domElement.toBlob((blob) => {
    const a = document.createElement('a');
    a.download = `${charName}-frame.png`; a.href = URL.createObjectURL(blob); a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
});

$('toEditor').addEventListener('click', () => {
  if (!lastBlob) return;
  try {
    parent.postMessage({ type: 'export-media', name: lastName, blob: lastBlob, meta: { kind: 'video', ...lastMeta } }, '*');
    setStatus('sent to the editor timeline 🎬');
  } catch (e) { setStatus('could not reach the editor: ' + e.message); }
});
$('shareBtn').addEventListener('click', async () => {
  if (!lastBlob) return;
  const file = new File([lastBlob], lastName, { type: lastBlob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: lastName }); return; } catch (_) { /* fall through */ }
  }
  dl(lastBlob, lastName);
});
$('dlBtn').addEventListener('click', () => lastBlob && dl(lastBlob, lastName));
function dl(blob, name) {
  const a = document.createElement('a');
  a.download = name; a.href = URL.createObjectURL(blob); a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------------------------------------------------------------- chrome wiring
$('open').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', () => {
  const f = $('file').files && $('file').files[0];
  $('file').value = '';
  if (f) loadFromFile(f).catch((e) => setStatus(e.message));
});
$('aicut').addEventListener('click', () => {
  aiCut = !aiCut;
  $('aicut').classList.toggle('active', aiCut);
  setStatus(aiCut ? 'AI cut-out ON — good for photos' : 'AI cut-out off — flat backgrounds auto-key');
});
$('editJoints').addEventListener('click', () => setEditMode(!editMode));
$('resetJoints').addEventListener('click', () => {
  if (!cutout) return;
  buildCharacter(null);                        // template skeleton, fresh bind
  if (editMode) placeJointDots();
  setStatus('skeleton reset to the template');
});

const motionsHost = $('motions');
for (const p of PRESETS) {
  const b = document.createElement('button');
  b.className = 'gridbtn'; b.dataset.m = p.id;
  b.innerHTML = `<span class="mi">${p.icon}</span><span>${p.label}</span>`;
  b.addEventListener('click', () => { if (rig) { setEditMode(false); setMotion(p.id); } });
  motionsHost.appendChild(b);
}
$('speed').addEventListener('input', (e) => {
  speed = +e.target.value / 100;
  $('speedVal').textContent = e.target.value + '%';
});
function syncPlay() {
  $('playToggle').innerHTML = playing
    ? '<span class="ic"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg></span>'
    : '<span class="ic"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>';
}
$('playToggle').addEventListener('click', () => { playing = !playing; syncPlay(); });
syncPlay();

// ---------------------------------------------------------------- host bridge
// The Shell can hand us media (share-in → "Animate character") and we hand back rendered clips.
addEventListener('message', (e) => {
  if (e.source !== parent) return;
  const d = e.data;
  if (d && d.type === 'open-media' && d.file) {
    loadFromFile(d.file).catch((err) => setStatus(err.message));
  }
});
try { parent.postMessage({ type: 'surface-ready', surface: 'animate' }, '*'); } catch (_) {}

// verification / host-bridging handle (the paint surface's __fp precedent)
window.__anim = {
  loadFromFile, loadFromUrl,
  rig: () => rig, motion: () => motion,
  setMotion, setPlaying(v) { playing = !!v; syncPlay(); },
  meshChecksum() {
    if (!mesh) return 0;
    const a = mesh.geometry.attributes.position.array;
    let s = 0; for (let i = 0; i < a.length; i += 7) s += a[i];
    return s;
  },
};

setStatus('open a drawing to start — flat backgrounds key out automatically');
