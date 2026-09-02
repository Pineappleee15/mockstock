import { NextResponse } from "next/server";
import { activeCompetition, leaderboard, marketSnapshot, marketIndex } from "@/lib/queries";
import { cached, etagFor, notModified } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const comp = await activeCompetition();
  if (!comp) return NextResponse.json({ error: "no competition" }, { status: 404 });

  // Keyed on the snapshot tick, not the price tick: the leaderboard is
  // recomputed every leaderboardEveryNTicks, so this is the real change key.
  const snapshotTick = comp.currentTick - (comp.currentTick % comp.leaderboardEveryNTicks);
  const key = `${comp.id}:${snapshotTick}:${comp.state}`;
  const etag = etagFor(`lb-${key}`);
  if (notModified(req, etag)) return new NextResponse(null, { status: 304 });

  const rows = await cached("leaderboard", key, () => leaderboard(comp));
  // Shares the market cache entry, so this costs nothing extra.
  const stocks = await cached("market", `${comp.id}:${comp.currentTick}:${comp.state}`,
    () => marketSnapshot(comp));

  return NextResponse.json(
    { tick: snapshotTick, frozen: comp.state === "ended", rows, index: marketIndex(stocks) },
    { headers: { ETag: etag, "Cache-Control": "no-cache" } },
  );
}
