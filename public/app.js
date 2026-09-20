// Debate Arena client: online simultaneous roast battles.
// Home -> lobby -> battle <-> wait -> round -> over. Server is authoritative;
// this client polls room state and renders. Each tab holds its own session.
import { STRINGS, TOPICS, localizeFoul, localizeCrowd } from "./strings.js";

const $ = (id) => document.getElementById(id);
const POLL_MS = 900;
const MIN_CHARS = 20;

// ---- Language ---------------------------------------------------------------
let lang = localStorage.getItem("arena-lang") ||
  ((navigator.language || "").toLowerCase().startsWith("id") ? "id" : "en");
if (!STRINGS[lang]) lang = "en";
const t = (key) => STRINGS[lang][key] ?? key;

function applyLang() {
  document.documentElement.lang = lang === "id" ? "id" : "en";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  $("langEn").classList.toggle("on", lang === "en");
  $("langId").classList.toggle("on", lang === "id");
}

$("langEn").addEventListener("click", () => setLang("en"));
$("langId").addEventListener("click", () => setLang("id"));
function setLang(next) {
  lang = next;
  localStorage.setItem("arena-lang", lang);
  applyLang();
  if (!$("kvWarn").classList.contains("hidden")) $("kvWarn").textContent = t("kvWarn");
  if (lastState) route(lastState, true); // re-render current screen
}

// ---- Session / screens --------------------------------------------------------
let session = null; // { code, token, side, name }
let lastState = null;
let prevPhase = null;
let pollTimer = null;
let log = [];
let battleRound = 0;
let autoSentRound = 0;

try {
  session = JSON.parse(sessionStorage.getItem("arena-session") || "null");
} catch {
  session = null;
}
function saveSession() {
  if (session) sessionStorage.setItem("arena-session", JSON.stringify(session));
  else sessionStorage.removeItem("arena-session");
}

const screens = ["screen-home", "screen-lobby", "screen-battle", "screen-wait", "screen-round", "screen-over"];
let currentScreen = "screen-home";
function show(id) {
  if (id === currentScreen) return; // polls re-render often; never yank scroll/focus
  currentScreen = id;
  for (const s of screens) $(s).classList.toggle("hidden", s !== id);
  const slot = document.querySelector(`#${id} .stage-slot`);
  if (slot && $("stageWrap").parentElement !== slot) slot.appendChild($("stageWrap"));
  if (stage) requestAnimationFrame(() => stage.refresh());
  window.scrollTo(0, 0);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---- 3D stage (lazy, optional) --------------------------------------------------
let stage = null;
let stageReady = null;
function ensureStage() {
  if (!stageReady) {
    stageReady = (async () => {
      try {
        const { initArena } = await import("./arena.js");
        stage = await initArena($("stage"));
      } catch (err) {
        console.warn("3D arena unavailable, using 2D mode:", err);
        $("stageWrap").classList.add("no3d");
        $("stageFallback").classList.remove("hidden");
        stage = null;
      }
      return stage;
    })();
  }
  return stageReady;
}

// ---- API -----------------------------------------------------------------------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || "request-failed"), { data: json });
  return json;
}

function isLocalHost() {
  const h = location.hostname;
  return (
    h === "" || h === "localhost" || h === "[::1]" ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)
  );
}

async function refreshBadge() {
  const badge = $("judgeBadge");
  try {
    const status = await api("/api/status");
    // Memory rooms are fine locally and on LAN (one process) but break
    // across serverless instances — warn on public hosts without KV.
    const warn = status.storage === "memory" && !isLocalHost();
    $("kvWarn").textContent = warn ? t("kvWarn") : "";
    $("kvWarn").classList.toggle("hidden", !warn);
    badge.textContent = status.judge === "jev" ? "Jev key set" : "Demo judge";
    badge.className = status.judge === "jev" ? "badge live" : "badge mock";
    badge.title = status.judge === "jev"
      ? `Key configured for ${status.model}; first judgment confirms it works`
      : "No API key: heuristic demo scoring";
  } catch {
    badge.textContent = "judge unreachable";
    badge.className = "badge";
  }
}

function noteJudgeSource(result) {
  const badge = $("judgeBadge");
  if (!result.mock) {
    badge.textContent = `Jev live · ${result.model || "jev"}`;
    badge.className = "badge live";
    badge.title = "Judged live by Jev";
  } else if (result.jevError) {
    badge.textContent = "Demo judge — Jev unreachable";
    badge.className = "badge mock";
    badge.title = `Key is set but the Jev call failed: ${result.jevError}`;
  }
}

// ---- Home ------------------------------------------------------------------------
async function loadLan() {
  try {
    const net = await api("/api/network");
    $("lanUrl").textContent = net.lan[0] || location.origin;
  } catch {
    $("lanUrl").textContent = location.origin;
  }
}

function showResume() {
  const btn = $("resumeBtn");
  if (session) {
    btn.classList.remove("hidden");
    btn.textContent = `${t("rejoin")} ${session.code} ${t("as")} ${session.name}`;
  } else {
    btn.classList.add("hidden");
  }
}

function homeError(msg) {
  const el = $("homeErr");
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
}

$("createBtn").addEventListener("click", async () => {
  const name = $("name").value.trim();
  if (!name) return homeError(t("errName"));
  homeError("");
  try {
    const out = await api("/api/rooms", { method: "POST", body: JSON.stringify({ name }) });
    session = { code: out.code, token: out.token, side: out.side, name };
    saveSession();
    enterRoom();
  } catch {
    homeError(t("errSend"));
  }
});

$("joinBtn").addEventListener("click", async () => {
  const name = $("name").value.trim();
  const code = $("code").value.trim().toUpperCase();
  if (!name) return homeError(t("errName"));
  if (!code) return homeError(t("errRoom"));
  homeError("");
  try {
    const out = await api(`/api/rooms/${code}/join`, { method: "POST", body: JSON.stringify({ name }) });
    session = { code, token: out.token, side: out.side, name };
    saveSession();
    enterRoom();
  } catch (err) {
    homeError(err.data?.error === "room-full" ? t("errFull") : t("errRoom"));
  }
});

$("resumeBtn").addEventListener("click", async () => {
  if (!session) return;
  homeError("");
  try {
    await api(`/api/rooms/${session.code}/join`, {
      method: "POST",
      body: JSON.stringify({ token: session.token, name: session.name }),
    });
    enterRoom();
  } catch {
    session = null;
    saveSession();
    showResume();
    homeError(t("errRoom"));
  }
});

// ---- Room loop ---------------------------------------------------------------------
function enterRoom() {
  log = [];
  prevPhase = null;
  battleRound = 0;
  show("screen-lobby");
  poll();
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, POLL_MS);
}

function leaveRoom() {
  clearInterval(pollTimer);
  pollTimer = null;
  session = null;
  lastState = null;
  saveSession();
  showResume();
  show("screen-home");
}

$("leaveBtn1").addEventListener("click", leaveRoom);
$("leaveBtn2").addEventListener("click", leaveRoom);

async function poll() {
  if (!session || document.hidden) return;
  try {
    const state = await api(
      `/api/rooms/${session.code}/state?token=${encodeURIComponent(session.token)}`,
    );
    route(state);
  } catch (err) {
    if (err.data?.error === "room-not-found" || err.data?.error === "not-in-room") {
      leaveRoom();
      homeError(t("errRoom"));
    }
    // Transient network hiccups: next poll retries.
  }
}

function route(state, relocalize = false) {
  lastState = state;
  const phase = state.phase;
  if (phase === "lobby") {
    if (!relocalize && (prevPhase === "over" || prevPhase === "roundEnd")) log = [];
    renderLobby(state);
    show("screen-lobby");
  } else if (phase === "battle") {
    // enterBattle resets the textarea: only on a real new round, never on re-render.
    if (state.round !== battleRound && !relocalize) enterBattle(state);
    else updateBattle(state);
  } else if (phase === "roundEnd") {
    if (prevPhase !== "roundEnd" && !relocalize) playRound(state);
    else {
      renderRound(state);
      updateReady(state);
    }
  } else if (phase === "over") {
    if (prevPhase !== "over" && !relocalize) showEnd(state);
    else renderEnd(state);
  }
  if (!relocalize) prevPhase = phase;
}

// ---- Lobby -------------------------------------------------------------------------
$("randomTopic").addEventListener("click", () => {
  const list = TOPICS[lang] || TOPICS.en;
  $("topic").value = list[Math.floor(Math.random() * list.length)];
});

$("copyBtn").addEventListener("click", async () => {
  const base = $("lanUrl").textContent !== "…" ? $("lanUrl").textContent : location.origin;
  const link = `${base}/?room=${session.code}`;
  try {
    await navigator.clipboard.writeText(link);
    $("copyBtn").textContent = t("copied");
    setTimeout(() => {
      $("copyBtn").textContent = t("copyLink");
    }, 1500);
  } catch {
    prompt(link, link);
  }
});

$("startBtn").addEventListener("click", async () => {
  const topic = $("topic").value.trim();
  if (!topic) {
    $("lobbyErr").textContent = t("errTopic");
    $("lobbyErr").classList.remove("hidden");
    return;
  }
  $("lobbyErr").classList.add("hidden");
  try {
    await api(`/api/rooms/${session.code}/start`, {
      method: "POST",
      body: JSON.stringify({ token: session.token, topic }),
    });
    poll();
  } catch {
    $("lobbyErr").textContent = t("errSend");
    $("lobbyErr").classList.remove("hidden");
  }
});

function renderLobby(state) {
  $("roomCode").textContent = session.code;
  const isHost = state.you.side === 0;
  $("hostTopicWrap").classList.toggle("hidden", !isHost);
  $("guestTopic").classList.toggle("hidden", isHost);
  if (!isHost) $("guestTopic").textContent = state.topic || "…";
  $("lobbyPlayers").innerHTML = [0, 1]
    .map((side) => {
      const p = state.players[side];
      const cls = side === 0 ? "red" : "blue";
      const label = side === 0 ? t("redCorner") : t("blueCorner");
      const body = !p
        ? `<span class="dim">${t("waitingJoin")}</span>`
        : `${escapeHtml(p.name)}${p.connected ? "" : ` <span class="dim">(${t("offline")})</span>`}${side === state.you.side ? " ★" : ""}`;
      return `<div class="lobby-player ${cls}"><span class="lp-corner">${label}</span><span>${body}</span></div>`;
    })
    .join("");
  const both = state.players[0] && state.players[1];
  $("startBtn").disabled = !both;
  $("lobbyStatus").textContent = !both
    ? t("needTwo")
    : isHost
      ? ""
      : t("guestWaits");
}

// ---- Battle (simultaneous) --------------------------------------------------------------
function hpHtml(state) {
  return state.hp
    .map((hp, i) => {
      const side = i === 0 ? "red" : "blue";
      const name = state.players[i]?.name || "?";
      return `<div class="hp ${side}">
        <div class="name">${escapeHtml(name)}</div>
        <div class="track"><div class="fill" style="width:${Math.max(0, hp)}%"></div></div>
        <div class="num">${Math.max(0, hp)} HP</div>
      </div>`;
    })
    .join("");
}

function renderHp(state) {
  const html = hpHtml(state);
  for (const id of ["hpbar", "hpbarWait", "hpbar2", "finalHp"]) $(id).innerHTML = html;
}

let localHp = [100, 100];
function renderLocalHp(state) {
  const html = localHp
    .map((hp, i) => {
      const side = i === 0 ? "red" : "blue";
      const name = state.players[i]?.name || "?";
      return `<div class="hp ${side}">
        <div class="name">${escapeHtml(name)}</div>
        <div class="track"><div class="fill" style="width:${Math.max(0, hp)}%"></div></div>
        <div class="num">${Math.max(0, hp)} HP</div>
      </div>`;
    })
    .join("");
  for (const id of ["hpbar", "hpbarWait", "hpbar2", "finalHp"]) $(id).innerHTML = html;
}

function enterBattle(state) {
  battleRound = state.round;
  localHp = [...state.hp];
  $("argument").value = "";
  if (stage) stage.resetStance();
  updateBattle(state);
}

function updateBattle(state) {
  // Runs on every poll: only touches text/status nodes, never the textarea.
  $("battleTitle").textContent = `${t("round")} ${state.round}`;
  $("battleTopic").textContent = state.topic;
  $("argLabel").textContent = t("yourRoast");
  const opp = 1 - state.you.side;
  const last = state.lastArgs[opp];
  $("oppBox").classList.toggle("hidden", !last);
  if (last) {
    $("oppTitle").textContent = `${state.players[opp]?.name || ""} ${t("opponentLast")}`;
    $("oppText").textContent = last;
  }
  renderLocalHp(state);
  $("oppStatus").textContent = state.submitted[opp] ? t("oppSubmitted") : t("oppTyping");
  const dc = state.players[opp] && !state.players[opp].connected;
  $("dcBanner").textContent = dc ? t("disconnected") : "";
  $("dcBanner").classList.toggle("hidden", !dc);
  if (state.submitted[state.you.side]) {
    $("waitTitle").textContent = state.submitted[opp] ? t("scoring") : t("submittedWait");
    $("waitSub").textContent = state.submitted[opp] ? t("scoringSub") : "";
    show("screen-wait");
  } else {
    show("screen-battle");
  }
  tickTimer(state);
}

function tickTimer(state) {
  const left = Math.max(0, Math.round((state.deadline - Date.now()) / 1000));
  const el = $("timer");
  el.textContent = left;
  el.classList.toggle("low", left <= 10);
  if (left <= 0 && state.round !== autoSentRound && !state.submitted[state.you.side]) {
    autoSentRound = state.round;
    submitArgument(true);
  }
}
setInterval(() => {
  if (lastState && lastState.phase === "battle") tickTimer(lastState);
}, 500);

let submitting = false;
async function submitArgument(auto) {
  if (submitting || !session) return;
  const text = $("argument").value.trim();
  if (!auto && text.length < MIN_CHARS) return;
  submitting = true;
  try {
    await api(`/api/rooms/${session.code}/submit`, {
      method: "POST",
      body: JSON.stringify({ token: session.token, text: text || "(…)" }),
    });
  } catch {
    // 409 round-over etc: next poll reconciles.
  } finally {
    submitting = false;
    poll();
  }
}
$("submitBtn").addEventListener("click", () => submitArgument(false));

// ---- Round result ------------------------------------------------------------------
const DIM_LABELS = { wit: "Wit", logic: "Logic", savagery: "Savagery", relevance: "Relevance" };

function scoreCard(side, state, result) {
  const cls = side === 0 ? "red" : "blue";
  const name = state.players[side]?.name || "?";
  const dims = Object.entries(result.breakdown || {})
    .map(([key, d]) => {
      const pct = Math.round((d.value / 4) * 100);
      return `<div class="dim">
        <div class="row"><span>${DIM_LABELS[key] || key}</span><span>${d.value.toFixed(1)} / 4</span></div>
        <div class="track"><div class="fill" style="width:${pct}%"></div></div>
      </div>`;
    })
    .join("");
  const fouls = (result.fouls || [])
    .map((f) => `<span class="foul">${escapeHtml(localizeFoul(f, lang))}</span>`)
    .join("");
  return `<div class="score-card ${cls}">
    <h3>${escapeHtml(name)}</h3>
    <p class="dmg">${result.damage} <small>${t("dmg")} · ${escapeHtml(result.attack?.label || "")}</small></p>
    ${dims}
    <div>${fouls}</div>
    <p class="crowd-line">${t("crowd")}: <b>${escapeHtml(localizeCrowd(result.crowd, lang))}</b>${result.mock ? ` · ${t("demo")}` : ""}</p>
    <p class="roast-text">“${escapeHtml(result.argument || "")}”</p>
  </div>`;
}

function renderRound(state) {
  const [r0, r1] = state.results;
  const winner = r0.damage === r1.damage ? -1 : r0.damage > r1.damage ? 0 : 1;
  $("roundTitle").textContent = winner === -1
    ? `${t("round")} ${state.round} — ${t("deadEven")}`
    : `${t("round")} ${state.round} — ${state.players[winner].name} ${t("takesIt")}`;
  $("suddenBanner").textContent = state.suddenDeath ? t("suddenDeath") : "";
  $("suddenBanner").classList.toggle("hidden", !state.suddenDeath);
  $("roundCards").innerHTML = scoreCard(0, state, r0) + scoreCard(1, state, r1);
  renderLocalHp(state);
  show("screen-round");
}

async function playRound(state) {
  const [r0, r1] = state.results;
  renderRound(state);
  noteJudgeSource(r0.mock && r1.mock ? { mock: true } : { mock: false, model: "jev-latest" });
  log.push(
    `${t("roundLog")} ${state.round}: ${state.players[0].name} ${r0.damage} — ${r1.damage} ${state.players[1].name}`,
  );

  const readyBtn = $("readyBtn");
  readyBtn.disabled = true;
  readyBtn.textContent = "…";
  $("readyStatus").textContent = "";
  $("skipBtn").classList.add("hidden");

  const live = await ensureStage();
  if (live) {
    live.resetStance();
    $("skipBtn").classList.remove("hidden");
    $("skipBtn").onclick = () => live.skip();
    // Simultaneous exchange: both blasts fly at once.
    await Promise.all([
      live.attack(0, r0.attack, {
        onImpact: () => {
          localHp[1] = Math.max(0, localHp[1] - r0.damage);
          renderLocalHp(state);
        },
      }),
      live.attack(1, r1.attack, {
        onImpact: () => {
          localHp[0] = Math.max(0, localHp[0] - r1.damage);
          renderLocalHp(state);
        },
      }),
    ]);
    $("skipBtn").classList.add("hidden");
    $("skipBtn").onclick = null;
    for (let side = 0; side < 2; side++) {
      if (localHp[side] <= 0) await live.knockout(side);
    }
  } else {
    localHp[1] = Math.max(0, localHp[1] - r0.damage);
    localHp[0] = Math.max(0, localHp[0] - r1.damage);
    renderLocalHp(state);
  }
  updateReady(lastState && lastState.phase === "roundEnd" ? lastState : state);
}

function updateReady(state) {
  if (!state || state.phase !== "roundEnd") return;
  const me = state.you.side;
  const readyBtn = $("readyBtn");
  readyBtn.disabled = state.ready[me];
  readyBtn.textContent = state.ready[me] ? t("readyWaiting") : `${t("readyBtn")} — ${t("readyNext")} ${state.round + 1}`;
  const opp = 1 - me;
  $("readyStatus").textContent = state.ready[opp]
    ? (state.ready[me] ? t("bothReady") : "")
    : (state.ready[me] ? t("readyWaiting") : "");
}

$("readyBtn").addEventListener("click", async () => {
  if (!session) return;
  try {
    await api(`/api/rooms/${session.code}/ready`, {
      method: "POST",
      body: JSON.stringify({ token: session.token }),
    });
    poll();
  } catch {
    poll();
  }
});

// ---- Match end -----------------------------------------------------------------------
function renderEnd(state) {
  const w = state.winner;
  const name = state.players[w.side]?.name || "?";
  $("winnerName").textContent = name;
  $("winMethod").textContent = t("knockout");
  localHp = [...state.hp];
  renderLocalHp(state);
  $("matchLog").innerHTML = log.map((l) => `<div>${escapeHtml(l)}</div>`).join("");
  const isHost = state.you.side === 0;
  $("hostRematchWrap").classList.toggle("hidden", !isHost);
  $("guestRematchWait").classList.toggle("hidden", isHost);
  show("screen-over");
}

function showEnd(state) {
  renderEnd(state);
  const w = state.winner;
  if (stage) {
    (async () => {
      await stage.knockout(1 - w.side);
      await stage.celebrate(w.side);
    })();
  }
}

$("rematchBtn").addEventListener("click", async () => {
  if (!session) return;
  try {
    await api(`/api/rooms/${session.code}/reset`, {
      method: "POST",
      body: JSON.stringify({ token: session.token }),
    });
    poll();
  } catch {
    poll();
  }
});

// ---- Boot ------------------------------------------------------------------------------
applyLang();
refreshBadge();
ensureStage();
loadLan();
showResume();
{
  const params = new URLSearchParams(location.search);
  const room = (params.get("room") || "").toUpperCase();
  if (room) $("code").value = room;
  const stored = localStorage.getItem("arena-name");
  if (stored) $("name").value = stored;
}
$("name").addEventListener("change", (e) => localStorage.setItem("arena-name", e.target.value));
