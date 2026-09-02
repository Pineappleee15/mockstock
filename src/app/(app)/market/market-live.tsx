"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePoll } from "@/lib/use-poll";
import { Card, Change, Badge, Empty, Input, Select, Button } from "@/components/ui";
import { LivePrice, Spark } from "@/components/price";
import { WatchStar } from "@/components/watch-star";
import type { MarketRow, PortfolioView, MarketIndex } from "@/lib/queries";

type SortKey = "symbol" | "price" | "change";

export function MarketLive() {
  const { data, loading } = usePoll<{ tick: number; state: string; stocks: MarketRow[]; index: MarketIndex; mood: string | null }>("/api/market", 5000);
  // Starred symbols are per team, so they arrive on the portfolio poll rather
  // than on the shared, cached market payload.
  const { data: pf } = usePoll<PortfolioView>("/api/portfolio", 5000);

  const [q, setQ] = useState("");
  const [sector, setSector] = useState("all");
  const [sort, setSort] = useState<SortKey>("symbol");
  const [desc, setDesc] = useState(false);
  const [onlyWatched, setOnlyWatched] = useState(false);

  // Mirrored locally so a star filters instantly instead of on the next poll.
  const [watched, setWatched] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (pf?.watched) setWatched(new Set(pf.watched));
  }, [pf?.watched]);

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
    if (onlyWatched) list = list.filter((s) => watched.has(s.symbol));

    const sorted = [...list].sort((a, b) => {
      if (sort === "price") return a.pricePaise - b.pricePaise;
      if (sort === "change") return a.changeBps - b.changeBps;
      return a.symbol.localeCompare(b.symbol);
    });
    return desc ? sorted.reverse() : sorted;
  }, [data, q, sector, sort, desc, onlyWatched, watched]);

  const toggle = (key: SortKey) => {
    if (sort === key) setDesc((d) => !d);
    else { setSort(key); setDesc(key !== "symbol"); }
  };

  const onStar = (symbol: string, next: boolean) =>
    setWatched((prev) => {
      const s = new Set(prev);
      if (next) s.add(symbol); else s.delete(symbol);
      return s;
    });

  if (loading && !data) return <Empty>Loading the market…</Empty>;

  return (
    <div className="space-y-3">
      {data?.index && (
        <Card className="hidden flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2 sm:flex">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              BCX {data.index.constituents}
            </span>
            <span className="num text-lg font-semibold">{data.index.value.toFixed(2)}</span>
            <Change bps={data.index.returnBps} className="text-sm" />
            {data.mood && (
              <span className="rounded bg-surface-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
                {data.mood}
              </span>
            )}
          </div>
          <span className="text-[11px] text-muted">
            Equal-weighted, from the session open. Beat this and you have alpha.
          </span>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search symbol or name" aria-label="Search stocks"
          className="min-w-40 flex-1"
        />
        <Select value={sector} onChange={(e) => setSector(e.target.value)}
          aria-label="Filter by sector" className="w-36 shrink-0">
          <option value="all">All sectors</option>
          {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Button
          onClick={() => setOnlyWatched((v) => !v)}
          aria-pressed={onlyWatched}
          className={`shrink-0 ${onlyWatched ? "bg-accent text-black hover:bg-accent/90" : ""}`}
        >
          ★ Watchlist{watched.size > 0 && ` (${watched.size})`}
        </Button>
      </div>

      <Card>
        <table className="hidden w-full text-sm sm:table">
          <thead className="text-[11px] uppercase tracking-wide text-muted">
            <tr className="border-b border-border">
              <th className="w-8 px-2 py-2" aria-label="Watchlist" />
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
                <td className="px-2 py-2">
                  <WatchStar symbol={s.symbol} watched={watched.has(s.symbol)}
                    onChange={(n) => onStar(s.symbol, n)} />
                </td>
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
            <div key={s.id} className="flex items-center gap-2 px-2 py-2.5">
              <WatchStar symbol={s.symbol} watched={watched.has(s.symbol)}
                onChange={(n) => onStar(s.symbol, n)} />
              <Link href={`/stock/${s.symbol}`} className="flex min-w-0 flex-1 items-center gap-3">
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
            </div>
          ))}
        </div>

        {rows.length === 0 && (
          <Empty>
            {onlyWatched && watched.size === 0
              ? "Nothing starred yet. Tap ☆ next to a stock to add it here."
              : "No stocks match that search."}
          </Empty>
        )}
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
