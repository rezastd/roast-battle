// Netplay: LAN + online multiplayer rooms for simultaneous roast battles.
// Server is authoritative: HP, phases, deadlines and judging all live here.
// Rooms persist in a store (memory locally, Redis on Vercel); every mutation
// runs under a per-room lock so concurrent polls can't corrupt a match.
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { judgeTurn, judgeMode } from "./judge.js";
import { attackFor } from "./public/fight.js";
import { getStore, memoryStore } from "./store.js";

export const ROUND_SECONDS = 60;
const SUDDEN_DEATH_HP = 25;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ROOM_TTL_MS = 30 * 60 * 1000;
const AWAY_MS = 12000;
const JUDGING_STALE_MS = 90 * 1000;
const FORFEIT = "(no argument — time expired)";

let store = getStore();
export function setStore(s) {
  store = s;
}
export function storageMode() {
  return store.mode;
}

const roomKey = (code) => `arena:room:${code}`;
const subKey = (code, side) => `arena:sub:${code}:${side}`;
const lockKey = (code) => `arena:lock:${code}`;
const knownCodes = new Set();

export async function loadRoom(code) {
  code = String(code || "").toUpperCase();
  let room = null;
  try {
    const raw = await store.get(roomKey(code));
    if (raw) room = JSON.parse(raw);
  } catch {
    room = null;
  }
  if (!room) return null;
  if (Date.now() - room.lastActivity > ROOM_TTL_MS) {
    await store.del(roomKey(code), subKey(code, 0), subKey(code, 1));
    knownCodes.delete(code);
    return null;
  }
  return room;
}

export async function saveRoom(room) {
  room.lastActivity = Date.now();
  knownCodes.add(room.code);
  await store.set(roomKey(room.code), JSON.stringify(room));
  await store.expire?.(roomKey(room.code), 45 * 60);
}

function blankMatch() {
  return {
    phase: "lobby", // lobby | battle | roundEnd | over
    round: 0,
    hp: [100, 100],
    submitted: [false, false],
    results: null,
    ready: [false, false],
    deadline: 0,
    judging: false,
    judgingAt: 0,
    suddenDeath: false,
    winner: null,
    lastArgs: ["", ""],
  };
}

async function withRoom(code, fn) {
  code = String(code || "").toUpperCase();
  const release = await store.acquire(lockKey(code));
  if (!release) return { error: "busy" };
  try {
    const room = await loadRoom(code);
    const out = await fn(room);
    if (room && !out?.roomDeleted) await saveRoom(room);
    return out;
  } finally {
    await release();
  }
}

function touch(room, player) {
  player.connected = true;
  player.lastSeen = Date.now();
}

function authed(room, token) {
  const side = room.players.findIndex((p) => p && p.token === token);
  if (side < 0) return null;
  touch(room, room.players[side]);
  return side;
}

function refreshPresence(room) {
  const now = Date.now();
  for (const p of room.players) {
    if (p && now - p.lastSeen > AWAY_MS) p.connected = false;
  }
}

function judgingFresh(room) {
  return room.judging && Date.now() - room.judgingAt < JUDGING_STALE_MS;
}

export async function createRoom(name) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = Array.from(
      { length: 4 },
      () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)],
    ).join("");
    const release = await store.acquire(lockKey(code));
    if (!release) continue;
    try {
      if (await loadRoom(code)) continue; // collision: try another
      const room = {
        code,
        topic: "",
        players: [{ name, token: randomUUID(), connected: true, lastSeen: Date.now() }, null],
        lastActivity: Date.now(),
        ...blankMatch(),
      };
      await saveRoom(room);
      return { room, side: 0, token: room.players[0].token };
    } finally {
      await release();
    }
  }
  return { error: "busy" };
}

export async function joinRoom(code, { name, token } = {}) {
  return withRoom(code, async (room) => {
    if (!room) return { error: "room-not-found" };
    refreshPresence(room);
    if (token) {
      const side = room.players.findIndex((p) => p && p.token === token);
      if (side >= 0) {
        touch(room, room.players[side]);
        return { side, token, resumed: true };
      }
    }
    const free = room.players.findIndex((p) => !p || !p.connected);
    if (free < 0 || !name) return { error: "room-full" };
    const player = { name: name.slice(0, 24), token: randomUUID(), connected: true, lastSeen: Date.now() };
    room.players[free] = player;
    return { side: free, token: player.token };
  });
}

export async function startMatch(code, token, topic) {
  return withRoom(code, async (room) => {
    if (!room) return { error: "room-not-found" };
    const side = authed(room, token);
    if (side === null) return { error: "not-in-room" };
    if (side !== 0) return { error: "host-only" };
    if (room.phase !== "lobby") return { error: "already-started" };
    if (!room.players[0] || !room.players[1]) return { error: "need-two" };
    if (!topic || !topic.trim()) return { error: "need-topic" };
    Object.assign(room, blankMatch(), {
      phase: "battle",
      round: 1,
      topic: topic.slice(0, 140),
      deadline: Date.now() + ROUND_SECONDS * 1000,
    });
    return { ok: true };
  });
}

async function finalizeLocked(room) {
  if (room.phase !== "battle") return room.results;
  room.judging = true;
  room.judgingAt = Date.now();
  await saveRoom(room); // publish the flag before the slow Jev calls
  const subs = [
    (await store.get(subKey(room.code, 0))) || FORFEIT,
    (await store.get(subKey(room.code, 1))) || FORFEIT,
  ];
  const names = [room.players[0]?.name || "Red", room.players[1]?.name || "Blue"];
  try {
    const judged = await Promise.all([
      judgeTurn({
        topic: room.topic, round: room.round, speaker: names[0], opponent: names[1],
        opponentArgument: room.lastArgs[1], argument: subs[0],
      }),
      judgeTurn({
        topic: room.topic, round: room.round, speaker: names[1], opponent: names[0],
        opponentArgument: room.lastArgs[0], argument: subs[1],
      }),
    ]);
    room.results = judged.map((j, i) => ({
      damage: j.damage,
      breakdown: j.breakdown,
      fouls: j.fouls,
      crowd: j.crowd,
      mock: j.mock,
      argument: subs[i],
      attack: attackFor(j),
    }));
    room.hp[1] = Math.max(0, room.hp[1] - room.results[0].damage);
    room.hp[0] = Math.max(0, room.hp[0] - room.results[1].damage);
    room.lastArgs = subs;
    room.suddenDeath = false;
    await store.del(subKey(room.code, 0), subKey(room.code, 1));

    if (room.hp[0] <= 0 && room.hp[1] <= 0) {
      // Double KO: sudden death, both revived — the fight never draws.
      room.hp = [SUDDEN_DEATH_HP, SUDDEN_DEATH_HP];
      room.suddenDeath = true;
      room.phase = "roundEnd";
    } else if (room.hp[0] <= 0 || room.hp[1] <= 0) {
      room.winner = { side: room.hp[0] <= 0 ? 1 : 0, method: "knockout" };
      room.phase = "over";
    } else {
      room.phase = "roundEnd";
    }
    return room.results;
  } finally {
    room.judging = false;
  }
}

export async function submitText(code, token, text) {
  return withRoom(code, async (room) => {
    if (!room) return { error: "room-not-found" };
    const side = authed(room, token);
    if (side === null) return { error: "not-in-room" };
    if (room.phase !== "battle") return { error: "round-over" };
    await store.set(subKey(room.code, side), String(text || "").slice(0, 2000).trim() || FORFEIT);
    room.submitted[side] = true;
    if (room.submitted[0] && room.submitted[1] && !judgingFresh(room)) {
      await finalizeLocked(room);
      return { results: room.results, suddenDeath: room.suddenDeath };
    }
    return { waiting: true };
  });
}

export async function setReady(code, token) {
  return withRoom(code, async (room) => {
    if (!room) return { error: "room-not-found" };
    const side = authed(room, token);
    if (side === null) return { error: "not-in-room" };
    if (room.phase !== "roundEnd") return { error: "not-ready-phase" };
    room.ready[side] = true;
    if (room.ready[0] && room.ready[1]) {
      room.round += 1;
      room.submitted = [false, false];
      room.results = null;
      room.ready = [false, false];
      room.phase = "battle";
      room.deadline = Date.now() + ROUND_SECONDS * 1000;
    }
    return { ready: room.ready };
  });
}

export async function resetRoom(code, token) {
  return withRoom(code, async (room) => {
    if (!room) return { error: "room-not-found" };
    const side = authed(room, token);
    if (side === null) return { error: "not-in-room" };
    if (side !== 0) return { error: "host-only" };
    Object.assign(room, blankMatch());
    await store.del(subKey(room.code, 0), subKey(room.code, 1));
    return { ok: true };
  });
}

export async function getState(code, token) {
  return withRoom(code, async (room) => {
    if (!room) return { error: "room-not-found" };
    const side = authed(room, token);
    if (side === null) return { error: "not-in-room" };
    refreshPresence(room);
    // Server-side deadline: finalize even if both fighters stall.
    if (room.phase === "battle" && Date.now() > room.deadline && !judgingFresh(room)) {
      await finalizeLocked(room);
    }
    return {
      phase: room.phase,
      round: room.round,
      topic: room.topic,
      hp: [...room.hp],
      deadline: room.deadline,
      serverNow: Date.now(),
      suddenDeath: room.suddenDeath,
      you: { side, name: room.players[side].name },
      players: room.players.map((p) => (p ? { name: p.name, connected: p.connected } : null)),
      submitted: [...room.submitted],
      lastArgs: [...room.lastArgs],
      results: room.results,
      ready: [...room.ready],
      winner: room.winner,
      judge: judgeMode(),
    };
  });
}

export function getLanUrls(port) {
  const urls = [];
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === "IPv4" && !i.internal) urls.push(`http://${i.address}:${port}`);
    }
  }
  return urls;
}

export async function sweepRooms(now = Date.now()) {
  for (const code of [...knownCodes]) {
    const room = await loadRoom(code);
    if (!room || now - room.lastActivity > ROOM_TTL_MS) {
      await store.del(roomKey(code), subKey(code, 0), subKey(code, 1));
      knownCodes.delete(code);
    }
  }
}

let sweeping = false;
export function startSweeper() {
  if (sweeping) return;
  sweeping = true;
  const t = setInterval(() => sweepRooms().catch(() => {}), 60 * 1000);
  t.unref?.();
}

export function clearRooms() {
  knownCodes.clear();
  memoryStore.clear();
}
