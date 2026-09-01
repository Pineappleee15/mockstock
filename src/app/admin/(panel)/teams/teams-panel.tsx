"use client";

import { Fragment, useState } from "react";
import { createTeams, resetTeamPassword, setTeamDisabled, adjustCashAction } from "@/actions/admin";
import { ActionButton, ActionForm } from "@/components/action-button";
import { Card, Badge, Input, Empty, Button } from "@/components/ui";
import { formatRupees } from "@/lib/money";

export interface TeamRow {
  id: number; name: string; members: string; joinCode: string;
  enrolled: boolean; disabled: boolean; lastLogin: string | null;
  cashPaise: number; tradeCount: number;
}

export function TeamsPanel({ competitionId, teams }: { competitionId: number; teams: TeamRow[] }) {
  const [q, setQ] = useState("");
  const [adjusting, setAdjusting] = useState<number | null>(null);

  const filtered = teams.filter((t) =>
    t.name.toLowerCase().includes(q.toLowerCase()) || t.joinCode.includes(q.toUpperCase()));

  const codeSheet = teams.map((t) => `${t.joinCode}\t${t.name}`).join("\n");

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-3">
          <h2 className="mb-2 text-sm font-semibold">Add teams</h2>
          <ActionForm run={(fd) => createTeams(competitionId, fd)} submitLabel="Create teams">
            <textarea
              name="bulk" rows={5}
              placeholder="One per line:  Alpha Seekers, Rohan, Ananya"
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
            />
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">or paste a CSV</summary>
              <textarea
                name="csv" rows={4} placeholder="name,members,join_code"
                className="mt-2 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
              />
              <p className="mt-1">
                Leave join_code blank to generate one. Duplicate team names are skipped, so
                re-importing the same sheet will not create second copies.
              </p>
            </details>
          </ActionForm>
        </Card>

        <Card className="p-3">
          <h2 className="mb-2 text-sm font-semibold">Join codes</h2>
          <p className="mb-2 text-xs text-muted">
            Paste this into a slide. Codes avoid 0/O and 1/I so they read cleanly off a projector.
          </p>
          <textarea readOnly value={codeSheet} rows={8}
            className="num w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-xs" />
          <Button className="mt-2" onClick={() => void navigator.clipboard.writeText(codeSheet)}>
            Copy all
          </Button>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">{teams.length} teams</h2>
          <Input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or code" className="max-w-56" />
        </div>

        {filtered.length === 0 ? <Empty>No teams match.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-muted">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-medium">Code</th>
                  <th className="px-3 py-2 text-left font-medium">Team</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Cash</th>
                  <th className="px-3 py-2 text-right font-medium">Trades</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <Fragment key={t.id}>
                    <TeamRowView team={t}
                      onToggleCash={() => setAdjusting(adjusting === t.id ? null : t.id)} />
                    {adjusting === t.id && <CashRow team={t} />}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function TeamRowView({ team, onToggleCash }: { team: TeamRow; onToggleCash: () => void }) {
  return (
    <tr className="border-b border-border/50">
      <td className="num px-3 py-2 font-semibold tracking-wider">{team.joinCode}</td>
      <td className="px-3 py-2">
        <div className="font-medium">{team.name}</div>
        {team.members && <div className="text-[11px] text-muted">{team.members}</div>}
      </td>
      <td className="px-3 py-2">
        {team.disabled ? <Badge tone="down">Disabled</Badge>
          : team.enrolled ? <Badge tone="up">Signed in</Badge>
          : <Badge>Not yet</Badge>}
      </td>
      <td className="num px-3 py-2 text-right">{formatRupees(team.cashPaise)}</td>
      <td className="num px-3 py-2 text-right text-muted">{team.tradeCount}</td>
      <td className="px-3 py-2">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onToggleCash}>Cash</Button>
          <ActionButton
            variant="ghost"
            confirm={`Reset the password for ${team.name}? They set a new one on next sign-in and any open session is signed out.`}
            run={() => resetTeamPassword(team.id)}
          >
            Reset
          </ActionButton>
          <ActionButton
            variant="ghost"
            confirm={team.disabled ? undefined : `Disable ${team.name}? They cannot sign in or trade.`}
            run={() => setTeamDisabled(team.id, !team.disabled)}
          >
            {team.disabled ? "Enable" : "Disable"}
          </ActionButton>
        </div>
      </td>
    </tr>
  );
}

/** Cash adjustment. The reason is mandatory and lands in the audit log. */
function CashRow({ team }: { team: TeamRow }) {
  return (
    <tr className="border-b border-border/50 bg-surface-2/40">
      <td colSpan={6} className="px-3 py-2">
        <ActionForm
          submitLabel="Adjust cash"
          run={async (fd) =>
            adjustCashAction(team.id, Number(fd.get("amount")), String(fd.get("reason") ?? ""))}
        >
          <div className="flex flex-wrap gap-2">
            <Input name="amount" type="number" step="0.01" required className="max-w-64"
              placeholder="Amount in rupees (negative to deduct)" />
            <Input name="reason" required className="max-w-96" placeholder="Reason (required, logged)" />
          </div>
        </ActionForm>
      </td>
    </tr>
  );
}
