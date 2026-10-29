import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Compact read-only chip for a template setting (objective, budget, attribution…). */
export function SettingChip({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-surface-2 px-2 text-[12px] font-medium text-muted"
    >
      <Icon className="size-3.5 text-faint" aria-hidden />
      <span className="sr-only">{title}: </span>
      {children}
    </span>
  );
}
