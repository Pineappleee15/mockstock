import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth";
import { AdminLoginForm } from "./admin-login-form";

export default async function AdminLoginPage() {
  const actor = await currentActor();
  if (actor?.kind === "admin") redirect("/admin");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <div className="text-2xl font-bold tracking-tight">
          Mock<span className="text-accent">Stock</span> <span className="text-muted">admin</span>
        </div>
      </div>
      <AdminLoginForm />
    </main>
  );
}
