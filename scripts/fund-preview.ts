import { driftFor, priceHistory, fundamentalsFor } from "../src/lib/fundamentals";

const cases: Array<[string, string, number, number, number]> = [
  ["TCS", "IT", 4150, 45, 482],
  ["TATASTEEL", "Metals", 145, 100, 9655],
  ["ITC", "FMCG", 465, 40, 5161],
  ["SBIN", "Banking", 820, 65, 2439],
  ["MARUTI", "Auto", 12400, 45, 161],
  ["CIPLA", "Pharma", 1520, 60, 1316],
  ["ONGC", "Energy", 265, 85, 7547],
];

for (const [sym, , rupees, vol, liq] of cases) {
  const price = rupees * 100;
  const drift = driftFor(1, sym);
  const h = priceHistory(1, sym, price, vol, drift);
  const f = fundamentalsFor(1, sym, price, vol, drift, liq, h);
  console.log(
    sym.padEnd(11),
    ("drift " + String(drift).padStart(2)).padEnd(10),
    ("₹" + f.marketCapCr.toLocaleString("en-IN") + " Cr").padEnd(18),
    ("growth " + String(f.revenueGrowthPct) + "%").padEnd(14),
    ("PE " + String(f.peRatio)).padEnd(10),
    f.analystRating,
  );
}
