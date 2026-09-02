import demo from "./demo-data.json";

/**
 * Demo dataset for the seed script.
 *
 * The data itself lives in demo-data.json so that scripts/deploy-init.mjs —
 * which is plain JavaScript and runs in production without a TypeScript loader
 * — can share exactly this list instead of keeping a second copy that drifts.
 */
export interface SeedStock {
  symbol: string; name: string; sector: string; price: number; volBps: number;
}

export interface SeedTeam { name: string; members: string }

export interface SeedNews {
  headline: string; body: string; impactBps: number; decaySeconds: number; sectors: string[];
}

export const DEMO_STOCKS: SeedStock[] = demo.stocks;
export const DEMO_TEAMS: SeedTeam[] = demo.teams;
export const DEMO_NEWS: SeedNews[] = demo.news;
