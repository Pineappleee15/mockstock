# MockStock Runbook

Everything you need to run an event, in the order you will need it.
Keep this open on a second screen during the competition.

---

## 0. One-time setup

### Local development

Node and PostgreSQL are vendored into `.tools/` so nothing is installed system-wide.

```bash
.tools/pgsql/bin/pg_ctl -D .tools/pgdata -o "-p 5433" -l .tools/pg.log start
npm install
npm run db:push
npx tsx scripts/apply-constraints.ts
npm run db:seed
npm run build
npm run start
```

Open http://localhost:3000/admin/login and sign in with the credentials in `.env.local`.

Stop the database with `.tools/pgsql/bin/pg_ctl -D .tools/pgdata stop`.

### Deploying to Railway

1. Push the repo, create a Railway service from it, add the Postgres plugin.
2. Set environment variables:
   - `DATABASE_URL` from the Postgres plugin
   - `SESSION_SECRET` — 32+ random characters, **not** the dev value
   - `ADMIN_USERNAME`, `ADMIN_PASSWORD` — used once by the seed script
   - `TICKER_ENABLED=true`
3. **Set replicas to 1.** The advisory lock stops a second replica double-ticking,
   but it halves the effectiveness of the in-process read cache.
4. After the first deploy, run once from the Railway shell:
   `npm run db:push && npx tsx scripts/apply-constraints.ts && npm run db:seed`

---

## 1. Setting up a competition

1. **Settings** — name, starting cash, brokerage, spread, concentration cap, rate
   limit, circuit limit, tick interval, volatility multiplier.
2. **Stocks** — paste a CSV. Only `symbol,name,starting_price` are required.
3. **Teams** — paste one team per line, or a CSV. Join codes are generated automatically.
4. **Teams -> Join codes -> Copy all** — paste into a slide. Codes avoid `0/O` and
   `1/I` so they read cleanly off a projector.

### Sizing `liquidity` — the number people get wrong

`liquidity` is how many shares must be net-bought in one tick to move a stock about 1%.
It is what decides whether team trading actually moves prices.

Rule of thumb: pick a rupee notional of **teams x starting cash x 0.2**, then
`liquidity = notional_in_paise / price_in_paise`. The CSV importer does this for you
when you leave the column blank, but it assumes a 10-team demo.

| Teams | Notional to use |
| --- | --- |
| 10-20 (the seeded default) | Rs 20 lakh |
| 100 | Rs 2 crore |
| 300 | Rs 6 crore |

For a 10-20 team event the seeded defaults are already right. Leave them alone.

Too low and a handful of teams move a stock 20% and trip the circuit breaker in the
first minute. Too high and trading feels inert and the event is just a random walk.

---

## 2. Thirty minutes before an event

Ordered by how badly each item hurts if you skip it.

- [ ] **Run a dry run first.** Not optional the first time. See section 3.
- [ ] `npm run db:reset && npm run db:seed` if the dry run left data behind, then
      re-import your real stocks and teams. **Check the team list is the real one**
      and contains no `Load Test` rows.
- [ ] Confirm the admin dashboard's **Before you open** checklist is all ticks.
- [ ] Confirm **Order flow: ON** and the impact settings match what you rehearsed with.
- [ ] Confirm starting cash, brokerage, spread and concentration cap on **Settings**.
- [ ] Open the app on a phone on the venue wifi, not just your laptop. Sign in as a
      real team, place one trade, then void it from **Trades**.
- [ ] Project the join codes. Have a printed copy too.
- [ ] Queue your news events as text in a document, ready to paste. During the event
      you will not want to be composing prose.
- [ ] Decide who is on the admin console. One person. Not three.
- [ ] Check the server is up and the tick counter is **not** advancing (market closed).

At the start:

1. **Control -> Open market.** This captures every stock's session open price (the
   circuit-breaker reference) and publishes tick 0.
2. Watch the tick counter advance on the admin dashboard. If it does not, see section 4.

---

## 3. The dry run

Do this at least once, days before, with fake teams.

```bash
npm run db:seed
npm run loadtest -- --teams=50 --rounds=10
```

The load test asserts seven invariants: no negative cash, no negative holdings, no
double-fills from duplicate idempotency keys, exact money reconciliation, correct trade
counters, and that no team ever spent more than it had. It cleans up its own teams
afterwards unless you pass `--keep`.

Then run a **human** dry run: get five to ten people to trade for twenty minutes while
you push news events. Watch for:

- **Does the opening rush pump everything?** If prices run away in the first two
  minutes, lower the impact coefficient or shorten the pullback half-life.
- **Does trading feel inert?** Raise the impact coefficient, or lower `liquidity`.
- **Do circuit breakers fire constantly?** Raise the circuit limit, or raise `liquidity`.
- **Does a news event produce a visible, tradeable move?** If not, raise the impact percent.

Write down the numbers that felt right and set them in Settings before the real event.

---

## 4. When something goes wrong mid-event

### Prices have stopped moving

Check the tick counter on the admin dashboard.

1. Is the market **paused** or **closed**? Pausing freezes prices by design — the price
   clock only advances while the market is open. Resume it.
2. Is the counter frozen while the state says open? The ticker has died. **Restart the
   server.** On restart it replays every missed tick from the last persisted one, so
   there is no gap in the charts and no lost news event. Nothing is lost by restarting.
3. Still stuck? Check the server logs for `[ticker] cycle failed`.

### One stock shows HALTED

It hit its circuit limit. **Stocks -> Resume** un-halts it and re-bases the circuit
reference to the current price, so it will not immediately re-halt. If stocks keep
halting, raise the circuit limit in Settings.

### A team says their trade did not go through

1. **Trades**, filter by their team name. If the trade is there it went through and they
   are looking at a stale screen — tell them to reload.
2. If it is not there, the order was rejected, and every rejection is recorded with a
   reason. Common ones: `INSUFFICIENT_CASH`, `CONCENTRATION_CAP` (over the single-stock
   cap), `RATE_LIMITED` (more than 30 orders a minute), `STOCK_HALTED`.

### A team says they were charged twice

They were not. Duplicate submissions are deduplicated by idempotency key, and the load
test proves it. Show them **Trades** filtered to their team. If there genuinely are two
fills, they clicked twice with a long enough gap to be two real orders — void one from
**Trades** with a reason.

### A team's balance is wrong

**Teams -> Cash** adjusts it. The reason is mandatory and lands in the audit log. Prefer
voiding the offending trade over adjusting cash, so the P&L stays honest.

### Voiding a trade is refused

Voiding is refused when the reversal would push cash or holdings negative — the team has
already spent the proceeds or sold the shares on. Adjust their cash instead, with a
reason explaining why.

### The whole thing is on fire

**Control -> Pause.** Prices and trading both freeze immediately. Nothing is lost. Fix
the problem, then Resume. Resuming does not replay the paused minutes.

### A team is cheating or being disruptive

**Teams -> Disable.** They cannot sign in or trade, and any open session is signed out
immediately.

---

## 5. Ending the event

1. **Control -> End competition.** The leaderboard freezes and `/results` becomes final.
2. **Exports** — download all four CSVs before you touch anything else: trades,
   standings, price history, audit log.
3. Show `/results` on the projector.

Keep the database. The whole event is reconstructible from it, and the price history
export is genuinely interesting to walk through afterwards — you can show participants
which of their own trades moved which price.

---

## 6. Things worth knowing

- **Pausing freezes prices.** The price clock only advances while the market is open.
- **Restarting the server is safe.** Missed ticks are replayed exactly from the
  persisted state plus the adjustment log.
- **The client never sends a price.** Every fill is priced by the server at fill time.
- **Every rejection is logged**, so "the app would not let me trade" is always answerable.
- **The audit log cannot be edited**, not even from a psql session — a database trigger
  blocks UPDATE and DELETE on it.
