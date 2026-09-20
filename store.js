// Storage for netplay rooms. Local dev uses memory; Vercel serverless uses
// Upstash Redis (works with Vercel KV integration env vars too), because
// function instances don't share memory. Same interface, selected by env.
import { randomUUID } from "node:crypto";

export function kvEnv() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

export function storageMode() {
  return kvEnv() ? "kv" : "memory";
}

// --- In-memory store (local dev, tests) ---------------------------------------
function createMemoryStore() {
  const data = new Map();
  const tails = new Map(); // lock key -> tail promise (FIFO mutex)
  return {
    mode: "memory",
    async get(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async set(key, value) {
      data.set(key, value);
    },
    async del(...keys) {
      for (const k of keys) data.delete(k);
    },
    // Real mutex: awaits still interleave on one thread, so FIFO-chain them.
    async acquire(key) {
      const prev = tails.get(key) || Promise.resolve();
      let release;
      const mine = new Promise((r) => {
        release = r;
      });
      const tail = prev.then(() => mine);
      tails.set(key, tail);
      await prev;
      let done = false;
      return async () => {
        if (done) return;
        done = true;
        release();
        if (tails.get(key) === tail) tails.delete(key);
      };
    },
    clear() {
      data.clear();
      tails.clear();
    },
  };
}

// --- Upstash Redis store (Vercel). Lazily imports the client so local runs
// never need the dependency installed. -------------------------------------------
function createKvStore() {
  let client = null;
  async function redis() {
    if (!client) {
      const { Redis } = await import("@upstash/redis");
      const env = kvEnv();
      client = new Redis({ url: env.url, token: env.token });
    }
    return client;
  }
  // The client may auto-parse stored JSON; normalize back to a string.
  const asString = (v) => (v === null || v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    mode: "kv",
    async get(key) {
      return asString(await (await redis()).get(key));
    },
    async set(key, value) {
      await (await redis()).set(key, value);
    },
    async del(...keys) {
      if (keys.length) await (await redis()).del(...keys);
    },
    async expire(key, seconds) {
      await (await redis()).expire(key, seconds);
    },
    // Best-effort mutex with expiry so a crashed function can't wedge a room.
    async acquire(lockKey, { tries = 80, waitMs = 75, exSeconds = 60 } = {}) {
      const r = await redis();
      const token = randomUUID();
      for (let i = 0; i < tries; i++) {
        const ok = await r.set(lockKey, token, { nx: true, ex: exSeconds });
        if (ok) {
          return async () => {
            try {
              await r.eval(
                'if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end',
                [lockKey],
                [token],
              );
            } catch {
              try {
                await r.del(lockKey);
              } catch {
                /* lock expires on its own */
              }
            }
          };
        }
        await sleep(waitMs + Math.random() * waitMs);
      }
      return null;
    },
  };
}

export const memoryStore = createMemoryStore();
export const kvStore = createKvStore();

export function getStore() {
  return kvEnv() ? kvStore : memoryStore;
}
