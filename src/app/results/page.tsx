import Link from "next/link";
import { activeCompetition, leaderboard } from "@/lib/queries";
import { rankHistory, teamReplay } from "@/lib/replay";
import { RankChart } from "@/components/rank-chart";
import { TeamReplayCard } from "@/components/team-replay-card";
import { currentActor } from "@/lib/auth";
import { formatRupees, formatBps } from "@/lib/money";

export const dynamic = "force-dynamic";

const PLACE = ["First", "Second", "Third"];
const TILT = ["tilt-r", "tilt-l", "tilt-r"];

/**
 * Final results. Reads the same frozen leaderboard the live page reads — when
 * the competition ends the ticker stops writing, so this is automatically the
 * final standing with no separate snapshot step.
 *
 * Paper treatment: this is a moment, not a working screen, and it is the one
 * people photograph.
 */
export default async function ResultsPage() {
  const comp = await activeCompetition();
  if (!comp) {
    return (
      <main className="paper-page flex min-h-screen items-center justify-center">
        <p className="text-[var(--color-ink-soft)]">No competition yet.</p>
      </main>
    );
  }

  const rows = await leaderboard(comp);
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  const final = comp.state === "ended";

  const history = await rankHistory(comp.id, comp.tickIntervalSeconds);

  // A signed-in team gets its own session told back to it. An admin viewing
  // this sees the winner's, which is the one to put on the projector.
  const actor = await currentActor();
  const replayTeamId =
    actor?.kind === "team" ? actor.id
    : actor?.kind === "admin" ? rows[0]?.teamId
    : undefined;
  const replay = replayTeamId
    ? await teamReplay(comp.id, replayTeamId, comp.currentTick)
    : null;

  return (
    <main className="paper-page min-h-screen px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-9 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--color-ink-soft)]">
            BlueChip Exchange · {final ? "Final standings" : "Standing so far"}
          </p>
          <h1 className="display mt-2 text-4xl leading-tight sm:text-5xl">
            <span className="paper-underline">{comp.name}</span>
          </h1>
        </header>

        {rows.length === 0 ? (
          <p className="text-center text-[var(--color-ink-soft)]">No standings recorded.</p>
        ) : (
          <>
            <div className="mb-10 grid gap-6 sm:grid-cols-3 sm:items-end">
              {podium.map((r, i) => (
                <div key={r.teamId} className={`${TILT[i]} ${i === 0 ? "sm:-mt-6" : ""}`}>
                  <div className="paper-card px-4 py-6 text-center">
                    <span className="paper-tape" aria-hidden />
                    <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[var(--color-accent-ink)]">
                      {PLACE[i]}
                    </div>
                    <div className={`display mt-1 ${i === 0 ? "text-6xl" : "text-5xl"}`}>
                      {r.rank}
                    </div>
                    <div className="mt-2 text-base font-bold leading-tight">{r.teamName}</div>
                    <div className="num mt-3 text-lg font-semibold">
                      {formatRupees(r.valuePaise, { decimals: false })}
                    </div>
                    <div className={`num text-sm font-bold ${r.returnBps >= 0 ? "text-[#14733f]" : "text-[#a3242f]"}`}>
                      {r.returnBps > 0 ? "+" : ""}{formatBps(r.returnBps)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {replay && (
              <section className="mb-10">
                <h2 className="mb-3 text-center text-[11px] font-bold uppercase tracking-[0.25em] text-[var(--color-ink-soft)]">
                  {actor?.kind === "admin" ? "The winner's session" : "Your session"}
                </h2>
                <TeamReplayCard r={replay} />
              </section>
            )}

            {history.points.length >= 2 && (
              <section className="mb-10">
                <h2 className="mb-1 text-center text-[11px] font-bold uppercase tracking-[0.25em] text-[var(--color-ink-soft)]">
                  How the lead changed hands
                </h2>
                <p className="mb-3 text-center text-xs text-[var(--color-ink-soft)]">
                  Every team&apos;s rank through the session. First place at the top.
                </p>
                <div className="paper-card px-2 py-4">
                  <RankChart
                    teams={history.teams}
                    points={history.points}
                    podium={podium.map((p) => p.teamName)}
                  />
                </div>
              </section>
            )}

            {rest.length > 0 && (
              <div className="paper-card px-1 py-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
                      <th className="px-3 py-2 text-left font-bold">#</th>
                      <th className="px-3 py-2 text-left font-bold">Team</th>
                      <th className="px-3 py-2 text-right font-bold">Value</th>
                      <th className="px-3 py-2 text-right font-bold">Return</th>
                      <th className="hidden px-3 py-2 text-right font-bold sm:table-cell">Trades</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rest.map((r) => (
                      <tr key={r.teamId} className="border-t border-[var(--color-paper-edge)]/60">
                        <td className="num px-3 py-2 font-bold">{r.rank}</td>
                        <td className="px-3 py-2 font-medium">{r.teamName}</td>
                        <td className="num px-3 py-2 text-right">{formatRupees(r.valuePaise)}</td>
                        <td className={`num px-3 py-2 text-right font-semibold ${
                          r.returnBps >= 0 ? "text-[#14733f]" : "text-[#a3242f]"}`}>
                          {r.returnBps > 0 ? "+" : ""}{formatBps(r.returnBps)}
                        </td>
                        <td className="num hidden px-3 py-2 text-right text-[var(--color-ink-soft)] sm:table-cell">
                          {r.tradeCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <p className="mt-9 text-center text-[11px] text-[var(--color-ink-soft)]">
          Ranked on return from starting cash. Ties broken by realised P&amp;L, then fewer trades.
          {" · "}
          <Link href="/leaderboard" className="font-semibold text-[var(--color-accent-ink)] underline underline-offset-2">
            Live leaderboard
          </Link>
        </p>
      </div>
    </main>
  );
}
