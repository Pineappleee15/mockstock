import { NextResponse } from "next/server";
import { activeCompetition, marketSnapshot, marketIndex } from "@/lib/queries";
import { cached, etagFor, notModified } from "@/lib/cache";
import { regimeAt } from "@/lib/regime";
import { ensureTicker } from "@/lib/boot";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  ensureTicker();
  const comp = await activeCompetition();
  if (!comp) return NextResponse.json({ error: "no competition" }, { status: 404 });

  const key = `${comp.id}:${comp.currentTick}:${comp.state}`;
  const etag = etagFor(`market-${key}`);
  if (notModified(req, etag)) return new NextResponse(null, { status: 304 });

  const stocks = await cached("market", key, () => marketSnapshot(comp));

  return NextResponse.json(
    {
      tick: comp.currentTick, state: comp.state, name: comp.name, stocks,
      index: marketIndex(stocks),
      // The label only. The multipliers behind it stay on the server.
      mood: comp.regimeEnabled && comp.state === "open"
        ? regimeAt(comp.id, comp.currentTick, comp.tickIntervalSeconds).label
        : null,
    },
    { headers: { ETag: etag, "Cache-Control": "no-cache" } },
  );
}
