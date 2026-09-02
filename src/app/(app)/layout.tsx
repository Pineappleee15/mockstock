import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth";
import { activeCompetition } from "@/lib/queries";
import { NewsTicker } from "@/components/news-ticker";
import { ensureTicker } from "@/lib/boot";
import { logout } from "@/actions/auth";

const NAV = [
  { href: "/dashboard", label: "Portfolio" },
  { href: "/market", label: "Market" },
  { href: "/news", label: "News" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/trades", label: "History" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  ensureTicker();
  const actor = await currentActor();
  if (!actor || actor.kind !== "team") redirect("/login");
  const comp = await activeCompetition();

  // A team belongs to exactly one competition. If theirs is not the live one,
  // showing them the current market would price their old holdings against the
  // new competition's stocks, which is worse than saying nothing.
  if (comp && comp.id !== actor.competitionId) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5 text-center">
        <h1 className="text-lg font-semibold">This competition has finished</h1>
        <p className="mt-2 text-sm text-muted">
          {actor.label} played in an earlier event. A new one is running now — ask the
          organisers for your team&apos;s new join code.
        </p>
        <form action={logout} className="mt-4">
          <button className="text-sm text-accent hover:underline">Sign out</button>
        </form>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="glass sticky top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/dashboard"
              className="shrink-0 text-sm font-bold tracking-[0.02em] text-text">
              Mock<span className="text-accent">Stock</span>
            </Link>
            {comp && <MarketState state={comp.state} />}
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden max-w-[16ch] truncate text-xs text-muted sm:inline">{actor.label}</span>
            <form action={logout}>
              <button className="text-xs text-muted hover:text-text">Sign out</button>
            </form>
          </div>
        </div>

        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-1">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}
              className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>

      <NewsTicker />

      <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-4">{children}</main>
    </div>
  );
}

function MarketState({ state }: { state: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    open:    { label: "LIVE",   cls: "bg-up-dim text-up" },
    paused:  { label: "PAUSED", cls: "bg-accent/20 text-accent" },
    pre_open:{ label: "PRE-OPEN", cls: "bg-surface-2 text-muted" },
    closed:  { label: "CLOSED", cls: "bg-surface-2 text-muted" },
    ended:   { label: "ENDED",  cls: "bg-surface-2 text-muted" },
    draft:   { label: "DRAFT",  cls: "bg-surface-2 text-muted" },
  };
  const s = map[state] ?? map.draft!;
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${s.cls}`}>
      {s.label}
    </span>
  );
}
