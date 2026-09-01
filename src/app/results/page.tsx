import Link from "next/link";
import { activeCompetition, leaderboard } from "@/lib/queries";
import { Card, Empty, Change, Badge } from "@/components/ui";
import { formatRupees } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * Final results. Reads the same frozen leaderboard_current table the live page
 * reads — when the competition ends the ticker stops writing, so this is
 * automatically the final standing with no separate snapshot step.
 */
export default async function ResultsPage() {
  const comp = await activeCompetition();
  if (!comp) return <Empty>No competition.</Empty>;

  const rows = await leaderboard(comp);
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 text-center">
        <div className="text-sm text-muted">Final results</div>
        <h1 className="text-2xl font-bold">{comp.name}</h1>
        <div className="mt-1">
          {comp.state === "ended"
            ? <Badge tone="up">Final</Badge>
            : <Badge tone="warn">Provisional — competition still running</Badge>}
        </div>
      </div>

      {rows.length === 0 ? <Empty>No standings recorded.</Empty> : (
        <>
          <div className="mb-4 grid gap-2 sm:grid-cols-3">
            {podium.map((r, i) => (
              <Card key={r.teamId} className={`p-4 text-center ${i === 0 ? "border-accent" : ""}`}>
                <div className="text-3xl">{["🥇", "🥈", "🥉"][i]}</div>
                <div className="mt-1 truncate font-semibold">{r.teamName}</div>
                <div className="num mt-1 text-lg">{formatRupees(r.valuePaise, { decimals: false })}</div>
                <div className="mt-0.5"><Change bps={r.returnBps} /></div>
              </Card>
            ))}
          </div>

          {rest.length > 0 && (
            <Card>
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-muted">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left font-medium">#</th>
                    <th className="px-3 py-2 text-left font-medium">Team</th>
                    <th className="px-3 py-2 text-right font-medium">Value</th>
                    <th className="px-3 py-2 text-right font-medium">Return</th>
                    <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Realised</th>
                    <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Trades</th>
                  </tr>
                </thead>
                <tbody>
                  {rest.map((r) => (
                    <tr key={r.teamId} className="border-b border-border/50 last:border-0">
                      <td className="num px-3 py-2 font-semibold">{r.rank}</td>
                      <td className="px-3 py-2">{r.teamName}</td>
                      <td className="num px-3 py-2 text-right">{formatRupees(r.valuePaise)}</td>
                      <td className="px-3 py-2 text-right"><Change bps={r.returnBps} /></td>
                      <td className="num hidden px-3 py-2 text-right text-muted sm:table-cell">
                        {formatRupees(r.realisedPnlPaise, { sign: true })}
                      </td>
                      <td className="num hidden px-3 py-2 text-right text-muted sm:table-cell">{r.tradeCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      <p className="mt-6 text-center text-xs text-muted">
        Ranked on return from starting cash. Ties broken by realised P&amp;L, then fewer trades.{" "}
        <Link href="/leaderboard" className="text-accent hover:underline">Live leaderboard</Link>
      </p>
    </main>
  );
}
