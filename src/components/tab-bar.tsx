"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePoll } from "@/lib/use-poll";
import { cn } from "@/lib/cn";
import type { MarketIndex } from "@/lib/market-index";

/**
 * Floating tab bar, phone only.
 *
 * Moves navigation off the top of the screen, which on a phone is the hardest
 * place to reach and the most valuable space for actual content. It floats over
 * the gradient rather than sitting on a bar, so the page scrolls underneath.
 */

function Icon({ d, filled }: { d: string; filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[22px]" aria-hidden
      fill={filled ? "currentColor" : "none"} stroke="currentColor"
      strokeWidth={filled ? 0 : 1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const TABS = [
  { href: "/dashboard", label: "Portfolio", d: "M3 12h4l3 8 4-16 3 8h4" },
  { href: "/market", label: "Market", d: "M4 19V9m5 10V5m5 14v-7m5 7V8" },
  { href: "/news", label: "News", d: "M4 5h16v14H4zM7 9h10M7 13h10M7 17h6" },
  { href: "/leaderboard", label: "Ranks", d: "M8 21V9m4 12V4m4 17v-6" },
  { href: "/trades", label: "History", d: "M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" },
];

export function TabBar() {
  const path = usePathname();
  const { data } = usePoll<{ index: MarketIndex; mood: string | null; state: string }>(
    "/api/market", 5000,
  );

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 sm:hidden">
      <div className="mx-auto flex max-w-md flex-col gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {/* Market strip: the one number worth carrying on every screen. */}
        {data?.index && (
          <Link
            href="/market"
            className="glass-pill press pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2"
          >
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
              Market
            </span>
            <span className="num text-sm font-semibold">{data.index.value.toFixed(2)}</span>
            <span className={cn(
              "num text-sm font-semibold",
              data.index.returnBps > 0 ? "text-up" : data.index.returnBps < 0 ? "text-down" : "text-muted",
            )}>
              {data.index.returnBps > 0 ? "+" : ""}{(data.index.returnBps / 100).toFixed(2)}%
            </span>
            {data.mood && (
              <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                {data.mood}
              </span>
            )}
          </Link>
        )}

        <nav className="glass-pill pointer-events-auto flex items-center justify-between rounded-[26px] px-2 py-1.5">
          {TABS.map((t) => {
            const active = path === t.href || path.startsWith(t.href + "/");
            return (
              <Link
                key={t.href} href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "press flex flex-1 flex-col items-center gap-0.5 rounded-2xl px-1 py-1.5",
                  active ? "tab-active text-accent" : "text-muted",
                )}
              >
                <Icon d={t.d} filled={false} />
                <span className="text-[10px] font-semibold tracking-tight">{t.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
