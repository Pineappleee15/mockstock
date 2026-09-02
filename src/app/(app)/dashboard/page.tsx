import { activeCompetition } from "@/lib/queries";
import { DashboardLive } from "./dashboard-live";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const comp = await activeCompetition();

  // Passed from the server rather than added to the poll: the rules do not
  // change second to second, and the lobby needs them before any data arrives.
  const rules = comp && {
    competitionName: comp.name,
    startingCashPaise: comp.startingCashPaise,
    brokerageBps: comp.brokerageBps,
    spreadBps: comp.spreadBps,
    concentrationCapBps: comp.concentrationCapBps,
    orderRateLimitPerMin: comp.orderRateLimitPerMin,
    circuitLimitBps: comp.circuitLimitBps,
    startsAt: comp.startsAt ? comp.startsAt.toISOString() : null,
  };

  return <DashboardLive rules={rules ?? null} />;
}
