"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import type { ActionResult } from "@/actions/admin";

/**
 * Runs a server action and shows the result inline. Admin actions during a live
 * event need to say plainly whether they worked, not navigate away.
 */
export function ActionButton({
  run, children, variant = "default", confirm, className,
}: {
  run: () => Promise<ActionResult>;
  children: React.ReactNode;
  variant?: "default" | "buy" | "sell" | "ghost" | "danger";
  confirm?: string;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        variant={variant}
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => setResult(await run()));
        }}
      >
        {pending ? "Working…" : children}
      </Button>
      {result && (
        <span className={`text-[11px] ${result.ok ? "text-up" : "text-down"}`}>
          {result.ok ? result.message : result.error}
        </span>
      )}
    </span>
  );
}

export function ActionForm({
  run, children, submitLabel = "Save", variant = "default",
}: {
  run: (form: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  submitLabel?: string;
  variant?: "default" | "buy" | "sell" | "ghost" | "danger";
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => setResult(await run(fd)));
      }}
      className="space-y-2"
    >
      {children}
      <div className="flex items-center gap-3">
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? "Working…" : submitLabel}
        </Button>
        {result && (
          <span className={`text-xs ${result.ok ? "text-up" : "text-down"}`}>
            {result.ok ? result.message : result.error}
          </span>
        )}
      </div>
    </form>
  );
}
