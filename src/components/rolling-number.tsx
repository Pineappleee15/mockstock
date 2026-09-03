"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * A number that counts to its new value instead of snapping.
 *
 * A price that jumps is read as a glitch; a price that moves is read as a
 * market. The tween is short enough to keep up with a five-second tick and
 * eased so it settles rather than stops.
 */
export function RollingNumber({
  value, format, className, durationMs = 550,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
  durationMs?: number;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (value === from.current) return;

    // Respect people who have asked the OS for less movement.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = value;
      setShown(value);
      return;
    }

    const start = performance.now();
    const a = from.current;
    const b = value;

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(a + (b - a) * eased);
      if (t < 1) raf.current = requestAnimationFrame(step);
      else from.current = b;
    };

    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [value, durationMs]);

  return <span className={cn("num tabular-nums", className)}>{format(shown)}</span>;
}
