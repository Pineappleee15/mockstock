"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePoll } from "@/lib/use-poll";
import { Card, Change, Badge, Empty, Input, Select } from "@/components/ui";
import { LivePrice, Spark } from "@/components/price";
import type { MarketRow } from "@/lib/queries";

type SortKey = "symbol" | "price" | "change";

export function MarketLive() {
  const { data, loading } = usePoll<{ tick: number; state: string; stocks: MarketRow[] }>("/api/market", 5000);
  const [q, setQ] = useState("");
  const [sector, setSector] = useState("all");
  const [sort, setSort] = useState<SortKey>("symbol");
  const [desc, setDesc] = useState(false);

  const sectors = useMemo(
    () => Array.from(new Set((data?.stocks ?? []).map((s) => s.sector))).sort(),
    [data],
  );

  const rows = useMemo(() => {
    let list = data?.stocks ?? [];
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((s) =>
        s.symbol.toLowerCase().includes(needle) || s.name.toLowerCase().includes(needle));
    }
    if (sector !== "all") list = list.filter((s) => s.sector === sector);

    const sorted = [...list].sort((a, b) => {
      if (sort === "price") return a.pricePaise - b.pricePaise;
      if (sort === "change") return a.changeBps - b.changeBps;
      return a.symbol.localeCompare(b.symbol);
    });
    return desc ? sorted.reverse() : sorted;
  }, [data, q, sector, sort, desc]);

  const toggle = (key: SortKey) => {
    if (sort === key) setDesc((d) => !d);
    else { setSort(key); setDesc(key !== "symbol"); }
  };

  if (loading && !data) return <Empty>Loading the market…</Empty>;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search symbol or name" aria-label="Search stocks" className="flex-1"
        />
        <Select value={sector} onChange={(e) => setSector(e.target.value)}
          aria-label="Filter by sector" className="w-36 shrink-0">
          <option value="all">All sectors</option>
          {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>

      <Card>
        <table className="hidden w-full text-sm sm:table">
          <thead className="text-[11px] uppercase tracking-wide text-muted">
            <tr className="border-b border-border">
              <SortTh label="Stock" active={sort === "symbol"} desc={desc} onClick={() => toggle("symbol")} />
              <th className="px-3 py-2 text-left font-medium">Sector</th>
              <SortTh label="Price" right active={sort === "price"} desc={desc} onClick={() => toggle("price")} />
              <SortTh label="Change" right active={sort === "change"} desc={desc} onClick={() => toggle("change")} />
              <th className="px-3 py-2 text-right font-medium">Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-b border-border/50 last:border-0 hover:bg-surface-2/50">
                <td className="px-3 py-2">
                  <Link href={`/stock/${s.symbol}`} className="font-semibold hover:text-accent">{s.symbol}</Link>
                  <div className="max-w-[22ch] truncate text-[11px] text-muted">{s.name}</div>
                </td>
                <td className="px-3 py-2 text-xs text-muted">{s.sector}</td>
                <td className="px-3 py-2 text-right">
                  {s.halted ? <Badge tone="warn">Halted</Badge> : <LivePrice paise={s.pricePaise} />}
                </td>
                <td className="px-3 py-2 text-right"><Change bps={s.changeBps} /></td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end"><Spark points={s.spark} up={s.changeBps >= 0} /></div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="divide-y divide-border/50 sm:hidden">
          {rows.map((s) => (
            <Link key={s.id} href={`/stock/${s.symbol}`} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold">{s.symbol}</span>
                  {s.halted && <Badge tone="warn">Halted</Badge>}
                </div>
                <div className="truncate text-[11px] text-muted">{s.name}</div>
              </div>
              <Spark points={s.spark} up={s.changeBps >= 0} />
              <div className="w-24 shrink-0 text-right">
                <LivePrice paise={s.pricePaise} />
                <div className="text-xs"><Change bps={s.changeBps} /></div>
              </div>
            </Link>
          ))}
        </div>

        {rows.length === 0 && <Empty>No stocks match that search.</Empty>}
      </Card>
    </div>
  );
}

function SortTh({
  label, right, active, desc, onClick,
}: { label: string; right?: boolean; active: boolean; desc: boolean; onClick: () => void }) {
  return (
    <th className={`px-3 py-2 font-medium ${right ? "text-right" : "text-left"}`}>
      <button onClick={onClick} className={`hover:text-text ${active ? "text-text" : ""}`}>
        {label}{active ? (desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
}
