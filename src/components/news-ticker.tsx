"use client";

import Link from "next/link";
import { usePoll } from "@/lib/use-poll";
import { cn } from "@/lib/cn";

interface NewsItem {
  id: number; headline: string; impactBps: number; symbols: string[]; publishedAt: string;
}

/** "just now", "4m ago" — enough to tell a fresh headline from a fading one. */
function age(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  return `${mins}m ago`;
}

function Symbols({ item }: { item: NewsItem }) {
  return (
    <span className={cn(
      "num font-semibold",
      item.impactBps > 0 ? "text-up" : item.impactBps < 0 ? "text-down" : "text-accent",
    )}>
      {item.symbols.slice(0, 3).join(" ") || "MARKET"}
    </span>
  );
}

/**
 * Always-visible news ticker.
 *
 * Only shows headlines from the last few minutes — the bar is for what just
 * happened, and an hour-old story scrolling as though it were current is worse
 * than no bar at all. Full history lives on the News page.
 *
 * A single headline is shown still rather than scrolled: a marquee with one
 * short item looks like a glitch, and a headline that will not sit still is
 * hard to read on a phone.
 */
export function NewsTicker() {
  const { data } = usePoll<{ items: NewsItem[] }>("/api/news", 10_000);
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  const latest = items[0]!;
  const scroll = items.length > 1;

  return (
    <div className="border-b border-border bg-surface-2/70">
      {/* Mobile: newest headline only, never scrolling. */}
      <Link href="/news" className="flex items-center gap-2 px-3 py-1.5 sm:hidden">
        <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-black">NEWS</span>
        <span className="truncate text-xs">{latest.headline}</span>
        <span className="ml-auto shrink-0 text-[10px] text-muted">{age(latest.publishedAt)}</span>
      </Link>

      <div className="hidden items-center gap-3 overflow-hidden px-3 py-1.5 sm:flex">
        <Link href="/news"
          className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-black">
          NEWS
        </Link>

        {scroll ? (
          <div className="relative flex-1 overflow-hidden">
            <div className="marquee flex w-max gap-8 whitespace-nowrap text-xs">
              {[0, 1].map((copy) => (
                <div key={copy} className="flex gap-8" aria-hidden={copy === 1}>
                  {items.map((n) => (
                    <span key={`${copy}-${n.id}`} className="flex items-center gap-2">
                      <Symbols item={n} />
                      <span>{n.headline}</span>
                      <span className="text-muted">{age(n.publishedAt)}</span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-2 truncate text-xs">
            <Symbols item={latest} />
            <span className="truncate">{latest.headline}</span>
            <span className="ml-auto shrink-0 text-muted">{age(latest.publishedAt)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
