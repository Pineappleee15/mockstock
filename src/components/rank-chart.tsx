"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { RankPoint } from "@/lib/replay";

/**
 * Bump chart of every team's rank through the session.
 *
 * The y-axis is reversed so first place is at the top, which is the only way
 * this reads correctly. The top three are drawn thick and coloured; everyone
 * else is a muted thread, so the story of who overtook whom stays legible with
 * a dozen lines on one chart.
 */
const PODIUM = ["var(--color-accent)", "#9fb4d8", "#c08a5e"];

export function RankChart({
  teams, points, podium,
}: { teams: string[]; points: RankPoint[]; podium: string[] }) {
  if (points.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--color-ink-soft)]">
        Not enough of the session was recorded to draw this.
      </div>
    );
  }

  const data = points.map((p) => ({ minute: p.minute, ...p.ranks }));

  return (
    <div className="h-72 w-full sm:h-96">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <XAxis
            dataKey="minute" tickFormatter={(v: number) => `${v}m`}
            tick={{ fill: "var(--color-ink-soft)", fontSize: 11 }}
            axisLine={false} tickLine={false}
          />
          <YAxis
            reversed domain={[1, teams.length]} allowDecimals={false}
            width={28} tick={{ fill: "var(--color-ink-soft)", fontSize: 11 }}
            axisLine={false} tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "#fffdf8", border: "1px solid var(--color-paper-edge)",
              borderRadius: 4, fontSize: 12, color: "var(--color-ink)",
            }}
            labelFormatter={(v) => `${v} minutes in`}
            formatter={(value: number, name: string) => [`#${value}`, name]}
          />
          {teams.map((team) => {
            const place = podium.indexOf(team);
            const isPodium = place >= 0 && place < 3;
            return (
              <Line
                key={team} type="monotone" dataKey={team}
                stroke={isPodium ? PODIUM[place] : "var(--color-ink-soft)"}
                strokeWidth={isPodium ? 2.6 : 1}
                strokeOpacity={isPodium ? 1 : 0.28}
                dot={false} isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
