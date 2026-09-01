import { sql } from "drizzle-orm";
import type { Conn } from "@/db";

/**
 * Recompute the whole leaderboard in one statement (PLAN.md 5.5).
 *
 * Never called per request. The ticker calls it on a fixed cadence and the API
 * serves the resulting table, so 300 clients polling cost one query per
 * snapshot rather than 300 portfolio computations per second.
 *
 * prev_rank is carried from the row being replaced, so "rank change since last
 * snapshot" needs no second query and no history table.
 */
export async function recomputeLeaderboard(
  tx: Conn,
  competitionId: number,
  tickIndex: number,
  startingCashPaise: number,
): Promise<void> {
  await tx.execute(sql`
    WITH latest AS (
      SELECT stock_id, price_paise
      FROM price_ticks
      WHERE competition_id = ${competitionId} AND tick_index = ${tickIndex}
    ),
    pos AS (
      SELECT
        p.team_id,
        p.cash_paise,
        p.realised_pnl_paise,
        p.trade_count,
        COALESCE(SUM(h.quantity::bigint * l.price_paise), 0)::bigint AS invested,
        COALESCE(SUM(h.quantity::bigint * (l.price_paise - h.avg_cost_paise)), 0)::bigint AS unrealised
      FROM portfolios p
      LEFT JOIN holdings h ON h.portfolio_id = p.id AND h.quantity > 0
      LEFT JOIN latest   l ON l.stock_id = h.stock_id
      WHERE p.competition_id = ${competitionId}
      GROUP BY p.id, p.team_id, p.cash_paise, p.realised_pnl_paise, p.trade_count
    ),
    valued AS (
      SELECT *,
        (cash_paise + invested) AS pv,
        ROUND((((cash_paise + invested) - ${startingCashPaise}::numeric)
               / NULLIF(${startingCashPaise}::numeric, 0)) * 10000)::int AS return_bps
      FROM pos
    ),
    ranked AS (
      SELECT *,
        RANK() OVER (
          ORDER BY return_bps DESC, realised_pnl_paise DESC, trade_count ASC
        )::int AS rnk
      FROM valued
    )
    INSERT INTO leaderboard_current (
      competition_id, team_id, rank, prev_rank, portfolio_value_paise, cash_paise,
      invested_paise, return_bps, realised_pnl_paise, unrealised_pnl_paise,
      trade_count, tick_index, updated_at
    )
    SELECT
      ${competitionId}, team_id, rnk, NULL, pv, cash_paise,
      invested, return_bps, realised_pnl_paise, unrealised,
      trade_count, ${tickIndex}, now()
    FROM ranked
    ON CONFLICT (competition_id, team_id) DO UPDATE SET
      prev_rank             = leaderboard_current.rank,
      rank                  = EXCLUDED.rank,
      portfolio_value_paise = EXCLUDED.portfolio_value_paise,
      cash_paise            = EXCLUDED.cash_paise,
      invested_paise        = EXCLUDED.invested_paise,
      return_bps            = EXCLUDED.return_bps,
      realised_pnl_paise    = EXCLUDED.realised_pnl_paise,
      unrealised_pnl_paise  = EXCLUDED.unrealised_pnl_paise,
      trade_count           = EXCLUDED.trade_count,
      tick_index            = EXCLUDED.tick_index,
      updated_at            = now()
  `);
}

/** Sparse archive row for the rank-over-time chart on the results page. */
export async function archiveLeaderboard(
  tx: Conn,
  competitionId: number,
  tickIndex: number,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO leaderboard_archive (competition_id, team_id, tick_index, rank, portfolio_value_paise, return_bps)
    SELECT competition_id, team_id, ${tickIndex}, rank, portfolio_value_paise, return_bps
    FROM leaderboard_current
    WHERE competition_id = ${competitionId}
    ON CONFLICT (competition_id, team_id, tick_index) DO NOTHING
  `);
}
