
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearRooms, createRoom, joinRoom, startMatch, submitText,
  setReady, resetRoom, getState, sweepRooms, getLanUrls,
  loadRoom, saveRoom, setStore,
} from "../netplay.js";
import { memoryStore } from "../store.js";

beforeEach(() => {
  setStore(memoryStore);
  clearRooms();
});

async function fullRoom() {
  const c = await createRoom("Ruby");
  const j = await joinRoom(c.room.code, { name: "Blake" });
  return { code: c.room.code, host: c.token, guest: j.token };
}

async function startedRoom() {
  const r = await fullRoom();
  const out = await startMatch(r.code, r.host, "Pineapple on pizza");
  assert.equal(out.error, undefined);
  return r;
}

const ROASTS = [
  "Pineapple on pizza is a crime against cheese! Sweet and savory had a meeting and pineapple was NOT invited.",
  "Oh please, your taste is so bland that water files a complaint after you drink it, you absolute clown!",
  "My opponent's arguments are like their haircut: tragic, uneven, and nobody asked for it. Burn!",
  "You call that a roast? I've seen spicier mayonnaise. Sit down and let the adults debate!",
];

describe("rooms", () => {
  it("creates and joins a room", async () => {
    const { code, host, guest } = await fullRoom();
    assert.match(code, /^[A-Z2-9]{4}$/);
    assert.ok(host && guest && host !== guest);
    const room = await loadRoom(code);
    assert.equal(room.players.length, 2);
  });

  it("rejects unknown rooms and full rooms", async () => {
    assert.equal((await joinRoom("ZZZZ", { name: "X" })).error, "room-not-found");
    const { code } = await fullRoom();
    assert.equal((await joinRoom(code, { name: "Third" })).error, "room-full");
  });

  it("resumes a disconnected player via token", async () => {
    const { code, host } = await fullRoom();
    const room = await loadRoom(code);
    room.players[0].connected = false;
    room.players[0].lastSeen = Date.now() - 60000;
    await saveRoom(room);
    const out = await joinRoom(code, { token: host });
    assert.equal(out.resumed, true);
    assert.equal(out.side, 0);
  });

  it("only the host can start, with two players and a topic", async () => {
    const solo = await createRoom("Ruby");
    assert.equal((await startMatch(solo.room.code, solo.token, "T")).error, "need-two");
    const { code, host, guest } = await fullRoom();
    assert.equal((await startMatch(code, guest, "T")).error, "host-only");
    assert.equal((await startMatch(code, host, " ")).error, "need-topic");
    const ok = await startMatch(code, host, "Pineapple?");
    assert.equal(ok.error, undefined);
    const room = await loadRoom(code);
    assert.equal(room.phase, "battle");
    assert.equal(room.round, 1);
  });
});

describe("simultaneous battle", () => {
  it("judges when both submit and returns attack specs", async () => {
    const { code, host, guest } = await startedRoom();
    const first = await submitText(code, host, ROASTS[0]);
    assert.equal(first.waiting, true);
    const second = await submitText(code, guest, ROASTS[1]);
    assert.ok(second.results);
    assert.equal(second.results.length, 2);
    for (const r of second.results) {
      assert.ok(Number.isInteger(r.damage) && r.damage >= 1);
      assert.ok(["beam", "ball", "fizzle"].includes(r.attack.kind));
      assert.ok(r.argument.length > 0);
    }
    const state = await getState(code, host);
    assert.equal(state.phase, "roundEnd");
    assert.ok(state.hp[0] < 100 || state.hp[1] < 100);
  });

  it("handles truly simultaneous submits with a single finalize", async () => {
    const { code, host, guest } = await startedRoom();
    const [a, b] = await Promise.all([
      submitText(code, host, ROASTS[0]),
      submitText(code, guest, ROASTS[1]),
    ]);
    const withResults = [a, b].filter((r) => r.results);
    assert.equal(withResults.length, 1);
    assert.ok(withResults[0].results[0].argument.includes("Pineapple"));
    assert.ok(withResults[0].results[1].argument.includes("bland"));
    const state = await getState(code, host);
    assert.equal(state.phase, "roundEnd");
  });

  it("rejects submits after the round ends", async () => {
    const { code, host, guest } = await startedRoom();
    await submitText(code, host, ROASTS[0]);
    await submitText(code, guest, ROASTS[1]);
    assert.equal((await submitText(code, host, "again")).error, "round-over");
  });

  it("advances when both ready up", async () => {
    const { code, host, guest } = await startedRoom();
    await submitText(code, host, ROASTS[0]);
    await submitText(code, guest, ROASTS[1]);
    await setReady(code, host);
    let state = await getState(code, host);
    assert.equal(state.phase, "roundEnd");
    await setReady(code, guest);
    state = await getState(code, host);
    assert.equal(state.phase, "battle");
    assert.equal(state.round, 2);
    assert.deepEqual(state.submitted, [false, false]);
  });

  it("auto-finalizes on deadline with forfeit text", async () => {
    const { code, host } = await startedRoom();
    await submitText(code, host, ROASTS[0]);
    const room = await loadRoom(code);
    room.deadline = Date.now() - 1;
    await saveRoom(room);
    const state = await getState(code, host);
    assert.equal(state.phase, "roundEnd");
    assert.match(state.results[1].argument, /time expired/);
  });

  it("fights until KO with no decision", async () => {
    const { code, host, guest } = await startedRoom();
    let state = await getState(code, host);
    let rounds = 0;
    while (state.phase !== "over" && rounds < 25) {
      await submitText(code, host, `${ROASTS[rounds % 4]} (round ${rounds} host!)`);
      await submitText(code, guest, `${ROASTS[(rounds + 2) % 4]} (round ${rounds} guest!)`);
      state = await getState(code, host);
      rounds++;
      if (state.phase === "roundEnd") {
        await setReady(code, host);
        await setReady(code, guest);
        state = await getState(code, host);
      }
    }
    assert.equal(state.phase, "over");
    assert.ok([0, 1].includes(state.winner.side));
    assert.equal(state.winner.method, "knockout");
  });

  it("resets to lobby for a rematch", async () => {
    const { code, host, guest } = await startedRoom();
    await submitText(code, host, ROASTS[0]);
    await submitText(code, guest, ROASTS[1]);
    assert.equal((await resetRoom(code, guest)).error, "host-only");
    await resetRoom(code, host);
    const state = await getState(code, host);
    assert.equal(state.phase, "lobby");
    assert.deepEqual(state.hp, [100, 100]);
  });
});

describe("housekeeping", () => {
  it("sweeps stale rooms only", async () => {
    const a = await createRoom("A");
    const b = await createRoom("B");
    const roomA = await loadRoom(a.room.code);
    roomA.lastActivity = Date.now() - 31 * 60 * 1000;
    await saveRoom(roomA);
    // saveRoom refreshes lastActivity, so age it directly in the store instead
    roomA.lastActivity = Date.now() - 31 * 60 * 1000;
    await memoryStore.set(`arena:room:${a.room.code}`, JSON.stringify(roomA));
    await sweepRooms();
    assert.equal(await loadRoom(a.room.code), null);
    assert.ok(await loadRoom(b.room.code));
  });

  it("lists LAN urls without throwing", () => {
    assert.ok(Array.isArray(getLanUrls(3000)));
  });
});
