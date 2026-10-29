"use client";

import { Copy, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { buttonClass, cn } from "@/components/ui";

/** Tab strip for the builder's ad sets / ads, with add, duplicate and remove for the active item. */
export function ItemTabs({
  noun,
  items,
  active,
  max,
  issues,
  onSelect,
  onAdd,
  onDuplicate,
  onRemove,
  extra,
}: {
  noun: string;
  items: { key: string; label: string }[];
  active: number;
  max: number;
  /** Items with blocking issues get a warning dot. */
  issues?: Set<number>;
  onSelect: (i: number) => void;
  onAdd: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  extra?: ReactNode;
}) {
  return (
    // Phones: tabs on their own scrolling row, actions below, so the active tab is never cut off.
    <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface p-1.5 shadow-card sm:flex-row sm:items-center sm:justify-between sm:gap-2">
      <div role="tablist" aria-label={`${noun}s`} className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {items.map((it, i) => (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => onSelect(i)}
            title={it.label}
            className={cn(
              "flex h-8 max-w-56 shrink-0 items-center gap-2 rounded-lg px-2 text-[13px] font-medium transition-colors",
              i === active ? "bg-primary-soft text-primary-ink ring-1 ring-inset ring-primary/25" : "text-muted hover:bg-hover hover:text-ink",
            )}
          >
            <span className={cn("tabular grid size-5 shrink-0 place-items-center rounded-md text-[11px] font-semibold", i === active ? "bg-primary text-on-primary" : "bg-surface-2 ring-1 ring-inset ring-line")}>{i + 1}</span>
            <span className="truncate">{it.label || `${noun} ${i + 1}`}</span>
            {issues?.has(i) && <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-label="Needs attention" />}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-0.5 max-sm:border-t max-sm:border-line-soft max-sm:pt-1.5">
        {extra}
        <IconButton label={`Duplicate ${noun.toLowerCase()}`} disabled={items.length >= max} onClick={onDuplicate}>
          <Copy />
        </IconButton>
        <IconButton label={`Remove ${noun.toLowerCase()}`} danger disabled={items.length <= 1} onClick={onRemove}>
          <Trash2 />
        </IconButton>
        <button type="button" disabled={items.length >= max} onClick={onAdd} className={buttonClass("secondary", "sm", "ml-1")}>
          <Plus /> Add {noun.toLowerCase()}
        </button>
      </div>
    </div>
  );
}

export function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={buttonClass("ghost", "icon", danger ? "hover:bg-danger-soft hover:text-danger-ink" : undefined)}
    >
      {children}
    </button>
  );
}
