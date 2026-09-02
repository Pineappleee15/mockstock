"use client";

import { useOptimistic, useTransition } from "react";
import { setWatched } from "@/actions/watchlist";
import { cn } from "@/lib/cn";

/**
 * Star toggle.
 *
 * Flips immediately and reconciles with the server in the background — a star
 * that waits for a round trip feels broken, and this is a bookkeeping action
 * where being briefly wrong costs nothing. The portfolio poll corrects it
 * within a few seconds if the write failed.
 */
export function WatchStar({
  symbol, watched, size = "sm", onChange,
}: {
  symbol: string;
  watched: boolean;
  size?: "sm" | "lg";
  onChange?: (watched: boolean) => void;
}) {
  const [optimistic, setOptimistic] = useOptimistic(watched);
  const [, start] = useTransition();

  return (
    <button
      type="button"
      aria-pressed={optimistic}
      aria-label={optimistic ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
      title={optimistic ? "On your watchlist" : "Add to watchlist"}
      onClick={(e) => {
        // Rows are links; starring must not navigate.
        e.preventDefault();
        e.stopPropagation();
        const next = !optimistic;
        onChange?.(next);
        start(async () => {
          setOptimistic(next);
          await setWatched({ symbol, watched: next });
        });
      }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded transition-colors",
        size === "lg" ? "size-9 text-xl" : "size-7 text-base",
        optimistic ? "text-accent" : "text-muted/40 hover:text-muted",
      )}
    >
      {optimistic ? "★" : "☆"}
    </button>
  );
}
