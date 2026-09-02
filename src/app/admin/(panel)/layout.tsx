import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth";
import { logout } from "@/actions/auth";
import { ensureTicker } from "@/lib/boot";

const NAV = [
  { href: "/admin", label: "Control" },
  { href: "/admin/teams", label: "Teams" },
  { href: "/admin/stocks", label: "Stocks" },
  { href: "/admin/news", label: "News" },
  { href: "/admin/trades", label: "Trades" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/exports", label: "Exports" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  ensureTicker();
  const actor = await currentActor();
  // Middleware gates this too, but authorisation is re-checked here and again in
  // every admin action. Middleware alone is not an authorisation boundary.
  if (!actor || actor.kind !== "admin") redirect("/admin/login");

  return (
    <div className="min-h-screen">
      <header className="glass sticky top-0 z-20">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-3 py-2">
          <Link href="/admin" className="text-sm font-bold">
            Mock<span className="text-accent">Stock</span> <span className="text-muted">admin</span>
          </Link>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span>{actor.label}</span>
            <form action={logout}><button className="hover:text-text">Sign out</button></form>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2 pb-1">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}
              className="shrink-0 rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-7xl px-3 py-4">{children}</main>
    </div>
  );
}
