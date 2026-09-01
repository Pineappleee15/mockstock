"use client";

import { usePoll } from "@/lib/use-poll";
import { cn } from "@/lib/cn";

interface NewsItem {
  id: number; headline: string; impactBps: number; symbols: string[]; publishedAt: string;
}

/**
 * Always-visible news ticker. Marquee on desktop, latest headline only on
 * mobile where a scrolling strip is unreadable on a phone mid-trade.
 */
export function NewsTicker() {
  const { data } = usePoll<{ items: NewsItem[] }>("/api/news", 10_000);
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  const latest = items[0]!;

  return (
    <div className="border-b border-border bg-surface-2/70">
      {/* Mobile: newest headline only. */}
      <div className="flex items-center gap-2 px-3 py-1.5 sm:hidden">
        <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-black">NEWS</span>
        <span className="truncate text-xs">{latest.headline}</span>
      </div>

      {/* Desktop: scrolling strip. */}
      <div className="hidden items-center gap-3 overflow-hidden px-3 py-1.5 sm:flex">
        <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-black">NEWS</span>
        <div className="relative flex-1 overflow-hidden">
          <div className="marquee flex w-max gap-8 whitespace-nowrap text-xs">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex gap-8" aria-hidden={copy === 1}>
                {items.map((n) => (
                  <span key={`${copy}-${n.id}`} className="flex items-center gap-2">
                    <span className={cn(
                      "num font-semibold",
                      n.impactBps > 0 ? "text-up" : n.impactBps < 0 ? "text-down" : "text-muted",
                    )}>
                      {n.symbols.slice(0, 3).join(" ") || "MARKET"}
                    </span>
                    <span>{n.headline}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
