"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, stocks, watchlist, competitions } from "@/db";
import { requireTeam } from "@/lib/auth";
import { activeCompetition } from "@/lib/queries";

const input = z.object({
  symbol: z.string().trim().min(1).max(20),
  watched: z.boolean(),
}).strict();

export type WatchResult = { ok: true; watched: boolean } | { ok: false; error: string };

/**
 * Star or unstar a stock for the whole team.
 *
 * Idempotent on purpose: the client sends the state it wants rather than a
 * toggle, so two phones tapping the same star do not cancel each other out.
 */
export async function setWatched(raw: unknown): Promise<WatchResult> {
  const actor = await requireTeam();

  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const comp = await activeCompetition();
  if (!comp) return { ok: false, error: "No competition." };

  const stock = await db.query.stocks.findFirst({
    where: and(
      eq(stocks.competitionId, comp.id),
      eq(stocks.symbol, parsed.data.symbol.toUpperCase()),
    ),
  });
  if (!stock) return { ok: false, error: "No such stock." };

  if (parsed.data.watched) {
    await db.insert(watchlist)
      .values({ teamId: actor.id, stockId: stock.id })
      .onConflictDoNothing();
  } else {
    await db.delete(watchlist)
      .where(and(eq(watchlist.teamId, actor.id), eq(watchlist.stockId, stock.id)));
  }

  return { ok: true, watched: parsed.data.watched };
}
