// Lightweight synthesized sound effects via the Web Audio API — no asset files,
// nothing copyrighted. Used on the big screen (display) for countdown beeps,
// reveal stinger, etc. Browsers block audio until a user gesture, so call
// unlockAudio() on the first interaction (e.g. entering fullscreen / a click).
let ctx: AudioContext | null = null;
let enabled = true;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    try { ctx = new Ctor(); } catch { return null; }
  }
  return ctx;
}

export function unlockAudio() {
  const c = ac();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

export function setSoundEnabled(v: boolean) { enabled = v; }
export function isSoundEnabled() { return enabled; }

function tone(freq: number, durMs: number, type: OscillatorType = "sine", gain = 0.07, offset = 0) {
  const c = ac();
  if (!c || !enabled || c.state !== "running") return;
  const t0 = c.currentTime + offset;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + durMs / 1000 + 0.03);
}

export const sound = {
  countdownTick() { tone(660, 160, "square", 0.05); },
  go() { tone(523, 110, "sawtooth", 0.06); tone(784, 320, "sawtooth", 0.07, 0.1); },
  // C–E–G rising arpeggio when the answer is revealed
  reveal() { tone(523, 130, "sine", 0.07); tone(659, 130, "sine", 0.07, 0.12); tone(784, 260, "sine", 0.08, 0.24); },
  tickLow() { tone(440, 70, "square", 0.035); },
  join() { tone(880, 90, "sine", 0.04); },
};
