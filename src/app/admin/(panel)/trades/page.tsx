import { and, desc, eq, sql } from "drizzle-orm";
import { db, trades, stocks, teams } from "@/db";
import { activeCompetition } from "@/lib/queries";
import { Empty } from "@/components/ui";
import { TradesPanel } from "./trades-panel";

export const dynamic = "force-dynamic";

export default async function AdminTradesPage({
  searchParams,
}: { searchParams: Promise<{ team?: string; symbol?: string; side?: string }> }) {
  const sp = await searchParams;
  const comp = await activeCompetition();
  if (!comp) return <Empty>No competition.</Empty>;

  const filters = [eq(trades.competitionId, comp.id)];
  if (sp.team) filters.push(sql`${teams.name} ILIKE ${"%" + sp.team + "%"}`);
  if (sp.symbol) filters.push(eq(stocks.symbol, sp.symbol.toUpperCase()));
  if (sp.side === "buy" || sp.side === "sell") filters.push(eq(trades.side, sp.side));

  const rows = await db.select({
    id: trades.id, teamName: teams.name, symbol: stocks.symbol,
    side: trades.side, quantity: trades.quantity,
    fillPricePaise: trades.fillPricePaise, grossPaise: trades.grossPaise,
    brokeragePaise: trades.brokeragePaise, realisedPnlPaise: trades.realisedPnlPaise,
    executedAt: trades.executedAt, voidedAt: trades.voidedAt, voidReason: trades.voidReason,
  }).from(trades)
    .innerJoin(teams, eq(teams.id, trades.teamId))
    .innerJoin(stocks, eq(stocks.id, trades.stockId))
    .where(and(...filters))
    .orderBy(desc(trades.executedAt))
    .limit(500);

  return (
    <TradesPanel
      filters={{ team: sp.team ?? "", symbol: sp.symbol ?? "", side: sp.side ?? "" }}
      trades={rows.map((r) => ({
        id: r.id, teamName: r.teamName, symbol: r.symbol, side: r.side,
        quantity: r.quantity, fillPricePaise: r.fillPricePaise, grossPaise: r.grossPaise,
        brokeragePaise: r.brokeragePaise, realisedPnlPaise: r.realisedPnlPaise,
        executedAt: r.executedAt.toISOString(),
        voided: r.voidedAt != null, voidReason: r.voidReason,
      }))}
    />
  );
}
