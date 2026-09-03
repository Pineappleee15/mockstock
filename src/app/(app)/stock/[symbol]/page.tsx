import { notFound } from "next/navigation";
import { and, eq, lt } from "drizzle-orm";
import { db, stocks, priceTicks } from "@/db";
import { activeCompetition } from "@/lib/queries";
import { fundamentalsFor } from "@/lib/fundamentals";
import { StockDetail } from "./stock-detail";

export const dynamic = "force-dynamic";

export default async function StockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const comp = await activeCompetition();
  if (!comp) notFound();

  const stock = await db.query.stocks.findFirst({
    where: and(eq(stocks.competitionId, comp.id), eq(stocks.symbol, symbol.toUpperCase())),
  });
  if (!stock) notFound();

  // Pre-open history, used for the 52-week range on the card.
  const history = await db.select({ p: priceTicks.pricePaise })
    .from(priceTicks)
    .where(and(eq(priceTicks.stockId, stock.id), lt(priceTicks.tickIndex, 0)))
    .orderBy(priceTicks.tickIndex);

  const series = history.length ? history.map((r) => r.p) : [stock.startingPricePaise];

  // Derived on the server from the stock's real hidden parameters. The drift
  // itself is never sent to the client — working it out is the exercise.
  const fundamentals = fundamentalsFor(
    comp.id, stock.symbol, stock.startingPricePaise,
    stock.volatilityBps, stock.driftBps, stock.liquidity, series, comp.driftSpreadBps,
  );

  return (
    <StockDetail
      symbol={stock.symbol}
      name={stock.name}
      sector={stock.sector}
      spreadBps={comp.spreadBps}
      brokerageBps={comp.brokerageBps}
      concentrationCapBps={comp.concentrationCapBps}
      tradingOpen={comp.state === "open"}
      shortSellingEnabled={comp.shortSellingEnabled}
      fundamentals={fundamentals}
    />
  );
}
