"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { submitOrder } from "@/actions/trade";
import { Button, Input, Card } from "@/components/ui";
import { applySpread, brokerageFor, formatRupees, BPS } from "@/lib/money";

interface Props {
  symbol: string;
  pricePaise: number;
  halted: boolean;
  marketOpen: boolean;
  cashPaise: number;
  heldQty: number;
  portfolioValuePaise: number;
  positionValuePaise: number;
  spreadBps: number;
  brokerageBps: number;
  concentrationCapBps: number;
  onFilled: (message: string) => void;
}

export function TradePanel(props: Props) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // One idempotency key per intended order, rotated after every settled attempt.
  // A double-click reuses the same key, so the server replays instead of refilling.
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());

  const quantity = Number.parseInt(qty, 10);
  const valid = Number.isInteger(quantity) && quantity >= 1;

  /**
   * Client-side preview only. The server prices the trade again at fill time,
   * so this is advisory — and with order flow driving prices it really can move
   * between preview and fill, which is why the modal says so.
   */
  const preview = useMemo(() => {
    if (!valid) return null;
    const fill = applySpread(props.pricePaise, side, props.spreadBps);
    const gross = fill * quantity;
    const fee = brokerageFor(gross, props.brokerageBps);
    const cashAfter = side === "buy" ? props.cashPaise - gross - fee : props.cashPaise + gross - fee;
    return { fill, gross, fee, cashAfter, total: side === "buy" ? gross + fee : gross - fee };
  }, [valid, quantity, side, props.pricePaise, props.spreadBps, props.brokerageBps, props.cashPaise]);

  const disabledReason = !props.marketOpen
    ? "Market is closed"
    : props.halted
    ? "Trading halted in this stock"
    : side === "sell" && props.heldQty === 0
    ? "You hold none of this stock"
    : null;

  // Local pre-checks so common mistakes are caught before a round trip.
  // Convenience only: the server re-checks every one of them.
  const localWarning = useMemo(() => {
    if (!preview || !valid) return null;
    if (side === "buy" && preview.total > props.cashPaise) return "Not enough cash for this order.";
    if (side === "sell" && quantity > props.heldQty) return `You only hold ${props.heldQty}.`;
    if (side === "buy" && props.concentrationCapBps > 0) {
      const posAfter = props.positionValuePaise + quantity * props.pricePaise;
      if (props.portfolioValuePaise > 0 &&
          (posAfter * BPS) / props.portfolioValuePaise > props.concentrationCapBps) {
        return `Over the ${(props.concentrationCapBps / 100).toFixed(0)}% single-stock cap.`;
      }
    }
    return null;
  }, [preview, valid, side, quantity, props]);

  useEffect(() => { setError(null); }, [side, qty]);

  const maxQty = side === "buy"
    ? Math.floor(props.cashPaise / Math.max(1, applySpread(props.pricePaise, "buy", props.spreadBps)))
    : props.heldQty;

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await submitOrder({ symbol: props.symbol, side, quantity, idempotencyKey: idemKey });
      setIdemKey(crypto.randomUUID());
      setConfirming(false);
      if (res.ok) {
        props.onFilled(
          `${res.side === "buy" ? "Bought" : "Sold"} ${res.quantity} ${res.symbol} at ${formatRupees(res.fillPricePaise)}` +
          (res.replayed ? " (already placed)" : ""),
        );
        setQty("");
      } else {
        setError(res.detail);
      }
    });
  }

  return (
    <>
      <Card className="glass-pill fixed inset-x-2 bottom-[calc(6.75rem+env(safe-area-inset-bottom,0px))] z-30 rounded-3xl p-3 sm:static sm:inset-x-auto sm:bottom-auto sm:rounded-2xl sm:border sm:bg-surface sm:shadow-none">
        <div className="mx-auto max-w-6xl space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Button variant={side === "buy" ? "buy" : "default"} onClick={() => setSide("buy")}>Buy</Button>
            <Button variant={side === "sell" ? "sell" : "default"} onClick={() => setSide("sell")}>Sell</Button>
          </div>

          <div className="flex gap-2">
            <Input
              inputMode="numeric" pattern="[0-9]*" value={qty}
              onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))}
              placeholder="Quantity" aria-label="Quantity" className="num flex-1"
            />
            <Button variant="ghost" onClick={() => setQty(String(Math.max(0, maxQty)))} className="shrink-0">
              Max {maxQty}
            </Button>
          </div>

          {preview && (
            <div className="num space-y-0.5 text-xs text-muted">
              <Row label={`Est. ${side === "buy" ? "cost" : "proceeds"}`} value={formatRupees(preview.gross)} />
              <Row label="Brokerage" value={formatRupees(preview.fee)} />
              <Row label="Cash after" value={formatRupees(preview.cashAfter)} strong />
            </div>
          )}

          {(localWarning || error || disabledReason) && (
            <p role="alert" className="rounded bg-down/10 px-2 py-1.5 text-xs text-down">
              {error ?? localWarning ?? disabledReason}
            </p>
          )}

          <Button
            variant={side === "buy" ? "buy" : "sell"}
            className="w-full"
            disabled={!valid || !!disabledReason || !!localWarning || pending}
            onClick={() => setConfirming(true)}
          >
            {pending ? "Placing…" : `Review ${side} order`}
          </Button>
        </div>
      </Card>

      {confirming && preview && (
        <ConfirmModal
          symbol={props.symbol} side={side} quantity={quantity} preview={preview}
          pending={pending} onCancel={() => setConfirming(false)} onConfirm={confirm}
        />
      )}
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className={strong ? "font-semibold text-text" : ""}>{value}</span>
    </div>
  );
}

/**
 * Confirmation modal. Shows exact estimated cost, fees and cash after trade,
 * and says plainly that the fill price may differ — which with order-flow
 * pricing is a real possibility rather than legal boilerplate.
 */
function ConfirmModal({
  symbol, side, quantity, preview, pending, onCancel, onConfirm,
}: {
  symbol: string; side: "buy" | "sell"; quantity: number;
  preview: { fill: number; gross: number; fee: number; cashAfter: number; total: number };
  pending: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center"
      role="dialog" aria-modal="true" aria-label="Confirm order"
    >
      <Card className="w-full max-w-sm p-4">
        <h2 className="text-base font-semibold">
          {side === "buy" ? "Buy" : "Sell"} {quantity} {symbol}
        </h2>

        <div className="num mt-3 space-y-1 text-sm">
          <Row label="Estimated price" value={formatRupees(preview.fill)} />
          <Row label={side === "buy" ? "Order value" : "Sale value"} value={formatRupees(preview.gross)} />
          <Row label="Brokerage" value={formatRupees(preview.fee)} />
          <div className="my-2 border-t border-border" />
          <Row label={side === "buy" ? "Total cost" : "Net proceeds"} value={formatRupees(preview.total)} strong />
          <Row label="Cash after trade" value={formatRupees(preview.cashAfter)} strong />
        </div>

        <p className="mt-3 text-[11px] leading-snug text-muted">
          This is an estimate. The server sets the price when the order fills, and other teams&apos;
          trades move it, so your fill may differ.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={pending}>Cancel</Button>
          <Button variant={side === "buy" ? "buy" : "sell"} onClick={onConfirm} disabled={pending}>
            {pending ? "Placing…" : "Confirm"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
