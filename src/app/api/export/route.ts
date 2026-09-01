import { sql } from "drizzle-orm";
import { db } from "@/db";
import { currentActor } from "@/lib/auth";
import { activeCompetition } from "@/lib/queries";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Minimal RFC4180 escaping. Everything here is our own data, but a team name can contain a comma. */
function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => csvCell(r[h])).join(","));
  return lines.join("\n");
}

/**
 * CSV exports. Money is emitted in RUPEES with two decimals rather than paise,
 * because these files get opened in Excel by people who did not read SCHEMA.md.
 */
export async function GET(req: Request) {
  const actor = await currentActor();
  if (!actor || actor.kind !== "admin") {
    return new Response("Unauthorised", { status: 401 });
  }
  const comp = await activeCompetition();
  if (!comp) return new Response("No competition", { status: 404 });

  const type = new URL(req.url).searchParams.get("type") ?? "trades";
  let rows: Array<Record<string, unknown>> = [];

  if (type === "trades") {
    rows = (await db.execute(sql`
      SELECT t.id, tm.name AS team, tm.join_code, s.symbol, t.side, t.quantity,
             ROUND(t.fill_price_paise / 100.0, 2) AS fill_price,
             ROUND(t.gross_paise / 100.0, 2)      AS gross,
             ROUND(t.brokerage_paise / 100.0, 2)  AS brokerage,
             ROUND(t.realised_pnl_paise / 100.0, 2) AS realised_pnl,
             t.tick_index, t.executed_at,
             (t.voided_at IS NOT NULL) AS voided, t.void_reason
      FROM trades t
      JOIN teams tm ON tm.id = t.team_id
      JOIN stocks s ON s.id = t.stock_id
      WHERE t.competition_id = ${comp.id}
      ORDER BY t.executed_at
    `)) as unknown as Array<Record<string, unknown>>;
  } else if (type === "standings") {
    rows = (await db.execute(sql`
      SELECT l.rank, tm.name AS team, tm.join_code, tm.members,
             ROUND(l.portfolio_value_paise / 100.0, 2) AS portfolio_value,
             ROUND(l.cash_paise / 100.0, 2)            AS cash,
             ROUND(l.invested_paise / 100.0, 2)        AS invested,
             ROUND(l.return_bps / 100.0, 2)            AS return_pct,
             ROUND(l.realised_pnl_paise / 100.0, 2)    AS realised_pnl,
             ROUND(l.unrealised_pnl_paise / 100.0, 2)  AS unrealised_pnl,
             l.trade_count
      FROM leaderboard_current l
      JOIN teams tm ON tm.id = l.team_id
      WHERE l.competition_id = ${comp.id}
      ORDER BY l.rank, tm.name
    `)) as unknown as Array<Record<string, unknown>>;
  } else if (type === "prices") {
    rows = (await db.execute(sql`
      SELECT p.tick_index, p.ts, s.symbol,
             ROUND(p.price_paise / 100.0, 2)  AS price,
             ROUND(p.anchor_paise / 100.0, 2) AS anchor,
             p.gap_bps, p.net_qty, p.halted
      FROM price_ticks p
      JOIN stocks s ON s.id = p.stock_id
      WHERE p.competition_id = ${comp.id}
      ORDER BY p.tick_index, s.symbol
    `)) as unknown as Array<Record<string, unknown>>;
  } else if (type === "audit") {
    rows = (await db.execute(sql`
      SELECT id, created_at, actor_type, actor_label, action, entity_type, entity_id, payload
      FROM audit_log
      WHERE competition_id = ${comp.id}
      ORDER BY id
    `)) as unknown as Array<Record<string, unknown>>;
  } else {
    return new Response("Unknown export type", { status: 400 });
  }

  await audit(actor, `export.${type}`, { competitionId: comp.id, payload: { rows: rows.length } });

  const slug = comp.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const filename = `${slug || "mockstock"}-${type}.csv`;

  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
