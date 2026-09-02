// Convert the demo dataset to JSON so both the TS seed and the plain-JS deploy
// init can share one copy instead of drifting apart.
import { readFileSync, writeFileSync } from "node:fs";
const src = readFileSync("scripts/stocks-demo.ts", "utf8");

const grab = (name) => {
  const start = src.indexOf(`export const ${name}`);
  const open = src.indexOf("[", start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]") { depth--; if (depth === 0) break; }
  }
  return src.slice(open, i + 1);
};

const toJson = (literal) =>
  literal
    .replace(/(\w+):/g, '"$1":')       // bare keys -> quoted
    .replace(/"([^"]*)"\s*:/g, '"$1":')
    .replace(/'/g, '"')
    .replace(/,(\s*[}\]])/g, "$1");    // trailing commas

const data = {
  stocks: JSON.parse(toJson(grab("DEMO_STOCKS"))),
  teams: JSON.parse(toJson(grab("DEMO_TEAMS"))),
  news: JSON.parse(toJson(grab("DEMO_NEWS"))),
};
writeFileSync("scripts/demo-data.json", JSON.stringify(data, null, 2) + "\n");
console.log(`stocks=${data.stocks.length} teams=${data.teams.length} news=${data.news.length}`);
