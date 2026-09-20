# Debate Arena — Roast Battle

A 2-player online roast battle judged live by **Jev** (TypeSafe's System One model).
Both fighters roast **at the same time** — no turns — and Jev scores every
argument on wit, logic, savagery and relevance. Damage drains HP; the fight
goes until **KO**. Double KO triggers sudden death (both revived at 25 HP).

In English or Bahasa Indonesia — toggle EN/ID in the header. Jev judges both
languages the same.

## Run it

```sh
cd debate-arena
npm start
```

Then open http://localhost:3000/ in a browser. No install step, no dependencies.

Friends on the same Wi-Fi join at the network URL printed on startup
(also shown on the home screen), then enter your 4-letter room code.
Two tabs in one browser also work for a solo test drive.

To use another port: `PORT=3101 npm start`.

## Deploy to Vercel

Live at https://roast-battle-rezast.vercel.app (project `rezast/roast-battle`).

The repo root is the app root (`package.json`, `public/`, `server.js`), so
**Root Directory stays blank**. With the repo connected (Settings → Git),
pushes to `main` auto-deploy to production. From a checkout you can also run
`vercel --prod` directly.

First-time setup from scratch:

1. `vercel login`, then from this directory: `vercel link`, `vercel --prod`.
2. Add a Redis store (required for online rooms — serverless instances don't
   share memory). Either:
   - Vercel dashboard → **Storage → Create → KV**, connect it to the project
     (adds `KV_REST_API_URL` / `KV_REST_API_TOKEN` automatically), or
   - Create a free Redis at Upstash and add `UPSTASH_REDIS_REST_URL` /
     `UPSTASH_REDIS_REST_TOKEN` as project env vars.
3. Add `TYPESAFE_API_KEY` as a project env var for live Jev judging
   (without it, the demo judge runs).
4. Redeploy. Play at the production URL — no LAN needed.

Local runs always use in-memory rooms (right for one process) and never
need `npm install` — even with KV vars in `.env`. Only real exported KV env
vars switch storage to Redis (Vercel sets those from its dashboard).

## Live Jev judging

Without a key the game runs on a clearly-labeled demo judge (heuristics).
For real judging, get a key from the TypeSafe dashboard and put it in
`debate-arena/.env` (already git-ignored):

```sh
TYPESAFE_API_KEY=your-key
```

A real environment variable wins over `.env`, so
`TYPESAFE_API_KEY=your-key npm start` still works too.

## How it works

- `server.js` — Node server: static UI + room API. Also Vercel's server
  entrypoint (default export), so local and deployed run the same code.
- `netplay.js` — rooms (create/join/rejoin), simultaneous rounds,
  server-side deadlines, ready-ups, KO/sudden-death. Polled over plain HTTP.
  Every mutation runs under a per-room lock; stale locks/finalizes recover.
- `store.js` — room storage: in-memory locally, Upstash Redis on Vercel
  (selected by env vars; the client is lazily imported).
- `judge.js` — one System One call per argument with 8 parallel questions:
  4 × `Score` (wit, logic, savagery, relevance), 3 × `Noul`
  (crossed_line, dodged, low_effort), 1 × `Choice` (crowd reaction).
  Damage is a composite computed in code. Low mean confidence halves damage
  ("split crowd"). Arguments may be English or Indonesian.
- `public/` — the game UI (home → lobby → battle → round → KO verdict).
- `public/fight.js` — pure mapping from Jev judgment to attack
  (`beam` / `ball` / `fizzle`, scaled by damage; fouls fizzle out).
- `public/strings.js` — EN/ID strings, topics, foul/crowd localization.
- `public/arena.js` — three.js 3D stage (pinned CDN import; if it or WebGL
  is unavailable the game falls back to 2D mode automatically).

## Rules

- 100 HP each, 60 seconds to roast, both at once.
- Your opponent's text stays hidden until both have thrown.
- Fouls (crossing the line, dodging, low effort) cut your damage.
- Fight until KO. Double KO means sudden death, never a draw.
