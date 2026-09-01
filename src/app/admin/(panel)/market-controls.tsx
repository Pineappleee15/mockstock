"use client";

import { marketAction } from "@/actions/admin";
import { ActionButton } from "@/components/action-button";
import { Card } from "@/components/ui";

/**
 * The buttons that matter most during a live event, so they are big, always in
 * the same place, and the destructive ones ask first.
 */
export function MarketControls({ competitionId, state }: { competitionId: number; state: string }) {
  const can = (s: string[]) => s.includes(state);

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-start gap-2">
        {can(["draft", "pre_open", "closed"]) && (
          <ActionButton variant="buy" run={() => marketAction(competitionId, "open")}>
            Open market
          </ActionButton>
        )}
        {can(["open"]) && (
          <ActionButton run={() => marketAction(competitionId, "pause")}>Pause</ActionButton>
        )}
        {can(["paused"]) && (
          <ActionButton variant="buy" run={() => marketAction(competitionId, "resume")}>Resume</ActionButton>
        )}
        {can(["open", "paused"]) && (
          <ActionButton
            run={() => marketAction(competitionId, "close")}
            confirm="Close the market? Trading stops and prices freeze. You can reopen."
          >
            Close
          </ActionButton>
        )}
        {can(["open", "paused", "closed"]) && (
          <ActionButton
            variant="danger"
            run={() => marketAction(competitionId, "end")}
            confirm="End the competition for good? The leaderboard freezes and the results page is generated. This cannot be undone from the UI."
          >
            End competition
          </ActionButton>
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Pausing freezes prices as well as trading — the price clock only advances while the market is open.
      </p>
    </Card>
  );
}
