"use client";

import { usePoll } from "@/lib/use-poll";
import { Card, Change, Empty, Badge } from "@/components/ui";
import { formatRupees, formatCompact } from "@/lib/money";
import type { LeaderRow, MarketIndex } from "@/lib/queries";

export function LeaderboardLive() {
  const { data, loading } = usePoll<{
    tick: number; frozen: boolean; rows: LeaderRow[]; index: MarketIndex;
  }>("/api/leaderboard", 5000);

  if (loading && !data) return <Empty>Loading the leaderboard…</Empty>;
  const rows = data?.rows ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Leaderboard</h1>
        <div className="flex items-center gap-3">
          {data?.index && (
            <span className="text-xs text-muted">
              Market <span className="num">{data.index.value.toFixed(2)}</span>{" "}
              <Change bps={data.index.returnBps} />
            </span>
          )}
          {data?.frozen && <Badge tone="warn">Final</Badge>}
        </div>
      </div>

      <Card>
        <table className="hidden w-full text-sm sm:table">
          <thead className="text-[11px] uppercase tracking-wide text-muted">
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Team</th>
              <th className="px-3 py-2 text-right font-medium">Value</th>
              <th className="px-3 py-2 text-right font-medium">Cash</th>
              <th className="px-3 py-2 text-right font-medium">Invested</th>
              <th className="px-3 py-2 text-right font-medium">Return</th>
              <th className="px-3 py-2 text-right font-medium">Alpha</th>
              <th className="px-3 py-2 text-right font-medium">Trades</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.teamId} className="border-b border-border/50 last:border-0">
                <td className="px-3 py-2">
                  <span className="num font-semibold">{r.rank}</span>
                  <RankMove rank={r.rank} prev={r.prevRank} />
                </td>
                <td className="max-w-[28ch] truncate px-3 py-2 font-medium">{r.teamName}</td>
                <td className="num px-3 py-2 text-right">{formatRupees(r.valuePaise)}</td>
                <td className="num px-3 py-2 text-right text-muted">{formatRupees(r.cashPaise)}</td>
                <td className="num px-3 py-2 text-right text-muted">{formatRupees(r.investedPaise)}</td>
                <td className="px-3 py-2 text-right"><Change bps={r.returnBps} /></td>
                <td className="px-3 py-2 text-right">
                  <Change bps={r.returnBps - (data?.index?.returnBps ?? 0)} />
                </td>
                <td className="num px-3 py-2 text-right text-muted">{r.tradeCount}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="divide-y divide-border/50 sm:hidden">
          {rows.map((r) => (
            <div key={r.teamId} className="flex items-center gap-3 px-3 py-2.5">
              <div className="w-8 shrink-0">
                <span className="num font-bold">{r.rank}</span>
                <RankMove rank={r.rank} prev={r.prevRank} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.teamName}</div>
                <div className="num text-[11px] text-muted">
                  {formatCompact(r.cashPaise)} cash · {r.tradeCount} trades
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="num text-sm">{formatCompact(r.valuePaise)}</div>
                <Change bps={r.returnBps} className="text-xs" />
              </div>
            </div>
          ))}
        </div>

        {rows.length === 0 && <Empty>No standings yet. They appear once the market opens.</Empty>}
      </Card>

      <p className="text-center text-[11px] text-muted">
        Updates every 5 seconds. Ties broken by realised P&amp;L, then fewer trades.
        Alpha is your return less the market&apos;s, so it ranks the same but shows whether you
        beat the market or just rode it.
      </p>
    </div>
  );
}

function RankMove({ rank, prev }: { rank: number; prev: number | null }) {
  if (prev == null || prev === rank) return null;
  const up = prev > rank;
  return (
    <span className={`num ml-1 text-[10px] ${up ? "text-up" : "text-down"}`}>
      {up ? "▲" : "▼"}{Math.abs(prev - rank)}
    </span>
  );
}
