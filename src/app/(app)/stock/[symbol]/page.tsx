import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, stocks } from "@/db";
import { activeCompetition } from "@/lib/queries";
import { StockDetail } from "./stock-detail";

export default async function StockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const comp = await activeCompetition();
  if (!comp) notFound();

  const stock = await db.query.stocks.findFirst({
    where: and(eq(stocks.competitionId, comp.id), eq(stocks.symbol, symbol.toUpperCase())),
  });
  if (!stock) notFound();

  return (
    <StockDetail
      symbol={stock.symbol}
      name={stock.name}
      sector={stock.sector}
      spreadBps={comp.spreadBps}
      brokerageBps={comp.brokerageBps}
      concentrationCapBps={comp.concentrationCapBps}
      tradingOpen={comp.state === "open"}
    />
  );
}
