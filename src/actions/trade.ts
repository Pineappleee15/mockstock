"use server";

import { z } from "zod";
import { requireTeam } from "@/lib/auth";
import { placeOrder, type OrderResult } from "@/lib/orders";

/**
 * The entire client payload. Note what is NOT here: price.
 *
 * `.strict()` makes zod reject unknown keys outright, so a client that tries to
 * smuggle a price, a fee or a team id gets an error rather than having the
 * field quietly ignored (correctness requirement 2).
 */
const orderInput = z.object({
  symbol: z.string().trim().min(1).max(20),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().int().min(1).max(10_000_000),
  idempotencyKey: z.string().uuid(),
}).strict();

export async function submitOrder(raw: unknown): Promise<OrderResult> {
  const actor = await requireTeam();

  const parsed = orderInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false, replayed: false, code: "INVALID_QUANTITY",
      detail: parsed.error.issues[0]?.message ?? "Invalid order.",
    };
  }

  return placeOrder({ teamId: actor.id, ...parsed.data });
}
