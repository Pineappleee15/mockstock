/**
 * Story templates for the generated news schedule.
 *
 * Each arc is several beats that develop over a few minutes, so a headline is
 * rarely a bolt from nowhere: a rumour arrives, then confirmation or a denial,
 * then the fallout. Teams that act on the rumour are early and take the risk of
 * it being wrong; teams that wait for confirmation pay up.
 *
 * `scope` decides who is hit. Cross-sector arcs are what make the market feel
 * joined up rather than a set of independent tickers — crude rising is good for
 * energy and bad for the people who buy fuel.
 */

export type Sentiment = "positive" | "negative" | "mixed";

export interface BeatTemplate {
  /** Minutes after the arc begins. */
  at: number;
  headline: string;
  body?: string;
  /** Percent move. Positive lifts, negative drags. */
  impactPct: number;
  /** Which of the arc's targets this beat hits. */
  target: "primary" | "secondary";
  decaySeconds?: number;
}

export interface ArcTemplate {
  key: string;
  title: string;
  sentiment: Sentiment;
  /** stock: one company. sector: a whole sector. cross: one sector helped, another hurt. */
  scope: "stock" | "sector" | "cross";
  /** For cross arcs, which sectors to prefer as primary and secondary. */
  pairs?: Array<[string, string]>;
  beats: BeatTemplate[];
}

/** {NAME} and {SYMBOL} for companies, {SECTOR} and {OTHER} for sectors. */
export const ARCS: ArcTemplate[] = [
  {
    key: "order-win", title: "Contract win", sentiment: "positive", scope: "stock",
    beats: [
      { at: 0, headline: "Traders talk of a large order in the works at {NAME}", impactPct: 1.4, target: "primary" },
      { at: 4, headline: "{NAME} confirms multi-year contract, biggest in three years", impactPct: 3.6, target: "primary", decaySeconds: 180 },
      { at: 9, headline: "Brokerages lift targets on {SYMBOL} after the order win", impactPct: 1.3, target: "primary" },
    ],
  },
  {
    key: "results-beat", title: "Results beat", sentiment: "positive", scope: "stock",
    beats: [
      { at: 0, headline: "{NAME} numbers due shortly, street braced for a soft quarter", impactPct: -1.2, target: "primary" },
      { at: 5, headline: "{NAME} beats estimates as margins expand", impactPct: 4.2, target: "primary", decaySeconds: 180 },
    ],
  },
  {
    key: "acquisition", title: "Acquisition", sentiment: "positive", scope: "stock",
    beats: [
      { at: 0, headline: "{NAME} said to be in advanced talks for an acquisition", impactPct: 1.8, target: "primary" },
      { at: 6, headline: "{NAME} announces all-cash deal, funded from reserves", impactPct: 2.4, target: "primary" },
    ],
  },
  {
    key: "probe", title: "Regulatory probe", sentiment: "negative", scope: "stock",
    beats: [
      { at: 0, headline: "Regulator seeks clarification from {NAME} on disclosures", impactPct: -1.6, target: "primary" },
      { at: 5, headline: "{NAME} placed under formal investigation", impactPct: -4.1, target: "primary", decaySeconds: 180 },
      { at: 11, headline: "{NAME} says it will cooperate fully, calls reports premature", impactPct: 1.2, target: "primary" },
    ],
  },
  {
    key: "guidance-cut", title: "Guidance cut", sentiment: "negative", scope: "stock",
    beats: [
      { at: 0, headline: "{NAME} flags softer demand in its key markets", impactPct: -1.9, target: "primary" },
      { at: 6, headline: "{NAME} cuts full-year guidance, shares under pressure", impactPct: -3.8, target: "primary", decaySeconds: 180 },
    ],
  },
  {
    key: "cfo-exit", title: "Boardroom exit", sentiment: "negative", scope: "stock",
    beats: [
      { at: 0, headline: "{NAME} CFO resigns citing personal reasons", impactPct: -2.6, target: "primary" },
      { at: 7, headline: "{NAME} names an interim CFO, calls the transition orderly", impactPct: 0.9, target: "primary" },
    ],
  },
  {
    key: "block-deal", title: "Block deal", sentiment: "negative", scope: "stock",
    beats: [
      { at: 0, headline: "Large block of {SYMBOL} changes hands at a discount", impactPct: -2.2, target: "primary" },
      { at: 5, headline: "Promoter says stake sale was for unrelated obligations", impactPct: 0.8, target: "primary" },
    ],
  },
  {
    key: "policy-relief", title: "Policy relief", sentiment: "positive", scope: "sector",
    beats: [
      { at: 0, headline: "Cabinet is said to be considering relief for {SECTOR}", impactPct: 1.5, target: "primary" },
      { at: 5, headline: "Government clears policy support package for {SECTOR}", impactPct: 3.0, target: "primary", decaySeconds: 210 },
    ],
  },
  {
    key: "new-levy", title: "New levy", sentiment: "negative", scope: "sector",
    beats: [
      { at: 0, headline: "Reports of a fresh levy under discussion for {SECTOR}", impactPct: -1.5, target: "primary" },
      { at: 6, headline: "Levy on {SECTOR} confirmed in draft rules", impactPct: -3.2, target: "primary", decaySeconds: 210 },
    ],
  },
  {
    key: "demand-surge", title: "Demand surge", sentiment: "positive", scope: "sector",
    beats: [
      { at: 0, headline: "{SECTOR} volumes running at multi-quarter highs", impactPct: 2.6, target: "primary", decaySeconds: 180 },
    ],
  },
];

/**
 * Cryptic arcs.
 *
 * The company is never named. The clue points at what a business does, or at
 * something happening upstream of it, and the room has to work out who it lands
 * on. Whoever cracks it first buys cheapest, and their own buying is what moves
 * the price for everyone slower, so the reward for reading well comes out of
 * the engine rather than being handed out.
 *
 * Written over two or three lines so they read as a riddle, not a headline.
 */
export const CRYPTIC_ARCS: ArcTemplate[] = [
  {
    key: "cryptic-order-book", title: "Cryptic - order book", sentiment: "positive", scope: "stock",
    beats: [
      { at: 0, headline: "A ledger somewhere just got longer.\nThe ink is not dry, and nobody has announced anything.", impactPct: 1.2, target: "primary" },
      { at: 6, headline: "The order was real.\nWhoever read the room first is already holding it.", impactPct: 3.4, target: "primary", decaySeconds: 180 },
    ],
  },
  {
    key: "cryptic-audit", title: "Cryptic - the auditors", sentiment: "negative", scope: "stock",
    beats: [
      { at: 0, headline: "Someone has been asked for their books.\nThey have asked for more time.", impactPct: -1.6, target: "primary" },
      { at: 6, headline: "More time was not granted.\nThe question was never really about the numbers.", impactPct: -3.6, target: "primary", decaySeconds: 180 },
    ],
  },
  {
    key: "cryptic-ground", title: "Cryptic - from the ground", sentiment: "mixed", scope: "cross",
    pairs: [["Metals", "Auto"]],
    beats: [
      { at: 0, headline: "What comes out of the ground is dearer this morning.\nGood news, if selling it is your whole business.", impactPct: 3.2, target: "primary", decaySeconds: 180 },
      { at: 2, headline: "Less good if you buy it by the tonne\nbefore you can sell anything at all.", impactPct: -2.1, target: "secondary", decaySeconds: 180 },
    ],
  },
  {
    key: "cryptic-currency", title: "Cryptic - the rupee", sentiment: "mixed", scope: "cross",
    pairs: [["IT", "Energy"]],
    beats: [
      { at: 0, headline: "The rupee buys less this morning than it did last night.\nSome people are paid in something else.", impactPct: 2.4, target: "primary", decaySeconds: 180 },
      { at: 3, headline: "Others have to pay in something else.\nTheir bill just went up.", impactPct: -1.9, target: "secondary", decaySeconds: 180 },
    ],
  },
  {
    key: "cryptic-shelf", title: "Cryptic - the shelf", sentiment: "positive", scope: "sector",
    beats: [
      { at: 0, headline: "Something on every shelf in the country\nis about to get a little cheaper to make.", impactPct: 2.6, target: "primary", decaySeconds: 200 },
    ],
  },
  {
    key: "cryptic-corner", title: "Cryptic - the corner office", sentiment: "negative", scope: "stock",
    beats: [
      { at: 0, headline: "A corner office emptied over the weekend.\nThe statement says personal reasons.\nIt usually does.", impactPct: -2.4, target: "primary" },
      { at: 7, headline: "A replacement has been found from inside.\nThe market is choosing to believe it.", impactPct: 1.0, target: "primary" },
    ],
  },
];

/** Cross-sector arcs: one side gains exactly because the other loses. */
export const CROSS_ARCS: ArcTemplate[] = [
  {
    key: "crude-spike", title: "Crude spikes", sentiment: "mixed", scope: "cross",
    pairs: [["Energy", "Auto"]],
    beats: [
      { at: 0, headline: "Crude jumps overnight after a supply disruption", impactPct: 3.4, target: "primary", decaySeconds: 180 },
      { at: 1, headline: "Higher fuel costs seen squeezing {OTHER} margins", impactPct: -2.4, target: "secondary", decaySeconds: 180 },
      { at: 8, headline: "Crude gives back part of the overnight spike", impactPct: -1.3, target: "primary" },
    ],
  },
  {
    key: "rate-hold", title: "Rate decision", sentiment: "mixed", scope: "cross",
    pairs: [["Banking", "FMCG"]],
    beats: [
      { at: 0, headline: "RBI holds the repo rate and strikes a softer tone", impactPct: 2.8, target: "primary", decaySeconds: 210 },
      { at: 3, headline: "Cheaper credit seen lifting discretionary demand", impactPct: 1.4, target: "secondary" },
    ],
  },
  {
    key: "rupee-slide", title: "Rupee slides", sentiment: "mixed", scope: "cross",
    pairs: [["IT", "Energy"]],
    beats: [
      { at: 0, headline: "Rupee slides to a record low against the dollar", impactPct: 2.5, target: "primary", decaySeconds: 180 },
      { at: 2, headline: "Weaker rupee raises the import bill for {OTHER}", impactPct: -2.0, target: "secondary", decaySeconds: 180 },
    ],
  },
  {
    key: "metal-surge", title: "Metal prices surge", sentiment: "mixed", scope: "cross",
    pairs: [["Metals", "Auto"]],
    beats: [
      { at: 0, headline: "Global metal prices surge on supply cuts", impactPct: 3.8, target: "primary", decaySeconds: 180 },
      { at: 2, headline: "Input costs climb for {OTHER} makers", impactPct: -2.2, target: "secondary", decaySeconds: 180 },
    ],
  },
  {
    key: "pharma-approval", title: "Approvals cleared", sentiment: "mixed", scope: "cross",
    pairs: [["Pharma", "FMCG"]],
    beats: [
      { at: 0, headline: "Regulator clears a backlog of {SECTOR} approvals", impactPct: 3.0, target: "primary", decaySeconds: 180 },
      { at: 6, headline: "Analysts call the read-across to {OTHER} overdone", impactPct: -1.2, target: "secondary" },
    ],
  },
];
