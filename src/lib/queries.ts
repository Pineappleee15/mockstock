import { and, desc, eq, sql, gte } from "drizzle-orm";
import {
  db, competitions, stocks, priceTicks, portfolios, holdings, teams,
  leaderboardCurrent, newsEvents, trades, watchlist,
} from "@/db";
import { returnBps } from "./money";

export { marketIndex, INDEX_BASE, type MarketIndex } from "./market-index";

export type LiveCompetition = typeof competitions.$inferSelect;

/** The one competition that is live, or the most recent one if none is. */
export async function activeCompetition(): Promise<LiveCompetition | null> {
  const live = await db.query.competitions.findFirst({
    where: sql`state IN ('pre_open','open','paused')`,
  });
  if (live) return live;
  return (await db.query.competitions.findFirst({ orderBy: desc(competitions.id) })) ?? null;
}

export interface MarketRow {
  id: number;
  symbol: string;
  name: string;
  sector: string;
  pricePaise: number;
  openPaise: number;
  changeBps: number;
  halted: boolean;
  spark: number[];
}

const SPARK_POINTS = 30;

/**
 * Whole-market snapshot: current price, change from session open, and a
 * sparkline. One query for prices, one for sparklines — never one per stock.
 */
export async function marketSnapshot(comp: LiveCompetition): Promise<MarketRow[]> {
  const all = await db.query.stocks.findMany({ where: eq(stocks.competitionId, comp.id) });
  if (all.length === 0) return [];

  const current = await db.select().from(priceTicks)
    .where(and(eq(priceTicks.competitionId, comp.id), eq(priceTicks.tickIndex, comp.currentTick)));
  const byStock = new Map(current.map((t) => [t.stockId, t]));

  // Sparkline window, downsampled so a long event does not send 3000 points.
  const span = Math.max(1, Math.floor(comp.currentTick / SPARK_POINTS));
  const from = Math.max(0, comp.currentTick - SPARK_POINTS * span);
  const sparkRows = await db.select({
    stockId: priceTicks.stockId,
    tickIndex: priceTicks.tickIndex,
    pricePaise: priceTicks.pricePaise,
  }).from(priceTicks)
    .where(and(
      eq(priceTicks.competitionId, comp.id),
      gte(priceTicks.tickIndex, from),
      sql`(${priceTicks.tickIndex} - ${from}) % ${span} = 0`,
    ))
    .orderBy(priceTicks.tickIndex);

  const sparks = new Map<number, number[]>();
  for (const r of sparkRows) {
    const arr = sparks.get(r.stockId) ?? [];
    arr.push(r.pricePaise);
    sparks.set(r.stockId, arr);
  }

  return all.map((s) => {
    const tick = byStock.get(s.id);
    const price = tick?.pricePaise ?? s.startingPricePaise;
    const open = s.sessionOpenPaise ?? s.startingPricePaise;
    return {
      id: s.id, symbol: s.symbol, name: s.name, sector: s.sector,
      pricePaise: price, openPaise: open, changeBps: returnBps(price, open),
      halted: s.status === "halted",
      spark: sparks.get(s.id) ?? [price],
    };
  }).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export interface PositionRow {
  stockId: number; symbol: string; name: string;
  quantity: number; avgCostPaise: number; pricePaise: number;
  marketValuePaise: number; unrealisedPaise: number; unrealisedBps: number;
  halted: boolean;
}

export interface PortfolioView {
  teamName: string;
  cashPaise: number;
  investedPaise: number;
  valuePaise: number;
  returnBps: number;
  realisedPnlPaise: number;
  unrealisedPnlPaise: number;
  brokeragePaidPaise: number;
  tradeCount: number;
  rank: number | null;
  prevRank: number | null;
  positions: PositionRow[];
  /** Symbols this team has starred. */
  watched: string[];
}

/** A team's full portfolio, priced at the current tick. */
export async function portfolioView(comp: LiveCompetition, teamId: number): Promise<PortfolioView | null> {
  const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) });
  const pf = await db.query.portfolios.findFirst({ where: eq(portfolios.teamId, teamId) });
  if (!team || !pf) return null;

  const rows = await db.select({
    stockId: holdings.stockId,
    quantity: holdings.quantity,
    avgCostPaise: holdings.avgCostPaise,
    symbol: stocks.symbol,
    name: stocks.name,
    status: stocks.status,
    startingPricePaise: stocks.startingPricePaise,
    pricePaise: priceTicks.pricePaise,
  }).from(holdings)
    .innerJoin(stocks, eq(stocks.id, holdings.stockId))
    .leftJoin(priceTicks, and(
      eq(priceTicks.stockId, holdings.stockId),
      eq(priceTicks.tickIndex, comp.currentTick),
    ))
    .where(and(eq(holdings.portfolioId, pf.id), sql`${holdings.quantity} > 0`));

  const positions: PositionRow[] = rows.map((r) => {
    const price = r.pricePaise ?? r.startingPricePaise;
    const mv = r.quantity * price;
    const unreal = r.quantity * (price - r.avgCostPaise);
    return {
      stockId: r.stockId, symbol: r.symbol, name: r.name,
      quantity: r.quantity, avgCostPaise: r.avgCostPaise, pricePaise: price,
      marketValuePaise: mv, unrealisedPaise: unreal,
      unrealisedBps: r.avgCostPaise > 0 ? returnBps(price, r.avgCostPaise) : 0,
      halted: r.status === "halted",
    };
  }).sort((a, b) => b.marketValuePaise - a.marketValuePaise);

  const invested = positions.reduce((s, p) => s + p.marketValuePaise, 0);
  const unrealised = positions.reduce((s, p) => s + p.unrealisedPaise, 0);
  const value = pf.cashPaise + invested;

  const starred = await db.select({ symbol: stocks.symbol })
    .from(watchlist)
    .innerJoin(stocks, eq(stocks.id, watchlist.stockId))
    .where(eq(watchlist.teamId, teamId));

  const lb = await db.query.leaderboardCurrent.findFirst({
    where: and(eq(leaderboardCurrent.competitionId, comp.id), eq(leaderboardCurrent.teamId, teamId)),
  });

  return {
    teamName: team.name,
    cashPaise: pf.cashPaise,
    investedPaise: invested,
    valuePaise: value,
    returnBps: returnBps(value, comp.startingCashPaise),
    realisedPnlPaise: pf.realisedPnlPaise,
    unrealisedPnlPaise: unrealised,
    brokeragePaidPaise: pf.brokeragePaidPaise,
    tradeCount: pf.tradeCount,
    rank: lb?.rank ?? null,
    prevRank: lb?.prevRank ?? null,
    positions,
    watched: starred.map((s) => s.symbol),
  };
}

export interface LeaderRow {
  rank: number; prevRank: number | null; teamId: number; teamName: string;
  valuePaise: number; cashPaise: number; investedPaise: number;
  returnBps: number; realisedPnlPaise: number; tradeCount: number;
}

export async function leaderboard(comp: LiveCompetition): Promise<LeaderRow[]> {
  const rows = await db.select({
    rank: leaderboardCurrent.rank,
    prevRank: leaderboardCurrent.prevRank,
    teamId: leaderboardCurrent.teamId,
    teamName: teams.name,
    valuePaise: leaderboardCurrent.portfolioValuePaise,
    cashPaise: leaderboardCurrent.cashPaise,
    investedPaise: leaderboardCurrent.investedPaise,
    returnBps: leaderboardCurrent.returnBps,
    realisedPnlPaise: leaderboardCurrent.realisedPnlPaise,
    tradeCount: leaderboardCurrent.tradeCount,
  }).from(leaderboardCurrent)
    .innerJoin(teams, eq(teams.id, leaderboardCurrent.teamId))
    .where(eq(leaderboardCurrent.competitionId, comp.id))
    .orderBy(leaderboardCurrent.rank, teams.name);
  return rows;
}

export interface NewsRow {
  id: number; headline: string; body: string | null;
  impactBps: number; publishedAt: string; symbols: string[];
}

/**
 * How long a headline stays on the scrolling ticker.
 *
 * The ticker is for "what just happened", not a history. Without a window, an
 * hour-old story keeps scrolling as though it were current — which is worst for
 * a cryptic clue, where participants cannot tell which one is live. Full history
 * stays available on the News page.
 */
export const TICKER_WINDOW_MINUTES = 15;

export async function newsFeed(
  comp: LiveCompetition, limit = 20, sinceMinutes?: number,
): Promise<NewsRow[]> {
  const rows = await db.execute(sql`
    SELECT n.id, n.headline, n.body, n.impact_bps, n.published_at,
           COALESCE(ARRAY_AGG(s.symbol ORDER BY s.symbol) FILTER (WHERE s.symbol IS NOT NULL), '{}') AS symbols
    FROM news_events n
    LEFT JOIN news_event_stocks ns ON ns.news_event_id = n.id
    LEFT JOIN stocks s ON s.id = ns.stock_id
    WHERE n.competition_id = ${comp.id}
      ${sinceMinutes
        ? sql`AND n.published_at > now() - (${sinceMinutes} * interval '1 minute')`
        : sql``}
    GROUP BY n.id
    ORDER BY n.published_at DESC
    LIMIT ${limit}
  `);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    headline: String(r.headline),
    body: r.body == null ? null : String(r.body),
    impactBps: Number(r.impact_bps),
    publishedAt: new Date(r.published_at as string).toISOString(),
    symbols: (r.symbols as string[]) ?? [],
  }));
}

export interface TradeRow {
  id: number; symbol: string; side: "buy" | "sell"; quantity: number;
  fillPricePaise: number; grossPaise: number; brokeragePaise: number;
  realisedPnlPaise: number; executedAt: string; voided: boolean;
  teamName?: string;
}

export async function tradeHistory(teamId: number, limit = 200): Promise<TradeRow[]> {
  const rows = await db.select({
    id: trades.id, symbol: stocks.symbol, side: trades.side, quantity: trades.quantity,
    fillPricePaise: trades.fillPricePaise, grossPaise: trades.grossPaise,
    brokeragePaise: trades.brokeragePaise, realisedPnlPaise: trades.realisedPnlPaise,
    executedAt: trades.executedAt, voidedAt: trades.voidedAt,
  }).from(trades)
    .innerJoin(stocks, eq(stocks.id, trades.stockId))
    .where(eq(trades.teamId, teamId))
    .orderBy(desc(trades.executedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id, symbol: r.symbol, side: r.side, quantity: r.quantity,
    fillPricePaise: r.fillPricePaise, grossPaise: r.grossPaise,
    brokeragePaise: r.brokeragePaise, realisedPnlPaise: r.realisedPnlPaise,
    executedAt: r.executedAt.toISOString(), voided: r.voidedAt != null,
  }));
}

/** Chart series for one stock, downsampled to at most `points` values. */
export async function priceSeries(
  comp: LiveCompetition, stockId: number, points = 180,
): Promise<Array<{ t: number; p: number }>> {
  // Pre-open history lives at negative tick indices. It is short, so it is
  // returned whole; only the live session is downsampled.
  const span = Math.max(1, Math.ceil((comp.currentTick + 1) / points));
  const rows = await db.select({ t: priceTicks.tickIndex, p: priceTicks.pricePaise })
    .from(priceTicks)
    .where(and(
      eq(priceTicks.competitionId, comp.id),
      eq(priceTicks.stockId, stockId),
      sql`(${priceTicks.tickIndex} < 0 OR ${priceTicks.tickIndex} % ${span} = 0)`,
    ))
    .orderBy(priceTicks.tickIndex);

  // Always include the very latest tick, even if it is not on the sampling grid.
  const latest = await db.query.priceTicks.findFirst({
    where: and(eq(priceTicks.stockId, stockId), eq(priceTicks.tickIndex, comp.currentTick)),
  });
  if (latest && rows.at(-1)?.t !== latest.tickIndex) {
    rows.push({ t: latest.tickIndex, p: latest.pricePaise });
  }
  return rows;
}
