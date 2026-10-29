import type { ReactNode } from "react";
import { cn } from "@/components/ui";

/** Sunken mini-panel used for the per-account details (sync health, default identity). */
export function DetailPanel({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-lg border border-line-soft bg-surface-2 px-3.5 py-3", className)}>
      <div className="mb-2 flex min-h-5 items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-faint">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

/** First letter of a name in a quiet tile (matches the account switcher). */
export function Monogram({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-gradient-to-b from-surface to-surface-2 text-[13px] font-semibold text-muted shadow-xs",
        className,
      )}
    >
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}
