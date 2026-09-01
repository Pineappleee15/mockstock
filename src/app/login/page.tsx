import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const actor = await currentActor();
  if (actor?.kind === "team") redirect("/dashboard");
  if (actor?.kind === "admin") redirect("/admin");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <div className="text-2xl font-bold tracking-tight">
          Mock<span className="text-accent">Stock</span>
        </div>
        <p className="mt-1 text-sm text-muted">Enter your team join code to trade.</p>
      </div>

      <LoginForm />

      <p className="mt-8 text-center text-xs text-muted">
        Running the event? <Link href="/admin/login" className="text-accent hover:underline">Admin sign in</Link>
      </p>
    </main>
  );
}
