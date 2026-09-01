"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { voidTradeAction } from "@/actions/admin";
import { ActionForm } from "@/components/action-button";
import { Card, Badge, Button, Input, Empty, Money } from "@/components/ui";
import { formatRupees } from "@/lib/money";

export interface AdminTrade {
  id: number; teamName: string; symbol: string; side: "buy" | "sell";
  quantity: number; fillPricePaise: number; grossPaise: number;
  brokeragePaise: number; realisedPnlPaise: number; executedAt: string;
  voided: boolean; voidReason: string | null;
}

export function TradesPanel({
  trades, filters,
}: { trades: AdminTrade[]; filters: { team: string; symbol: string; side: string } }) {
  const router = useRouter();
  const [voiding, setVoiding] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const qs = new URLSearchParams();
            for (const k of ["team", "symbol", "side"]) {
              const v = String(fd.get(k) ?? "").trim();
              if (v) qs.set(k, v);
            }
            router.push(`/admin/trades?${qs.toString()}`);
          }}
        >
          <Input name="team" defaultValue={filters.team} placeholder="Team name" className="max-w-56" />
          <Input name="symbol" defaultValue={filters.symbol} placeholder="Symbol" className="max-w-40" />
          <select name="side" defaultValue={filters.side}
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
            <option value="">Both sides</option>
            <option value="buy">Buys</option>
            <option value="sell">Sells</option>
          </select>
          <Button type="submit">Filter</Button>
        </form>
      </Card>

      <Card>
        <div className="border-b border-border px-3 py-2 text-sm font-semibold">
          {trades.length} trades {trades.length === 500 && <span className="text-muted">(newest 500)</span>}
        </div>
        {trades.length === 0 ? <Empty>No trades match.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-muted">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-medium">Time</th>
                  <th className="px-3 py-2 text-left font-medium">Team</th>
                  <th className="px-3 py-2 text-left font-medium">Trade</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2 text-right font-medium">P&amp;L</th>
                  <th className="px-3 py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <Fragment key={t.id}>
                    <TradeRowView trade={t} onToggle={() => setVoiding(voiding === t.id ? null : t.id)} />
                    {voiding === t.id && <VoidRow trade={t} />}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function TradeRowView({ trade: t, onToggle }: { trade: AdminTrade; onToggle: () => void }) {
  return (
    <tr className={`border-b border-border/50 ${t.voided ? "opacity-50" : ""}`}>
      <td className="num whitespace-nowrap px-3 py-2 text-xs text-muted">
        {new Date(t.executedAt).toLocaleTimeString("en-IN")}
      </td>
      <td className="max-w-[22ch] truncate px-3 py-2">{t.teamName}</td>
      <td className="px-3 py-2">
        <span className={t.side === "buy" ? "text-up" : "text-down"}>
          {t.side === "buy" ? "BUY" : "SELL"}
        </span>{" "}
        <span className="num">{t.quantity}</span>{" "}
        <span className="font-semibold">{t.symbol}</span>
        {t.voided && (
          <span className="ml-2" title={t.voidReason ?? undefined}><Badge tone="warn">Voided</Badge></span>
        )}
      </td>
      <td className="num px-3 py-2 text-right">{formatRupees(t.fillPricePaise)}</td>
      <td className="num px-3 py-2 text-right">{formatRupees(t.grossPaise)}</td>
      <td className="px-3 py-2 text-right">
        {t.side === "sell"
          ? <Money paise={t.realisedPnlPaise} sign />
          : <span className="text-muted">—</span>}
      </td>
      <td className="px-3 py-2 text-right">
        {!t.voided && <Button variant="ghost" onClick={onToggle}>Void</Button>}
      </td>
    </tr>
  );
}

function VoidRow({ trade }: { trade: AdminTrade }) {
  return (
    <tr className="border-b border-border/50 bg-surface-2/40">
      <td colSpan={7} className="px-3 py-2">
        <ActionForm
          variant="danger" submitLabel="Void this trade"
          run={async (fd) => voidTradeAction(trade.id, String(fd.get("reason") ?? ""))}
        >
          <Input name="reason" required placeholder="Reason (required, logged permanently)" />
          <p className="text-[11px] text-muted">
            Reverses cash and shares at the original fill price. Refused if the team has already
            spent the proceeds or sold the shares on — adjust their cash instead.
          </p>
        </ActionForm>
      </td>
    </tr>
  );
}
