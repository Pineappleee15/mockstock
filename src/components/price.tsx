"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { formatRupees } from "@/lib/money";

/**
 * A price that flashes green or red briefly when it changes.
 *
 * The flash is driven by a class swap keyed on a counter rather than by
 * remounting, so the DOM node is stable for screen readers and the animation
 * restarts reliably.
 */
export function LivePrice({
  paise, className, size = "base",
}: { paise: number; className?: string; size?: "base" | "lg" | "xl" }) {
  const prev = useRef(paise);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (paise === prev.current) return;
    setFlash(paise > prev.current ? "up" : "down");
    setNonce((n) => n + 1);
    prev.current = paise;
    const t = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(t);
  }, [paise]);

  return (
    <span
      key={nonce}
      className={cn(
        "num inline-block rounded px-1 tabular-nums",
        size === "lg" && "text-lg font-semibold",
        size === "xl" && "text-3xl font-bold",
        flash === "up" && "flash-up",
        flash === "down" && "flash-down",
        className,
      )}
    >
      {formatRupees(paise)}
    </span>
  );
}

/** Tiny inline sparkline. Pure SVG, no chart library — this renders 20x per page. */
export function Spark({ points, up }: { points: number[]; up: boolean }) {
  if (points.length < 2) return <svg viewBox="0 0 100 24" className="h-6 w-24" aria-hidden />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const d = points.map((p, i) => {
    const x = (i / (points.length - 1)) * 100;
    const y = 22 - ((p - min) / range) * 20;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-24" aria-hidden>
      <path d={d} fill="none" stroke={up ? "var(--color-up)" : "var(--color-down)"} strokeWidth="1.5"
        vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
