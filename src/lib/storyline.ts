import { hash32, uniform } from "./rng";
import { regimeAt } from "./regime";
import { ARCS, CROSS_ARCS, CRYPTIC_ARCS, type ArcTemplate } from "./storyline-templates";

/**
 * Builds a session's worth of news ahead of time.
 *
 * Two things make it feel authored rather than random.
 *
 * Stories develop. An arc is several beats over a few minutes — rumour, then
 * confirmation or denial, then fallout — so acting early is a real risk and
 * waiting for certainty costs you the move.
 *
 * Stories agree with the market. Regimes are deterministic, so the generator
 * reads the mood at each slot and picks news that fits it: bad news lands while
 * the market is selling off, good news during a rally. The session then appears
 * to explain itself instead of running two unrelated systems side by side.
 */

export interface StockLike {
  id: number;
  symbol: string;
  name: string;
  sector: string;
}

export interface PlannedBeat {
  arcId: string;
  arcTitle: string;
  arcStep: number;
  arcLength: number;
  /** Tick this beat goes live. */
  tick: number;
  minute: number;
  headline: string;
  impactBps: number;
  decaySeconds: number;
  stockIds: number[];
  /** For the admin list: what this beat hits. */
  targetLabel: string;
}

/** Roughly one story every this many minutes. */
const MINUTES_PER_ARC = 22;
const STREAM = 9100;

export function planStoryline(
  competitionId: number,
  stocks: StockLike[],
  sessionMinutes: number,
  tickIntervalSeconds: number,
  opts: { maxImpactPct?: number; variant?: number } = {},
): PlannedBeat[] {
  if (stocks.length === 0) return [];

  const maxPct = opts.maxImpactPct ?? 4.5;
  // Everything below is seeded from the competition, which made a plan
  // reproducible and regeneration pointless — it returned the same stories every
  // time. The variant shifts the whole seed so "Regenerate" genuinely rewrites
  // the session. Left at zero it is still reproducible, which the preview
  // script relies on.
  const seed = competitionId * 7919 + (opts.variant ?? 0) * 104729;
  const bySector = new Map<string, StockLike[]>();
  for (const s of stocks) bySector.set(s.sector, [...(bySector.get(s.sector) ?? []), s]);
  const sectors = [...bySector.keys()];

  const arcCount = Math.max(2, Math.round(sessionMinutes / MINUTES_PER_ARC));
  const out: PlannedBeat[] = [];
  // Every arc key used so far. A story repeating inside one session is the
  // fastest way to break the illusion that any of this is real.
  const used = new Set<string>();
  // Targets too: the same company twice in a session reads as a bug.
  const usedTargets = new Set<string>();

  for (let i = 0; i < arcCount; i++) {
    // Spread arcs across the session, jittered so they are not metronomic, and
    // never in the first three minutes — let people find their feet.
    const slot = (i + 0.5) / arcCount;
    const jitter = (uniform(hash32(seed, i, STREAM), i, STREAM) - 0.5) * (sessionMinutes / arcCount) * 0.5;
    const startMinute = Math.max(3, Math.min(sessionMinutes - 6, Math.round(slot * sessionMinutes + jitter)));
    const startTick = Math.round((startMinute * 60) / tickIntervalSeconds);

    const mood = regimeAt(competitionId, startTick, tickIntervalSeconds);
    const wants: "positive" | "negative" | "any" =
      mood.key === "rally" ? "positive"
      : mood.key === "selloff" || mood.key === "panic" ? "negative"
      : "any";

    const arc = pickArc(seed, i, wants, used);
    used.add(arc.key);

    const targets = resolveTargets(seed, i, arc, stocks, bySector, sectors, usedTargets);
    if (!targets) continue;
    usedTargets.add(targets.primary.label);

    for (let b = 0; b < arc.beats.length; b++) {
      const beat = arc.beats[b]!;
      const pick = beat.target === "secondary" ? targets.secondary : targets.primary;
      if (!pick || pick.stockIds.length === 0) continue;

      const minute = startMinute + beat.at;
      if (minute > sessionMinutes - 1) continue;

      const pct = Math.max(-maxPct, Math.min(maxPct, beat.impactPct));
      out.push({
        arcId: `${competitionId}-${opts.variant ?? 0}-${i}-${arc.key}`,
        arcTitle: arc.title,
        arcStep: b + 1,
        arcLength: arc.beats.length,
        tick: Math.round((minute * 60) / tickIntervalSeconds),
        minute,
        headline: fill(beat.headline, pick, targets.secondary),
        impactBps: Math.round(pct * 100),
        decaySeconds: beat.decaySeconds ?? 120,
        stockIds: pick.stockIds,
        targetLabel: pick.label,
      });
    }
  }

  return out.sort((a, b) => a.tick - b.tick);
}

interface Target {
  label: string;
  stockIds: number[];
  symbol?: string;
  name?: string;
  sector?: string;
}

/** Pick an unused arc whose sentiment fits the mood. */
function pickArc(
  seed: number, i: number,
  wants: "positive" | "negative" | "any", used: Set<string>,
): ArcTemplate {
  const all = [...ARCS, ...CROSS_ARCS, ...CRYPTIC_ARCS];
  const fitsMood = (a: ArcTemplate) =>
    wants === "any" || a.sentiment === wants || a.sentiment === "mixed";

  // Prefer unused and on-mood; fall back to unused; only then allow a repeat.
  const pool =
    all.filter((a) => !used.has(a.key) && fitsMood(a)).length > 0
      ? all.filter((a) => !used.has(a.key) && fitsMood(a))
      : all.filter((a) => !used.has(a.key)).length > 0
      ? all.filter((a) => !used.has(a.key))
      : all.filter(fitsMood);

  const usable = pool.length > 0 ? pool : all;
  const roll = uniform(hash32(seed, i, STREAM + 1), i, STREAM + 1);
  return usable[Math.min(usable.length - 1, Math.floor(roll * usable.length))]!;
}

function resolveTargets(
  seed: number, i: number, arc: ArcTemplate,
  stocks: StockLike[], bySector: Map<string, StockLike[]>, sectors: string[],
  usedTargets: Set<string>,
): { primary: Target; secondary?: Target } | null {
  const roll = (n: number) => uniform(hash32(seed, i * 10 + n, STREAM + 2), i, STREAM + 2);

  if (arc.scope === "stock") {
    const fresh = stocks.filter((x) => !usedTargets.has(x.symbol));
    const pool = fresh.length > 0 ? fresh : stocks;
    const s = pool[Math.floor(roll(1) * pool.length)]!;
    return {
      primary: { label: s.symbol, stockIds: [s.id], symbol: s.symbol, name: s.name, sector: s.sector },
    };
  }

  if (arc.scope === "sector") {
    const freshSectors = sectors.filter((x) => !usedTargets.has(x));
    const pool = freshSectors.length > 0 ? freshSectors : sectors;
    const sector = pool[Math.floor(roll(2) * pool.length)]!;
    const list = bySector.get(sector) ?? [];
    return { primary: { label: sector, stockIds: list.map((x) => x.id), sector } };
  }

  // Cross-sector: use a defined pair when both sectors exist, else improvise.
  const pairs = (arc.pairs ?? []).filter(([a, b]) => bySector.has(a) && bySector.has(b));
  let a: string, b: string;
  if (pairs.length) {
    [a, b] = pairs[Math.floor(roll(3) * pairs.length)]!;
  } else {
    if (sectors.length < 2) return null;
    a = sectors[Math.floor(roll(4) * sectors.length)]!;
    b = sectors.find((x) => x !== a)!;
  }

  return {
    primary: { label: a, stockIds: (bySector.get(a) ?? []).map((x) => x.id), sector: a },
    secondary: { label: b, stockIds: (bySector.get(b) ?? []).map((x) => x.id), sector: b },
  };
}

/** Resolve {NAME}, {SYMBOL}, {SECTOR} and {OTHER} in a headline. */
function fill(template: string, target: Target, other?: Target): string {
  return template
    .replace(/\{NAME\}/g, target.name ?? target.sector ?? target.label)
    .replace(/\{SYMBOL\}/g, target.symbol ?? target.label)
    .replace(/\{SECTOR\}/g, target.sector ?? target.label)
    .replace(/\{OTHER\}/g, other?.sector ?? other?.label ?? "the rest of the market");
}
