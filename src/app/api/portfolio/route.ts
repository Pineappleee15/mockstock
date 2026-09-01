import { NextResponse } from "next/server";
import { currentActor } from "@/lib/auth";
import { activeCompetition, portfolioView } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * The one polled endpoint that cannot be shared between clients, so it is the
 * only one that hits Postgres per request. Two indexed reads.
 */
export async function GET() {
  const actor = await currentActor();
  if (!actor || actor.kind !== "team") {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const comp = await activeCompetition();
  if (!comp) return NextResponse.json({ error: "no competition" }, { status: 404 });

  const view = await portfolioView(comp, actor.id);
  if (!view) return NextResponse.json({ error: "no portfolio" }, { status: 404 });

  return NextResponse.json(
    { tick: comp.currentTick, state: comp.state, ...view },
    { headers: { "Cache-Control": "no-store" } },
  );
}
