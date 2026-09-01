import { NextResponse } from "next/server";
import { activeCompetition, newsFeed } from "@/lib/queries";
import { cached, etagFor, notModified } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const comp = await activeCompetition();
  if (!comp) return NextResponse.json({ error: "no competition" }, { status: 404 });

  // Cheap change key: the latest event id. Costs one indexed lookup.
  const items = await cached(
    "news",
    `${comp.id}:${comp.currentTick - (comp.currentTick % 4)}`,
    () => newsFeed(comp),
  );
  const etag = etagFor(`news-${comp.id}-${items[0]?.id ?? 0}-${items.length}`);
  if (notModified(req, etag)) return new NextResponse(null, { status: 304 });

  return NextResponse.json({ items }, { headers: { ETag: etag, "Cache-Control": "no-cache" } });
}
