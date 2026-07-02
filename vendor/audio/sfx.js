/* ============================================================================
   Arline Arcade — shared chiptune SFX engine
   Procedural Web Audio (no sound files). Recipe house-style: a tone() synth
   (osc + gain envelope + pitch glide) and a noise() generator (buffer -> filter),
   the same approach as MansfieldTeachesTyping's audio.js.
   Mobile-safe: the AudioContext is created lazily and resumed on first gesture.
   ========================================================================== */

let ctx = null;
let muted = false;

function ac(){
  if(!ctx){
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** Robustly unlock audio. iOS won't start a context from resume() alone — it
    needs a (silent) buffer played *inside* a real user gesture. We also attach
    global one-time gesture listeners so the very first tap anywhere unlocks. */
let _unlocked = false;
function primeUnlock(){
  const c = ac(); if(!c) return;
  if(c.state === 'suspended') c.resume();
  if(_unlocked) return;
  try{
    const b = c.createBuffer(1, 1, 22050);
    const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
    _unlocked = true;
  }catch(_){}
}
export function unlock(){ primeUnlock(); }
const _UNLOCK_EVENTS = ['pointerdown','touchend','mousedown','keydown'];
function _onGesture(){ primeUnlock(); if(_unlocked) _UNLOCK_EVENTS.forEach(ev=>removeEventListener(ev,_onGesture)); }
if(typeof window !== 'undefined') _UNLOCK_EVENTS.forEach(ev=>addEventListener(ev,_onGesture,{passive:true}));
export function context(){ return ac(); }   // shared AudioContext (used by music.js)
export function toggleMute(){ muted = !muted; return muted; }
export function isMuted(){ return muted; }
export function setMuted(v){ muted = !!v; }

/* --- primitives ----------------------------------------------------------- */
function tone({type='square', from, to, t0=0, dur=0.1, gain=0.1, glide='exp'}){
  const c = ac(); if(!c || muted) return;
  const now = c.currentTime + t0;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, now);
  if(to != null){
    if(glide === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1,to), now + dur);
    else o.frequency.linearRampToValueAtTime(to, now + dur);
  }
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
  o.connect(g); g.connect(c.destination);
  o.start(now); o.stop(now + dur + 0.02);
}

function noise({t0=0, dur=0.1, gain=0.1, filter='bandpass', f0=1800, f1, q=0.8}){
  const c = ac(); if(!c || muted) return;
  const now = c.currentTime + t0;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for(let i=0;i<n;i++) d[i] = Math.random()*2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const flt = c.createBiquadFilter(); flt.type = filter; flt.Q.value = q;
  flt.frequency.setValueAtTime(f0, now);
  if(f1 != null) flt.frequency.exponentialRampToValueAtTime(f1, now + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
  src.connect(flt); flt.connect(g); g.connect(c.destination);
  src.start(now); src.stop(now + dur + 0.02);
}

/** A soft "shhh" — filtered-noise swoosh with a smooth attack so it slides instead of clicking. */
function shh({t0=0, dur=0.22, gain=0.05, f0=900, f1=4200}){
  const c = ac(); if(!c || muted) return;
  const now = c.currentTime + t0;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for(let i=0;i<n;i++) d[i] = Math.random()*2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const flt = c.createBiquadFilter(); flt.type = 'bandpass'; flt.Q.value = 0.55;
  flt.frequency.setValueAtTime(f0, now);
  flt.frequency.linearRampToValueAtTime(f1, now + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(gain, now + dur*0.32);   // soft attack
  g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
  src.connect(flt); flt.connect(g); g.connect(c.destination);
  src.start(now); src.stop(now + dur + 0.02);
}

/* --- card-game voices ----------------------------------------------------- */
export const deal      = () => { shh({dur:0.12, gain:0.035, f0:1600, f1:3000}); tone({type:'square', from:680, to:520, dur:0.05, gain:0.045}); };
export const flip      = () => { tone({type:'square', from:430, to:880, dur:0.06, gain:0.07}); };
export const pickup    = () => { tone({type:'triangle', from:300, to:420, dur:0.05, gain:0.06}); };
export const place     = () => { tone({type:'square', from:520, to:700, dur:0.07, gain:0.07}); };
export const foundation= () => { tone({type:'sine', from:760, to:1280, dur:0.14, gain:0.09}); tone({type:'square', from:1180, t0:0.05, dur:0.1, gain:0.04}); };
export const invalid   = () => { tone({type:'sawtooth', from:180, to:110, dur:0.18, gain:0.09, glide:'lin'}); };

/** Riffle shuffle — a burst of short filtered-noise ticks, then a soft settle. */
export function shuffle(){
  const c = ac(); if(!c || muted) return;
  // two soft "shhh" swooshes (the card-slide) ...
  shh({t0:0.0,  dur:0.28, gain:0.05,  f0:700,  f1:3400});
  shh({t0:0.24, dur:0.26, gain:0.045, f0:1100, f1:4200});
  // ... with the crisp riffle ticks layered on top
  let t = 0;
  const ticks = 16;
  for(let i=0;i<ticks;i++){
    t += 0.018 + Math.random()*0.016;
    noise({t0:t, dur:0.03, gain:0.035 + Math.random()*0.02, filter:'bandpass', f0:1500 + Math.random()*1800, q:1.4});
  }
  // two soft thumps as the deck squares up
  tone({type:'triangle', from:160, to:90, t0:t+0.04, dur:0.12, gain:0.08});
  tone({type:'triangle', from:150, to:80, t0:t+0.16, dur:0.12, gain:0.07});
}

/** Triumphant little arpeggio. */
export function win(){
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]; // C5 E5 G5 C6 E6
  let t = 0;
  notes.forEach((f,i)=>{ tone({type:'triangle', from:f, dur:i===4?0.32:0.12, gain:0.09, t0:t}); t += (i===4?0.32:0.12) + 0.02; });
  notes.forEach((f,i)=>{ tone({type:'square', from:f*2, dur:0.08, gain:0.03, t0:i*0.14}); });
}

export default { unlock, context, toggleMute, isMuted, setMuted, deal, flip, pickup, place, foundation, invalid, shuffle, win };
