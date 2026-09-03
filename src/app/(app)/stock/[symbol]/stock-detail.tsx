"use client";

import { useMemo, useState } from "react";
import { usePoll } from "@/lib/use-poll";
import { Card, Change, Badge, Empty } from "@/components/ui";
import { LivePrice } from "@/components/price";
import { formatRupees } from "@/lib/money";
import { PriceChart } from "@/components/price-chart";
import { TradePanel } from "@/components/trade-panel";
import { FundamentalsCard } from "@/components/fundamentals-card";
import { WatchStar } from "@/components/watch-star";
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

export function StockDetail(props: Props) {
  const { data: market } = usePoll<{ stocks: MarketRow[]; state: string }>("/api/market", 5000);
  const { data: chart } = usePoll<ChartPayload>(`/api/chart?symbol=${props.symbol}`, 5000);
  const { data: pf, refresh: refreshPf } = usePoll<PortfolioView>("/api/portfolio", 5000);
  const [flash, setFlash] = useState<string | null>(null);
  // Today by default: sixty days of backstory on the same scale flattens three
  // hours of trading into a line.
  const [range, setRange] = useState<"today" | "history">("today");

  const row = useMemo(
    () => market?.stocks.find((s) => s.symbol === props.symbol) ?? null,
    [market, props.symbol],
  );
  const position = pf?.positions.find((p) => p.symbol === props.symbol) ?? null;

  if (!row) return <Empty>Loading {props.symbol}…</Empty>;

  const marketOpen = market?.state === "open";
  const hasHistory = (chart?.series ?? []).some((d) => d.t < 0);

  return (
    <div className="space-y-3 pb-24 sm:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <WatchStar symbol={props.symbol} watched={pf?.watched?.includes(props.symbol) ?? false} size="lg" />
            <h1 className="text-xl font-bold">{props.symbol}</h1>
            {row.halted && <Badge tone="warn">Halted</Badge>}
          </div>
          <p className="truncate text-sm text-muted">{props.name} · {props.sector}</p>
        </div>
        <div className="shrink-0 text-right">
          <LivePrice paise={row.pricePaise} size="xl" />
          <div className="text-sm"><Change bps={row.changeBps} /> today</div>
        </div>
      </div>

      {flash && (
        <div role="status" className="rounded-md bg-up/10 px-3 py-2 text-sm text-up">{flash}</div>
      )}

      <Card className="p-2">
        <PriceChart
          series={chart?.series ?? []}
          openPaise={chart?.openPaise ?? row.openPaise}
          up={row.changeBps >= 0}
          showHistory={range === "history"}
        />
        {hasHistory && (
          <div className="mt-1 flex justify-center gap-1">
            {([["today", "Today"], ["history", "60 days"]] as const).map(([key, label]) => (
              <button
                key={key} onClick={() => setRange(key)}
                aria-pressed={range === key}
                className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                  range === key ? "bg-surface-2 text-text" : "text-muted hover:text-text"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </Card>

      {position && (
        <Card className="px-3 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
            <span className="text-muted">
              {position.quantity < 0 ? "You are short" : "Your position"}
            </span>
            <span className="num">{Math.abs(position.quantity)} shares</span>
            <span className="num text-muted">
              {position.quantity < 0 ? "sold at" : "avg"} {formatRupees(position.avgCostPaise)}
            </span>
            <span><Change bps={position.unrealisedBps} /></span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-border/60 pt-2 text-[11px] text-muted sm:grid-cols-4">
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
              <span className={`num ${position.unrealisedPaise >= 0 ? "text-up" : "text-down"}`}>
                {formatRupees(position.unrealisedPaise, { sign: true })}
              </span>
            </span>
            <span>Return <Change bps={position.unrealisedBps} /></span>
          </div>
        </Card>
      )}

      <FundamentalsCard
        f={props.fundamentals}
        pricePaise={row.pricePaise}
        sector={props.sector}
      />

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
