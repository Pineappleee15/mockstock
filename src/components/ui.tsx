import { cn } from "@/lib/cn";
import { formatRupees, formatBps } from "@/lib/money";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("lit rounded-2xl border border-white/[0.06] bg-surface", className)}>{children}</div>
  );
}

export function Stat({
  label, value, sub, tone = "neutral",
}: {
  label: string; value: React.ReactNode; sub?: React.ReactNode;
  tone?: "neutral" | "up" | "down";
}) {
  return (
    <div className="lit rounded-2xl border border-white/[0.06] bg-surface px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={cn(
        "num mt-0.5 text-lg font-semibold tabular-nums sm:text-xl",
        tone === "up" && "text-up", tone === "down" && "text-down",
      )}>
        {value}
      </div>
      {sub != null && <div className="num mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** Signed percentage, coloured. The single most repeated element in the app. */
export function Change({ bps, className }: { bps: number; className?: string }) {
  const tone = bps > 0 ? "text-up" : bps < 0 ? "text-down" : "text-muted";
  return (
    <span className={cn("num tabular-nums", tone, className)}>
      {bps > 0 ? "+" : ""}{formatBps(bps)}
    </span>
  );
}

export function Money({
  paise, className, sign = false,
}: { paise: number; className?: string; sign?: boolean }) {
  const tone = sign ? (paise > 0 ? "text-up" : paise < 0 ? "text-down" : "text-muted") : "";
  return <span className={cn("num tabular-nums", tone, className)}>{formatRupees(paise, { sign })}</span>;
}

export function Badge({
  children, tone = "neutral",
}: { children: React.ReactNode; tone?: "neutral" | "up" | "down" | "warn" }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
      tone === "neutral" && "bg-surface-2 text-muted",
      tone === "up" && "bg-up-dim text-up",
      tone === "down" && "bg-down-dim text-down",
      tone === "warn" && "bg-accent/15 text-accent",
    )}>
      {children}
    </span>
  );
}

export function Button({
  children, variant = "default", className, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "buy" | "sell" | "ghost" | "danger";
}) {
  return (
    <button
      {...props}
      className={cn(
        "press inline-flex items-center justify-center rounded-xl px-3.5 py-2 text-sm font-semibold",
        "transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "default" && "bg-surface-2 text-text hover:bg-border",
        variant === "buy" && "bg-up text-black hover:bg-up/90",
        variant === "sell" && "bg-down text-white hover:bg-down/90",
        variant === "danger" && "bg-down/15 text-down hover:bg-down/25",
        variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-text",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-xl border border-white/[0.07] bg-surface-2 px-3.5 py-2.5 text-sm",
        "placeholder:text-muted/60 transition-colors focus:border-accent/40",
        className,
      )}
    />
  );
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn("w-full rounded-xl border border-white/[0.07] bg-surface-2 px-3.5 py-2.5 text-sm", className)}
    >
      {children}
    </select>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-10 text-center text-sm text-muted">{children}</div>;
}
