"use client";

import { useMemo, useState } from "react";
import { publishNewsAction } from "@/actions/admin";
import { ActionForm } from "@/components/action-button";
import { Card, Input, Button } from "@/components/ui";

interface StockOpt { id: number; symbol: string; name: string; sector: string }

/**
 * News composer. The impact is applied gradually across the decay window rather
 * than as an instant jump, so participants see a move develop and can react to
 * it — which, with order flow driving prices, is where most of the real move
 * actually comes from.
 */
export function NewsComposer({
  competitionId, stocks, tickSeconds,
}: { competitionId: number; stocks: StockOpt[]; tickSeconds: number }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [decay, setDecay] = useState(120);

  const sectors = useMemo(
    () => Array.from(new Set(stocks.map((s) => s.sector))).sort(), [stocks]);

  const toggle = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const selectSector = (sector: string) => setSelected((prev) => {
    const next = new Set(prev);
    const ids = stocks.filter((s) => s.sector === sector).map((s) => s.id);
    const allIn = ids.every((id) => next.has(id));
    for (const id of ids) { if (allIn) next.delete(id); else next.add(id); }
    return next;
  });

  const ticks = Math.max(1, Math.ceil(decay / tickSeconds));

  return (
    <Card className="p-3">
      <h2 className="mb-2 text-sm font-semibold">Push a news event</h2>
      <ActionForm
        submitLabel={`Publish to ${selected.size} stock${selected.size === 1 ? "" : "s"}`}
        variant="buy"
        run={(fd) => {
          for (const id of selected) fd.append("stockIds", String(id));
          return publishNewsAction(competitionId, fd);
        }}
      >
        <Input name="headline" required maxLength={200}
          placeholder="Headline, e.g. RBI holds repo rate, signals softer stance" />
        <Input name="body" maxLength={500} placeholder="Optional detail line" />

        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 text-xs text-muted">
            Impact %
            <Input name="impactPct" type="number" step="0.1" defaultValue="3" required className="w-24" />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            Applied over (seconds)
            <Input name="decaySeconds" type="number" min="1" value={decay}
              onChange={(e) => setDecay(Number(e.target.value) || 1)} required className="w-28" />
          </label>
          <span className="self-center text-[11px] text-muted">
            = {ticks} tick{ticks === 1 ? "" : "s"}, front-loaded then settling. Permanent: it does not fade back.
          </span>
        </div>

        <div>
          <div className="mb-1 flex flex-wrap gap-1">
            {sectors.map((sec) => (
              <Button key={sec} type="button" variant="ghost" className="px-2 py-1 text-xs"
                onClick={() => selectSector(sec)}>
                {sec}
              </Button>
            ))}
            <Button type="button" variant="ghost" className="px-2 py-1 text-xs"
              onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
          <div className="flex max-h-44 flex-wrap gap-1 overflow-y-auto rounded-md border border-border p-2">
            {stocks.map((s) => (
              <button
                key={s.id} type="button" onClick={() => toggle(s.id)}
                aria-pressed={selected.has(s.id)}
                className={`rounded px-2 py-1 text-xs ${
                  selected.has(s.id)
                    ? "bg-accent font-semibold text-black"
                    : "bg-surface-2 text-muted hover:text-text"
                }`}
              >
                {s.symbol}
              </button>
            ))}
          </div>
        </div>
      </ActionForm>
    </Card>
  );
}
