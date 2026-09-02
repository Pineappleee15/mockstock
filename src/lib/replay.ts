import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * The closing ceremony.
 *
 * Everything here is read from data the app was already collecting and never
 * showing: leaderboard_archive has a rank for every team every five minutes,
 * and price_adjustments records why each price moved, including the net volume
 * behind every order-flow nudge. That is enough to tell a team not just what
 * they made, but which prices they personally moved.
 */

export interface RankPoint {
  minute: number;
  ranks: Record<string, number>;
}

/** Rank of every team over the session, for the bump chart. */
export async function rankHistory(
  competitionId: number, tickIntervalSeconds: number,
): Promise<{ teams: string[]; points: RankPoint[] }> {
  const rows = await db.execute(sql`
    SELECT a.tick_index, t.name, a.rank
    FROM leaderboard_archive a
    JOIN teams t ON t.id = a.team_id
    WHERE a.competition_id = ${competitionId}
    ORDER BY a.tick_index, a.rank
  `) as unknown as Array<{ tick_index: number; name: string; rank: number }>;

  if (rows.length === 0) return { teams: [], points: [] };

  const byTick = new Map<number, Record<string, number>>();
  const teams = new Set<string>();
  for (const r of rows) {
    teams.add(r.name);
    const at = byTick.get(Number(r.tick_index)) ?? {};
    at[r.name] = Number(r.rank);
    byTick.set(Number(r.tick_index), at);
  }

  const points = [...byTick.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tick, ranks]) => ({
      minute: Math.round((tick * tickIntervalSeconds) / 60),
      ranks,
    }));

  return { teams: [...teams].sort(), points };
}

export interface TradeHighlight {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  fillPricePaise: number;
  closePricePaise: number;
  /** What the decision was worth by the close, in paise. */
  valuePaise: number;
  executedAt: string;
}

export interface TeamReplay {
  teamId: number;
  teamName: string;
  rank: number;
  valuePaise: number;
  returnBps: number;
  realisedPnlPaise: number;
  brokeragePaidPaise: number;
  tradeCount: number;
  best: TradeHighlight | null;
  worst: TradeHighlight | null;
  /** Stocks this team personally shifted, biggest first. */
  moved: Array<{ symbol: string; bps: number; shareOfFlowPct: number }>;
  busiest: { symbol: string; trades: number } | null;
  /** The best performer they never owned. */
  missed: { symbol: string; changeBps: number } | null;
}

/** Everything one team needs to see about their own event. */
export async function teamReplay(
  competitionId: number, teamId: number, finalTick: number,
): Promise<TeamReplay | null> {
  const head = (await db.execute(sql`
    SELECT l.team_id, t.name, l.rank, l.portfolio_value_paise, l.return_bps,
           l.realised_pnl_paise, l.trade_count, p.brokerage_paid_paise
    FROM leaderboard_current l
    JOIN teams t ON t.id = l.team_id
    JOIN portfolios p ON p.team_id = l.team_id
    WHERE l.competition_id = ${competitionId} AND l.team_id = ${teamId}
  `) as unknown as Array<Record<string, unknown>>)[0];
  if (!head) return null;

  /**
   * Value every decision at the closing price. A buy is worth what it gained
   * by the close; a sell is worth what it realised. Voided trades are excluded.
   */
  const highlights = (await db.execute(sql`
    WITH closes AS (
      SELECT stock_id, price_paise FROM price_ticks
      WHERE competition_id = ${competitionId} AND tick_index = ${finalTick}
    )
    SELECT s.symbol, tr.side, tr.quantity, tr.fill_price_paise, tr.executed_at,
           COALESCE(c.price_paise, tr.fill_price_paise) AS close_paise,
           CASE WHEN tr.side = 'buy'
                THEN (COALESCE(c.price_paise, tr.fill_price_paise) - tr.fill_price_paise) * tr.quantity
                ELSE tr.realised_pnl_paise
           END AS value_paise
    FROM trades tr
    JOIN stocks s ON s.id = tr.stock_id
    LEFT JOIN closes c ON c.stock_id = tr.stock_id
    WHERE tr.team_id = ${teamId} AND tr.voided_at IS NULL
    ORDER BY value_paise DESC
  `)) as unknown as Array<Record<string, unknown>>;

  const toHighlight = (r: Record<string, unknown> | undefined): TradeHighlight | null =>
    r ? {
      symbol: String(r.symbol),
      side: r.side as "buy" | "sell",
      quantity: Number(r.quantity),
      fillPricePaise: Number(r.fill_price_paise),
      closePricePaise: Number(r.close_paise),
      valuePaise: Number(r.value_paise),
      executedAt: new Date(r.executed_at as string).toISOString(),
    } : null;

  /**
   * How much of each stock's order-flow move this team caused.
   *
   * The engine logs one order_flow adjustment per stock per tick with the net
   * volume behind it. A team's share of that tick's net flow is its share of
   * the resulting move — so this is attribution, not a guess.
   */
  const moved = (await db.execute(sql`
    WITH team_flow AS (
      SELECT stock_id, tick_index,
             SUM(CASE WHEN side = 'buy' THEN quantity ELSE -quantity END) AS qty
      FROM trades
      WHERE team_id = ${teamId} AND competition_id = ${competitionId} AND voided_at IS NULL
      GROUP BY stock_id, tick_index
    )
    SELECT s.symbol,
           SUM(ABS(pa.delta_bps * (tf.qty::numeric / NULLIF(pa.net_qty, 0))))::int AS bps,
           AVG(ABS(tf.qty::numeric / NULLIF(pa.net_qty, 0)) * 100)::int AS share_pct
    FROM team_flow tf
    JOIN price_adjustments pa
      ON pa.stock_id = tf.stock_id AND pa.tick_index = tf.tick_index + 1
     AND pa.kind = 'order_flow' AND pa.competition_id = ${competitionId}
    JOIN stocks s ON s.id = tf.stock_id
    WHERE pa.net_qty IS NOT NULL AND pa.net_qty <> 0
    GROUP BY s.symbol
    ORDER BY bps DESC
    LIMIT 3
  `)) as unknown as Array<{ symbol: string; bps: number; share_pct: number }>;

  const busiestRow = (await db.execute(sql`
    SELECT s.symbol, COUNT(*)::int AS n
    FROM trades tr JOIN stocks s ON s.id = tr.stock_id
    WHERE tr.team_id = ${teamId} AND tr.voided_at IS NULL
    GROUP BY s.symbol ORDER BY n DESC, s.symbol LIMIT 1
  `) as unknown as Array<{ symbol: string; n: number }>)[0];

  // The best performer they never touched.
  const missedRow = (await db.execute(sql`
    SELECT s.symbol,
           ROUND((((pt.price_paise - s.session_open_paise)::numeric
                   / NULLIF(s.session_open_paise, 0)) * 10000))::int AS change_bps
    FROM stocks s
    JOIN price_ticks pt ON pt.stock_id = s.id AND pt.tick_index = ${finalTick}
    WHERE s.competition_id = ${competitionId}
      AND s.session_open_paise IS NOT NULL
      AND s.id NOT IN (
        SELECT DISTINCT stock_id FROM trades WHERE team_id = ${teamId} AND voided_at IS NULL
      )
    ORDER BY change_bps DESC
    LIMIT 1
  `) as unknown as Array<{ symbol: string; change_bps: number }>)[0];

  return {
    teamId,
    teamName: String(head.name),
    rank: Number(head.rank),
    valuePaise: Number(head.portfolio_value_paise),
    returnBps: Number(head.return_bps),
    realisedPnlPaise: Number(head.realised_pnl_paise),
    brokeragePaidPaise: Number(head.brokerage_paid_paise),
    tradeCount: Number(head.trade_count),
    best: toHighlight(highlights[0]),
    worst: highlights.length > 1 ? toHighlight(highlights[highlights.length - 1]) : null,
    moved: moved.map((m) => ({
      symbol: m.symbol, bps: Number(m.bps), shareOfFlowPct: Number(m.share_pct),
    })),
    busiest: busiestRow ? { symbol: busiestRow.symbol, trades: Number(busiestRow.n) } : null,
    missed: missedRow ? { symbol: missedRow.symbol, changeBps: Number(missedRow.change_bps) } : null,
  };
}
