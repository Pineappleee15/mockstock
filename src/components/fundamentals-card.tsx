"use client";

import { Card } from "@/components/ui";
import { formatRupees, formatCompact } from "@/lib/money";
import type { Fundamentals } from "@/lib/fundamentals";

const RATING_TONE: Record<Fundamentals["analystRating"], string> = {
  "Strong buy": "bg-up-dim text-up",
  Buy: "bg-up-dim/60 text-up",
  Hold: "bg-surface-2 text-muted",
  Reduce: "bg-down-dim/60 text-down",
  Sell: "bg-down-dim text-down",
};

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-xs text-muted">
        {label}
        {hint && <span className="ml-1 text-[10px] text-muted/60">{hint}</span>}
      </span>
      <span className="num text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

/**
 * What a team has to go on besides the tape.
 *
 * Every figure here is a real function of the stock's hidden parameters, so
 * reading it well genuinely pays — measured at roughly seven percentage points
 * over three hours, winning about 85% of the time. It is not a cheat sheet: the
 * analyst view in particular is deliberately noisier than the accounts.
 */
export function FundamentalsCard({
  f, pricePaise, sector,
}: { f: Fundamentals; pricePaise: number; sector: string }) {
  const upside = (f.analystTargetPaise - pricePaise) / pricePaise;
  const inRange = Math.max(0, Math.min(1,
    (pricePaise - f.low52Paise) / Math.max(1, f.high52Paise - f.low52Paise)));

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Company</h2>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
          {sector}
        </span>
      </div>

      <p className="mb-3 text-xs leading-relaxed text-muted">{f.summary}</p>

      <div className="grid gap-x-6 sm:grid-cols-2">
        <div className="divide-y divide-border/40">
          <Row label="Market cap" value={`₹${f.marketCapCr.toLocaleString("en-IN")} Cr`} />
          <Row label="Revenue growth" hint="yoy" value={`${f.revenueGrowthPct}%`} />
          <Row label="Profit margin" value={`${f.profitMarginPct}%`} />
        </div>
        <div className="divide-y divide-border/40">
          <Row label="P/E ratio" value={String(f.peRatio)} />
          <Row label="Debt to equity" value={String(f.debtToEquity)} />
          <Row label="Beta" hint="vs market" value={String(f.beta)} />
        </div>
      </div>

      <div className="mt-3 border-t border-border/60 pt-3">
        <div className="mb-1 flex items-baseline justify-between text-xs">
          <span className="text-muted">52-week range</span>
          <span className="num text-muted">
            {formatCompact(f.low52Paise)} – {formatCompact(f.high52Paise)}
          </span>
        </div>
        <div className="relative h-1.5 rounded-full bg-surface-2" aria-hidden>
          <div
            className="absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-accent"
            style={{ left: `calc(${(inRange * 100).toFixed(1)}% - 5px)` }}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
        <div>
          <div className="text-xs text-muted">Analyst target</div>
          <div className="num text-sm font-semibold">
            {formatRupees(f.analystTargetPaise)}
            <span className={`ml-2 text-xs ${upside >= 0 ? "text-up" : "text-down"}`}>
              {upside >= 0 ? "+" : ""}{(upside * 100).toFixed(1)}%
            </span>
          </div>
        </div>
        <span className={`rounded px-2 py-1 text-[11px] font-semibold ${RATING_TONE[f.analystRating]}`}>
          {f.analystRating}
        </span>
      </div>

      <p className="mt-2 text-[10px] leading-snug text-muted/70">
        Analysts are often right and sometimes badly wrong. The accounts are the more reliable read.
      </p>
    </Card>
  );
}
