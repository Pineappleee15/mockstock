import { planStoryline } from "../src/lib/storyline";
import { regimeAt } from "../src/lib/regime";
import { DEMO_STOCKS } from "./stocks-demo";

/** What does a generated session actually read like? */
const COMP = Number(process.argv[2] ?? 1);
const MINUTES = Number(process.argv[3] ?? 180);

const stocks = DEMO_STOCKS.map((s, i) => ({
  id: i + 1, symbol: s.symbol, name: s.name, sector: s.sector,
}));

const plan = planStoryline(COMP, stocks, MINUTES, 5);

console.log(`\nSTORYLINE  competition ${COMP}, ${MINUTES} minutes, ${plan.length} headlines\n`);
let lastArc = "";
for (const b of plan) {
  if (b.arcId !== lastArc) {
    console.log("");
    lastArc = b.arcId;
  }
  const mood = regimeAt(COMP, b.tick, 5).label;
  const pct = (b.impactBps / 100).toFixed(1).padStart(5);
  console.log(
    `  ${String(b.minute).padStart(3)}m  ${pct}%  ${b.targetLabel.padEnd(10)} ${mood.padEnd(12)} ${b.headline}`,
  );
}

const arcs = new Set(plan.map((b) => b.arcId));
const aligned = plan.filter((b) => {
  const mood = regimeAt(COMP, b.tick, 5).key;
  if (mood === "rally") return b.impactBps > 0;
  if (mood === "selloff" || mood === "panic") return b.impactBps < 0;
  return true;
});
console.log(`\n  ${arcs.size} stories, ${plan.length} headlines`);
console.log(`  ${Math.round((aligned.length / plan.length) * 100)}% of headlines agree with the market mood\n`);
