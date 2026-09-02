# MockStock

Paper trading competition platform for running mock stock events at a college
finance cell. Prices are fully simulated and admin-controlled — there is no live
market data anywhere in this app.

Two formats, one codebase, switched by config:

- **Event mode** — a single 2–4 hour session, high volatility, admin pushes news
- **League mode** — several days with scheduled open/close windows

Built for up to 500 registered teams and 300 concurrently active, on one server.

## What makes prices move

Team buying and selling is the primary driver. Each stock carries a slow
"anchor" (fair value, moved by a seeded random walk, news and admin overrides)
and a market price that order flow pushes away from the anchor and that decays
back toward it. See [PLAN.md](PLAN.md) §3 — the pullback half-life is the single
most important thing to tune before a real event.

## Documents

| File | What it is |
| --- | --- |
| [PLAN.md](PLAN.md) | Architecture, the price engine, and how each correctness requirement is met |
| [SCHEMA.md](SCHEMA.md) | Full database schema with the reasoning behind each table |
| [RUNBOOK.md](RUNBOOK.md) | How to set up an event, what to do 30 minutes before, what to do when it breaks |
| [DEPLOY.md](DEPLOY.md) | Getting a public URL on Railway so your team can use it from their phones |

## Quick start

Node and PostgreSQL are vendored into `.tools/`, so nothing is installed
system-wide.

```bash
.tools/pgsql/bin/pg_ctl -D .tools/pgdata -o "-p 5433" -l .tools/pg.log start
npm install
npm run db:push
npx tsx scripts/apply-constraints.ts
npm run db:seed
npm run build && npm run start
```

Admin console: http://localhost:3000/admin/login
Participants: http://localhost:3000/login with a join code printed by the seed script.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run db:seed` | Demo competition: 20 Indian stocks, 10 teams, printable join codes |
| `npm run db:reset` | Wipe all competition data (keeps admin accounts) |
| `npm test` | Unit tests for the price engine and money arithmetic |
| `npx tsx scripts/smoke.ts` | End-to-end check of the engine, orders, news, leaderboard and voids |
| `npm run loadtest -- --teams=200 --rounds=5` | Concurrency test asserting seven correctness invariants |

Stop the server before running `smoke.ts`, or its ticker will advance the same
competition alongside the script.

## Stack

Next.js 15 (App Router) · TypeScript · PostgreSQL via Drizzle · Tailwind v4 ·
Recharts. No Redis, no queue, no websockets, no separate backend service.
