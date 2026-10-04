// Metronome engine. Clicks are scheduled ahead on the Web Audio clock so the
// beat stays steady even if the screen is busy re-drawing.
import * as audio from './audio.js';
import { tempoBeatsInRep, tempoRepSeconds, tempoPosition } from './logic.js';

const LOOKAHEAD = 0.2; // seconds of audio scheduled in advance
let st = null;
let pumpTimer = null;
let nodes = [];

// Sounds: lowering = low tone, lifting = high tone, pauses = middle tone,
// remaining seconds inside a phase = soft click.
const PHASE_TONE = [523, 698, 880, 698];

function play(freq, ms, t, vol) {
  const o = audio.beepAt(freq, ms, t, vol);
  if (o) {
    nodes.push({ o, t });
    o.onended = () => { nodes = nodes.filter((n) => n.o !== o); };
  }
}

function beatTime(n) {
  if (st.mode === 'beat') return st.t0 + (n * 60) / st.bpm;
  const per = st.beats.length;
  return st.t0 + Math.floor(n / per) * st.repLen + st.beats[n % per].offset;
}

function pump() {
  const ctx = audio.context();
  if (!st || !ctx) return;
  const horizon = ctx.currentTime + LOOKAHEAD;
  while (!st.endAt) {
    const n = st.next;
    if (st.mode === 'tempo' && st.targetReps && Math.floor(n / st.beats.length) >= st.targetReps) {
      st.endAt = st.t0 + st.targetReps * st.repLen;
      play(880, 160, st.endAt, 0.3);
      play(880, 160, st.endAt + 0.22, 0.3);
      play(1175, 380, st.endAt + 0.44, 0.3);
      break;
    }
    const t = beatTime(n);
    if (t > horizon) break;
    if (st.mode === 'beat') {
      play(1000, 50, t, 0.3);
    } else {
      const b = st.beats[n % st.beats.length];
      if (b.first) play(PHASE_TONE[b.phase], b.phase === 0 && b.offset === 0 ? 150 : 110, t, b.offset === 0 ? 0.38 : 0.28);
      else play(1500, 30, t, 0.14);
    }
    st.next++;
  }
}

// opts: { mode: 'tempo'|'beat', secs: [4 numbers], bpm, leadIn (sec), targetReps (0 = keep going) }
export function start(opts) {
  stop();
  const ctx = audio.context();
  if (!ctx) return false;
  const now = ctx.currentTime + 0.08;
  const lead = Math.max(0, Math.round(opts.leadIn || 0));
  st = {
    mode: opts.mode,
    bpm: Math.min(240, Math.max(20, opts.bpm || 60)),
    secs: opts.secs,
    beats: opts.mode === 'tempo' ? tempoBeatsInRep(opts.secs) : null,
    repLen: opts.mode === 'tempo' ? tempoRepSeconds(opts.secs) : 0,
    targetReps: opts.mode === 'tempo' ? opts.targetReps || 0 : 0,
    leadStart: now,
    t0: now + lead,
    next: 0,
    endAt: null,
  };
  // Lead-in: a quiet tick each second so you know it is counting down.
  for (let i = 0; i < lead; i++) play(i >= lead - 3 ? 660 : 440, 90, now + i, i >= lead - 3 ? 0.25 : 0.12);
  pump();
  pumpTimer = setInterval(pump, 25);
  return true;
}

export function stop() {
  clearInterval(pumpTimer);
  pumpTimer = null;
  const ctx = audio.context();
  const now = ctx ? ctx.currentTime : 0;
  // Silence clicks that were already scheduled for the next fraction of a second.
  for (const n of nodes) {
    if (n.t > now) {
      try { n.o.stop(); } catch {}
    }
  }
  nodes = [];
  st = null;
}

export function isRunning() {
  return !!st;
}

// Snapshot for the screen: lead-in countdown, or rep / phase progress.
export function status() {
  const ctx = audio.context();
  if (!st || !ctx) return null;
  const now = ctx.currentTime;
  if (now < st.t0) return { stage: 'lead', leadRemaining: Math.ceil(st.t0 - now) };
  if (st.endAt && now >= st.endAt) return { stage: 'done', rep: st.targetReps };
  const elapsed = now - st.t0;
  if (st.mode === 'beat') {
    return { stage: 'run', mode: 'beat', beat: Math.floor((elapsed * st.bpm) / 60) + 1, bpm: st.bpm };
  }
  const pos = tempoPosition(st.secs, elapsed);
  return { stage: 'run', mode: 'tempo', ...pos, targetReps: st.targetReps, phaseLength: st.secs[pos.phase] };
}
