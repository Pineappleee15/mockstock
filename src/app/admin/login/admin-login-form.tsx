"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginAdmin, type LoginState } from "@/actions/auth";

const field =
  "w-full rounded-[3px] border border-[var(--color-paper-edge)] bg-[#fffaf0] px-3 py-2.5 " +
  "text-[var(--color-ink)] placeholder:text-[var(--color-ink-soft)]/50 " +
  "focus-visible:outline-2 focus-visible:outline-[var(--color-accent-deep)]";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="w-full rounded-[3px] bg-[var(--color-ink)] px-3 py-3 text-sm font-bold uppercase
                 tracking-[0.14em] text-[var(--color-paper)] transition-colors
                 hover:bg-[var(--color-accent-ink)] disabled:opacity-60">
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export function AdminLoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(loginAdmin, {});
  return (
    <form action={action} className="space-y-3">
      <input name="username" placeholder="Username" required autoFocus
        autoComplete="username" className={field} />
      <input name="password" type="password" placeholder="Password" required
        autoComplete="current-password" className={field} />
      {state.error && (
        <p role="alert"
          className="rounded-[3px] border border-[#b4444f]/30 bg-[#b4444f]/10 px-3 py-2 text-sm text-[#8c2f38]">
          {state.error}
        </p>
      )}
      <Submit />
    </form>
  );
}
