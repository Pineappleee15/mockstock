import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth";
import { AdminLoginForm } from "./admin-login-form";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  const actor = await currentActor();
  if (actor?.kind === "admin") redirect("/admin");

  return (
    <main className="paper-page flex min-h-screen flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <header className="mb-6 text-center">
          <h1 className="display text-3xl">
            BC<span className="paper-underline">X</span>
          </h1>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--color-ink-soft)]">
            Control room
          </p>
        </header>
        <div className="paper-card tilt-r px-6 py-7">
          <span className="paper-tape" aria-hidden />
          <AdminLoginForm />
        </div>
      </div>
    </main>
  );
}
