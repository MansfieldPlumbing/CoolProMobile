/* ============================================================================
   Arline Arcade — generative chiptune background music
   Loops a tasteful lounge/jazz chord progression through the SAME Web Audio
   synth context as sfx.js. No audio files: a soft synthesized piano (walking
   bass, comped chords, light arpeggio), a few hundred bytes of code, offline.
   Progression voicings are in the spirit of the MIT-licensed mood library
   ldrolez/free-midi-chords (https://github.com/ldrolez/free-midi-chords).
   Music-only mute toggle, persisted. Begins on the first user gesture.
   ============================================================================ */
import sfx from './sfx.js';

const LS = 'arline-music';
let enabled = localStorage.getItem(LS) === '1';        // default OFF (looping bg music was too aggressive)
let ctx = null, master = null, timer = null, playing = false;
let nextBar = 0, bar = 0, pianoWave = null;

const BPM = 100, BEATS = 4;
const beat = 60 / BPM;
const barDur = beat * BEATS;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/* chord voicings — [bass MIDI, [upper voices]] */
const V = {
  Cmaj7:[48,[60,64,67,71]], A7:[45,[61,64,67,69]], Dm7:[50,[62,65,69,72]],
  G7:[43,[59,62,65,67]],    Em7:[52,[59,62,64,67]], Fmaj7:[53,[60,64,65,69]],
  Am7:[45,[60,64,67,69]],   D7:[50,[60,62,66,69]],
};
/* A 24-bar JRPG-lounge song in three 8-bar sections, looped: bright → lift → wistful */
const SONG = [
  'Cmaj7','A7','Dm7','G7','Em7','A7','Dm7','G7',
  'Fmaj7','Em7','Dm7','G7','Cmaj7','Am7','Dm7','G7',
  'Am7','Em7','Fmaj7','G7','Am7','D7','Fmaj7','G7',
].map(n => ({ bass:V[n][0], notes:V[n][1] }));

function ensure(){
  ctx = sfx.context(); if(!ctx) return false;
  if(!master){ master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination); }
  if(!pianoWave) makeWave();
  return true;
}
/* A soft synthesized piano: one oscillator carrying a baked-in harmonic
   spectrum, a struck attack + long exponential ring, and a lowpass that closes
   as the note decays (the brightness falloff that makes a piano read as piano). */
function makeWave(){
  const H = [0, 1.0, 0.5, 0.32, 0.2, 0.13, 0.09, 0.06, 0.04];   // harmonic amplitudes
  pianoWave = ctx.createPeriodicWave(new Float32Array(H.length), new Float32Array(H));
}
function voice(freq, start, dur, gain){
  const o = ctx.createOscillator(); o.setPeriodicWave(pianoWave); o.frequency.value = freq;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
  lp.frequency.setValueAtTime(Math.min(freq*7, 7500), start);
  lp.frequency.exponentialRampToValueAtTime(Math.max(freq*2.2, 500), start + Math.min(dur, 0.7));
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.006);           // quick struck attack
  g.gain.exponentialRampToValueAtTime(0.0006, start + dur);      // long ring-out
  o.connect(lp); lp.connect(g); g.connect(master);
  o.start(start); o.stop(start + dur + 0.05);
}
function scheduleBar(i, t){
  const ch = SONG[i % SONG.length];
  const hum = ()=> (Math.random()-0.5)*0.008;                    // tiny timing humanize
  voice(mtof(ch.bass),   t + hum(),          beat*2.4, 0.11);            // left hand: root on 1
  voice(mtof(ch.bass+7), t + beat*2 + hum(), beat*1.8, 0.085);          //            fifth on 3
  ch.notes.forEach((m,k)=> voice(mtof(m), t + 0.01 + k*0.012 + hum(), barDur*1.15, 0.06)); // rolled chord
  for(let b=0;b<BEATS;b++){                                              // light arpeggio over the top
    const m = ch.notes[(b+1) % ch.notes.length] + 12;
    voice(mtof(m), t + b*beat + beat*0.5 + hum(), beat*1.1, 0.045);
  }
}
function sched(){
  if(!ctx) return;
  while(nextBar < ctx.currentTime + 0.25){ scheduleBar(bar, nextBar); nextBar += barDur; bar++; }
}
function start(){
  if(playing || !enabled) return;
  if(!ensure()) return;
  sfx.unlock();
  playing = true; bar = 0; nextBar = ctx.currentTime + 0.18;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), ctx.currentTime);
  master.gain.linearRampToValueAtTime(0.34, ctx.currentTime + 1.6);        // gentle fade-in
  sched();
  timer = setInterval(sched, 30);
}
function stop(){
  playing = false;
  if(timer){ clearInterval(timer); timer = null; }
  if(ctx && master){
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
  }
}
function updateBtn(btn){
  if(!btn) return;
  btn.textContent = enabled ? '♪' : '🔇';
  btn.classList.toggle('off', !enabled);
  btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  btn.title = enabled ? 'Music on' : 'Music off';
}
function toggle(btn){
  enabled = !enabled; localStorage.setItem(LS, enabled ? '1' : '0');
  updateBtn(btn);
  if(enabled) start(); else stop();
}

const btn = document.getElementById('musicToggle');
if(btn){ updateBtn(btn); btn.addEventListener('click', (e)=>{ e.stopPropagation(); toggle(btn); }); }
window.addEventListener('pointerdown', ()=>{ if(enabled) start(); }, { once:true });
document.addEventListener('visibilitychange', ()=>{ if(document.hidden) stop(); else if(enabled) start(); });  // never in the background

export default { start, stop, toggle:()=>toggle(btn), isOn:()=>enabled };
