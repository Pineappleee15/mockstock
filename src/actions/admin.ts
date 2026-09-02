"use server";

import { revalidatePath } from "next/cache";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import Papa from "papaparse";
import { db, competitions, stocks, teams, portfolios, newsEvents, newsEventStocks } from "@/db";
import { requireAdmin, generateJoinCode, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { seedFromString } from "@/lib/rng";
import { driftFor } from "@/lib/fundamentals";
import { planStoryline } from "@/lib/storyline";
import { rupeesToPaise } from "@/lib/money";
import {
  openMarket, setMarketState, resumeMarket, haltStock, unhaltStock,
  overridePrice, publishNews, voidTrade, adjustCash, writeStockHistory,
} from "@/lib/market";
import { invalidate } from "@/lib/cache";
import baseline from "@/data/universe.json";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  const msg = e instanceof Error ? e.message : "Something went wrong.";
  return { ok: false, error: msg };
}

function refresh() {
  invalidate("market");
  invalidate("leaderboard");
  invalidate("news");
  revalidatePath("/admin", "layout");
  revalidatePath("/", "layout");
}

/* ─────────────────────────  market control  ───────────────────────── */

export async function marketAction(competitionId: number, action: string): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    switch (action) {
      case "open":   await openMarket(admin, competitionId); break;
      case "resume": await resumeMarket(admin, competitionId); break;
      case "pause":  await setMarketState(admin, competitionId, "paused"); break;
      case "close":  await setMarketState(admin, competitionId, "closed"); break;
      case "end":    await setMarketState(admin, competitionId, "ended"); break;
      case "pre_open": await setMarketState(admin, competitionId, "pre_open"); break;
      default: return { ok: false, error: "Unknown action." };
    }
    refresh();
    return { ok: true, message: `Market ${action}` };
  } catch (e) { return fail(e); }
}

/* ─────────────────────────  competition config  ───────────────────────── */

const configSchema = z.object({
  name: z.string().trim().min(1).max(120),
  startingCashRupees: z.coerce.number().min(1).max(1_000_000_000),
  brokerageBps: z.coerce.number().int().min(0).max(1000),
  spreadBps: z.coerce.number().int().min(0).max(1000),
  concentrationCapBps: z.coerce.number().int().min(100).max(10000),
  orderRateLimitPerMin: z.coerce.number().int().min(1).max(600),
  circuitLimitBps: z.coerce.number().int().min(0).max(10000),
  tickIntervalSeconds: z.coerce.number().int().min(1).max(120),
  volatilityMultiplierBps: z.coerce.number().int().min(0).max(100000),
  orderFlowEnabled: z.coerce.boolean(),
  impactCoefficientBps: z.coerce.number().int().min(0).max(5000),
  maxImpactBpsPerTick: z.coerce.number().int().min(0).max(5000),
  gapHalflifeSeconds: z.coerce.number().int().min(1).max(86400),
  permanentImpactBps: z.coerce.number().int().min(0).max(10000),
  regimeEnabled: z.coerce.boolean(),
  marketFactorBps: z.coerce.number().int().min(0).max(30000),
  liquidityMultiplierBps: z.coerce.number().int().min(500).max(100000),
  shockChanceBps: z.coerce.number().int().min(0).max(500),
  autoNewsEnabled: z.coerce.boolean(),
});

export async function updateCompetition(competitionId: number, form: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = configSchema.safeParse({
      name: form.get("name"),
      startingCashRupees: form.get("startingCashRupees"),
      brokerageBps: form.get("brokerageBps"),
      spreadBps: form.get("spreadBps"),
      concentrationCapBps: form.get("concentrationCapBps"),
      orderRateLimitPerMin: form.get("orderRateLimitPerMin"),
      circuitLimitBps: form.get("circuitLimitBps"),
      tickIntervalSeconds: form.get("tickIntervalSeconds"),
      volatilityMultiplierBps: form.get("volatilityMultiplierBps"),
      orderFlowEnabled: form.get("orderFlowEnabled") === "on",
      impactCoefficientBps: form.get("impactCoefficientBps"),
      maxImpactBpsPerTick: form.get("maxImpactBpsPerTick"),
      gapHalflifeSeconds: form.get("gapHalflifeSeconds"),
      permanentImpactBps: form.get("permanentImpactBps"),
      regimeEnabled: form.get("regimeEnabled") === "on",
      marketFactorBps: form.get("marketFactorBps"),
      liquidityMultiplierBps: form.get("liquidityMultiplierBps"),
      shockChanceBps: form.get("shockChanceBps"),
      autoNewsEnabled: form.get("autoNewsEnabled") === "on",
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    }
    const { startingCashRupees, ...rest } = parsed.data;

    await db.update(competitions).set({
      ...rest,
      startingCashPaise: rupeesToPaise(startingCashRupees),
      updatedAt: new Date(),
    }).where(eq(competitions.id, competitionId));

    await audit(admin, "competition.update", { competitionId, payload: parsed.data });
    refresh();
    return { ok: true, message: "Settings saved." };
  } catch (e) { return fail(e); }
}

/* ─────────────────────────  teams  ───────────────────────── */

/**
 * Bulk team creation. Accepts either the textarea (one team per line,
 * "Team name, member, member") or a CSV with name/members/join_code columns.
 * Join codes are generated when not supplied, and retried on collision.
 */
export async function createTeams(competitionId: number, form: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const raw = String(form.get("bulk") ?? "").trim();
    const csv = String(form.get("csv") ?? "").trim();
    if (!raw && !csv) return { ok: false, error: "Paste some teams or upload a CSV." };

    type Row = { name: string; members: string; joinCode?: string };
    let rows: Row[] = [];

    if (csv) {
      const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
      rows = parsed.data.map((r) => ({
        name: (r.name ?? r.Name ?? r.team ?? "").trim(),
        members: (r.members ?? r.Members ?? "").trim(),
        joinCode: (r.join_code ?? r.joinCode ?? "").trim().toUpperCase() || undefined,
      })).filter((r) => r.name);
    } else {
      rows = raw.split("\n").map((line) => {
        const [name, ...members] = line.split(",").map((s) => s.trim());
        return { name: name ?? "", members: members.join(", ") };
      }).filter((r) => r.name);
    }

    if (rows.length === 0) return { ok: false, error: "No valid team rows found." };
    if (rows.length > 600) return { ok: false, error: "That is more than 600 teams." };

    const comp = await db.query.competitions.findFirst({ where: eq(competitions.id, competitionId) });
    if (!comp) return { ok: false, error: "Competition not found." };

    let created = 0;
    const skipped: string[] = [];

    for (const r of rows) {
      let code = r.joinCode ?? generateJoinCode();
      let inserted = false;
      for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
        try {
          const [team] = await db.insert(teams).values({
            competitionId, name: r.name, members: r.members, joinCode: code,
          }).returning({ id: teams.id });
          await db.insert(portfolios).values({
            competitionId, teamId: team!.id, cashPaise: comp.startingCashPaise,
          });
          created++;
          inserted = true;
        } catch {
          // Either a duplicate join code (retry with a new one) or a duplicate
          // team name in this competition (skip — re-importing the same sheet
          // must not silently create a second copy of a team).
          if (r.joinCode) break;
          code = generateJoinCode();
        }
      }
      if (!inserted) skipped.push(r.name);
    }

    await audit(admin, "teams.create", { competitionId, payload: { created, skipped: skipped.length } });
    refresh();
    return {
      ok: true,
      message: `Created ${created} team${created === 1 ? "" : "s"}` +
        (skipped.length ? `. Skipped ${skipped.length} (duplicate name or code): ${skipped.slice(0, 5).join(", ")}` : "."),
    };
  } catch (e) { return fail(e); }
}

/** Clear a team's password so they set a new one on next sign-in, and kick live sessions. */
export async function resetTeamPassword(teamId: number): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) });
    if (!team) return { ok: false, error: "Team not found." };

    await db.update(teams).set({
      passwordHash: null,
      mustSetPassword: true,
      sessionVersion: team.sessionVersion + 1, // invalidates every live session
    }).where(eq(teams.id, teamId));

    await audit(admin, "team.password_reset", {
      competitionId: team.competitionId, entityType: "team", entityId: teamId,
    });
    refresh();
    return { ok: true, message: `${team.name} will set a new password on next sign-in.` };
  } catch (e) { return fail(e); }
}

export async function setTeamDisabled(teamId: number, disabled: boolean): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) });
    if (!team) return { ok: false, error: "Team not found." };
    await db.update(teams)
      .set({ isDisabled: disabled, sessionVersion: team.sessionVersion + 1 })
      .where(eq(teams.id, teamId));
    await audit(admin, disabled ? "team.disable" : "team.enable", {
      competitionId: team.competitionId, entityType: "team", entityId: teamId,
    });
    refresh();
    return { ok: true, message: `${team.name} ${disabled ? "disabled" : "enabled"}.` };
  } catch (e) { return fail(e); }
}

/* ─────────────────────────  stocks  ───────────────────────── */

/**
 * CSV import for the stock universe.
 * Columns: symbol, name, sector, starting_price, volatility_bps, liquidity, drift_bps
 * The last three are optional. Liquidity defaults from a rupee notional so that
 * cheap and expensive stocks are equally movable by order flow.
 */
const LIQUIDITY_NOTIONAL_PAISE = 200_000_000;

export async function importStocks(competitionId: number, form: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const csv = String(form.get("csv") ?? "").trim();
    if (!csv) return { ok: false, error: "Paste a CSV first." };

    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
    const rows = parsed.data
      .map((r) => ({
        symbol: (r.symbol ?? r.Symbol ?? "").trim().toUpperCase(),
        name: (r.name ?? r.Name ?? "").trim(),
        sector: (r.sector ?? r.Sector ?? "Other").trim(),
        price: Number(r.starting_price ?? r.price ?? 0),
        volBps: Number(r.volatility_bps ?? r.volatility ?? 50),
        liquidity: Number(r.liquidity ?? 0),
        driftBps: Number(r.drift_bps ?? 0),
      }))
      .filter((r) => r.symbol && r.name && r.price > 0);

    if (rows.length === 0) {
      return { ok: false, error: "No valid rows. Need at least symbol, name and starting_price." };
    }

    let created = 0;
    const skipped: string[] = [];
    for (const r of rows) {
      const pricePaise = rupeesToPaise(r.price);
      try {
        const [row] = await db.insert(stocks).values({
          competitionId, symbol: r.symbol, name: r.name, sector: r.sector,
          startingPricePaise: pricePaise,
          volatilityBps: Number.isFinite(r.volBps) && r.volBps > 0 ? Math.round(r.volBps) : 50,
          // Zero drift would mean nothing to analyse, so an unspecified drift
          // is derived from the competition and symbol rather than left flat.
          driftBps: Number.isFinite(r.driftBps) && r.driftBps !== 0
            ? Math.round(r.driftBps)
            : driftFor(competitionId, r.symbol),
          liquidity: r.liquidity > 0
            ? Math.round(r.liquidity)
            : Math.max(10, Math.round(LIQUIDITY_NOTIONAL_PAISE / pricePaise)),
          seed: seedFromString(`${competitionId}:${r.symbol}`) % 2_000_000_000,
        }).returning();
        await writeStockHistory(db, competitionId, row!);
        created++;
      } catch {
        skipped.push(r.symbol);
      }
    }

    await audit(admin, "stocks.import", { competitionId, payload: { created, skipped } });
    refresh();
    return {
      ok: true,
      message: `Imported ${created} stock${created === 1 ? "" : "s"}` +
        (skipped.length ? `. Skipped ${skipped.length} already present: ${skipped.join(", ")}` : "."),
    };
  } catch (e) { return fail(e); }
}

export async function haltStockAction(stockId: number, reason: string): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    await haltStock(admin, stockId, reason?.trim() || "Halted by admin");
    refresh();
    return { ok: true, message: "Stock halted." };
  } catch (e) { return fail(e); }
}

export async function unhaltStockAction(stockId: number, rebase: boolean): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    await unhaltStock(admin, stockId, rebase);
    refresh();
    return { ok: true, message: rebase ? "Resumed, circuit reference re-based." : "Resumed." };
  } catch (e) { return fail(e); }
}

export async function overridePriceAction(
  stockId: number, priceRupees: number, reason: string,
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    if (!(priceRupees > 0)) return { ok: false, error: "Price must be greater than zero." };
    if (!reason?.trim()) return { ok: false, error: "A reason is required." };
    await overridePrice(admin, stockId, rupeesToPaise(priceRupees), reason.trim());
    refresh();
    return { ok: true, message: "Price overridden." };
  } catch (e) { return fail(e); }
}

/* ─────────────────────────  news  ───────────────────────── */

export async function publishNewsAction(competitionId: number, form: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const headline = String(form.get("headline") ?? "").trim();
    const body = String(form.get("body") ?? "").trim();
    const impactPct = Number(form.get("impactPct"));
    const decaySeconds = Number(form.get("decaySeconds"));
    const stockIds = form.getAll("stockIds").map((v) => Number(v)).filter(Number.isFinite);

    if (!headline) return { ok: false, error: "A headline is required." };
    if (!Number.isFinite(impactPct)) return { ok: false, error: "Impact must be a number." };
    if (!Number.isFinite(decaySeconds) || decaySeconds < 1) return { ok: false, error: "Decay must be at least 1 second." };
    if (stockIds.length === 0) return { ok: false, error: "Select at least one stock." };

    await publishNews(admin, competitionId, {
      headline, body: body || undefined,
      impactBps: Math.round(impactPct * 100),
      decaySeconds: Math.round(decaySeconds),
      stockIds,
    });
    refresh();
    return { ok: true, message: `Published to ${stockIds.length} stock${stockIds.length === 1 ? "" : "s"}.` };
  } catch (e) { return fail(e); }
}

/* ─────────────────────────  trades and cash  ───────────────────────── */

export async function voidTradeAction(tradeId: number, reason: string): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    if (!reason?.trim()) return { ok: false, error: "A reason is required to void a trade." };
    await voidTrade(admin, tradeId, reason.trim());
    refresh();
    return { ok: true, message: "Trade voided." };
  } catch (e) { return fail(e); }
}

export async function adjustCashAction(
  teamId: number, amountRupees: number, reason: string,
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    if (!Number.isFinite(amountRupees) || amountRupees === 0) {
      return { ok: false, error: "Enter a non-zero amount." };
    }
    if (!reason?.trim()) return { ok: false, error: "A reason is required." };
    await adjustCash(admin, teamId, rupeesToPaise(amountRupees), reason.trim());
    refresh();
    return { ok: true, message: "Cash adjusted." };
  } catch (e) { return fail(e); }
}

/**
 * Delete a team and everything belonging to it.
 *
 * Refused while the market is open: deleting a team mid-event is almost always
 * a misclick, and it takes their trades with it, which quietly changes every
 * price those trades moved. Disable them instead.
 */
export async function deleteTeam(teamId: number): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) });
    if (!team) return { ok: false, error: "Team not found." };

    const comp = await db.query.competitions.findFirst({
      where: eq(competitions.id, team.competitionId),
    });
    if (comp?.state === "open") {
      return { ok: false, error: "Cannot delete a team while the market is open. Pause first, or disable them instead." };
    }

    // Everything hangs off teams with ON DELETE CASCADE, so this is one statement.
    await db.delete(teams).where(eq(teams.id, teamId));

    await audit(admin, "team.delete", {
      competitionId: team.competitionId, entityType: "team", entityId: teamId,
      payload: { name: team.name, joinCode: team.joinCode },
    });
    refresh();
    return { ok: true, message: `Deleted ${team.name}.` };
  } catch (e) { return fail(e); }
}

/** Delete every team in the competition. For clearing demo data before a real event. */
export async function deleteAllTeams(competitionId: number): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const comp = await db.query.competitions.findFirst({ where: eq(competitions.id, competitionId) });
    if (!comp) return { ok: false, error: "Competition not found." };
    if (comp.state === "open") {
      return { ok: false, error: "Cannot delete teams while the market is open. Pause first." };
    }

    const existing = await db.query.teams.findMany({ where: eq(teams.competitionId, competitionId) });
    await db.delete(teams).where(eq(teams.competitionId, competitionId));

    await audit(admin, "teams.delete_all", {
      competitionId, payload: { count: existing.length },
    });
    refresh();
    return { ok: true, message: `Deleted all ${existing.length} teams.` };
  } catch (e) { return fail(e); }
}

/**
 * Create a new competition and make it the active one.
 *
 * Only one competition is live at a time (enforced by a partial unique index),
 * so this refuses while the current one is still running. Past competitions
 * stay in the database for their results pages.
 */
export async function createCompetition(form: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();

    const name = String(form.get("name") ?? "").trim();
    const mode = String(form.get("mode") ?? "event");
    const startingCashRupees = Number(form.get("startingCashRupees"));
    const copyStocksFrom = Number(form.get("copyStocksFrom")) || null;

    if (!name) return { ok: false, error: "Give the competition a name." };
    if (mode !== "event" && mode !== "league") return { ok: false, error: "Mode must be event or league." };
    if (!Number.isFinite(startingCashRupees) || startingCashRupees < 1) {
      return { ok: false, error: "Starting cash must be a positive number." };
    }

    const live = await db.query.competitions.findFirst({
      where: sql`state IN ('pre_open','open','paused')`,
    });
    if (live) {
      return {
        ok: false,
        error: `"${live.name}" is still running. Close or end it before starting a new competition.`,
      };
    }

    const [created] = await db.insert(competitions).values({
      name,
      mode,
      state: "draft",
      startingCashPaise: rupeesToPaise(startingCashRupees),
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
    }).returning();

    // Copying the universe saves re-importing 20 stocks for every event.
    // Seeds are re-derived from the new competition id so the price paths differ.
    let copied = 0;
    if (copyStocksFrom) {
      const source = await db.query.stocks.findMany({
        where: eq(stocks.competitionId, copyStocksFrom),
      });
      if (source.length) {
        await db.insert(stocks).values(source.map((s) => ({
          competitionId: created!.id,
          symbol: s.symbol, name: s.name, sector: s.sector,
          startingPricePaise: s.startingPricePaise,
          volatilityBps: s.volatilityBps, driftBps: s.driftBps,
          liquidity: s.liquidity, circuitLimitBps: s.circuitLimitBps,
          seed: seedFromString(`${created!.id}:${s.symbol}`) % 2_000_000_000,
        })));
        copied = source.length;
      }
    }

    await audit(admin, "competition.create", {
      competitionId: created!.id,
      payload: { name, mode, startingCashRupees, copiedStocks: copied },
    });
    refresh();
    return {
      ok: true,
      message: `Created "${name}"` + (copied ? ` with ${copied} stocks copied over.` : ". Import your stocks next."),
    };
  } catch (e) { return fail(e); }
}

/**
 * Load the built-in stock universe into a competition.
 *
 * The baseline is src/data/universe.json — 28 Indian stocks, four in each of
 * seven sectors, so sector news always hits a real basket. Symbols already
 * present are skipped, so this is safe to run on a competition that has some
 * stocks already, and safe to run twice.
 *
 * Liquidity is derived from a rupee notional rather than set per stock, so
 * cheap and expensive names are equally movable by order flow.
 */
export async function loadStandardUniverse(competitionId: number): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();

    const existing = await db.query.stocks.findMany({
      where: eq(stocks.competitionId, competitionId),
    });
    const have = new Set(existing.map((s) => s.symbol));

    // Metals move more easily than large caps, so they read as small caps:
    // a couple of teams can genuinely push them around.
    const notionalFor = (sector: string) =>
      sector === "Metals" ? 140_000_000 : sector === "FMCG" ? 240_000_000 : 200_000_000;

    const toInsert = baseline.stocks
      .filter((s) => !have.has(s.symbol))
      .map((s) => {
        const pricePaise = rupeesToPaise(s.price);
        return {
          competitionId,
          symbol: s.symbol,
          name: s.name,
          sector: s.sector,
          startingPricePaise: pricePaise,
          volatilityBps: s.volBps,
          driftBps: driftFor(competitionId, s.symbol),
          liquidity: Math.max(10, Math.round(notionalFor(s.sector) / pricePaise)),
          seed: seedFromString(`${competitionId}:${s.symbol}`) % 2_000_000_000,
        };
      });

    if (toInsert.length === 0) {
      return { ok: true, message: `All ${baseline.stocks.length} standard stocks are already loaded.` };
    }

    const inserted = await db.insert(stocks).values(toInsert).returning();
    for (const row of inserted) await writeStockHistory(db, competitionId, row);

    await audit(admin, "stocks.load_standard", {
      competitionId,
      payload: { added: toInsert.length, skipped: baseline.stocks.length - toInsert.length },
    });
    refresh();

    const skipped = baseline.stocks.length - toInsert.length;
    return {
      ok: true,
      message: `Added ${toInsert.length} stock${toInsert.length === 1 ? "" : "s"}` +
        (skipped ? `, skipped ${skipped} already present.` : "."),
    };
  } catch (e) { return fail(e); }
}

/* ─────────────────────────  generated storyline  ───────────────────────── */

/**
 * Plan a session's worth of news and queue it.
 *
 * Replaces any news still queued, never anything already published — you can
 * regenerate the rest of a session mid-event without rewriting its history.
 */
export async function generateStoryline(competitionId: number): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const comp = await db.query.competitions.findFirst({ where: eq(competitions.id, competitionId) });
    if (!comp) return { ok: false, error: "Competition not found." };

    const universe = await db.query.stocks.findMany({ where: eq(stocks.competitionId, competitionId) });
    if (universe.length === 0) return { ok: false, error: "Load some stocks first." };

    const sessionMinutes = comp.startsAt && comp.endsAt
      ? Math.max(20, Math.round((comp.endsAt.getTime() - comp.startsAt.getTime()) / 60000))
      : 180;

    // Keep every headline comfortably inside the circuit limit, so generated
    // news never halts a stock on its own.
    const maxImpactPct = Math.max(1, (comp.circuitLimitBps / 100) * 0.45);

    const plan = planStoryline(
      competitionId,
      universe.map((s) => ({ id: s.id, symbol: s.symbol, name: s.name, sector: s.sector })),
      sessionMinutes,
      comp.tickIntervalSeconds,
      { maxImpactPct },
    );
    if (plan.length === 0) return { ok: false, error: "Could not plan anything for this session." };

    await db.transaction(async (tx) => {
      await tx.delete(newsEvents).where(and(
        eq(newsEvents.competitionId, competitionId),
        eq(newsEvents.status, "queued"),
      ));

      for (const beat of plan) {
        const ticks = Math.max(1, Math.ceil(beat.decaySeconds / comp.tickIntervalSeconds));
        const [row] = await tx.insert(newsEvents).values({
          competitionId,
          headline: beat.headline,
          body: `${beat.arcTitle} · part ${beat.arcStep} of ${beat.arcLength}`,
          impactBps: beat.impactBps,
          decaySeconds: beat.decaySeconds,
          startTick: beat.tick,
          endTick: beat.tick + ticks - 1,
          status: "queued",
          arcId: beat.arcId,
          arcStep: beat.arcStep,
          createdBy: admin.id,
        }).returning({ id: newsEvents.id });

        if (beat.stockIds.length) {
          await tx.insert(newsEventStocks).values(
            beat.stockIds.map((stockId) => ({ newsEventId: row!.id, stockId, impactBps: null })),
          );
        }
      }
    });

    const stories = new Set(plan.map((b) => b.arcId)).size;
    await audit(admin, "news.generate", {
      competitionId, payload: { headlines: plan.length, stories, sessionMinutes },
    });
    refresh();
    return {
      ok: true,
      message: `Queued ${plan.length} headlines across ${stories} stories, spread over ${sessionMinutes} minutes.`,
    };
  } catch (e) { return fail(e); }
}

/** Fire a queued headline immediately instead of waiting for its slot. */
export async function publishQueuedNow(newsEventId: number): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const row = await db.query.newsEvents.findFirst({ where: eq(newsEvents.id, newsEventId) });
    if (!row) return { ok: false, error: "Not found." };
    if (row.status === "published") return { ok: false, error: "Already published." };

    const comp = await db.query.competitions.findFirst({ where: eq(competitions.id, row.competitionId) });
    if (!comp) return { ok: false, error: "Competition not found." };

    const ticks = Math.max(1, row.endTick - row.startTick + 1);
    const start = comp.currentTick + 1;
    await db.update(newsEvents).set({
      status: "published", startTick: start, endTick: start + ticks - 1, publishedAt: new Date(),
    }).where(eq(newsEvents.id, newsEventId));

    await audit(admin, "news.publish_early", {
      competitionId: row.competitionId, entityType: "news_event", entityId: newsEventId,
    });
    refresh();
    return { ok: true, message: "Published." };
  } catch (e) { return fail(e); }
}

/** Drop a queued headline that does not suit. */
export async function deleteQueuedNews(newsEventId: number): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const row = await db.query.newsEvents.findFirst({ where: eq(newsEvents.id, newsEventId) });
    if (!row) return { ok: false, error: "Not found." };
    if (row.status === "published") {
      return { ok: false, error: "That one has already gone out. It cannot be unpublished." };
    }
    await db.delete(newsEvents).where(eq(newsEvents.id, newsEventId));
    await audit(admin, "news.delete_queued", {
      competitionId: row.competitionId, entityType: "news_event", entityId: newsEventId,
      payload: { headline: row.headline },
    });
    refresh();
    return { ok: true, message: "Removed from the queue." };
  } catch (e) { return fail(e); }
}
