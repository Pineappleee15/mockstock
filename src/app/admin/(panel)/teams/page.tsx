import { eq, asc } from "drizzle-orm";
import { db, teams, portfolios } from "@/db";
import { activeCompetition } from "@/lib/queries";
import { Empty } from "@/components/ui";
import { TeamsPanel } from "./teams-panel";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const comp = await activeCompetition();
  if (!comp) return <Empty>No competition.</Empty>;

  const rows = await db.select({
    id: teams.id,
    name: teams.name,
    members: teams.members,
    joinCode: teams.joinCode,
    passwordHash: teams.passwordHash,
    disabled: teams.isDisabled,
    lastLoginAt: teams.lastLoginAt,
    cashPaise: portfolios.cashPaise,
    tradeCount: portfolios.tradeCount,
  }).from(teams)
    .leftJoin(portfolios, eq(portfolios.teamId, teams.id))
    .where(eq(teams.competitionId, comp.id))
    .orderBy(asc(teams.name));

  return (
    <TeamsPanel
      competitionId={comp.id}
      teams={rows.map((r) => ({
        id: r.id, name: r.name, members: r.members, joinCode: r.joinCode,
        enrolled: r.passwordHash != null, disabled: r.disabled,
        lastLogin: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
        cashPaise: r.cashPaise ?? 0, tradeCount: r.tradeCount ?? 0,
      }))}
    />
  );
}
