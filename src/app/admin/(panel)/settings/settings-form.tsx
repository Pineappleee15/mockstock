"use client";

import { useState } from "react";

import { updateCompetition, createCompetition } from "@/actions/admin";
import { ActionForm } from "@/components/action-button";
import { Card, Input } from "@/components/ui";

interface Comp {
  id: number; name: string; mode: string; state: string;
  sessionMinutes: number;
  startingCashPaise: number; brokerageBps: number; spreadBps: number;
  concentrationCapBps: number; orderRateLimitPerMin: number; circuitLimitBps: number;
  tickIntervalSeconds: number; volatilityMultiplierBps: number;
  orderFlowEnabled: boolean; impactCoefficientBps: number; maxImpactBpsPerTick: number;
  gapHalflifeSeconds: number; permanentImpactBps: number;
  regimeEnabled: boolean; marketFactorBps: number; autoNewsEnabled: boolean;
  shortSellingEnabled: boolean; driftSpreadBps: number;
  liquidityMultiplierBps: number; shockChanceBps: number;
}

function Field({
  label, name, defaultValue, hint, ...rest
}: { label: string; name: string; defaultValue: string | number; hint?: string } &
  React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <Input name={name} defaultValue={defaultValue} {...rest} />
      {hint && <span className="mt-0.5 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

/**
 * How long the session is meant to run.
 *
 * Not merely a label: it sets how far apart the generated news stories are
 * spaced, and where the volatility curve puts its opening and closing rush. A
 * 40-minute mock and a four-hour event need very different pacing from the same
 * engine.
 */
function SessionLength({ initial }: { initial: number }) {
  const [minutes, setMinutes] = useState(initial);
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const pretty = hrs > 0 ? `${hrs}h${mins ? ` ${mins}m` : ""}` : `${mins}m`;

  return (
    <label className="block sm:col-span-2">
      <span className="mb-1 flex items-baseline justify-between text-xs font-medium text-muted">
        <span>Session length</span>
        <span className="num text-sm font-semibold text-text">{pretty}</span>
      </span>
      <input
        type="range" name="sessionMinutes" min={15} max={480} step={5}
        value={minutes}
        onChange={(e) => setMinutes(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
      />
      <span className="mt-0.5 flex justify-between text-[10px] text-muted">
        <span>15m</span><span>2h</span><span>4h</span><span>8h</span>
      </span>
      <span className="mt-0.5 block text-[11px] text-muted">
        Spaces the generated news and sets where the opening and closing rush fall.
        Regenerate the storyline after changing it.
      </span>
    </label>
  );
}

export function SettingsForm({ competition: c }: { competition: Comp }) {
  return (
    <div className="space-y-4">
      <ActionForm run={(fd) => updateCompetition(c.id, fd)} submitLabel="Save settings">
        <Card className="p-3">
          <h2 className="mb-3 text-sm font-semibold">Competition</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Name" name="name" defaultValue={c.name} required />
            <Field label="Starting cash (₹)" name="startingCashRupees" type="number" step="1"
              defaultValue={c.startingCashPaise / 100}
              hint="Applies to teams created after this change." />
            <Field label="Brokerage (bps)" name="brokerageBps" type="number"
              defaultValue={c.brokerageBps} hint="5 = 0.05% per trade" />
            <Field label="Spread (bps)" name="spreadBps" type="number"
              defaultValue={c.spreadBps} hint="20 = 0.2%, half applied each side" />
            <Field label="Concentration cap (bps)" name="concentrationCapBps" type="number"
              defaultValue={c.concentrationCapBps} hint="4000 = 40% max in one stock" />
            <Field label="Order rate limit (per min)" name="orderRateLimitPerMin" type="number"
              defaultValue={c.orderRateLimitPerMin} />
            <Field label="Circuit limit (bps)" name="circuitLimitBps" type="number"
              defaultValue={c.circuitLimitBps} hint="2000 = halt after a 20% move from session open" />
            <Field label="Tick interval (seconds)" name="tickIntervalSeconds" type="number"
              defaultValue={c.tickIntervalSeconds} hint="Takes effect without a restart" />
            <SessionLength initial={c.sessionMinutes} />
            <Field label="Volatility multiplier (bps)" name="volatilityMultiplierBps" type="number"
              defaultValue={c.volatilityMultiplierBps} hint="10000 = 1.0x. 20000 makes the event twice as wild." />
          </div>
        </Card>

        <Card className="p-3">
          <h2 className="text-sm font-semibold">Order flow impact</h2>
          <p className="mb-3 text-[11px] text-muted">
            This is the primary price driver: what teams buy and sell is what moves prices.
            The pullback half-life is the most important knob — it is what stops the opening
            rush from pumping every stock and leaving nothing to trade for the rest of the event.
          </p>
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input type="checkbox" name="orderFlowEnabled" defaultChecked={c.orderFlowEnabled}
              className="size-4 accent-[var(--color-accent)]" />
            Enable order flow impact
          </label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Impact coefficient (bps)" name="impactCoefficientBps" type="number"
              defaultValue={c.impactCoefficientBps}
              hint="bps of move when net volume equals the stock's liquidity" />
            <Field label="Max impact per tick (bps)" name="maxImpactBpsPerTick" type="number"
              defaultValue={c.maxImpactBpsPerTick} hint="200 = 2% ceiling per tick" />
            <Field label="Pullback half-life (seconds)" name="gapHalflifeSeconds" type="number"
              defaultValue={c.gapHalflifeSeconds}
              hint="How fast a flow-driven move decays back to fair value" />
            <Field label="Permanent share (bps)" name="permanentImpactBps" type="number"
              defaultValue={c.permanentImpactBps}
              hint="3000 = 30% of each move permanently re-rates the stock" />
          </div>
        </Card>
        <Card className="p-3">
          <h2 className="text-sm font-semibold">Market mood</h2>
          <p className="mb-3 text-[11px] text-muted">
            Short selling lets a team sell what it does not own and buy it back later. It is
            deliberately flow-neutral — a short does not push the price down — so it cannot start
            a cascade, and the concentration cap plus the circuit breaker bound the loss.
            Without market regimes every stock moves independently and the session is three hours of
            flat noise. With it the market has phases — quiet, choppy, selling off, the
            occasional panic — and stocks fall and recover together, each according to its
            beta. Volatility also runs higher around the open and into the close.
          </p>
          <div className="mb-3 flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="regimeEnabled" defaultChecked={c.regimeEnabled}
                className="size-4 accent-[var(--color-accent)]" />
              Enable market regimes
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="autoNewsEnabled" defaultChecked={c.autoNewsEnabled}
                className="size-4 accent-[var(--color-accent)]" />
              Publish queued news automatically
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="shortSellingEnabled" defaultChecked={c.shortSellingEnabled}
                className="size-4 accent-[var(--color-accent)]" />
              Allow short selling
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Market factor (bps)" name="marketFactorBps" type="number"
              defaultValue={c.marketFactorBps}
              hint="How hard the shared move hits. 6000 gives about a 20% swing over three hours." />
            <Field label="Liquidity multiplier (bps)" name="liquidityMultiplierBps" type="number"
              defaultValue={c.liquidityMultiplierBps}
              hint="Below 10000 makes team trading move prices more. Halve it for a small room." />
            <Field label="Skill vs luck (drift spread, bps/min)" name="driftSpreadBps" type="number"
              defaultValue={c.driftSpreadBps}
              hint="How far apart good and bad companies are. Over 400 simulated sessions: 5 has research beating a random pick 75% of the time, 7 gets 86%, 9 reaches 88% and starts making the result a foregone conclusion." />
            <Field label="Shock chance per tick (bps)" name="shockChanceBps" type="number"
              defaultValue={c.shockChanceBps}
              hint="15 is roughly three or four unexplained jolts across a session. 0 turns them off." />
          </div>
        </Card>
      </ActionForm>

      <NewCompetition currentId={c.id} currentName={c.name} currentState={c.state} />
    </div>
  );
}

/**
 * Start a fresh competition. Only one runs at a time, so this refuses while the
 * current one is live. Copying the stock universe over saves re-importing the
 * whole thing for every event.
 */
function NewCompetition({
  currentId, currentName, currentState,
}: { currentId: number; currentName: string; currentState: string }) {
  const live = ["pre_open", "open", "paused"].includes(currentState);

  return (
    <Card className="border-border p-3">
      <h2 className="text-sm font-semibold">Start a new competition</h2>
      <p className="mb-3 text-[11px] text-muted">
        The current one keeps its data and its results page. You get a clean slate:
        no teams, no trades, fresh prices.
      </p>

      {live ? (
        <p className="rounded bg-accent/10 px-3 py-2 text-xs text-accent">
          &ldquo;{currentName}&rdquo; is still running. Close or end it on the Control page first.
        </p>
      ) : (
        <ActionForm run={(fd) => createCompetition(fd)} submitLabel="Create competition">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Name</span>
              <Input name="name" required placeholder="BlueChip Exchange 2026" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Mode</span>
              <select name="mode" defaultValue="event"
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
                <option value="event">Event — one session of a few hours</option>
                <option value="league">League — open and close over several days</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Starting cash (₹)</span>
              <Input name="startingCashRupees" type="number" defaultValue={1000000} required />
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" name="copyStocksFrom" value={currentId} defaultChecked
                className="size-4 accent-[var(--color-accent)]" />
              Copy the current stock list
            </label>
          </div>
        </ActionForm>
      )}
    </Card>
  );
}
