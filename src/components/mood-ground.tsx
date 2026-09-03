"use client";

import { useEffect } from "react";
import { usePoll } from "@/lib/use-poll";
import type { MarketIndex } from "@/lib/market-index";

/**
 * Tints the page ground with the market.
 *
 * Sets --mood on <html> between -1 and 1 from the index. The CSS does the rest,
 * and the transition is slow enough that it reads as the room changing
 * temperature rather than a colour animation.
 *
 * Deliberately saturating well before the index does: a market that has moved
 * 2% should already feel fully "up", because beyond that the difference stops
 * being perceptible and only the direction matters.
 */
const FULL_TINT_BPS = 200;

export function MoodGround() {
  const { data } = usePoll<{ index: MarketIndex; state: string }>("/api/market", 5000);
  const bps = data?.index?.returnBps ?? 0;
  const open = data?.state === "open";

  useEffect(() => {
    const mood = open
      ? Math.max(-1, Math.min(1, bps / FULL_TINT_BPS))
      : 0;
    document.documentElement.style.setProperty("--mood", mood.toFixed(3));
    return () => {
      document.documentElement.style.removeProperty("--mood");
    };
  }, [bps, open]);

  return null;
}
