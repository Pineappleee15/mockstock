"use client";

import {
  Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { formatRupees } from "@/lib/money";

/**
 * Price chart. Recharts, deliberately stripped back: on a phone in a noisy room
 * the only things that matter are the shape of the line and where it sits
 * relative to the session open.
 */
export function PriceChart({
  series, openPaise, up,
}: { series: Array<{ t: number; p: number }>; openPaise: number; up: boolean }) {
  if (series.length < 2) {
    return <div className="flex h-56 items-center justify-center text-sm text-muted">Waiting for prices…</div>;
  }

  const colour = up ? "var(--color-up)" : "var(--color-down)";
  const values = series.map((d) => d.p);
  const min = Math.min(...values, openPaise);
  const max = Math.max(...values, openPaise);
  const pad = Math.max(1, (max - min) * 0.08);

  return (
    <div className="h-56 w-full sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colour} stopOpacity={0.28} />
              <stop offset="100%" stopColor={colour} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="t" hide />
          <YAxis
            domain={[min - pad, max + pad]}
            tickFormatter={(v: number) => (v / 100).toFixed(0)}
            width={48} tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            axisLine={false} tickLine={false}
          />
          <ReferenceLine y={openPaise} stroke="var(--color-border)" strokeDasharray="3 3" />
          <Tooltip
            contentStyle={{
              background: "var(--color-surface-2)", border: "1px solid var(--color-border)",
              borderRadius: 6, fontSize: 12,
            }}
            labelFormatter={() => ""}
            formatter={(v: number) => [formatRupees(v), "Price"]}
          />
          <Area type="monotone" dataKey="p" stroke={colour} strokeWidth={1.8} fill="url(#fill)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
