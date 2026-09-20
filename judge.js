// Jev judging for Roast Battle: one System One call, eight parallel questions.
// Scores measure craft, Nouls catch fouls, a Choice reads the crowd.
// Code owns damage math and weights; the model supplies semantic judgment.

const API_URL = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
const TIMEOUT_MS = 20000;

export function judgeMode() {
  return hasKey() ? "jev" : "mock";
}

function hasKey() {
  return !!(process.env.TYPESAFE_API_KEY && process.env.TYPESAFE_API_KEY.trim());
}

// Roasts may be written in English or Bahasa Indonesia — judge both the same.
const LANG_NOTE =
  " The argument may be written in English or Bahasa Indonesia; judge both languages exactly the same.";

function buildQuestions() {
  const questions = {
    wit: {
      type: "score",
      instructions:
        "How funny is the speaker's argument (`argument`)? Judge the humor on its own merit, in the context of the debate topic.",
      criteria: [
        "Flat: no humor attempted, or jokes fall completely flat",
        "Mildly amusing: a smile at best, forgettable lines",
        "Genuinely funny: solid punchlines the crowd enjoys",
        "Hilarious: crowd-roaring lines with great timing",
        "Legendary: instant-classic roast material",
      ],
    },
    logic: {
      type: "score",
      instructions:
        "How strong is the reasoning in the speaker's argument (`argument`)? A roast battle still rewards a real point.",
      criteria: [
        "Incoherent or nonsensical",
        "Weak: mostly vibes, little real reasoning",
        "Decent: a real point with some support",
        "Strong: tight reasoning that is hard to refute",
        "Devastating: airtight and undeniable",
      ],
    },
    savagery: {
      type: "score",
      instructions:
        "How savage is the roast in the speaker's argument (`argument`)? Sporting brutality scores high; genuinely hateful content does not (that is judged separately).",
      criteria: [
        "Gentle: no sting at all",
        "Playful jab: light teasing",
        "Sharp: stings but stays sporting",
        "Brutal: leaves a mark",
        "Nuclear: career-ending heat, still within the bounds of a roast",
      ],
    },
    relevance: {
      type: "score",
      instructions:
        "How well does the speaker's argument (`argument`) stay on the debate topic (`topic`) and engage the opponent's argument (`opponent_argument`) when one is provided?",
      criteria: [
        "Off-topic: ignores the topic and the opponent",
        "Loosely connected: drifts away from the point",
        "On-topic: addresses the debate",
        "Direct rebuttal: engages the opponent's points",
        "Surgical: dismantles the opponent's exact claims",
      ],
    },
    crossed_line: {
      type: "noul",
      instructions:
        "Does the speaker's argument (`argument`) cross the line from playful roasting into genuinely hateful content: slurs, attacks on protected characteristics, threats of real violence, or cruelty about tragedy or trauma?",
      criteria: {
        true: "Contains hateful content, slurs, threats, or cruelty about tragedy or trauma",
        false: "Sporting roast, even if brutal; no hateful content",
      },
    },
    dodged: {
      type: "noul",
      instructions:
        "Does the speaker dodge or ignore the opponent's argument instead of engaging it? If `opponent_argument` is empty, answer no.",
      criteria: {
        true: "Ignores or dodges the opponent's points to change the subject",
        false: "Engages the opponent's argument, or there is no opponent argument yet",
      },
    },
    low_effort: {
      type: "noul",
      instructions:
        "Is the speaker's argument (`argument`) low-effort: a few filler words, a copy of the topic, or no real attempt at an argument?",
      criteria: {
        true: "Filler, near-empty, or no real attempt",
        false: "A genuine attempt at an argument",
      },
    },
    crowd: {
      type: "choice",
      instructions: "How does the roast-battle crowd react to the speaker's argument (`argument`)?",
      criteria: {
        cheers: "The crowd loves it: loud cheers and applause",
        oohs: "The crowd feels the burn: impressed oohs and gasps",
        crickets: "The crowd is unmoved: awkward silence",
        boos: "The crowd turns: boos for a foul, cringe, or crossed line",
      },
    },
  };
  for (const q of Object.values(questions)) q.instructions += LANG_NOTE;
  return questions;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

// Composite scoring lives in code: weights below are game balance, not model output.
const WEIGHTS = { wit: 0.3, logic: 0.25, savagery: 0.25, relevance: 0.2 };
const MAX_SCORE = 4;
const BASE_DAMAGE = 32;

export function computeDamage(answers) {
  const dims = ["wit", "logic", "savagery", "relevance"].map((key) => {
    const a = answers?.[key] ?? {};
    const value = Number.isFinite(a.score) ? Math.min(MAX_SCORE, Math.max(0, a.score)) : 0;
    return { key, value, confidence: clamp01(a.confidence ?? 0) };
  });

  let base = 0;
  for (const d of dims) base += (d.value / MAX_SCORE) * WEIGHTS[d.key];
  base *= BASE_DAMAGE;

  const nouls = {
    crossed_line: clamp01(answers?.crossed_line?.noul),
    dodged: clamp01(answers?.dodged?.noul),
    low_effort: clamp01(answers?.low_effort?.noul),
  };

  const fouls = [];
  let multiplier = 1;
  if (nouls.crossed_line >= 0.7) {
    multiplier *= 0.5;
    fouls.push("FOUL — crossed the line");
  }
  if (nouls.dodged >= 0.7) {
    multiplier *= 0.75;
    fouls.push("DODGED the rebuttal");
  }
  if (nouls.low_effort >= 0.7) {
    multiplier *= 0.5;
    fouls.push("LOW EFFORT");
  }

  const confidences = [...dims.map((d) => d.confidence), clamp01(answers?.crowd?.confidence)];
  const meanConfidence = confidences.reduce((s, c) => s + c, 0) / confidences.length;
  if (meanConfidence < 0.35) {
    multiplier *= 0.5;
    fouls.push("SPLIT CROWD — Jev unsure");
  }

  return {
    damage: Math.max(1, Math.round(base * multiplier)),
    breakdown: Object.fromEntries(
      dims.map((d) => [d.key, { value: +d.value.toFixed(2), confidence: +d.confidence.toFixed(2) }]),
    ),
    nouls: Object.fromEntries(Object.entries(nouls).map(([k, v]) => [k, +v.toFixed(2)])),
    fouls,
    crowd: answers?.crowd?.choice ?? "crickets",
    crowdConfidence: +clamp01(answers?.crowd?.confidence).toFixed(2),
    meanConfidence: +meanConfidence.toFixed(2),
  };
}

async function callJev(state) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TYPESAFE_API_KEY.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state, model: MODEL, questions: buildQuestions() }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`TypeSafe ${res.status}: ${text.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Demo fallback: same answer shape, heuristic scores, honestly labeled mock:true.
function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mockJudge({ argument, opponentArgument }) {
  const text = argument || "";
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const bangs = (text.match(/[!?]+/g) || []).length;
  const capsRatio = (text.match(/[A-Z]/g) || []).length / Math.max(1, text.length);
  const burnWords = (text.toLowerCase().match(/\b(burn|roast|destroy|wreck|clown|embarrass|pathetic|weak|laugh|joke)\b/g) || []).length;
  const rnd = mulberry32(hashSeed(text));

  const pick = (base, spread) =>
    Math.min(MAX_SCORE, Math.max(0, +(base + (rnd() - 0.5) * spread).toFixed(2)));
  const lengthFactor = Math.min(1, words / 60);

  const answers = {
    wit: { score: pick(1 + bangs * 0.4 + burnWords * 0.3 + lengthFactor, 1.2), confidence: 0.5 },
    logic: { score: pick(0.8 + lengthFactor * 2, 1.2), confidence: 0.5 },
    savagery: { score: pick(0.8 + capsRatio * 8 + burnWords * 0.4, 1.2), confidence: 0.5 },
    relevance: { score: pick(1.5 + (opponentArgument ? 1 : 0.3) + lengthFactor, 1.0), confidence: 0.5 },
    crossed_line: { noul: 0.02 },
    dodged: { noul: opponentArgument && words < 12 ? 0.8 : 0.1 },
    low_effort: { noul: words < 8 ? 0.9 : words < 20 ? 0.4 : 0.05 },
    crowd: {
      choice: words < 8 ? "crickets" : bangs >= 2 ? "oohs" : "cheers",
      confidence: 0.45,
    },
  };
  return { mock: true, model: "demo-judge", answers, ...computeDamage(answers) };
}

export async function judgeTurn({ topic, round, speaker, opponent, opponentArgument, argument }) {
  if (!hasKey()) return mockJudge({ argument, opponentArgument });
  const state = {
    topic,
    round,
    speaker,
    opponent,
    opponent_argument: opponentArgument || "",
    argument,
  };
  try {
    const response = await callJev(state);
    return {
      mock: false,
      model: response.model || MODEL,
      usage: response.usage,
      answers: response.answers,
      ...computeDamage(response.answers),
    };
  } catch (err) {
    console.error("Jev call failed, using demo judge:", err.message);
    return {
      ...mockJudge({ argument, opponentArgument }),
      jevError: String(err.message || err).slice(0, 200),
    };
  }
}
