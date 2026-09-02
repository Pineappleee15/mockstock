import { NextResponse } from "next/server";
import { activeCompetition, newsFeed, TICKER_WINDOW_MINUTES } from "@/lib/queries";
import { cached, etagFor, notModified } from "@/lib/cache";

export const dynamic = "force-dynamic";

/**
 * Two shapes from one endpoint:
 *   default  — only headlines from the last TICKER_WINDOW_MINUTES, for the
 *              scrolling bar, which is about what just happened
 *   ?all=1   — the full history, for the News page
 */
export async function GET(req: Request) {
  const comp = await activeCompetition();
  if (!comp) return NextResponse.json({ error: "no competition" }, { status: 404 });

  const all = new URL(req.url).searchParams.get("all") === "1";

  // The window means results change with the clock, not just on publish, so the
  // cache key has to move too. A minute of staleness is invisible on a 15-minute
  // window and keeps 12 clients polling down to one query a minute.
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const key = all ? `${comp.id}:all:${minuteBucket}` : `${comp.id}:live:${minuteBucket}`;

  const items = await cached(all ? "news:all" : "news", key, () =>
    newsFeed(comp, all ? 100 : 20, all ? undefined : TICKER_WINDOW_MINUTES),
  );

  const etag = etagFor(`news-${key}-${items[0]?.id ?? 0}-${items.length}`);
  if (notModified(req, etag)) return new NextResponse(null, { status: 304 });

  return NextResponse.json(
    { items, windowMinutes: all ? null : TICKER_WINDOW_MINUTES },
    { headers: { ETag: etag, "Cache-Control": "no-cache" } },
  );
}
