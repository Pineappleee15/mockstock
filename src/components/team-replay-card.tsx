import { formatRupees, formatBps } from "@/lib/money";
import type { TeamReplay } from "@/lib/replay";

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--color-paper-edge)]/50 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
        {label}
      </div>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}

function Money({ paise }: { paise: number }) {
  return (
    <span className={`num font-semibold ${paise >= 0 ? "text-[#14733f]" : "text-[#a3242f]"}`}>
      {paise >= 0 ? "+" : ""}{formatRupees(paise)}
    </span>
  );
}

/**
 * One team's session, told back to them.
 *
 * The market-impact line is the part nobody expects: because every order-flow
 * adjustment is logged with the volume behind it, the app can say exactly which
 * prices a team moved and by how much. It is the most convincing evidence that
 * the market was really made by the room.
 */
export function TeamReplayCard({ r }: { r: TeamReplay }) {
  return (
    <div className="paper-card px-5 py-6">
      <span className="paper-tape" aria-hidden />

      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--color-accent-ink)]">
            Finished #{r.rank}
          </div>
          <h2 className="display mt-0.5 text-2xl">{r.teamName}</h2>
        </div>
        <div className="text-right">
          <div className="num text-xl font-bold">{formatRupees(r.valuePaise, { decimals: false })}</div>
          <div className={`num text-sm font-bold ${r.returnBps >= 0 ? "text-[#14733f]" : "text-[#a3242f]"}`}>
            {r.returnBps > 0 ? "+" : ""}{formatBps(r.returnBps)}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-x-8 sm:grid-cols-2">
        <div>
          {r.best && (
            <Line label="Best call">
              {r.best.side === "buy" ? "Bought" : "Sold"} {r.best.quantity} {r.best.symbol} at{" "}
              {formatRupees(r.best.fillPricePaise)}
              {r.best.side === "buy" && <> · closed {formatRupees(r.best.closePricePaise)}</>}
              <div className="mt-0.5"><Money paise={r.best.valuePaise} /></div>
            </Line>
          )}
          {r.worst && r.worst.valuePaise < 0 && (
            <Line label="Worst call">
              {r.worst.side === "buy" ? "Bought" : "Sold"} {r.worst.quantity} {r.worst.symbol} at{" "}
              {formatRupees(r.worst.fillPricePaise)}
              {r.worst.side === "buy" && <> · closed {formatRupees(r.worst.closePricePaise)}</>}
              <div className="mt-0.5"><Money paise={r.worst.valuePaise} /></div>
            </Line>
          )}
          <Line label="Activity">
            <span className="num">{r.tradeCount}</span> trades
            {r.busiest && <> · busiest in <strong>{r.busiest.symbol}</strong> ({r.busiest.trades})</>}
            <div className="mt-0.5 text-xs text-[var(--color-ink-soft)]">
              paid <span className="num">{formatRupees(r.brokeragePaidPaise)}</span> in brokerage
            </div>
          </Line>
        </div>

        <div>
          {r.moved.length > 0 && (
            <Line label="Prices you moved">
              <ul className="space-y-1">
                {r.moved.map((m) => (
                  <li key={m.symbol} className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{m.symbol}</span>
                    <span className="num text-xs text-[var(--color-ink-soft)]">
                      {(m.bps / 100).toFixed(2)}% of its move · you were {m.shareOfFlowPct}% of the flow
                    </span>
                  </li>
                ))}
              </ul>
            </Line>
          )}
          <Line label="Realised profit">
            <Money paise={r.realisedPnlPaise} />
            <span className="ml-2 text-xs text-[var(--color-ink-soft)]">booked on sales</span>
          </Line>
          {r.missed && r.missed.changeBps > 0 && (
            <Line label="The one that got away">
              <strong>{r.missed.symbol}</strong> rose{" "}
              <span className="num text-[#14733f]">{formatBps(r.missed.changeBps)}</span> and you
              never touched it.
            </Line>
          )}
        </div>
      </div>
    </div>
  );
}
