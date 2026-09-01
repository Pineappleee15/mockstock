import { NextResponse } from "next/server";
import { activeCompetition, marketSnapshot } from "@/lib/queries";
import { cached, etagFor, notModified } from "@/lib/cache";
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
    { tick: comp.currentTick, state: comp.state, name: comp.name, stocks },
    { headers: { ETag: etag, "Cache-Control": "no-cache" } },
  );
}
