import { Building2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Badge, cn } from "@/components/ui";

/** "Used by" summary shown in a convention / rule card header. */
export function UsedBy({ names }: { names: string[] }) {
  if (names.length === 0) return <Badge tone="muted">Not in use</Badge>;
  const shown = names.slice(0, 2).join(", ");
  return (
    <span title={`Used by ${names.join(", ")}`}>
      <Badge tone="info" className="max-w-64">
        <Building2 className="size-3 shrink-0" aria-hidden />
        <span className="truncate">
          {shown}
          {names.length > 2 ? ` +${names.length - 2}` : ""}
        </span>
      </Badge>
    </span>
  );
}

/** Kbd-like insert chip for a token or URL macro. */
export function InsertChip({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-6 items-center rounded-md border border-line bg-surface-2 px-1.5 font-mono text-[11.5px] text-muted",
        "shadow-[inset_0_-1px_0_var(--line)] transition-colors",
        "hover:border-primary/40 hover:bg-primary-soft hover:text-primary-ink hover:shadow-none",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)]",
        className,
      )}
      {...props}
    />
  );
}

/** Sunken read-only panel for live previews. */
export function PreviewPanel({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-4 py-3.5">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">
          <span className="size-1.5 rounded-full bg-success shadow-[0_0_0_3px_var(--success-soft)]" aria-hidden />
          {title}
        </p>
        {aside && <span className="text-[11.5px] text-faint">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

/** Card footer holding Save / Delete. */
export function FormFooter({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-soft bg-surface-2 px-5 py-3">{children}</div>;
}
