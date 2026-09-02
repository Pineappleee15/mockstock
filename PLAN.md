# BCX — Architecture Plan

Status: **awaiting approval**. Nothing is built yet.

Target: single Railway container + Postgres. Up to 500 registered teams, 300 concurrent.
Not built for more than that, and the design deliberately exploits the single-instance
assumption where doing so removes complexity.

---

## 0. Decisions locked from your answers

| Question | Decision |
| --- | --- |
| Deploy target | **Railway**, single always-on Node process. Vercel is a documented fallback, §9. |
| Market open/close | **Admin-controlled**, both modes. League windows can be pre-scheduled but the admin switch always wins. |
| Price clock | Advances **only while market state is `open`**. Pause freezes prices. |
| **Primary price driver** | **Team buy/sell order flow.** This is the main thing that moves prices. §3.5 |
| News impact | Secondary. A nudge on top of order flow. Permanent, ramped in over the decay window. |
| Manual override | Persistent level shift. Walk continues from the forced price. |
| Void a trade | Reverses at original fill price; **refused** if it would make cash or holdings negative. |
| Team login | One shared login per team, multiple devices at once — this is why §5.1 exists. |
| Location | `C:\Users\aadit\Downloads\mockstock` |

---

## 1. Stack

- Next.js 15 App Router, TypeScript, React 19
- PostgreSQL 16+ via **Drizzle ORM**
- Tailwind CSS v4
- Recharts
- Server Actions for mutations, Route Handlers for polled reads
- Single Railway service (`next start`), Postgres as a Railway plugin or Neon

### Dependencies beyond the stack (you said "add anything u want")

| Package | Why |
| --- | --- |
| `drizzle-orm`, `drizzle-kit` | ORM + migrations |
| `postgres` | Driver (postgres.js) |
| `@node-rs/argon2` | Password hashing. Not hand-rolling this. |
| `jose` | Signed session cookie. ~40 lines of auth, no framework. |
| `zod` | Input validation on every server action. Load-bearing for correctness reqs #2 and #4. |
| `papaparse` | CSV import and export |
| `clsx`, `tailwind-merge` | Class composition |

Dev-only: `tsx`, `vitest` (price + order engine tests), `dotenv`.
The load test uses built-in `fetch` and `node:worker_threads` — no k6, no artillery.

**Nothing else without asking.** No Redis, no queue, no cron service, no websocket library,
no auth framework, no state library.

### Why Drizzle over Prisma

1. **I need raw SQL and I need it to stay typed.** The order path uses `SELECT … FOR UPDATE`,
   the leaderboard uses `RANK() OVER (…)` with a three-level tiebreak, the ticker uses
   `pg_advisory_xact_lock`. Drizzle keeps SQL fragments typechecked; Prisma's `$queryRaw`
   throws away type safety exactly where I care most.
2. **No codegen step, no query engine binary.** Railway builds stay simple. `prisma generate`
   in the build pipeline is one more thing to break at 11pm before an event.
3. **Explicit transaction control** mapping 1:1 to a real Postgres transaction at an isolation
   level I choose.
4. Migrations are plain `.sql` I can read and, if I have to, run by hand mid-event.

Cost: Prisma Studio is nicer than Drizzle Studio. Acceptable — the admin panel covers it.

---

## 2. Money and arithmetic

**All money is `BIGINT` paise. No floating point anywhere in the money path.**

- Prices, cash, fees, P&L: integer paise (`BIGINT`)
- Rates: integer **basis points**. 0.2% spread = 20 bps, 0.05% brokerage = 5 bps, 40% cap = 4000 bps
- Quantities: `INTEGER`, minimum 1

Floats appear in exactly one place — the price-engine multiplier, whose result is immediately
rounded to integer paise. That rounding is the boundary.

### Rounding rules (fixed, documented, unit-tested)

- Fill price **rounds against the participant**: buy rounds up, sell rounds down. Kills
  rounding-arbitrage loops and keeps the cash invariant clean.
- Brokerage: `ceil(gross × brokerage_bps / 10000)`, minimum 1 paisa on a non-zero trade.
- Average cost: stored in paise with the residual carried, so `avg_cost × qty` reconstructs
  total cost exactly.

**Invariant asserted in tests:**
`cash + Σ(qty × avg_cost) + Σ(brokerage) − Σ(cash adjustments) = starting_cash + realised_pnl`

---

## 3. Price engine

You told me the primary driver is team buying and selling, with news as a secondary nudge.
That inverts the spec's default and it changes the engine, so §3.5 and §3.6 are the two
sections to read carefully.

The engine is a **deterministic recurrence, persisted every tick**.

### 3.1 The two-level model: anchor and market price

Every stock carries two prices.

- **Anchor** — "fundamental value". Moves on a slow seeded random walk plus news events plus
  admin overrides. This is the boring background.
- **Market price** — what teams actually trade at. Pushed away from the anchor by order flow,
  and pulled back toward it over time.

```
anchor_{k+1} = anchor_k × (1 + drift·dt/10000 + sigma·sqrt(dt)·z/10000 + news_k/10000)
gap_{k+1}    = (gap_k × pullback) + impact_k
price_{k+1}  = round( clamp_circuit( anchor_{k+1} × (1 + gap_{k+1}/10000) ) )
```

`gap` is how far order flow has pushed the price from fair value, in bps. `pullback` is a
half-life (default ~90 seconds) that decays the gap back toward zero. A configurable fraction
of each impact (`permanent_impact_pct`, default 30%) is instead folded into the anchor
permanently, so sustained buying genuinely re-rates a stock rather than always mean-reverting.

**Why the pullback exists, and why you want it.** Without it the event breaks in the first
five minutes. Every team starts with 100% cash and has to buy something, so net flow at the
open is structurally, massively positive. Pure order-flow pricing would pump every stock 40–60%
in the opening rush, and after that there is no one left to buy and nothing to do. The anchor
plus decay means the opening rush is a real, tradeable spike that then fades — so buying the
panic and selling the euphoria is the skill the event rewards. This is the single most
important tuning decision in the app and I'd like to rehearse it with you before a live run.

### 3.2 Order flow impact

Per tick, per stock, net signed quantity from trades in the previous tick:

```
impact_bps = impact_coefficient × sign(net) × sqrt(|net| / liquidity)
```

**Square-root impact**, not linear — this is the standard empirical market-impact law, and
practically it stops one team with a big balance from moving a stock 300% in one tick while
still letting a coordinated rush move it hard. `liquidity` is a per-stock parameter (roughly:
shares that must be net-bought in one tick to move it ~1%), so you can make small-caps wild
and large-caps sluggish. Capped at `max_impact_bps` per tick, default 200 (2%).

`sqrt` is safe for determinism — IEEE-754 specifies it exactly.

Every tick's impact is written to `price_adjustments` with the net quantity that caused it, so
after the event you can show teams exactly which of their trades moved which price.

### 3.3 Determinism, done properly

The seeded background walk must be byte-identical on every machine and every replay. That
rules out anything platform-dependent:

- RNG is **counter-based**, not stateful: `hash32(seed, tick_index, stream)` via `Math.imul`
  on 32-bit ints. Identical on every V8 build and OS, no sequence to desync.
- Gaussian is **Irwin–Hall** — sum 12 uniforms, subtract 6. Only `+`, `−`, `/`. Deliberately
  avoids `Math.log`/`exp`/`sin`, which are *not* bit-identical across engines; a 1-ULP
  difference there can flip a paise rounding. Bonus: naturally truncated at ±6σ, so no absurd
  single-tick move.

Note that with order flow as the primary driver, price is a function of **trade history**, so
it is no longer computable from `(seed, start_time, elapsed)` alone. That approach from your
spec is genuinely incompatible with what you've asked for. §3.4 is how I get the same
guarantees anyway.

### 3.4 Persistence is the shared truth

- **Every user sees the same price** because every tick writes one `price_ticks` row and
  everyone reads that row. It isn't an emergent property of two servers agreeing — it's one row.
- **Crash recovery is exact.** If the ticker dies for 60s, on restart it replays the missing
  12 ticks from the last persisted tick plus the persisted adjustment log. No gap in the chart,
  no jump, no lost news event.
- **The event is auditable and replayable** from `(seeds + order log + adjustment log)`.

Replaying an entire 4-hour event for 20 stocks is ~57,600 float ops — under a millisecond.

### 3.5 The ticker

One `setInterval` in the Next.js server process, guarded by
`pg_advisory_xact_lock(competition_id)` so a deploy overlap can't double-tick. Each cycle, in
one transaction:

1. Advance `current_tick` (only if `market_state = 'open'`)
2. Aggregate last tick's net flow per stock → impact
3. Apply due news increments
4. Compute anchor, gap, price; insert one `price_ticks` row per stock
5. Evaluate circuit breakers, auto-halt breaches
6. Every `leaderboard_interval_ticks`, recompute the leaderboard

An overrunning cycle is skipped, not queued — the recurrence catches up by replaying. The loop
polls once a second and ticks only when a whole `tick_interval_seconds` has actually elapsed,
and each tick advances the clock by exactly one interval rather than to "now", so the cadence
does not drift by however long each tick took.

**As built, not as planned:** the ticker is started lazily by `src/lib/boot.ts`, which the
Node-runtime layouts and the market API call, rather than from `instrumentation.ts`. Next
compiles `instrumentation.ts` for the Edge runtime too (because `middleware.ts` exists), and
the Postgres driver needs Node built-ins that Edge does not have — so the build fails there
even though the code is runtime-guarded and would never execute. In practice the ticker starts
the moment anyone loads any page, well before the admin opens the market.

**Halted stocks** still get a tick row at the frozen price with `halted = true`, so the chart
shows a flat line like a real halt. Order flow accumulated during a halt is discarded, not
applied on resume — otherwise un-halting fires a cannon. On un-halt the walk resumes from the
frozen price; there is no invisible path to snap to.

### 3.6 News events

Admin sets headline, stocks, impact %, decay window. The engine converts that into a per-tick
increment schedule over `decay_seconds / tick_interval` ticks on an ease-out curve (hits hard,
then settles), increments summing to exactly the requested impact, applied **to the anchor** so
it is permanent and not decayed away by §3.1's pullback. Each increment is logged as it lands.

Because news moves the anchor and order flow moves the gap, the two compose the way you'd want:
news re-rates the stock, and teams' reaction to the headline is what actually delivers the move.

### 3.7 Circuit breakers

Measured against `session_open_price`, captured per stock when the market first opens (re-captured
at each window open in league mode). Breach of `circuit_limit_bps` either way → `status='halted'`,
audit entry, HALTED everywhere, orders rejected server-side. Admin un-halts; optional re-base of
the session open on un-halt so it isn't instantly re-halted.

With order flow as the primary driver, **circuit breakers stop being decoration and become the
main safety rail.** A 300-team stampede into one stock will hit the limit. Default 20% for event
mode; I'd suggest starting there and watching it in a rehearsal.

---

## 4. Trading

Market orders only. The order path is `validate -> price -> apply`, with validation as an array
of rule functions, so adding limit orders later means adding a resting-order table and a match
step in the ticker, not rewriting this. **Not building that now.**

- Buy fill: `ceil(price * (1 + spread_bps/20000))`
- Sell fill: `floor(price * (1 - spread_bps/20000))`
- Brokerage: `ceil(gross * brokerage_bps / 10000)`, charged on both sides
- Buy needs `cash >= gross + brokerage`; sell needs `holding.qty >= qty`
- Concentration cap checked **post-trade**: `(position value after) / (portfolio value after) <= cap`
  at fill prices. So the first buy cannot exceed 40% of starting cash. A position that drifts past
  40% on a rally is fine, you just cannot add to it.
- Realised P&L on sell: `(fill - avg_cost) * qty`. Brokerage excluded from that figure but still
  deducted from cash, shown separately so teams see what fees cost them.

---

## 5. The seven correctness requirements

### 5.1 Race conditions

Every order runs in one transaction whose **first statement** is `SELECT ... FOR UPDATE` on the
team's `portfolios` row, before reading cash, before the idempotency check, before anything.
Two simultaneous orders from one team serialise: the second blocks, then re-reads cash and
correctly fails.

The lock is one row per team, so teams never contend with each other; 300 teams take 300
independent locks. `portfolios` is deliberately a narrow table separate from `teams` so the lock
covers only mutable financial state.

`READ COMMITTED` is sufficient **because** of the explicit row lock. Not relying on
`SERIALIZABLE` plus retry loops.

Milestone 6's load test fires 200 teams x concurrent duplicate orders at this and asserts no
team ends with negative cash and no team trades more than their cash allowed.

### 5.2 Server-side pricing

The client sends `{ symbol, side, quantity, idempotencyKey }`, the entire payload, enforced by
a zod schema that **strips unknown keys**. The server reads the price from the latest
`price_ticks` row inside the transaction, at fill time. The UI cost preview is advisory and
labelled as such; the confirm modal says the price may move before fill. With order flow driving
prices this warning is not boilerplate, a busy stock will move between preview and fill.

### 5.3 Idempotency

`UNIQUE (team_id, idempotency_key)` on `orders`. The key is a UUID minted when the buy/sell panel
mounts, rotated after a successful fill. Inside the locked transaction the insert uses
`ON CONFLICT DO NOTHING`; on conflict the server returns the **original order's outcome**, so a
double-click shows one confirmation rather than a scary error. Because the portfolio lock comes
first, an in-flight duplicate blocks and then returns the completed result. No window where
both pass.

### 5.4 Server-side state checks

`market_state`, `stock.status`, competition start/end and league window are all re-validated
inside the transaction against the DB. UI hiding a button is cosmetic. Every rejection is
persisted to `orders` with `status='rejected'` and a reason code, so afterwards you can see who
tried to trade a halted stock and when.

### 5.5 Leaderboard caching

The ticker writes `leaderboard_current` (one row per team, upserted, carrying `prev_rank`) every
`leaderboard_interval_ticks`, default 2 ticks / 10s. One SQL statement, ~10k rows aggregated,
comfortably under 50ms at 500 teams.

The API serves that table and **never computes a portfolio on request**. It is additionally held
in a process cache keyed by snapshot tick and served with an ETag, so 300 clients polling every
5s cost roughly **one query per 10 seconds**, not 60 queries per second.

A thin archive row every 5 minutes into `leaderboard_archive` feeds the rank-over-time chart on
the results page. Keeping every 10s snapshot for 500 teams would be 720k rows per event for no
benefit.

### 5.6 Rate limiting

Trailing-60s order count for the team, queried **inside the same transaction while holding the
portfolio lock**. Exact, race-free, no Redis, no in-memory counter that dies with the process.
Default 30/min, per-competition. Rejections logged like any other.

### 5.7 Audit trail

`audit_log` is append-only: every order (filled *and* rejected), admin login, market state change,
news event, override, halt/un-halt, void, cash adjustment, password reset. Server `now()` never
client time, actor type and id, `jsonb` before/after payload.

Enforced by a Postgres trigger that raises on `UPDATE` or `DELETE`, so it cannot be quietly
edited even from a psql session.

---

## 6. Auth

Two roles, no framework. Argon2id hashes. Session is a signed JWT in an httpOnly, sameSite=lax,
secure cookie via `jose`. A `session_version` column on teams and admins invalidates every
existing session when incremented. That is how "reset password" and "kick team" work.

Participants log in with join code and set a password on first login. Admin is bootstrapped by
the seed script from env vars. Admin routes are gated in middleware **and** re-checked in every
admin server action. Middleware alone is not an authorisation boundary.

---

## 7. Reads and polling

300 clients polling every 5s is ~60 rps of reads, nearly all served from a process cache the
ticker refreshes, because there is exactly one process:

| Endpoint | Poll | Source |
| --- | --- | --- |
| `/api/market` | 5s | cache, refreshed each tick |
| `/api/leaderboard` | 5s | cache, refreshed each snapshot |
| `/api/news` | 10s | cache, invalidated on publish |
| `/api/portfolio` | 5s | DB, per team (cannot be shared) |

Only the last hits Postgres per request, a two-table read on indexed keys. All four send
`ETag`/`304`, which matters when 300 people are on college wifi. Charts fetch downsampled,
bucketed tick data rather than every 5s point.

---

## 8. UI

Dark, dense, laptop-first, usable on a phone. Tailwind, no component library.

- Green up / red down, brief flash on change via CSS animation keyed on the value,
  `prefers-reduced-motion` respected
- Market page: table on desktop, cards on mobile
- Buy/sell panel: bottom sheet on mobile, thumb-reachable
- Tabular figures so numbers do not jitter while updating
- News ticker pinned; marquee on desktop, latest headline only on mobile

---

## 9. What would break on serverless

You picked Railway so none of this bites. Recorded in case that changes:

1. **The ticker.** No always-on process, and Vercel Cron's floor is 1 minute, so a 5s tick is
   impossible. Fallback is lazy materialisation on the first request per tick window, which is
   correct but freezes an idle market. With order flow driving prices this is much worse than it
   would have been under the original stateless design: prices would only move when someone looks.
2. **The process read cache.** N lambdas = N caches = N x the DB load, and clients on different
   instances briefly see different snapshots.
3. **Advisory locks through a pooler.** Session-scoped advisory locks are unsafe through PgBouncer
   in transaction mode, so I use `pg_advisory_xact_lock` everywhere. `FOR UPDATE` is unaffected.
4. **Cold starts.** 300 simultaneous logins against cold lambdas on college wifi at the start of
   an event.

**Railway note: set the service to one replica.** The advisory lock stops a second replica
double-ticking, but it doubles the read cache and halves its usefulness.

---

## 10. Milestones

1. Schema, migrations, auth, admin team creation (manual + CSV), competition config
2. Price engine, ticker, charts, live prices page. No trading.
3. Order placement with all seven correctness requirements, positions, trade history
4. Leaderboard, news ticker, admin news events, circuit breakers
5. Admin trade management, CSV exports, final results page
6. Polish, mobile, load test, RUNBOOK.md

I stop after each and tell you exactly what to click.

---

## 11. Open questions

1. **Impact tuning (3.1 and 3.2) is the one thing I cannot get right without you.** Pullback
   half-life, permanent-impact fraction and per-stock liquidity decide whether the event is fun or
   a five-minute pump followed by three hours of nothing. The defaults are my best guess. Plan on
   a rehearsal with 10 fake teams before the real event.
2. Leaderboard snapshots default to 10s while clients poll at 5s, so a client sometimes sees the
   same snapshot twice. Say so and I will lock it to 5s.
3. Can teams see each other's *positions*, or only leaderboard numbers? Defaulting to
   leaderboard-only. With order flow driving prices, showing positions turns the event into
   coordinated squeeze warfare. Fun, but a different game.
