"use client";

import Link from "next/link";
import { usePoll } from "@/lib/use-poll";
import { Empty } from "@/components/ui";
import { RollingNumber } from "@/components/rolling-number";
import { Lobby, type LobbyRules } from "@/components/lobby";
import { formatRupees, formatBps } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { PortfolioView, MarketRow, MarketIndex } from "@/lib/queries";

type Payload = PortfolioView & { tick: number; state: string };

/** A label above a value. No box — the hierarchy does the separating. */
function Figure({
  label, children, tone,
}: { label: string; children: React.ReactNode; tone?: "up" | "down" }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className={cn(
        "num mt-1 truncate text-[15px] font-medium tabular-nums",
        tone === "up" && "text-up", tone === "down" && "text-down",
      )}>
        {children}
      </div>
    </div>
  );
}

function Delta({ bps, className }: { bps: number; className?: string }) {
  return (
    <span className={cn(
      "num tabular-nums",
      bps > 0 ? "text-up" : bps < 0 ? "text-down" : "text-muted",
      className,
    )}>
      {bps > 0 ? "+" : ""}{formatBps(bps)}
    </span>
  );
}

export function DashboardLive({ rules }: { rules: LobbyRules | null }) {
  const { data, loading, error } = usePoll<Payload>("/api/portfolio", 5000);
  const { data: market } = usePoll<{ stocks: MarketRow[]; index: MarketIndex }>("/api/market", 5000);

  if (loading && !data) return <Empty>Loading your portfolio…</Empty>;
  if (!data) return <Empty>{error ? "Could not load your portfolio." : "No portfolio yet."}</Empty>;

  const neverOpened = data.state === "draft" || data.state === "pre_open";
  if (neverOpened && rules) return <Lobby teamName={data.teamName} rules={rules} />;

  const finished = data.state === "ended";
  const alpha = market?.index ? data.returnBps - market.index.returnBps : null;
  const pnl = data.realisedPnlPaise + data.unrealisedPnlPaise;
  const rankMove = data.prevRank != null && data.rank != null ? data.prevRank - data.rank : 0;

  return (
    <div className="pb-6">
      {finished && (
        <Link href="/results"
          className="paper-page tilt-r mb-7 block rounded-sm px-5 py-4 transition-transform hover:rotate-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-[var(--color-ink-soft)]">
            That is the bell
          </div>
          <div className="display mt-1 text-2xl">
            <span className="paper-underline">See how it finished</span>
          </div>
        </Link>
      )}

      {/* The headline. One number, given the room it deserves. */}
      <header className="pt-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-[13px] text-muted">{data.teamName}</span>
          {data.rank != null && (
            <span className="flex shrink-0 items-baseline gap-1.5 text-[13px] text-muted">
              Rank
              <span className="serif text-xl text-text">#{data.rank}</span>
              {rankMove !== 0 && (
                <span className={cn("num text-[11px]", rankMove > 0 ? "text-up" : "text-down")}>
                  {rankMove > 0 ? "▲" : "▼"}{Math.abs(rankMove)}
                </span>
              )}
            </span>
          )}
        </div>

        <div className="serif mt-1 text-[clamp(2.75rem,12vw,4.25rem)] leading-[1.05]">
          <RollingNumber value={data.valuePaise} format={(n) => formatRupees(Math.round(n))} />
        </div>

        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
          <Delta bps={data.returnBps} className="text-base font-medium" />
          {/* Everyone starts in cash, so profit and loss since the open is
              simply what has been booked plus what is still open. */}
          <span className="text-muted">
            {pnl >= 0 ? "up" : "down"} {formatRupees(Math.abs(pnl))} today
          </span>
          {alpha != null && (
            <span className="text-muted">
              · <Delta bps={alpha} /> vs market
            </span>
          )}
        </div>
      </header>

      {/* Supporting figures, on a rule rather than in boxes. */}
      <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 border-t border-border/60 pt-5 sm:grid-cols-4">
        <Figure label="Cash">{formatRupees(data.cashPaise)}</Figure>
        <Figure label="Invested">{formatRupees(data.investedPaise)}</Figure>
        <Figure label="Realised" tone={data.realisedPnlPaise > 0 ? "up" : data.realisedPnlPaise < 0 ? "down" : undefined}>
          {formatRupees(data.realisedPnlPaise, { sign: true })}
        </Figure>
        <Figure label="Unrealised" tone={data.unrealisedPnlPaise > 0 ? "up" : data.unrealisedPnlPaise < 0 ? "down" : undefined}>
          {formatRupees(data.unrealisedPnlPaise, { sign: true })}
        </Figure>
      </div>

      <Positions positions={data.positions} />
      <WatchList watched={data.watched} stocks={market?.stocks ?? []} />

      <p className="mt-8 text-center text-[11px] text-muted">
        {data.tradeCount} trades · {formatRupees(data.brokeragePaidPaise)} paid in brokerage
      </p>
    </div>
  );
}

/** Section heading: a quiet label on a rule, not a card header. */
function SectionHead({ title, aside }: { title: string; aside?: React.ReactNode }) {
  return (
    <div className="mt-9 flex items-baseline justify-between border-b border-border/60 pb-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">{title}</h2>
      {aside && <span className="text-[11px] text-muted">{aside}</span>}
    </div>
  );
}

/**
 * Positions as a list, not a table.
 *
 * A table implies you will compare columns; a list implies you will scan rows,
 * which is what anyone actually does with their own holdings. It also fits a
 * phone without horizontal scrolling.
 */
function Positions({ positions }: { positions: PortfolioView["positions"] }) {
  if (positions.length === 0) {
    return (
      <>
        <SectionHead title="Positions" />
        <p className="py-8 text-center text-sm text-muted">
          Nothing held yet.{" "}
          <Link href="/market" className="text-text underline underline-offset-4">Open the market</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <SectionHead title="Positions" aside={`${positions.length} held`} />
      <ul>
        {positions.map((p) => (
          <li key={p.stockId}>
            <Link href={`/stock/${p.symbol}`}
              className="flex items-center gap-4 border-b border-border/40 py-3.5 transition-colors hover:bg-white/[0.02]">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.symbol}</span>
                  {p.halted && (
                    <span className="rounded bg-down-dim px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-down">
                      Halted
                    </span>
                  )}
                </div>
                <div className="num mt-0.5 text-[11px] text-muted">
                  {p.quantity} @ {formatRupees(p.avgCostPaise)}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="num text-[15px] tabular-nums">{formatRupees(p.marketValuePaise)}</div>
                <div className="mt-0.5 text-[11px]">
                  <span className={cn("num", p.unrealisedPaise >= 0 ? "text-up" : "text-down")}>
                    {formatRupees(p.unrealisedPaise, { sign: true })}
                  </span>{" "}
                  <Delta bps={p.unrealisedBps} className="text-[11px]" />
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Starred stocks the team does not necessarily hold — the shortlist. */
function WatchList({ watched, stocks }: { watched: string[]; stocks: MarketRow[] }) {
  const rows = stocks.filter((s) => watched.includes(s.symbol));
  if (rows.length === 0) return null;

  return (
    <>
      <SectionHead title="Watchlist" aside={`${rows.length} starred`} />
      <ul>
        {rows.map((s) => (
          <li key={s.id}>
            <Link href={`/stock/${s.symbol}`}
              className="flex items-center justify-between gap-4 border-b border-border/40 py-3 transition-colors hover:bg-white/[0.02]">
              <div className="min-w-0">
                <span className="font-medium">{s.symbol}</span>
                <span className="ml-2 truncate text-[11px] text-muted">{s.name}</span>
              </div>
              <div className="shrink-0 text-right">
                <span className="num text-[15px] tabular-nums">{formatRupees(s.pricePaise)}</span>
                <Delta bps={s.changeBps} className="ml-2 text-[11px]" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
