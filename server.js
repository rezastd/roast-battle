// Debate Arena server: serves the game UI and judges arguments via Jev.
// Zero dependencies; needs Node 20+. Set TYPESAFE_API_KEY for live judging,
// otherwise the demo judge keeps the game playable.

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.js";
import { judgeTurn, judgeMode } from "./judge.js";
import {
  createRoom, joinRoom, startMatch, submitText, setReady, resetRoom, getState,
  getLanUrls, startSweeper, storageMode,
} from "./netplay.js";

const root = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(root, ".env"));
const pub = path.join(root, "public");
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY = 32 * 1024;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": type, "Content-Length": Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function asText(v, max) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

async function readJson(req, res) {
  try {
    return JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { error: "invalid JSON body" });
    return null;
  }
}

async function serveStatic(reqPath, res) {
  const rel = reqPath === "/" ? "index.html" : reqPath.slice(1);
  const file = path.normalize(path.join(pub, rel));
  if (!file.startsWith(pub + path.sep) && file !== path.join(pub, "index.html")) {
    send(res, 403, { error: "forbidden" });
    return;
  }
  try {
    const data = await readFile(file);
    send(res, 200, data.toString("utf8"), TYPES[path.extname(file)] || "application/octet-stream");
  } catch {
    send(res, 404, { error: "not found" });
  }
}

export async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/api/status") {
      send(res, 200, {
        judge: judgeMode(),
        model: judgeMode() === "jev" ? "jev-latest" : "demo-judge",
        storage: storageMode(),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/judge") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        send(res, 400, { error: "invalid JSON body" });
        return;
      }
      const topic = asText(body.topic, 300);
      const argument = asText(body.argument, 4000);
      const speaker = asText(body.speaker, 60) || "Player";
      const opponent = asText(body.opponent, 60) || "Opponent";
      const opponentArgument = asText(body.opponentArgument, 4000);
      const round = Number(body.round) || 1;
      if (!topic || !argument.trim()) {
        send(res, 400, { error: "topic and argument are required" });
        return;
      }
      const result = await judgeTurn({ topic, round, speaker, opponent, opponentArgument, argument });
      send(res, 200, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/network") {
      send(res, 200, { lan: getLanUrls(PORT) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/rooms") {
      const body = await readJson(req, res);
      if (!body) return;
      const name = asText(body.name, 24);
      if (!name.trim()) {
        send(res, 400, { error: "name-required" });
        return;
      }
      const created = await createRoom(name.trim());
      if (created.error) {
        send(res, 503, created);
        return;
      }
      send(res, 200, { code: created.room.code, side: created.side, token: created.token });
      return;
    }

    const roomRoute = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]+)\/(join|start|submit|ready|reset|state)$/);
    if (roomRoute) {
      const [, code, action] = roomRoute;
      if (action === "state" && req.method === "GET") {
        const out = await getState(code, url.searchParams.get("token") || "");
        if (out.error) {
          send(res, out.error === "room-not-found" ? 404 : 403, out);
          return;
        }
        send(res, 200, out);
        return;
      }
      if (req.method === "POST") {
        const body = await readJson(req, res);
        if (!body) return;
        const token = asText(body.token, 64);
        let out;
        let status = 200;
        if (action === "join") {
          out = await joinRoom(code, { name: asText(body.name, 24).trim(), token: token || undefined });
          if (out.error) status = out.error === "room-not-found" ? 404 : 409;
          else out = { side: out.side, token: out.token, resumed: !!out.resumed };
        } else if (action === "start") {
          out = await startMatch(code, token, asText(body.topic, 140));
          if (out.error) status = 400;
          else out = { ok: true };
        } else if (action === "submit") {
          out = await submitText(code, token, asText(body.text, 2000));
          if (out.error) status = out.error === "round-over" ? 409 : 400;
        } else if (action === "ready") {
          out = await setReady(code, token);
          if (out.error) status = 400;
        } else if (action === "reset") {
          out = await resetRoom(code, token);
          if (out.error) status = 400;
          else out = { ok: true };
        }
        send(res, status, out);
        return;
      }
    }

    if (req.method === "GET") {
      await serveStatic(url.pathname, res);
      return;
    }

    send(res, 405, { error: "method not allowed" });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: "internal error" });
  }
}

export function start(port = PORT) {
  const server = http.createServer(handleRequest);
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} is in use. Retry with: PORT=${port + 1} npm start`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(port, () => {
    console.log(`Debate Arena: http://localhost:${port}/  (judge: ${judgeMode()})`);
    for (const u of getLanUrls(port)) console.log(`On your network: ${u}/`);
    startSweeper();
  });
  return server;
}

const runDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (runDirectly) start();
