"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, teams, admins } from "@/db";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { createSession, destroySession } from "@/lib/session";
import { audit } from "@/lib/audit";

const teamLogin = z.object({
  joinCode: z.string().trim().min(3).max(16).transform((s) => s.toUpperCase()),
  password: z.string().min(1).max(200),
}).strict();

const adminLogin = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
}).strict();

export type LoginState = { error?: string; needsPassword?: boolean; joinCode?: string };

/**
 * Team login. On first login the team SETS its password rather than being
 * rejected — that is the whole enrolment flow, per the spec.
 */
export async function loginTeam(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = teamLogin.safeParse({
    joinCode: form.get("joinCode"),
    password: form.get("password"),
  });
  if (!parsed.success) return { error: "Enter your join code and a password." };

  const { joinCode, password } = parsed.data;
  const team = await db.query.teams.findFirst({ where: eq(teams.joinCode, joinCode) });

  // Same message whether the code is wrong or the password is wrong.
  if (!team || team.isDisabled) return { error: "Invalid join code or password." };

  if (team.mustSetPassword || !team.passwordHash) {
    if (password.length < 6) {
      return { needsPassword: true, joinCode, error: "Choose a password of at least 6 characters." };
    }
    const hash = await hashPassword(password);
    await db.update(teams)
      .set({ passwordHash: hash, mustSetPassword: false, lastLoginAt: new Date() })
      .where(eq(teams.id, team.id));
    await audit({ kind: "team", id: team.id, label: team.name }, "team.password_set", {
      competitionId: team.competitionId, entityType: "team", entityId: team.id,
    });
    await createSession({
      kind: "team", id: team.id, label: team.name,
      v: team.sessionVersion, competitionId: team.competitionId,
    });
    redirect("/dashboard");
  }

  const ok = await verifyPassword(team.passwordHash, password);
  if (!ok) return { error: "Invalid join code or password." };

  await db.update(teams).set({ lastLoginAt: new Date() }).where(eq(teams.id, team.id));
  await audit({ kind: "team", id: team.id, label: team.name }, "team.login", {
    competitionId: team.competitionId, entityType: "team", entityId: team.id,
  });
  await createSession({
    kind: "team", id: team.id, label: team.name,
    v: team.sessionVersion, competitionId: team.competitionId,
  });
  redirect("/dashboard");
}

export async function loginAdmin(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = adminLogin.safeParse({
    username: form.get("username"),
    password: form.get("password"),
  });
  if (!parsed.success) return { error: "Enter a username and password." };

  const admin = await db.query.admins.findFirst({ where: eq(admins.username, parsed.data.username) });
  if (!admin || !(await verifyPassword(admin.passwordHash, parsed.data.password))) {
    return { error: "Invalid username or password." };
  }

  await audit({ kind: "admin", id: admin.id, label: admin.username }, "admin.login", {});
  await createSession({ kind: "admin", id: admin.id, label: admin.username, v: admin.sessionVersion });
  redirect("/admin");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
