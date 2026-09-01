import { startTicker } from "./ticker";

/**
 * Starts the price ticker on first use.
 *
 * This deliberately does NOT live in instrumentation.ts. Next compiles that file
 * for the Edge runtime as well (because middleware.ts exists), and the Postgres
 * driver needs Node built-ins that Edge does not have — so the build fails even
 * though the code is guarded and would never actually run there.
 *
 * Instead, the Node-runtime layouts and the market API call this. In practice
 * the ticker starts the moment anyone loads any page, which is well before the
 * admin opens the market.
 */
let started = false;

export function ensureTicker(): void {
  if (started) return;
  started = true;
  startTicker();
}
