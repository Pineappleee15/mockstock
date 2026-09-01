import { eq, asc } from "drizzle-orm";
import { db, stocks } from "@/db";
import { activeCompetition, newsFeed } from "@/lib/queries";
import { Card, Empty, Change } from "@/components/ui";
import { NewsComposer } from "./news-composer";

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  const comp = await activeCompetition();
  if (!comp) return <Empty>No competition.</Empty>;

  const all = await db.select({
    id: stocks.id, symbol: stocks.symbol, name: stocks.name, sector: stocks.sector,
  }).from(stocks).where(eq(stocks.competitionId, comp.id)).orderBy(asc(stocks.symbol));

  const published = await newsFeed(comp, 40);

  return (
    <div className="space-y-4">
      <NewsComposer competitionId={comp.id} stocks={all} tickSeconds={comp.tickIntervalSeconds} />

      <Card>
        <div className="border-b border-border px-3 py-2 text-sm font-semibold">Published</div>
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
