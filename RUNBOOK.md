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

### Making the session feel alive

If the market feels flat and news is the only thing that visibly moves it, the
cause is usually one of three, in this order:

1. **Market regimes are off.** Settings -> Market mood. Without them every stock
   moves independently, nothing ever falls or recovers together, and the session
   is three hours of stationary noise. With them the market has phases — quiet,
   choppy, selling off, the occasional panic — changing every few minutes, and
   volatility runs higher around the open and into the close. Each stock feels
   the shared move through its own beta, which is the same beta printed on its
   fundamentals card.

2. **Order flow is too weak for a small room.** Per-stock liquidity is
   calibrated for a crowd. With ten or twelve teams the whole room piling into
   one stock moves it barely one percent. Drop the **liquidity multiplier** to
   5000 (half) or 3000, and team trading starts to bite.

3. **Volatility is simply low.** The volatility multiplier is a blunt instrument
   and it works. 15000 to 20000 makes everything livelier.

Defaults give roughly a **20% average swing** across a three-hour session, with
the best stock up about 30% and the worst down about 25%. Preview any settings
before an event without touching the database:

```bash
npx tsx scripts/session-preview.ts 1 10000 6000
```

That prints the regime timeline, the shocks, and the closing spread for
competition 1 at 1.0x volatility and a 6000 market factor.

**Watch the circuit limit.** A 20% limit against a 20% average swing will halt a
lot of stocks. If you turn the chaos up, raise the circuit limit to 30-35% or
you will spend the event pressing Resume.

### What teams have to analyse

Trading is not only about waiting for news. Each stock carries a hidden **drift**
— roughly -5 to +5 basis points a minute — assigned from the competition id and
the symbol, so it is fixed for an event and different in the next one. Nothing
about it is visible directly.

What participants can see is derived from it honestly:

- **60 days of price history** on the chart, before the opening bell. A stock
  that is going to trend up has visibly been trending up.
- **A fundamentals card** — revenue growth, profit margin, P/E, debt to equity,
  beta, 52-week range. Growth and debt track drift closely; beta tracks
  volatility, not quality.
- **An analyst target and rating**, which is drift seen through a cloudier lens:
  right more often than not, wrong often enough to be worth a second opinion.

Simulated over 400 three-hour events, a team that buys the three highest-growth
stocks beats a team picking at random by about **7 percentage points**, and wins
roughly **85% of the time**. So the research pays without making the event a
solved puzzle. Run `npx tsx scripts/signal-sim.ts` to re-check this after any
tuning.

The drift is never sent to the browser. Working it out is the exercise.

### How many stocks to run

Not as many as you think. Team trading is the primary price driver, so the
universe has to be small enough that flow concentrates.

With the 40% concentration cap each team ends up holding roughly 4-6 stocks, so
`teams x 5` is about how many position-slots exist in total. Divide by your
stock count to get the average number of teams holding each name:

- **3 or more teams per stock** — prices move, the market feels alive
- **under 2** — most stocks see no trades at all and just drift on the
  background random walk, and your main price driver quietly stops working

Rule of thumb: **stocks between 1.5x and 2x your team count.**

| Teams | Stocks |
| --- | --- |
| 10-12 | 20-25 |
| 30 | 45-60 |
| 100+ | 60-80 is plenty; more is scroll noise |

Also keep **at least three stocks in every sector**. A sector with one stock
makes sector-wide news arbitrary and gives teams no reason ever to rotate into
it.

### Generated news

You do not have to write headlines during the event. **News -> Generate
storyline** plans a whole session in advance and publishes it on the clock.

What it produces is stories, not one-liners. An arc runs over several minutes —
a rumour, then confirmation or a denial, then the fallout — so acting on the
rumour is a real risk and waiting for certainty costs you the move. Some arcs
are cross-sector, which is what makes the market feel joined up: crude rising
lifts energy and squeezes the car makers in the same breath.

It also reads the market's mood when placing each story, so bad news tends to
land while the market is already selling off and good news during a rally.
Roughly 90% of headlines end up agreeing with the mood, and the session appears
to explain itself.

You keep control:

- **Publish now** fires any queued headline early.
- **Drop** removes one you do not want.
- **Regenerate** rewrites the rest of the schedule and never touches anything
  already published, so it is safe mid-event.
- **Settings -> Publish queued news automatically** turns the clock off entirely
  and leaves you firing each one by hand.
- The composer is still there for anything you want to write yourself.

Nothing queued is visible to teams, and queued headlines move no prices, until
they publish. Impacts are automatically capped below the circuit limit so
generated news never halts a stock on its own.

Preview a session's headlines before the event without touching the database:

```bash
npx tsx scripts/storyline-preview.ts 1 180
```

### Sizing a news event so it does not halt the stock

The circuit breaker halts a stock that moves more than the circuit limit
(default **20%**) from its session open. A news event whose impact is at or above
that limit **will** halt the stock — and teams buying the news push it further in
the same direction, so even 15% against a 20% limit often trips it.

Rules of thumb:

- Keep news impact under **70% of the circuit limit** — so under 14% at the
  default. The composer warns you before you publish either way.
- Want a bigger, more dramatic move? Raise the circuit limit in **Settings**
  first. 40% gives you room for a 25% headline.
- Or split it: two 10% events a few minutes apart read as a developing story and
  give teams a second chance to react.

If it does halt, that is not a bug — it is the safety rail working. Resume it
from the Stocks page.

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
