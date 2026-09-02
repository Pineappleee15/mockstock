"use client";

import Link from "next/link";
import { usePoll } from "@/lib/use-poll";
import { Card, Empty, Change, Badge } from "@/components/ui";

interface NewsItem {
  id: number; headline: string; body: string | null;
  impactBps: number; symbols: string[]; publishedAt: string;
}

/**
 * Full news history. The scrolling bar only carries the last few minutes, so
 * this is where a team goes to re-read a headline they missed — or a cryptic
 * clue they are still working on.
 */
export function NewsLive() {
  const { data, loading } = usePoll<{ items: NewsItem[] }>("/api/news?all=1", 10_000);

  if (loading && !data) return <Empty>Loading the news…</Empty>;
  const items = data?.items ?? [];

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">News</h1>

      {items.length === 0 ? (
        <Empty>Nothing has happened yet.</Empty>
      ) : (
        <Card>
          <ul className="divide-y divide-border/50">
            {items.map((n, i) => (
              <li key={n.id} className="px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {i === 0 && <Badge tone="warn">Latest</Badge>}
                      <span className="text-sm font-medium">{n.headline}</span>
                    </div>
                    {n.body && <p className="mt-1 text-xs text-muted">{n.body}</p>}
                    <div className="num mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted">
                      {n.symbols.map((s) => (
                        <Link key={s} href={`/stock/${s}`} className="hover:text-accent">{s}</Link>
                      ))}
                      <span>
                        · {new Date(n.publishedAt).toLocaleTimeString("en-IN", {
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                  {n.impactBps !== 0 && (
                    <span className="shrink-0 text-sm"><Change bps={n.impactBps} /></span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-center text-[11px] text-muted">
        The bar at the top shows the last 15 minutes. Everything ever published is here.
      </p>
    </div>
  );
}
