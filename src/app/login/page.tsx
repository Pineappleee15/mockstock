import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth";
import { activeCompetition } from "@/lib/queries";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const actor = await currentActor();
  if (actor?.kind === "team") redirect("/dashboard");
  if (actor?.kind === "admin") redirect("/admin");

  const comp = await activeCompetition();

  return (
    <main className="paper-page flex min-h-screen flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <header className="mb-7 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--color-ink-soft)]">
            The Bluechip Society
          </p>
          <h1 className="display mt-2 text-7xl leading-none sm:text-8xl">
            <span className="paper-underline">BCX</span>
          </h1>
          <p className="display mt-2 text-sm tracking-[0.28em] text-[var(--color-ink-soft)]">
            BlueChip Exchange
          </p>
          {comp && (
            <p className="mt-3 text-sm text-[var(--color-ink-soft)]">{comp.name}</p>
          )}
        </header>

        <div className="paper-card tilt-l px-6 py-7">
          <span className="paper-tape" aria-hidden />
          <LoginForm />
        </div>

        <p className="mt-7 text-center text-xs text-[var(--color-ink-soft)]">
          Running the event?{" "}
          <Link href="/admin/login" className="font-semibold text-[var(--color-accent-ink)] underline underline-offset-2">
            Admin sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
