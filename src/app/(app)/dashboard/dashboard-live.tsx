"use client";

import Link from "next/link";
import { usePoll } from "@/lib/use-poll";
import { Card, Stat, Change, Money, Badge, Empty } from "@/components/ui";
import { LivePrice } from "@/components/price";
import { formatRupees } from "@/lib/money";
import type { PortfolioView } from "@/lib/queries";

type Payload = PortfolioView & { tick: number; state: string };

export function DashboardLive() {
  const { data, loading, error } = usePoll<Payload>("/api/portfolio", 5000);

  if (loading && !data) return <Empty>Loading your portfolio…</Empty>;
  if (!data) return <Empty>{error ? "Could not load your portfolio." : "No portfolio yet."}</Empty>;

  const rankMove = data.prevRank != null && data.rank != null ? data.prevRank - data.rank : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="truncate text-lg font-semibold">{data.teamName}</h1>
        {data.rank != null && (
          <div className="flex shrink-0 items-baseline gap-1.5 text-sm">
            <span className="text-muted">Rank</span>
            <span className="num text-xl font-bold">#{data.rank}</span>
            {rankMove !== 0 && (
              <span className={`num text-xs ${rankMove > 0 ? "text-up" : "text-down"}`}>
                {rankMove > 0 ? "▲" : "▼"}{Math.abs(rankMove)}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Portfolio value" value={<LivePrice paise={data.valuePaise} />} />
        <Stat label="Return"
          tone={data.returnBps > 0 ? "up" : data.returnBps < 0 ? "down" : "neutral"}
          value={<Change bps={data.returnBps} />} />
        <Stat label="Cash" value={formatRupees(data.cashPaise)}
          sub={`${data.positions.length} position${data.positions.length === 1 ? "" : "s"}`} />
        <Stat label="Invested" value={formatRupees(data.investedPaise)}
          sub={<>fees paid {formatRupees(data.brokeragePaidPaise)}</>} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Realised P&L" value={<Money paise={data.realisedPnlPaise} sign />} />
        <Stat label="Unrealised P&L" value={<Money paise={data.unrealisedPnlPaise} sign />} />
        <Stat label="Trades" value={<span className="num">{data.tradeCount}</span>} />
      </div>

      <Card>
        <div className="border-b border-border px-3 py-2 text-sm font-semibold">Open positions</div>
        {data.positions.length === 0 ? (
          <Empty>
            No positions yet. <Link href="/market" className="text-accent hover:underline">Go to the market</Link>
          </Empty>
        ) : (
          <>
            {/* Desktop table */}
            <table className="hidden w-full text-sm sm:table">
              <thead className="text-[11px] uppercase tracking-wide text-muted">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-medium">Stock</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Avg cost</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2 text-right font-medium">P&L</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((p) => (
                  <tr key={p.stockId} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2">
                      <Link href={`/stock/${p.symbol}`} className="font-semibold hover:text-accent">
                        {p.symbol}
                      </Link>
                      {p.halted && <span className="ml-2"><Badge tone="warn">Halted</Badge></span>}
                    </td>
                    <td className="num px-3 py-2 text-right">{p.quantity}</td>
                    <td className="num px-3 py-2 text-right text-muted">{formatRupees(p.avgCostPaise)}</td>
                    <td className="px-3 py-2 text-right"><LivePrice paise={p.pricePaise} /></td>
                    <td className="num px-3 py-2 text-right">{formatRupees(p.marketValuePaise)}</td>
                    <td className="px-3 py-2 text-right">
                      <Money paise={p.unrealisedPaise} sign />
                      <span className="ml-2 text-xs"><Change bps={p.unrealisedBps} /></span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile cards */}
            <div className="divide-y divide-border/50 sm:hidden">
              {data.positions.map((p) => (
                <Link key={p.stockId} href={`/stock/${p.symbol}`} className="block px-3 py-2.5">
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold">{p.symbol}</span>
                    <LivePrice paise={p.pricePaise} />
                  </div>
                  <div className="mt-1 flex items-baseline justify-between text-xs text-muted">
                    <span className="num">{p.quantity} @ {formatRupees(p.avgCostPaise)}</span>
                    <span><Money paise={p.unrealisedPaise} sign /> <Change bps={p.unrealisedBps} /></span>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
