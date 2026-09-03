"use client";

import { useMemo, useState } from "react";
import { usePoll } from "@/lib/use-poll";
import { Empty } from "@/components/ui";
import { RollingNumber } from "@/components/rolling-number";
import { PriceChart } from "@/components/price-chart";
import { TradePanel } from "@/components/trade-panel";
import { FundamentalsCard } from "@/components/fundamentals-card";
import { WatchStar } from "@/components/watch-star";
import { formatRupees, formatBps } from "@/lib/money";
import { Change as Delta } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { MarketRow, PortfolioView } from "@/lib/queries";
import type { Fundamentals } from "@/lib/fundamentals";

interface Props {
  symbol: string; name: string; sector: string;
  spreadBps: number; brokerageBps: number; concentrationCapBps: number;
  tradingOpen: boolean;
  shortSellingEnabled: boolean;
  fundamentals: Fundamentals;
}

interface ChartPayload {
  symbol: string; halted: boolean; openPaise: number;
  tickIntervalSeconds: number; series: Array<{ t: number; p: number }>;
}

/**
 * The stock page as a hero rather than a report.
 *
 * Symbol and price at full size, the chart bleeding to the edges of the screen
 * with no container around it, and everything else below the fold. A chart in a
 * bordered box reads as a figure in a document; a chart that touches both edges
 * reads as the thing you came to look at.
 */
export function StockDetail(props: Props) {
  const { data: market } = usePoll<{ stocks: MarketRow[]; state: string }>("/api/market", 5000);
  const { data: chart } = usePoll<ChartPayload>(`/api/chart?symbol=${props.symbol}`, 5000);
  const { data: pf, refresh: refreshPf } = usePoll<PortfolioView>("/api/portfolio", 5000);
  const [flash, setFlash] = useState<string | null>(null);
  // Today by default once the session has started: during an event the last
  // three hours matter and the sixty days of backstory only flatten them.
  const [range, setRange] = useState<"today" | "history">("today");

  const row = useMemo(
    () => market?.stocks.find((s) => s.symbol === props.symbol) ?? null,
    [market, props.symbol],
  );
  const position = pf?.positions.find((p) => p.symbol === props.symbol) ?? null;

  if (!row) return <Empty>Loading {props.symbol}…</Empty>;

  const marketOpen = market?.state === "open";
  const up = row.changeBps >= 0;
  const hasHistory = (chart?.series ?? []).some((d) => d.t < 0);

  return (
    <div className="pb-56 sm:pb-4">
      <header className="flex items-start justify-between gap-4 pt-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-medium tracking-tight">{props.symbol}</h1>
            {row.halted && (
              <span className="rounded bg-down-dim px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-down">
                Halted
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-muted">{props.name} · {props.sector}</p>

          <div className="serif mt-3 text-[clamp(2.5rem,11vw,3.75rem)] leading-none">
            <RollingNumber value={row.pricePaise} format={(n) => formatRupees(Math.round(n))} />
          </div>
          <div className={cn("num mt-1 text-sm tabular-nums", up ? "text-up" : "text-down")}>
            {up ? "+" : ""}{formatBps(row.changeBps)}
            <span className="ml-2 text-muted">since the open</span>
          </div>
        </div>

        <WatchStar
          symbol={props.symbol}
          watched={pf?.watched?.includes(props.symbol) ?? false}
          size="lg"
        />
      </header>

      {flash && (
        <div role="status" className="mt-4 rounded-xl bg-up/10 px-3 py-2 text-sm text-up">
          {flash}
        </div>
      )}

      {/* Full bleed: cancels the page gutter so the chart touches both edges. */}
      <div className="-mx-3 mt-5">
        <PriceChart
          series={chart?.series ?? []}
          openPaise={chart?.openPaise ?? row.openPaise}
          up={up}
          showHistory={range === "history"}
        />
      </div>

      {hasHistory && (
        <div className="mt-2 flex justify-center gap-1">
          {([["today", "Today"], ["history", "60 days"]] as const).map(([key, label]) => (
            <button
              key={key} onClick={() => setRange(key)}
              aria-pressed={range === key}
              className={cn(
                "press rounded-full px-3.5 py-1.5 text-[11px] font-medium transition-colors",
                range === key ? "bg-white/[0.08] text-text" : "text-muted hover:text-text",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {position && (
        <div className="mt-5 border-y border-border/60 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 text-[13px]">
            <span className="text-muted">
              {position.quantity < 0 ? "You are short" : "You hold"}
            </span>
            <span className="num">{Math.abs(position.quantity)} shares</span>
            <span className="num text-muted">
              {position.quantity < 0 ? "sold at" : "avg"} {formatRupees(position.avgCostPaise)}
            </span>
            <span className={cn("num", position.unrealisedPaise >= 0 ? "text-up" : "text-down")}>
              {formatRupees(position.unrealisedPaise, { sign: true })}
            </span>
          </div>
          {/* Asked for in the notes: what this position is actually worth,
              spelled out rather than left to be inferred from two numbers. */}
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-muted sm:grid-cols-4">
            <span>
              {position.quantity < 0 ? "Cost to close" : "Market value"}{" "}
              <span className="num text-text">{formatRupees(Math.abs(position.marketValuePaise))}</span>
            </span>
            <span>
              {position.quantity < 0 ? "Received" : "Cost basis"}{" "}
              <span className="num text-text">
                {formatRupees(Math.abs(position.quantity) * position.avgCostPaise)}
              </span>
            </span>
            <span>
              Unrealised{" "}
              <span className={cn("num", position.unrealisedPaise >= 0 ? "text-up" : "text-down")}>
                {formatRupees(position.unrealisedPaise, { sign: true })}
              </span>
            </span>
            <span>
              Return <span className="num"><Delta bps={position.unrealisedBps} /></span>
            </span>
          </div>
        </div>
      )}

      <div className="mt-6">
        <FundamentalsCard
          f={props.fundamentals}
          pricePaise={row.pricePaise}
          sector={props.sector}
        />
      </div>

      <TradePanel
        symbol={props.symbol}
        pricePaise={row.pricePaise}
        halted={row.halted}
        marketOpen={marketOpen && props.tradingOpen}
        cashPaise={pf?.cashPaise ?? 0}
        heldQty={position?.quantity ?? 0}
        portfolioValuePaise={pf?.valuePaise ?? 0}
        positionValuePaise={position?.marketValuePaise ?? 0}
        spreadBps={props.spreadBps}
        brokerageBps={props.brokerageBps}
        concentrationCapBps={props.concentrationCapBps}
        shortSellingEnabled={props.shortSellingEnabled}
        onFilled={(msg: string) => { setFlash(msg); void refreshPf(); setTimeout(() => setFlash(null), 6000); }}
      />
    </div>
  );
}
