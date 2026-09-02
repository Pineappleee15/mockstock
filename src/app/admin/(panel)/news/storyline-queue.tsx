"use client";

import { Fragment } from "react";
import { generateStoryline, publishQueuedNow, deleteQueuedNews } from "@/actions/admin";
import { ActionButton } from "@/components/action-button";
import { Card, Empty, Change, Badge } from "@/components/ui";

export interface QueuedNews {
  id: number;
  headline: string;
  story: string | null;
  impactBps: number;
  startTick: number;
  minute: number;
  symbols: string[];
}

/**
 * The generated news schedule.
 *
 * Written ahead of the session and published on the clock, so the organiser is
 * not typing headlines while also watching the market. Every item can still be
 * fired early or dropped, and the whole schedule can be regenerated — which
 * only ever replaces what has not gone out yet.
 */
export function StorylineQueue({
  competitionId, queued, currentTick, tickSeconds, autoNews, marketOpen,
}: {
  competitionId: number;
  queued: QueuedNews[];
  currentTick: number;
  tickSeconds: number;
  autoNews: boolean;
  marketOpen: boolean;
}) {
  const nowMinute = Math.round((currentTick * tickSeconds) / 60);

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Story schedule</h2>
          <p className="mt-0.5 max-w-xl text-[11px] text-muted">
            Headlines are written in advance as multi-part stories — a rumour, then
            confirmation or a denial, then the fallout — and timed to match the market&apos;s
            mood, so bad news tends to land while it is already selling off. They publish
            themselves on the clock. Nothing here is visible to teams until it does.
          </p>
        </div>
        <ActionButton
          variant="buy"
          confirm={queued.length > 0
            ? "Replace the queue? Anything already published stays put."
            : undefined}
          run={() => generateStoryline(competitionId)}
        >
          {queued.length > 0 ? "Regenerate" : "Generate storyline"}
        </ActionButton>
      </div>

      {!autoNews && queued.length > 0 && (
        <p className="mt-3 rounded bg-accent/10 px-3 py-2 text-xs text-accent">
          Auto-publish is off in Settings, so nothing here will go out on its own. Use
          Publish now, or turn it back on.
        </p>
      )}

      {queued.length === 0 ? (
        <div className="mt-3">
          <Empty>
            Nothing queued. Generate a storyline and you will not have to type a headline
            during the event.
          </Empty>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted">
              <tr className="border-b border-border">
                <th className="px-2 py-2 text-left font-medium">At</th>
                <th className="px-3 py-2 text-left font-medium">Headline</th>
                <th className="px-3 py-2 text-left font-medium">Hits</th>
                <th className="px-3 py-2 text-right font-medium">Impact</th>
                <th className="px-3 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {queued.map((n) => {
                const due = marketOpen && n.minute <= nowMinute;
                return (
                  <Fragment key={n.id}>
                    <tr className="border-b border-border/50">
                      <td className="num whitespace-nowrap px-2 py-2 text-muted">
                        {n.minute}m
                        {due && <span className="ml-1"><Badge tone="warn">due</Badge></span>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="max-w-[52ch]">{n.headline}</div>
                        {n.story && <div className="mt-0.5 text-[11px] text-muted">{n.story}</div>}
                      </td>
                      <td className="max-w-[20ch] truncate px-3 py-2 text-xs text-muted">
                        {n.symbols.join(", ")}
                      </td>
                      <td className="px-3 py-2 text-right"><Change bps={n.impactBps} /></td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          <ActionButton variant="ghost" run={() => publishQueuedNow(n.id)}>
                            Publish now
                          </ActionButton>
                          <ActionButton
                            variant="ghost"
                            confirm={`Drop "${n.headline.slice(0, 50)}…" from the schedule?`}
                            run={() => deleteQueuedNews(n.id)}
                          >
                            Drop
                          </ActionButton>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
