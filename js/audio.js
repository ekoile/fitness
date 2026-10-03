// Timer beeps via Web Audio. iOS only allows audio after a user tap,
// so the context is created/resumed on the first touch.
let ctx = null;

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function installUnlock() {
  const unlock = () => {
    const c = ensure();
    if (!c) return;
    // A silent blip fully unlocks audio on iOS.
    const o = c.createOscillator();
    const g = c.createGain();
    g.gain.value = 0;
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.01);
  };
  document.addEventListener('pointerdown', unlock, { passive: true });
  document.addEventListener('touchend', unlock, { passive: true });
}

function beep(freq, ms, delayMs = 0, vol = 0.25) {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime + delayMs / 1000;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + ms / 1000 + 0.05);
}

export function tick(on) { if (on) beep(660, 120); }
export function go(on) { if (on) beep(990, 350); }
export function done(on) { if (on) { beep(880, 180); beep(880, 180, 230); beep(1175, 400, 460); } }
export function restOver(on) { if (on) { beep(988, 200); beep(1319, 450, 250); } }
