"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Poll a JSON endpoint. No websockets, by design.
 *
 * - Pauses while the tab is hidden, so 300 phones in pockets do not hammer the
 *   server for four hours.
 * - Treats 304 as "unchanged" and keeps the previous value, which is what makes
 *   the ETags on the API routes worth having.
 */
export function usePoll<T>(url: string, intervalMs: number, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const etag = useRef<string | null>(null);
  const inFlight = useRef(false);
  const loadedOnce = useRef(false);

  const tick = useCallback(async () => {
    // The visibility check must never block the FIRST load: a page mounted in a
    // background tab (or a prerendered one) would otherwise sit on its loading
    // state forever, even after the user switches to it.
    if (inFlight.current) return;
    if (loadedOnce.current && document.hidden) return;
    inFlight.current = true;
    try {
      const res = await fetch(url, {
        headers: etag.current ? { "If-None-Match": etag.current } : {},
        cache: "no-store",
      });
      if (res.status === 304) { setError(null); return; }
      if (!res.ok) { setError(`${res.status}`); return; }
      const tag = res.headers.get("ETag");
      if (tag) etag.current = tag;
      setData((await res.json()) as T);
      setError(null);
    } catch {
      setError("offline");
    } finally {
      inFlight.current = false;
      loadedOnce.current = true;
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (!enabled) return;
    void tick();
    const id = setInterval(() => { void tick(); }, intervalMs);
    const onVisible = () => { if (!document.hidden) void tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [tick, intervalMs, enabled]);

  return { data, error, loading, refresh: tick };
}
