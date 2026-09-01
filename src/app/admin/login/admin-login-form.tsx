"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginAdmin, type LoginState } from "@/actions/auth";
import { Button, Input } from "@/components/ui";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full bg-accent text-black hover:bg-accent/90">
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export function AdminLoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(loginAdmin, {});
  return (
    <form action={action} className="space-y-3">
      <Input name="username" placeholder="Username" required autoFocus autoComplete="username" />
      <Input name="password" type="password" placeholder="Password" required autoComplete="current-password" />
      {state.error && (
        <p role="alert" className="rounded-md bg-down/10 px-3 py-2 text-sm text-down">{state.error}</p>
      )}
      <Submit />
    </form>
  );
}
