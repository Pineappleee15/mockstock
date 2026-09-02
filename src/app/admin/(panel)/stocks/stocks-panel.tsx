"use client";

import { Fragment, useState } from "react";
import {
  importStocks, haltStockAction, unhaltStockAction, overridePriceAction, loadStandardUniverse,
} from "@/actions/admin";
import { ActionButton, ActionForm } from "@/components/action-button";
import { Card, Badge, Button, Input, Empty, Change } from "@/components/ui";
import { formatRupees, returnBps } from "@/lib/money";

export interface StockRow {
  id: number; symbol: string; name: string; sector: string;
  pricePaise: number; openPaise: number;
  volatilityBps: number; liquidity: number;
  halted: boolean; haltReason: string | null;
}

export function StocksPanel({
  competitionId, circuitLimitBps, stocks,
}: { competitionId: number; circuitLimitBps: number; stocks: StockRow[] }) {
  const [editing, setEditing] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Standard universe</h2>
            <p className="mt-0.5 text-[11px] text-muted">
              28 Indian stocks, four in every sector, so sector news always hits a real basket.
              Symbols you already have are skipped, so this is safe to run on a competition
              that is part way set up.
            </p>
          </div>
          <ActionButton variant="buy" run={() => loadStandardUniverse(competitionId)}>
            Load standard universe
          </ActionButton>
        </div>
      </Card>

      <Card className="p-3">
        <h2 className="mb-2 text-sm font-semibold">Or import your own CSV</h2>
        <ActionForm run={(fd) => importStocks(competitionId, fd)} submitLabel="Import CSV">
          <textarea
            name="csv" rows={5}
            placeholder="symbol,name,sector,starting_price,volatility_bps,liquidity"
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs"
          />
          <p className="text-[11px] text-muted">
            Only symbol, name and starting_price are required. volatility_bps is the expected move
            per minute (50 = 0.5%/min). liquidity is how many shares must be net-bought in one tick
            to move the price about 1%, so lower means teams can move it more easily. Both default
            sensibly if omitted. Symbols that already exist are skipped.
          </p>
        </ActionForm>
      </Card>

      <Card>
        <div className="border-b border-border px-3 py-2 text-sm font-semibold">
          {stocks.length} stocks · circuit limit {(circuitLimitBps / 100).toFixed(0)}% from session open
        </div>
        {stocks.length === 0 ? <Empty>No stocks yet. Import some above.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-muted">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-medium">Symbol</th>
                  <th className="px-3 py-2 text-left font-medium">Sector</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">From open</th>
                  <th className="px-3 py-2 text-right font-medium">Vol</th>
                  <th className="px-3 py-2 text-right font-medium">Liquidity</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((s) => (
                  <Fragment key={s.id}>
                    <StockRowView stock={s} onToggle={() => setEditing(editing === s.id ? null : s.id)} />
                    {editing === s.id && <OverrideRow stock={s} />}
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

function StockRowView({ stock: s, onToggle }: { stock: StockRow; onToggle: () => void }) {
  return (
    <tr className="border-b border-border/50">
      <td className="px-3 py-2">
        <div className="font-semibold">{s.symbol}</div>
        <div className="max-w-[24ch] truncate text-[11px] text-muted">{s.name}</div>
      </td>
      <td className="px-3 py-2 text-xs text-muted">{s.sector}</td>
      <td className="num px-3 py-2 text-right">{formatRupees(s.pricePaise)}</td>
      <td className="px-3 py-2 text-right"><Change bps={returnBps(s.pricePaise, s.openPaise)} /></td>
      <td className="num px-3 py-2 text-right text-muted">{s.volatilityBps}</td>
      <td className="num px-3 py-2 text-right text-muted">{s.liquidity}</td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-2">
          {s.halted && <Badge tone="warn">{s.haltReason ?? "Halted"}</Badge>}
          <Button variant="ghost" onClick={onToggle}>Override</Button>
          {s.halted ? (
            <ActionButton variant="ghost" run={() => unhaltStockAction(s.id, true)}>Resume</ActionButton>
          ) : (
            <ActionButton
              variant="ghost"
              confirm={`Halt trading in ${s.symbol}?`}
              run={() => haltStockAction(s.id, "Halted by admin")}
            >
              Halt
            </ActionButton>
          )}
        </div>
      </td>
    </tr>
  );
}

/** Manual price override. Permanent level shift, mandatory reason. */
function OverrideRow({ stock: s }: { stock: StockRow }) {
  return (
    <tr className="border-b border-border/50 bg-surface-2/40">
      <td colSpan={7} className="px-3 py-2">
        <ActionForm
          submitLabel={`Force ${s.symbol} price`}
          run={async (fd) =>
            overridePriceAction(s.id, Number(fd.get("price")), String(fd.get("reason") ?? ""))}
        >
          <div className="flex flex-wrap gap-2">
            <Input name="price" type="number" step="0.01" required className="max-w-48"
              placeholder="New price in rupees" defaultValue={(s.pricePaise / 100).toFixed(2)} />
            <Input name="reason" required className="max-w-96" placeholder="Reason (required, logged)" />
          </div>
          <p className="text-[11px] text-muted">
            Permanent level shift: the walk continues from the new price rather than springing back.
          </p>
        </ActionForm>
      </td>
    </tr>
  );
}
