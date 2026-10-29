import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn, Skeleton } from "@/components/ui";

/** Title row for a settings section (the page H1 "Settings" lives in the layout). */
export function SectionHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold leading-tight tracking-tight">{title}</h2>
        {description && <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Smaller heading for a group of cards inside a section. */
export function SubsectionHeader({
  title,
  description,
  actions,
  icon: Icon,
  count,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
  count?: number;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-[14.5px] font-semibold tracking-tight">
          {Icon && <Icon className="size-4 text-faint" aria-hidden />}
          {title}
          {count !== undefined && (
            <span className="tabular rounded-full bg-hover px-1.5 text-[11.5px] font-medium leading-5 text-muted">{count}</span>
          )}
        </h3>
        {description && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Compact empty row for use inside a card. */
export function InlineEmpty({ icon: Icon, title, children }: { icon: LucideIcon; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-5 py-5">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-gradient-to-b from-surface to-surface-2 text-faint shadow-xs">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink">{title}</p>
        {children && <p className="text-[12.5px] text-muted">{children}</p>}
      </div>
    </div>
  );
}

/** Uppercase micro label used above panels. */
export function MicroLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[11px] font-medium uppercase tracking-wider text-faint", className)}>{children}</p>;
}

export function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <div className="flex items-center gap-3 border-b border-line-soft px-5 py-4">
            <Skeleton className="size-8 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
          </div>
          <div className="space-y-2.5 p-5">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
