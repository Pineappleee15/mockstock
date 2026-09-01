"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginTeam, type LoginState } from "@/actions/auth";
import { Button, Input } from "@/components/ui";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full bg-accent text-black hover:bg-accent/90">
      {pending ? "Signing in…" : label}
    </Button>
  );
}

export function LoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(loginTeam, {});

  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="joinCode" className="mb-1 block text-xs font-medium text-muted">
          Join code
        </label>
        <Input
          id="joinCode" name="joinCode" required autoFocus autoComplete="off"
          autoCapitalize="characters" spellCheck={false} maxLength={16}
          defaultValue={state.joinCode}
          placeholder="ABC123"
          className="num tracking-[0.2em] uppercase"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-xs font-medium text-muted">
          Password
        </label>
        <Input
          id="password" name="password" type="password" required
          autoComplete="current-password" minLength={state.needsPassword ? 6 : undefined}
          placeholder={state.needsPassword ? "Choose a password" : "Your team password"}
        />
        <p className="mt-1 text-[11px] text-muted">
          First time signing in? The password you type now becomes your team&apos;s password.
        </p>
      </div>

      {state.error && (
        <p role="alert" className="rounded-md bg-down/10 px-3 py-2 text-sm text-down">
          {state.error}
        </p>
      )}

      <Submit label="Sign in" />
    </form>
  );
}
