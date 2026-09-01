# MockStock — Database Schema

Postgres 16+. Written as SQL for clarity; the actual source of truth will be
`src/db/schema.ts` (Drizzle), with generated migrations in `drizzle/`.

## Conventions

- **All money is `BIGINT` paise.** No `numeric`, no `float`, anywhere in the money path.
- **All rates are `INTEGER` basis points.** 0.2% = 20, 0.05% = 5, 40% = 4000.
- Every table that belongs to a competition carries `competition_id` and cascades on delete,
  so wiping a test event is one statement.
- `id` is `BIGSERIAL` except where a natural key is better.
- Timestamps are `TIMESTAMPTZ NOT NULL DEFAULT now()` and are always **server** time.

## Enums

```sql
CREATE TYPE market_mode      AS ENUM ('event', 'league');
CREATE TYPE market_state     AS ENUM ('draft','pre_open','open','paused','closed','ended');
CREATE TYPE stock_status     AS ENUM ('active','halted');
CREATE TYPE order_side       AS ENUM ('buy','sell');
CREATE TYPE order_status     AS ENUM ('filled','rejected');
CREATE TYPE adjustment_kind  AS ENUM ('news','order_flow','override');
CREATE TYPE actor_type       AS ENUM ('admin','team','system');
```

---

## 1. Identity

```sql
CREATE TABLE admins (
  id              BIGSERIAL PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,              -- argon2id
  display_name    TEXT NOT NULL,
  session_version INTEGER NOT NULL DEFAULT 1, -- bump to invalidate all sessions
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

```sql
CREATE TABLE teams (
  id                BIGSERIAL PRIMARY KEY,
  competition_id    BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  members           TEXT NOT NULL DEFAULT '',   -- free text, comma separated
  join_code         TEXT NOT NULL,              -- what they type to log in
  password_hash     TEXT,                       -- NULL until first login
  must_set_password BOOLEAN NOT NULL DEFAULT true,
  is_disabled       BOOLEAN NOT NULL DEFAULT false,
  session_version   INTEGER NOT NULL DEFAULT 1,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (competition_id, name),
  UNIQUE (join_code)          -- globally unique so login needs no competition picker
);
```

`join_code` is globally unique on purpose: a participant types only a code, so it has to
identify the team unambiguously across every competition ever run. Generated as 6 characters
from an unambiguous alphabet (no `0/O`, no `1/I/l`) because people read these off a projector.

---

## 2. Competition and market state

```sql
CREATE TABLE competitions (
  id                        BIGSERIAL PRIMARY KEY,
  name                      TEXT NOT NULL,
  mode                      market_mode  NOT NULL,
  state                     market_state NOT NULL DEFAULT 'draft',

  starting_cash_paise       BIGINT  NOT NULL DEFAULT 100000000,  -- 10,00,000
  brokerage_bps             INTEGER NOT NULL DEFAULT 5,          -- 0.05%
  spread_bps                INTEGER NOT NULL DEFAULT 20,         -- 0.20%
  concentration_cap_bps     INTEGER NOT NULL DEFAULT 4000,       -- 40%
  order_rate_limit_per_min  INTEGER NOT NULL DEFAULT 30,
  circuit_limit_bps         INTEGER NOT NULL DEFAULT 2000,       -- 20% from session open

  tick_interval_seconds     INTEGER NOT NULL DEFAULT 5,
  volatility_multiplier_bps INTEGER NOT NULL DEFAULT 10000,      -- 10000 = 1.0x
  leaderboard_every_n_ticks INTEGER NOT NULL DEFAULT 2,

  -- order flow impact (PLAN.md 3.1-3.2) -- the primary price driver
  order_flow_enabled        BOOLEAN NOT NULL DEFAULT true,
  impact_coefficient_bps    INTEGER NOT NULL DEFAULT 100,   -- bps per sqrt(liquidity unit)
  max_impact_bps_per_tick   INTEGER NOT NULL DEFAULT 200,   -- clamp, 2%
  gap_halflife_seconds      INTEGER NOT NULL DEFAULT 90,    -- pullback toward anchor
  permanent_impact_bps      INTEGER NOT NULL DEFAULT 3000,  -- 30% of impact re-rates anchor

  current_tick              INTEGER NOT NULL DEFAULT 0,
  last_tick_at              TIMESTAMPTZ,
  session_opened_at         TIMESTAMPTZ,   -- when session open prices were captured
  starts_at                 TIMESTAMPTZ,
  ends_at                   TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX one_live_competition
  ON competitions ((state IN ('pre_open','open','paused')))
  WHERE state IN ('pre_open','open','paused');
```

That partial unique index enforces **at most one live competition at a time**, which is the
assumption the in-process ticker and cache are built on. Past competitions stay in the table
for the results pages.

`current_tick` is the clock. It advances only while `state = 'open'`, which is what makes pause
freeze prices without any extra machinery.

```sql
CREATE TABLE market_windows (         -- league mode scheduled sessions
  id             BIGSERIAL PRIMARY KEY,
  competition_id BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  opens_at       TIMESTAMPTZ NOT NULL,
  closes_at      TIMESTAMPTZ NOT NULL,
  rebase_session_open BOOLEAN NOT NULL DEFAULT true,  -- reset circuit reference each day
  CHECK (closes_at > opens_at)
);
CREATE INDEX ON market_windows (competition_id, opens_at);
```

Windows are advisory: the ticker opens and closes the market on schedule, but an admin action
always wins and is recorded in `audit_log`.

---

## 3. Stocks and prices

```sql
CREATE TABLE stocks (
  id                      BIGSERIAL PRIMARY KEY,
  competition_id          BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  symbol                  TEXT NOT NULL,
  name                    TEXT NOT NULL,
  sector                  TEXT NOT NULL,

  starting_price_paise    BIGINT  NOT NULL CHECK (starting_price_paise > 0),
  volatility_bps          INTEGER NOT NULL DEFAULT 30,   -- expected move per MINUTE
  drift_bps               INTEGER NOT NULL DEFAULT 0,    -- per minute
  liquidity               INTEGER NOT NULL DEFAULT 500,  -- shares/tick to move ~1%
  circuit_limit_bps       INTEGER,                       -- NULL = inherit competition

  status                  stock_status NOT NULL DEFAULT 'active',
  halted_at               TIMESTAMPTZ,
  halt_reason             TEXT,
  seed                    INTEGER NOT NULL,              -- RNG stream id

  session_open_paise      BIGINT,   -- circuit breaker reference, set at market open
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (competition_id, symbol)
);
```

`volatility_bps` is deliberately **per minute, not per tick**, so changing the tick interval
does not change how dramatic the event feels. `liquidity` is the per-stock knob for order-flow
impact: low liquidity = small-cap that teams can move hard.

CSV import columns: `symbol, name, sector, starting_price, volatility_bps, liquidity, drift_bps`
(last three optional, defaulted).

```sql
CREATE TABLE price_ticks (
  competition_id  BIGINT  NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  stock_id        BIGINT  NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  tick_index      INTEGER NOT NULL,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now(),

  price_paise     BIGINT  NOT NULL,   -- what teams trade at
  anchor_paise    BIGINT  NOT NULL,   -- fundamental value  (PLAN.md 3.1)
  gap_bps         INTEGER NOT NULL,   -- order-flow displacement from anchor
  net_qty         INTEGER NOT NULL DEFAULT 0,  -- signed volume that produced this tick
  halted          BOOLEAN NOT NULL DEFAULT false,

  PRIMARY KEY (stock_id, tick_index)
);
CREATE INDEX price_ticks_snapshot ON price_ticks (competition_id, tick_index);
```

PK `(stock_id, tick_index)` serves the chart query (`WHERE stock_id = ? ORDER BY tick_index`);
the secondary index serves the whole-market snapshot (`WHERE competition_id = ? AND tick_index = ?`).

Storing `anchor`, `gap` and `net_qty` alongside the price is what makes the post-event
explanation possible: for any candle you can say how much was fundamentals, how much was news,
and how much was teams piling in. Volume for a 4-hour event with 20 stocks is ~57,600 rows.

```sql
CREATE TABLE price_adjustments (
  id             BIGSERIAL PRIMARY KEY,
  competition_id BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  stock_id       BIGINT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  tick_index     INTEGER NOT NULL,
  kind           adjustment_kind NOT NULL,
  delta_bps      INTEGER,          -- news / order_flow
  target_paise   BIGINT,           -- override only
  news_event_id  BIGINT REFERENCES news_events(id) ON DELETE SET NULL,
  net_qty        INTEGER,          -- order_flow only
  reason         TEXT,             -- mandatory for override
  actor_type     actor_type NOT NULL DEFAULT 'system',
  actor_id       BIGINT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON price_adjustments (competition_id, tick_index);
CREATE INDEX ON price_adjustments (stock_id, tick_index);
```

This is the replay log. Last persisted tick + these rows reproduces the price path exactly
after a crash (PLAN.md 3.4).

```sql
CREATE TABLE news_events (
  id             BIGSERIAL PRIMARY KEY,
  competition_id BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  headline       TEXT NOT NULL,
  body           TEXT,
  impact_bps     INTEGER NOT NULL,       -- signed; +500 = +5%
  decay_seconds  INTEGER NOT NULL DEFAULT 120,
  start_tick     INTEGER NOT NULL,
  end_tick       INTEGER NOT NULL,       -- start + ceil(decay/tick_interval)
  published_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     BIGINT NOT NULL REFERENCES admins(id)
);
CREATE INDEX ON news_events (competition_id, published_at DESC);

CREATE TABLE news_event_stocks (
  news_event_id  BIGINT NOT NULL REFERENCES news_events(id) ON DELETE CASCADE,
  stock_id       BIGINT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  impact_bps     INTEGER,   -- NULL = inherit the event's impact
  PRIMARY KEY (news_event_id, stock_id)
);
```

The per-stock `impact_bps` override lets one headline hit the whole sector at +3% but the named
company at +9%, which is how a real story reads.

---

## 4. Portfolios and holdings

```sql
CREATE TABLE portfolios (
  id                 BIGSERIAL PRIMARY KEY,
  competition_id     BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  team_id            BIGINT NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
  cash_paise         BIGINT NOT NULL CHECK (cash_paise >= 0),
  realised_pnl_paise BIGINT NOT NULL DEFAULT 0,
  brokerage_paid_paise BIGINT NOT NULL DEFAULT 0,
  trade_count        INTEGER NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**This is the lock row.** It is deliberately a narrow table separate from `teams` so
`SELECT ... FOR UPDATE` covers only mutable financial state and never blocks a login or a
profile read. `CHECK (cash_paise >= 0)` is the database-level backstop: even if every
application check were wrong, the transaction aborts rather than going negative.

```sql
CREATE TABLE holdings (
  id             BIGSERIAL PRIMARY KEY,
  portfolio_id   BIGINT  NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  stock_id       BIGINT  NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  quantity       INTEGER NOT NULL CHECK (quantity >= 0),
  avg_cost_paise BIGINT  NOT NULL CHECK (avg_cost_paise >= 0),
  cost_residual  BIGINT  NOT NULL DEFAULT 0,   -- integer-division remainder, see PLAN.md 2
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, stock_id)
);
```

Rows are kept at `quantity = 0` after a full exit rather than deleted, so the position history
and its realised P&L survive for the trade-history and results pages.

---

## 5. Orders and trades

Split on purpose. `orders` records **intent, including rejections** (correctness req 5.4 and the
audit trail). `trades` records **fills**. A rejected order has no trade.

```sql
CREATE TABLE orders (
  id               BIGSERIAL PRIMARY KEY,
  competition_id   BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  team_id          BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  stock_id         BIGINT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  idempotency_key  UUID   NOT NULL,
  side             order_side NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity >= 1),
  status           order_status NOT NULL,
  reject_code      TEXT,     -- MARKET_CLOSED, STOCK_HALTED, INSUFFICIENT_CASH,
                             -- INSUFFICIENT_HOLDINGS, CONCENTRATION_CAP, RATE_LIMITED
  reject_detail    TEXT,
  tick_index       INTEGER NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, idempotency_key)
);
CREATE INDEX orders_rate_limit ON orders (team_id, created_at DESC);
CREATE INDEX ON orders (competition_id, created_at DESC);
```

`UNIQUE (team_id, idempotency_key)` is correctness req 5.3, enforced by the database rather than
by application logic. `orders_rate_limit` serves the trailing-60s count in 5.6.

```sql
CREATE TABLE trades (
  id                  BIGSERIAL PRIMARY KEY,
  order_id            BIGINT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  competition_id      BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  team_id             BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  stock_id            BIGINT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  side                order_side NOT NULL,
  quantity            INTEGER NOT NULL,

  mid_price_paise     BIGINT NOT NULL,   -- price the engine published this tick
  fill_price_paise    BIGINT NOT NULL,   -- after spread
  gross_paise         BIGINT NOT NULL,   -- fill * qty
  brokerage_paise     BIGINT NOT NULL,
  cash_delta_paise    BIGINT NOT NULL,   -- signed, what actually moved
  avg_cost_at_fill    BIGINT,            -- sells only
  realised_pnl_paise  BIGINT NOT NULL DEFAULT 0,

  tick_index          INTEGER NOT NULL,
  executed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  voided_at           TIMESTAMPTZ,
  void_reason         TEXT,
  voided_by           BIGINT REFERENCES admins(id),
  CHECK (voided_at IS NULL OR void_reason IS NOT NULL)
);
CREATE INDEX ON trades (competition_id, executed_at DESC);
CREATE INDEX ON trades (team_id, executed_at DESC);
CREATE INDEX trades_flow ON trades (stock_id, tick_index) WHERE voided_at IS NULL;
```

`trades_flow` is the hot path for the price engine: every tick aggregates signed quantity per
stock for the previous tick. Partial on `voided_at IS NULL` so voids drop out of future flow
calculations without rewriting history.

Storing both `mid_price_paise` and `fill_price_paise` means a team can be shown exactly what the
spread cost them, and it settles arguments about whether a fill was correct.

**Voiding** (your call: my default). Reverses cash and quantity at the original fill price,
recomputes average cost, and is **refused** if the reversal would push cash or holdings negative
— the admin is told to use a cash adjustment instead. The trade row is never deleted; it is
stamped with `voided_at` and a mandatory reason and excluded from P&L, leaderboard and order flow.

```sql
CREATE TABLE cash_adjustments (
  id             BIGSERIAL PRIMARY KEY,
  competition_id BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  team_id        BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  amount_paise   BIGINT NOT NULL,   -- signed
  reason         TEXT   NOT NULL,   -- mandatory
  created_by     BIGINT NOT NULL REFERENCES admins(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 6. Leaderboard

Two tables, for the reason in PLAN.md 5.5: a live one that is overwritten, and a sparse archive
for the rank-over-time chart. Keeping every 10-second snapshot for 500 teams would be ~720k rows
per event and buy nothing.

```sql
CREATE TABLE leaderboard_current (
  competition_id       BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  team_id              BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  rank                 INTEGER NOT NULL,
  prev_rank            INTEGER,
  portfolio_value_paise BIGINT NOT NULL,
  cash_paise           BIGINT NOT NULL,
  invested_paise       BIGINT NOT NULL,
  return_bps           INTEGER NOT NULL,
  realised_pnl_paise   BIGINT NOT NULL,
  unrealised_pnl_paise BIGINT NOT NULL,
  trade_count          INTEGER NOT NULL,
  tick_index           INTEGER NOT NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (competition_id, team_id)
);
CREATE INDEX ON leaderboard_current (competition_id, rank);

CREATE TABLE leaderboard_archive (
  competition_id        BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  team_id               BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  tick_index            INTEGER NOT NULL,
  rank                  INTEGER NOT NULL,
  portfolio_value_paise BIGINT NOT NULL,
  return_bps            INTEGER NOT NULL,
  PRIMARY KEY (competition_id, team_id, tick_index)
);
```

Written by one statement per snapshot:

```sql
RANK() OVER (
  ORDER BY return_bps DESC, realised_pnl_paise DESC, trade_count ASC
)
```

which is your tiebreak, in order. `prev_rank` is carried forward from the row being replaced,
so "rank change since last snapshot" needs no second query.

When the competition reaches `ended` the ticker stops writing, so the leaderboard freezes
exactly as specified and the final results page reads the same table.

---

## 7. Audit log

```sql
CREATE TABLE audit_log (
  id             BIGSERIAL PRIMARY KEY,
  competition_id BIGINT REFERENCES competitions(id) ON DELETE CASCADE,
  actor_type     actor_type NOT NULL,
  actor_id       BIGINT,
  actor_label    TEXT NOT NULL,    -- denormalised, survives a deleted actor
  action         TEXT NOT NULL,    -- 'market.open', 'trade.void', 'price.override', ...
  entity_type    TEXT,
  entity_id      BIGINT,
  payload        JSONB NOT NULL DEFAULT '{}',   -- before/after
  ip             INET,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (competition_id, created_at DESC);
CREATE INDEX ON audit_log (action, created_at DESC);
```

Append-only, enforced by the database rather than by convention:

```sql
CREATE FUNCTION audit_log_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
```

So the log cannot be quietly edited even from an open psql session. Dropping the trigger to do it
would itself be visible in the migration history.

Logged actions: `admin.login`, `team.login`, `team.password_set`, `team.password_reset`,
`competition.create`, `competition.update`, `market.open|pause|resume|close|end`,
`stock.create|update|halt|unhalt`, `price.override`, `news.publish`, `order.filled`,
`order.rejected`, `trade.void`, `cash.adjust`, `export.*`.

---

## 8. Row-count estimates

For a 4-hour event, 20 stocks, 500 teams, 5s ticks:

| Table | Rows | Note |
| --- | --- | --- |
| `price_ticks` | ~57,600 | 2,880 ticks x 20 stocks |
| `price_adjustments` | ~60,000 | dominated by per-tick order flow rows |
| `orders` | ~20,000 | 500 teams x ~40 orders, rejections included |
| `trades` | ~18,000 | |
| `leaderboard_current` | 500 | overwritten in place |
| `leaderboard_archive` | ~24,000 | 48 snapshots x 500 teams |
| `audit_log` | ~50,000 | |

Under 250k rows for a whole event. This fits in the free tier of anything and needs no
partitioning, no archival job and no TimescaleDB.

---

## 9. Migration and seeding

- `drizzle/0000_init.sql` — enums, tables, indexes, the audit trigger
- `npm run db:migrate` — apply
- `npm run db:seed` — demo competition: 20 Indian stocks across sectors, 10 teams with printable
  join codes, 4 queued news events, one admin from `ADMIN_USERNAME` / `ADMIN_PASSWORD`
- `npm run db:reset` — drop and recreate; the `ON DELETE CASCADE` chain means deleting a
  competition row removes everything belonging to it

## 10. Deliberate omissions

- **No `sessions` table.** Sessions are stateless signed JWTs; `session_version` handles
  revocation. One less table to read on every request.
- **No `positions` history table.** Reconstructible from `trades`, and the results page does
  exactly that.
- **No `config` key-value table.** Every setting is a typed column on `competitions`, so the
  compiler catches a typo instead of production catching it during an event.
- **No soft deletes** except `trades.voided_at`, which is a real domain concept rather than a
  deletion.
