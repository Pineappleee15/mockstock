import { eq, asc, and, sql } from "drizzle-orm";
import { db, stocks, newsEvents } from "@/db";
import { activeCompetition, newsFeed } from "@/lib/queries";
import { Card, Empty, Change } from "@/components/ui";
import { NewsComposer } from "./news-composer";
import { StorylineQueue } from "./storyline-queue";

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  const comp = await activeCompetition();
  if (!comp) return <Empty>No competition.</Empty>;

  const all = await db.select({
    id: stocks.id, symbol: stocks.symbol, name: stocks.name, sector: stocks.sector,
  }).from(stocks).where(eq(stocks.competitionId, comp.id)).orderBy(asc(stocks.symbol));

  const queuedRows = await db.execute(sql`
    SELECT n.id, n.headline, n.body, n.impact_bps, n.start_tick, n.arc_id, n.arc_step,
           COALESCE(ARRAY_AGG(s.symbol ORDER BY s.symbol) FILTER (WHERE s.symbol IS NOT NULL), '{}') AS symbols
    FROM news_events n
    LEFT JOIN news_event_stocks ns ON ns.news_event_id = n.id
    LEFT JOIN stocks s ON s.id = ns.stock_id
    WHERE n.competition_id = ${comp.id} AND n.status = 'queued'
    GROUP BY n.id
    ORDER BY n.start_tick
  `);

  const queued = (queuedRows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    headline: String(r.headline),
    story: r.body ? String(r.body) : null,
    impactBps: Number(r.impact_bps),
    startTick: Number(r.start_tick),
    minute: Math.round((Number(r.start_tick) * comp.tickIntervalSeconds) / 60),
    symbols: (r.symbols as string[]) ?? [],
  }));

  const published = await newsFeed(comp, 40);

  return (
    <div className="space-y-4">
      <StorylineQueue
        competitionId={comp.id}
        queued={queued}
        currentTick={comp.currentTick}
        tickSeconds={comp.tickIntervalSeconds}
        autoNews={comp.autoNewsEnabled}
        marketOpen={comp.state === "open"}
      />

      <NewsComposer
        competitionId={comp.id}
        stocks={all}
        tickSeconds={comp.tickIntervalSeconds}
        circuitLimitBps={comp.circuitLimitBps}
      />

      <Card>
        <div className="border-b border-border px-3 py-2 text-sm font-semibold">
          Published <span className="font-normal text-muted">· {published.length}</span>
        </div>
        {published.length === 0 ? <Empty>Nothing published yet.</Empty> : (
          <ul className="divide-y divide-border/50">
            {published.map((n) => (
              <li key={n.id} className="px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{n.headline}</div>
                    <div className="num mt-0.5 text-[11px] text-muted">
                      {n.symbols.join(", ") || "no stocks"} ·{" "}
                      {new Date(n.publishedAt).toLocaleTimeString("en-IN")}
                    </div>
                  </div>
                  <span className="shrink-0 text-sm"><Change bps={n.impactBps} /></span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
