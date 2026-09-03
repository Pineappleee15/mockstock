"use client";

import Link from "next/link";
import { usePoll } from "@/lib/use-poll";

interface NewsItem {
  id: number; headline: string; symbols: string[]; publishedAt: string;
}

function age(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  return `${mins}m ago`;
}

/**
 * News as a column down the right, not a strip across the top.
 *
 * A ticker forces every headline through one line, which is hopeless for the
 * cryptic ones that are deliberately written over two or three. A rail gives
 * them room, keeps several visible at once so a developing story reads as a
 * story, and stops news competing with the price for the top of the screen.
 *
 * Desktop only — a phone has no right-hand side, so it keeps the strip.
 */
export function NewsRail() {
  const { data } = usePoll<{ items: NewsItem[] }>("/api/news?all=1", 10_000);
  const items = (data?.items ?? []).slice(0, 12);

  return (
    <aside className="hidden w-72 shrink-0 lg:block">
      <div className="sticky top-24 pr-1">
        <div className="flex items-baseline justify-between border-b border-border/60 pb-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
            The wire
          </h2>
          <Link href="/news" className="text-[11px] text-muted hover:text-text">All</Link>
        </div>

        {items.length === 0 ? (
          <p className="py-6 text-[12px] text-muted">Nothing has happened yet.</p>
        ) : (
          <ul className="max-h-[calc(100vh-11rem)] overflow-y-auto">
            {items.map((n, i) => (
              <li key={n.id} className="border-b border-border/30 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="num truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">
                    {n.symbols.slice(0, 3).join(" ") || "MARKET"}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted">{age(n.publishedAt)}</span>
                </div>
                <p className={`mt-1 whitespace-pre-line text-[12.5px] leading-snug ${
                  i === 0 ? "text-text" : "text-muted"
                }`}>
                  {n.headline}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
