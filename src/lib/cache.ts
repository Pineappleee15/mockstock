/**
 * Process-level read cache (PLAN.md 5.5 and 7).
 *
 * There is exactly one server process, so one cache serves every client. The
 * ticker moves the tick index forward; anything keyed on the tick is
 * automatically invalidated when prices change. 300 clients polling every 5s
 * therefore cost roughly one query per tick rather than 60 queries per second.
 *
 * This is the piece that stops working on serverless: N lambdas means N caches.
 */
const store = new Map<string, { key: string; value: unknown }>();

export async function cached<T>(name: string, key: string, load: () => Promise<T>): Promise<T> {
  const hit = store.get(name);
  if (hit && hit.key === key) return hit.value as T;
  const value = await load();
  store.set(name, { key, value });
  return value;
}

export function invalidate(name: string): void {
  store.delete(name);
}

/** Weak ETag so an unchanged snapshot costs a 304 rather than a payload. */
export function etagFor(key: string): string {
  return `W/"${key}"`;
}

export function notModified(req: Request, etag: string): boolean {
  return req.headers.get("if-none-match") === etag;
}
