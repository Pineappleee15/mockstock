"use client";

import { useMemo, useState } from "react";
import { usePoll } from "@/lib/use-poll";
import { Card, Change, Badge, Empty } from "@/components/ui";
import { LivePrice } from "@/components/price";
import { PriceChart } from "@/components/price-chart";
import { TradePanel } from "@/components/trade-panel";
import type { MarketRow, PortfolioView } from "@/lib/queries";

interface Props {
  symbol: string; name: string; sector: string;
  spreadBps: number; brokerageBps: number; concentrationCapBps: number;
  tradingOpen: boolean;
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

  const row = useMemo(
    () => market?.stocks.find((s) => s.symbol === props.symbol) ?? null,
    [market, props.symbol],
  );
  const position = pf?.positions.find((p) => p.symbol === props.symbol) ?? null;

  if (!row) return <Empty>Loading {props.symbol}…</Empty>;

  const marketOpen = market?.state === "open";

  return (
    <div className="space-y-3 pb-24 sm:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
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
        />
      </Card>

      {position && (
        <Card className="px-3 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
            <span className="text-muted">Your position</span>
            <span className="num">{position.quantity} shares</span>
            <span className="num text-muted">avg {(position.avgCostPaise / 100).toFixed(2)}</span>
            <span><Change bps={position.unrealisedBps} /></span>
          </div>
        </Card>
      )}

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
        onFilled={(msg: string) => { setFlash(msg); void refreshPf(); setTimeout(() => setFlash(null), 6000); }}
      />
    </div>
  );
}
