import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db, stocks } from "@/db";
import { activeCompetition, priceSeries } from "@/lib/queries";
import { cached, etagFor, notModified } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol")?.toUpperCase();
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const comp = await activeCompetition();
  if (!comp) return NextResponse.json({ error: "no competition" }, { status: 404 });

  const stock = await db.query.stocks.findFirst({
    where: and(eq(stocks.competitionId, comp.id), eq(stocks.symbol, symbol)),
  });
  if (!stock) return NextResponse.json({ error: "unknown symbol" }, { status: 404 });

  const key = `${comp.id}:${stock.id}:${comp.currentTick}`;
  const etag = etagFor(`chart-${key}`);
  if (notModified(req, etag)) return new NextResponse(null, { status: 304 });

  const series = await cached(`chart:${symbol}`, key, () => priceSeries(comp, stock.id));

  return NextResponse.json(
    {
      symbol, name: stock.name, sector: stock.sector,
      halted: stock.status === "halted",
      openPaise: stock.sessionOpenPaise ?? stock.startingPricePaise,
      tickIntervalSeconds: comp.tickIntervalSeconds,
      series,
    },
    { headers: { ETag: etag, "Cache-Control": "no-cache" } },
  );
}
