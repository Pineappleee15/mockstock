import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db, competitions, teams, stocks, trades } from "@/db";
import { activeCompetition } from "@/lib/queries";
import { Card, Stat, Badge, Empty } from "@/components/ui";
import { formatRupees } from "@/lib/money";
import { MarketControls } from "./market-controls";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const comp = await activeCompetition();
  if (!comp) {
    return (
      <Empty>
        No competition yet. Run <code className="text-accent">npm run db:seed</code> to create the demo,
        or add one from <Link href="/admin/settings" className="text-accent">Settings</Link>.
      </Empty>
    );
  }

  const [counts] = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM teams  WHERE competition_id = ${comp.id})::int AS teams,
      (SELECT COUNT(*) FROM teams  WHERE competition_id = ${comp.id} AND password_hash IS NOT NULL)::int AS enrolled,
      (SELECT COUNT(*) FROM stocks WHERE competition_id = ${comp.id})::int AS stocks,
      (SELECT COUNT(*) FROM stocks WHERE competition_id = ${comp.id} AND status = 'halted')::int AS halted,
      (SELECT COUNT(*) FROM trades WHERE competition_id = ${comp.id} AND voided_at IS NULL)::int AS trades,
      (SELECT COUNT(*) FROM orders WHERE competition_id = ${comp.id} AND status = 'rejected')::int AS rejected
  `) as unknown as Array<Record<string, number>>;

  const elapsed = comp.currentTick * comp.tickIntervalSeconds;
  const mins = Math.floor(elapsed / 60);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{comp.name}</h1>
          <p className="text-xs text-muted">
            {comp.mode === "event" ? "Event mode" : "League mode"} · tick {comp.currentTick} ·
            {" "}{mins}m elapsed · {comp.tickIntervalSeconds}s interval
          </p>
        </div>
        <StateBadge state={comp.state} />
      </div>

      <MarketControls competitionId={comp.id} state={comp.state} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Teams" value={counts?.teams ?? 0} sub={`${counts?.enrolled ?? 0} signed in`} />
        <Stat label="Stocks" value={counts?.stocks ?? 0}
          sub={counts?.halted ? `${counts.halted} halted` : "none halted"}
          tone={counts?.halted ? "down" : "neutral"} />
        <Stat label="Trades" value={counts?.trades ?? 0} />
        <Stat label="Rejected orders" value={counts?.rejected ?? 0} />
        <Stat label="Starting cash" value={formatRupees(comp.startingCashPaise, { decimals: false })} />
        <Stat label="Order flow"
          value={comp.orderFlowEnabled ? "ON" : "OFF"}
          tone={comp.orderFlowEnabled ? "up" : "neutral"}
          sub={comp.orderFlowEnabled ? `${comp.impactCoefficientBps}bps coeff` : "prices ignore trading"} />
      </div>

      <Card className="p-3">
        <h2 className="mb-2 text-sm font-semibold">Before you open</h2>
        <ul className="space-y-1 text-xs text-muted">
          <Check ok={(counts?.stocks ?? 0) > 0}>Stock universe loaded</Check>
          <Check ok={(counts?.teams ?? 0) > 0}>Teams created and join codes printed</Check>
          <Check ok={comp.currentTick > 0 || comp.state !== "open"}>
            Prices published (happens automatically when you open the market)
          </Check>
          <Check ok={comp.tickIntervalSeconds <= 10}>Tick interval is 10s or faster</Check>
        </ul>
        <p className="mt-2 text-[11px] text-muted">
          Full pre-event procedure is in <code className="text-accent">RUNBOOK.md</code>.
        </p>
      </Card>
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span className={ok ? "text-up" : "text-down"}>{ok ? "✓" : "✗"}</span>
      <span className={ok ? "" : "text-down"}>{children}</span>
    </li>
  );
}

function StateBadge({ state }: { state: string }) {
  const tone = state === "open" ? "up" : state === "paused" ? "warn" : "neutral";
  return <Badge tone={tone as "up" | "warn" | "neutral"}>{state.replace("_", " ")}</Badge>;
}
