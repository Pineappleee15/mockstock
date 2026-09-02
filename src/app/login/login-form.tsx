"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginTeam, type LoginState } from "@/actions/auth";

/** Paper-screen field. The dark-theme Input would be invisible on cream. */
const field =
  "w-full rounded-[3px] border border-[var(--color-paper-edge)] bg-[#fffaf0] px-3 py-2.5 " +
  "text-[var(--color-ink)] placeholder:text-[var(--color-ink-soft)]/50 " +
  "focus-visible:outline-2 focus-visible:outline-[var(--color-accent-deep)]";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-[3px] bg-[var(--color-ink)] px-3 py-3 text-sm font-bold uppercase
                 tracking-[0.14em] text-[var(--color-paper)] transition-colors
                 hover:bg-[var(--color-accent-ink)] disabled:opacity-60"
    >
      {pending ? "Signing in…" : label}
    </button>
  );
}

export function LoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(loginTeam, {});

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="joinCode"
          className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
          Join code
        </label>
        <input
          id="joinCode" name="joinCode" required autoFocus autoComplete="off"
          autoCapitalize="characters" spellCheck={false} maxLength={16}
          defaultValue={state.joinCode}
          placeholder="ABC123"
          className={`${field} num text-center text-2xl font-bold tracking-[0.35em] uppercase`}
        />
      </div>

      <div>
        <label htmlFor="password"
          className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
          Password
        </label>
        <input
          id="password" name="password" type="password" required
          autoComplete="current-password" minLength={state.needsPassword ? 6 : undefined}
          placeholder={state.needsPassword ? "Choose a password" : "Your team password"}
          className={field}
        />
        <p className="mt-1.5 text-[11px] leading-snug text-[var(--color-ink-soft)]">
          First time? Whatever you type now becomes your team&apos;s password — agree on it first.
        </p>
      </div>

      {state.error && (
        <p role="alert"
          className="rounded-[3px] border border-[#b4444f]/30 bg-[#b4444f]/10 px-3 py-2 text-sm text-[#8c2f38]">
          {state.error}
        </p>
      )}

      <Submit label="Enter the market" />
    </form>
  );
}
