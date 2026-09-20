// Procedural sound effects: Web Audio oscillators + filtered noise.
// No audio files. The context starts lazily on first user gesture
// (autoplay policy); every sound is a safe no-op when muted/failing.
function storedMuted() {
  try {
    return localStorage.getItem("arena-muted") === "1";
  } catch {
    return false;
  }
}

let ctx = null;
let master = null;
let muted = storedMuted();

export function isMuted() {
  return muted;
}

export function setMuted(m) {
  muted = !!m;
  try {
    localStorage.setItem("arena-muted", muted ? "1" : "0");
  } catch {
    /* private mode: session-only */
  }
  if (master && ctx) master.gain.setValueAtTime(muted ? 0 : 0.9, ctx.currentTime);
}

function ac() {
  if (muted || typeof window === "undefined") return null;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = ctx || new AC();
    if (ctx.state === "suspended") void ctx.resume();
    if (!master) {
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    return ctx;
  } catch {
    return null;
  }
}

if (typeof window !== "undefined") {
  for (const ev of ["pointerdown", "keydown"]) {
    window.addEventListener(ev, () => ac(), { once: true });
  }
}

function tone({ f0 = 440, f1 = null, dur = 0.15, type = "sine", vol = 0.4, delay = 0 }) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(1, f0), t);
  if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise({ dur = 0.3, vol = 0.4, f0 = 1000, f1 = null, type = "lowpass", delay = 0 }) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const flt = c.createBiquadFilter();
  flt.type = type;
  flt.frequency.setValueAtTime(Math.max(10, f0), t);
  if (f1) flt.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt);
  flt.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

export const sfx = {
  click() {
    tone({ f0: 660, dur: 0.06, type: "square", vol: 0.12 });
  },
  throwIt() {
    noise({ dur: 0.25, vol: 0.3, f0: 400, f1: 4000, type: "bandpass" });
  },
  charge(power = 0.5) {
    tone({ f0: 180, f1: 600 + power * 500, dur: 0.45, type: "sawtooth", vol: 0.1 });
  },
  ball(power = 0.5) {
    tone({ f0: 900, f1: 200, dur: 0.35, type: "sawtooth", vol: 0.2 });
    noise({ dur: 0.3, vol: 0.15 + power * 0.15, f0: 800, f1: 3000 });
  },
  beam() {
    tone({ f0: 120, f1: 85, dur: 0.65, type: "sawtooth", vol: 0.3 });
    noise({ dur: 0.65, vol: 0.25, f0: 200, f1: 5000, type: "highpass" });
  },
  fizzle() {
    tone({ f0: 500, f1: 120, dur: 0.4, type: "sine", vol: 0.22 });
  },
  impact(power = 0.5) {
    const v = 0.25 + power * 0.45;
    tone({ f0: 70, f1: 35, dur: 0.4, type: "sine", vol: v });
    noise({ dur: 0.3 + power * 0.25, vol: v, f0: 3000, f1: 200 });
  },
  bell() {
    tone({ f0: 880, dur: 0.5, type: "triangle", vol: 0.28 });
    tone({ f0: 1320, dur: 0.4, type: "triangle", vol: 0.16, delay: 0.02 });
    tone({ f0: 660, dur: 0.6, type: "triangle", vol: 0.22, delay: 0.18 });
  },
  fanfare() {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone({ f0: f, dur: 0.22, type: "triangle", vol: 0.26, delay: i * 0.11 }),
    );
  },
  tick() {
    tone({ f0: 1200, dur: 0.04, type: "square", vol: 0.1 });
  },
};
