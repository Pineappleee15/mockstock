import { db, auditLog, type Conn } from "@/db";

type Actor = { kind: "admin" | "team"; id: number; label: string } | { kind: "system" };

/**
 * Append to the immutable audit log. Never throws into the caller's path — a
 * logging failure must not roll back a trade — but it does complain loudly.
 *
 * Pass `tx` to log inside an existing transaction, which is what the order path
 * does so the trade and its audit row commit together.
 */
export async function audit(
  actor: Actor,
  action: string,
  opts: {
    competitionId?: number | null;
    entityType?: string;
    entityId?: number;
    payload?: Record<string, unknown>;
    ip?: string;
    tx?: Conn;
  } = {},
): Promise<void> {
  const conn = opts.tx ?? db;
  const row = {
    competitionId: opts.competitionId ?? null,
    actorType: actor.kind,
    actorId: actor.kind === "system" ? null : actor.id,
    actorLabel: actor.kind === "system" ? "system" : actor.label,
    action,
    entityType: opts.entityType ?? null,
    entityId: opts.entityId ?? null,
    payload: opts.payload ?? {},
    ip: opts.ip ?? null,
  };

  if (opts.tx) {
    await conn.insert(auditLog).values(row);
    return;
  }
  try {
    await conn.insert(auditLog).values(row);
  } catch (e) {
    console.error("[audit] failed to write audit row", action, e);
  }
}
