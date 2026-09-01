import { eq, asc, and } from "drizzle-orm";
import { db, stocks, priceTicks } from "@/db";
import { activeCompetition } from "@/lib/queries";
import { Empty } from "@/components/ui";
import { StocksPanel } from "./stocks-panel";

export const dynamic = "force-dynamic";

export default async function StocksPage() {
  const comp = await activeCompetition();
  if (!comp) return <Empty>No competition.</Empty>;

  const all = await db.select().from(stocks)
    .where(eq(stocks.competitionId, comp.id)).orderBy(asc(stocks.symbol));

  const ticks = await db.select().from(priceTicks)
    .where(and(eq(priceTicks.competitionId, comp.id), eq(priceTicks.tickIndex, comp.currentTick)));
  const priceBy = new Map(ticks.map((t) => [t.stockId, t.pricePaise]));

  return (
    <StocksPanel
      competitionId={comp.id}
      circuitLimitBps={comp.circuitLimitBps}
      stocks={all.map((s) => ({
        id: s.id, symbol: s.symbol, name: s.name, sector: s.sector,
        pricePaise: priceBy.get(s.id) ?? s.startingPricePaise,
        openPaise: s.sessionOpenPaise ?? s.startingPricePaise,
        volatilityBps: s.volatilityBps, liquidity: s.liquidity,
        halted: s.status === "halted", haltReason: s.haltReason,
      }))}
    />
  );
}
