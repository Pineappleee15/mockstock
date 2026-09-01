import "server-only";
import { hash, verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { db, admins, teams } from "@/db";
import { readSession, type SessionPayload } from "./session";

export const hashPassword = (plain: string): Promise<string> => hash(plain);

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain);
  } catch {
    return false;
  }
}

/**
 * Resolves the session AND re-checks session_version against the database, so
 * an admin password reset or a "kick team" action invalidates live sessions
 * rather than waiting for the JWT to expire.
 */
export async function currentActor(): Promise<
  | { kind: "admin"; id: number; label: string }
  | { kind: "team"; id: number; label: string; competitionId: number }
  | null
> {
  const session: SessionPayload | null = await readSession();
  if (!session) return null;

  if (session.kind === "admin") {
    const row = await db.query.admins.findFirst({ where: eq(admins.id, session.id) });
    if (!row || row.sessionVersion !== session.v) return null;
    return { kind: "admin", id: row.id, label: row.username };
  }

  const row = await db.query.teams.findFirst({ where: eq(teams.id, session.id) });
  if (!row || row.sessionVersion !== session.v || row.isDisabled) return null;
  return { kind: "team", id: row.id, label: row.name, competitionId: row.competitionId };
}

export async function requireAdmin() {
  const actor = await currentActor();
  if (!actor || actor.kind !== "admin") throw new Error("UNAUTHORISED");
  return actor;
}

export async function requireTeam() {
  const actor = await currentActor();
  if (!actor || actor.kind !== "team") throw new Error("UNAUTHORISED");
  return actor;
}

/** Join codes are read off a projector, so no 0/O and no 1/I/l. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateJoinCode(length = 6): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}
