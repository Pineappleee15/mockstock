"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatRupees } from "@/lib/money";

export interface LobbyRules {
  competitionName: string;
  startingCashPaise: number;
  brokerageBps: number;
  spreadBps: number;
  concentrationCapBps: number;
  orderRateLimitPerMin: number;
  circuitLimitBps: number;
  startsAt: string | null;
}

function useCountdown(iso: string | null) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!iso) return;
    const tick = () => setLeft(Math.max(0, new Date(iso).getTime() - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [iso]);
  if (left == null) return null;
  const s = Math.floor(left / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * What a team sees after signing in, before the market opens.
 *
 * Replaces a portfolio of zeroes, which is the worst possible first impression
 * and also the screen everyone stares at through the organiser's introduction.
 * Paper, because it is a moment rather than a working screen — and because a
 * briefing sheet is exactly what it is.
 */
export function Lobby({ teamName, rules }: { teamName: string; rules: LobbyRules }) {
  const countdown = useCountdown(rules.startsAt);
  const waitingOn = countdown && countdown !== "0:00";

  return (
    <div className="paper-page tilt-l mx-auto max-w-2xl rounded-sm px-6 py-8 sm:px-10 sm:py-10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--color-ink-soft)]">
        BCX · {rules.competitionName}
      </p>
      <h1 className="display mt-2 text-3xl leading-tight sm:text-4xl">
        <span className="paper-underline">{teamName}</span>
      </h1>

      <div className="mt-6 border-y border-[var(--color-paper-edge)] py-5 text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--color-ink-soft)]">
          {waitingOn ? "Trading opens in" : "Waiting for the opening bell"}
        </p>
        <p className="num mt-1 text-4xl font-bold text-[var(--color-ink)] sm:text-5xl">
          {waitingOn ? countdown : "—"}
        </p>
        <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
          This page moves on by itself. Nothing to refresh.
        </p>
      </div>

      <div className="mt-6">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--color-ink-soft)]">
          Your brief
        </h2>
        <dl className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <Rule term="Starting cash" desc={formatRupees(rules.startingCashPaise, { decimals: false })} />
          <Rule term="Brokerage" desc={`${(rules.brokerageBps / 100).toFixed(2)}% per trade`} />
          <Rule term="Spread" desc={`${(rules.spreadBps / 100).toFixed(2)}%`} />
          <Rule term="Max in one stock" desc={`${(rules.concentrationCapBps / 100).toFixed(0)}% of your portfolio`} />
          <Rule term="Order limit" desc={`${rules.orderRateLimitPerMin} a minute`} />
          <Rule term="Circuit breaker" desc={`halts at ${(rules.circuitLimitBps / 100).toFixed(0)}% from the open`} />
        </dl>
      </div>

      <div className="mt-6 rounded-sm bg-[var(--color-paper-2)]/70 px-4 py-3 text-sm leading-relaxed text-[var(--color-ink)]">
        <strong>Your buying and selling is what moves the prices.</strong> There is no outside
        market here. If everyone piles into the same stock it will run, and it will come back down
        when they stop. Watch what the room is doing, not just the chart.
      </div>

      <p className="mt-5 text-xs text-[var(--color-ink-soft)]">
        You can research before the bell.{" "}
        <Link href="/market" className="font-semibold text-[var(--color-accent-ink)] underline underline-offset-2">
          Read the market
        </Link>{" "}
        — every company has accounts, a price history and an analyst view. Some of it is worth
        believing.
      </p>
    </div>
  );
}

function Rule({ term, desc }: { term: string; desc: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-paper-edge)]/50 pb-1.5">
      <dt className="text-xs text-[var(--color-ink-soft)]">{term}</dt>
      <dd className="num text-sm font-semibold">{desc}</dd>
    </div>
  );
}
