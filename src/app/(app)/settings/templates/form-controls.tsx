import { Check, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardHeader, cn } from "@/components/ui";

/** Presentational building blocks for the template editor (used from the client form). */

export function Section({
  icon,
  title,
  description,
  actions,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader icon={icon} title={title} description={description} actions={actions} />
      <div className="flex flex-col gap-5 p-5">{children}</div>
    </Card>
  );
}

/** A labelled group of controls (tiles, toggles) that isn't a single input. */
export function FieldGroup({ legend, hint, error, children }: { legend: ReactNode; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="float-left mb-2 w-full text-[13px] font-medium text-ink">{legend}</legend>
      <div className="clear-both">{children}</div>
      {error ? <p className="mt-1.5 text-xs text-danger-ink">{error}</p> : hint ? <p className="mt-1.5 text-xs text-muted">{hint}</p> : null}
    </fieldset>
  );
}

const tile = cn(
  "relative flex cursor-pointer select-none rounded-lg border transition-[background-color,border-color,box-shadow] duration-150",
  "has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[var(--ring)]",
  "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
);
const tileState = (on: boolean) =>
  on ? "border-primary/50 bg-primary-soft ring-1 ring-inset ring-primary/20" : "border-line bg-surface hover:border-[color-mix(in_oklab,var(--line)_60%,var(--muted))] hover:bg-hover/50";

export function RadioTiles<T extends string>({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string }[];
}) {
  return (
    <div className="grid gap-2">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <label key={o.value} className={cn(tile, "items-start gap-3 px-3.5 py-3", tileState(on))}>
            <input type="radio" name={name} value={o.value} checked={on} onChange={() => onChange(o.value)} className="sr-only" />
            <span
              aria-hidden
              className={cn(
                "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border transition-colors",
                on ? "border-primary bg-primary" : "border-[color-mix(in_oklab,var(--line)_60%,var(--muted))] bg-surface",
              )}
            >
              {on && <span className="size-1.5 rounded-full bg-surface dark:bg-ink" />}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink">{o.label}</span>
              {o.hint && <span className="mt-0.5 block text-[12px] leading-snug text-muted">{o.hint}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function CheckMark({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors",
        on ? "border-primary bg-primary text-surface dark:text-ink" : "border-[color-mix(in_oklab,var(--line)_60%,var(--muted))] bg-surface",
      )}
    >
      {on && <Check className="size-3" strokeWidth={3} />}
    </span>
  );
}

/** Selectable tile backed by a real checkbox (keyboard + form semantics stay native). */
export function CheckTile({ checked, onChange, label, leading }: { checked: boolean; onChange: () => void; label: ReactNode; leading?: ReactNode }) {
  return (
    <label className={cn(tile, "min-w-0 items-center gap-2.5 px-3 py-2.5", tileState(checked))}>
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
      {leading && <span className={cn("flex shrink-0 items-center", checked ? "text-primary" : "text-faint")}>{leading}</span>}
      <span className={cn("min-w-0 flex-1 text-[13px] font-medium leading-tight", checked ? "text-ink" : "text-muted")}>{label}</span>
      <CheckMark on={checked} />
    </label>
  );
}

/** Outline of the asset shape a placement uses. */
export function AspectGlyph({ ratio, className }: { ratio: "square" | "vertical"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 rounded-[3px] border-[1.5px] border-current bg-current/10", ratio === "square" ? "size-3.5" : "h-4 w-[9px]", className)}
    />
  );
}

/** Switch styled control backed by a checkbox; the whole row is the hit target. */
export function ToggleRow({
  checked,
  onChange,
  label,
  description,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex cursor-pointer items-center justify-between gap-4 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60", className)}>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{description}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150",
          "peer-focus-visible:ring-4 peer-focus-visible:ring-[var(--ring)]",
          checked ? "bg-primary" : "bg-[color-mix(in_oklab,var(--line)_55%,var(--muted))]",
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 size-4 rounded-full bg-surface shadow-[0_1px_2px_hsl(var(--shadow-color)/0.25)] transition-transform duration-150 dark:bg-ink",
            checked && "translate-x-4",
          )}
        />
      </span>
    </label>
  );
}
