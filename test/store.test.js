
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { memoryStore, kvStore, getStore, kvEnv } from "../store.js";

describe("memory store", () => {
  beforeEach(() => memoryStore.clear());

  it("gets, sets and deletes", async () => {
    assert.equal(await memoryStore.get("k"), null);
    await memoryStore.set("k", "v");
    assert.equal(await memoryStore.get("k"), "v");
    await memoryStore.del("k");
    assert.equal(await memoryStore.get("k"), null);
  });

  it("serializes concurrent lock holders", async () => {
    const order = [];
    const job = async (name) => {
      const release = await memoryStore.acquire("lock");
      order.push(`${name}-in`);
      await new Promise((r) => setTimeout(r, 10));
      order.push(`${name}-out`);
      await release();
    };
    await Promise.all([job("a"), job("b"), job("c")]);
    assert.deepEqual(order, ["a-in", "a-out", "b-in", "b-out", "c-in", "c-out"]);
  });
});

describe("store selection", () => {
  it("selects the store by env vars", () => {
    assert.equal(getStore(), kvEnv() ? kvStore : memoryStore);
    assert.notEqual(kvStore, memoryStore);
  });
});
