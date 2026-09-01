import { requireTeam } from "@/lib/auth";
import { tradeHistory } from "@/lib/queries";
import { Card, Empty, Money, Badge } from "@/components/ui";
import { formatRupees } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function TradesPage() {
  const actor = await requireTeam();
  const trades = await tradeHistory(actor.id);

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Trade history</h1>
      <Card>
        {trades.length === 0 ? (
          <Empty>No trades yet.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left font-medium">Time</th>
                <th className="px-3 py-2 text-left font-medium">Stock</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Fee</th>
                <th className="px-3 py-2 text-right font-medium">P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} className="border-b border-border/50 last:border-0">
                  <td className="num whitespace-nowrap px-3 py-2 text-xs text-muted">
                    {new Date(t.executedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </td>
                  <td className="px-3 py-2">
                    <span className={t.side === "buy" ? "text-up" : "text-down"}>
                      {t.side === "buy" ? "B" : "S"}
                    </span>{" "}
                    <span className="font-semibold">{t.symbol}</span>
                    {t.voided && <span className="ml-2"><Badge tone="warn">Voided</Badge></span>}
                  </td>
                  <td className="num px-3 py-2 text-right">{t.quantity}</td>
                  <td className="num px-3 py-2 text-right">{formatRupees(t.fillPricePaise)}</td>
                  <td className="num hidden px-3 py-2 text-right text-muted sm:table-cell">
                    {formatRupees(t.brokeragePaise)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {t.side === "sell" ? <Money paise={t.realisedPnlPaise} sign /> : <span className="text-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
