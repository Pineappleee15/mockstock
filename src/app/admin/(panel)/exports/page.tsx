import { Card } from "@/components/ui";

const EXPORTS = [
  { type: "trades", label: "All trades", hint: "Every fill, with fees, P&L and void status." },
  { type: "standings", label: "Final standings", hint: "The leaderboard as it stands right now." },
  { type: "prices", label: "Price history", hint: "Every tick for every stock, with anchor, gap and net volume." },
  { type: "audit", label: "Audit log", hint: "Every admin action and order decision, immutable." },
];

export default function ExportsPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Exports</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {EXPORTS.map((e) => (
          <Card key={e.type} className="p-3">
            <h2 className="text-sm font-semibold">{e.label}</h2>
            <p className="mt-0.5 mb-2 text-xs text-muted">{e.hint}</p>
            <a
              href={`/api/export?type=${e.type}`}
              className="inline-flex rounded-md bg-surface-2 px-3 py-2 text-sm font-semibold hover:bg-border"
            >
              Download CSV
            </a>
          </Card>
        ))}
      </div>
      <p className="text-[11px] text-muted">
        Money is exported in rupees with two decimals, not paise, so the files open cleanly in Excel.
      </p>
    </div>
  );
}
