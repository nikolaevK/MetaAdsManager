"use client";

import { LoaderCircle, Search, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Card, CardHeader, cn, focusRing, Input, Segmented, segmentClass } from "@/components/ui";

/** Titled block inside the editor sheet and the campaign builder: the settings Card, in its dense size. */
export function Section({ title, description, icon, children, actions }: { title: string; description?: ReactNode; icon?: LucideIcon; children: ReactNode; actions?: ReactNode }) {
  return (
    <Card>
      <CardHeader dense as="h3" icon={icon} title={title} description={description} actions={actions} />
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </Card>
  );
}

/** Label + value pair for read-only settings. */
export function ReadOnly({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-muted">{label}</span>
      <span className="text-[13.5px] text-ink">{children}</span>
    </div>
  );
}

export function currencySymbol(currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
}

/** Number input with the account currency as a prefix. Empty string = no value. */
export function MoneyInput({ value, onChange, currency, id, disabled, placeholder }: { value: string; onChange: (v: string) => void; currency: string; id?: string; disabled?: boolean; placeholder?: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[13px] text-faint">{currencySymbol(currency)}</span>
      <Input id={id} type="number" inputMode="decimal" min="0" step="0.01" value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="tabular pl-8" />
    </div>
  );
}

/** On/off switch. Without `label`, a wrapping <label> names it (and its whole row becomes the hit target). */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        "relative flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors duration-150",
        // Same look on touch screens, with a 44×40 hit area around the 36×20 track.
        "pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:-inset-y-2.5",
        focusRing,
        "disabled:cursor-not-allowed disabled:opacity-60",
        on ? "bg-primary" : "bg-[color-mix(in_oklab,var(--faint)_45%,var(--line))]",
      )}
    >
      {/* The knob stays light in both themes, like a physical switch. */}
      <span className={cn("size-4 rounded-full bg-surface shadow-card transition-transform duration-150 dark:bg-ink", on && "translate-x-4")} />
    </button>
  );
}

/** Pill segmented control bound to a value (the shared Segmented styles, as a radio group). */
export function Choice<T extends string>({ value, options, onChange, disabled, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean; label: string }) {
  return (
    <Segmented role="radiogroup" aria-label={label} className="w-fit flex-wrap">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(segmentClass(value === o.value), "disabled:opacity-60")}
        >
          {o.label}
        </button>
      ))}
    </Segmented>
  );
}

export function Chip({ children, onRemove, tone = "default", title }: { children: ReactNode; onRemove?: () => void; tone?: "default" | "exclude"; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-lg py-1 pl-2.5 text-[12.5px] ring-1 ring-inset",
        onRemove ? "pr-1" : "pr-2.5",
        tone === "exclude" ? "bg-danger-soft text-danger-ink ring-danger/20" : "bg-primary-soft text-primary-ink ring-primary/15",
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className={cn(
            "relative grid size-5 shrink-0 place-items-center rounded-md opacity-70 transition hover:bg-hover hover:opacity-100",
            "pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1.5 pointer-coarse:after:-inset-y-2.5",
            focusRing,
          )}
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

/** Debounced async search with a result list; picking a result calls `onPick` and clears the box. */
export function SearchPicker<T>({
  placeholder,
  search,
  render,
  keyOf,
  onPick,
  disabled,
  exclude,
}: {
  placeholder: string;
  search: (q: string) => Promise<{ ok: true; items: T[] } | { ok: false; error: string }>;
  render: (item: T) => ReactNode;
  keyOf: (item: T) => string;
  onPick: (item: T) => void;
  disabled?: boolean;
  /** Keys already chosen (hidden from results). */
  exclude?: Set<string>;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<T[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seq = useRef(0);
  const wrap = useRef<HTMLDivElement>(null);
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  });

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const run = (value: string) => {
    clearTimeout(timer.current);
    if (!value.trim()) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;
      const res = await searchRef.current(value.trim());
      if (mine !== seq.current) return;
      setLoading(false);
      if (res.ok) {
        setItems(res.items);
        setError(null);
        setActive(0);
      } else setError(res.error);
    }, 300);
  };

  const visible = items.filter((i) => !exclude?.has(keyOf(i)));
  const pick = (item: T) => {
    onPick(item);
    setQ("");
    setItems([]);
    setOpen(false);
  };

  return (
    <div ref={wrap} className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" aria-hidden />
      <input
        type="search"
        value={q}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          run(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(visible.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && visible[active]) {
            e.preventDefault();
            pick(visible[active]);
          } else if (e.key === "Escape" && open) {
            // Handled here, so a dialog around the picker stays open.
            e.preventDefault();
            setOpen(false);
          }
        }}
        className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-8 text-[13px] shadow-xs placeholder:text-faint focus:border-primary focus:outline-none focus:ring-4 focus:ring-[var(--ring)] disabled:bg-surface-2"
      />
      {loading && <LoaderCircle className="absolute right-2.5 top-2.5 size-4 animate-spin text-faint" aria-label="Searching" />}
      {open && q.trim() && !loading && (visible.length > 0 || error) && (
        <ul role="listbox" className="absolute inset-x-0 top-10 z-30 max-h-72 animate-pop-in overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-pop">
          {error && <li className="px-2.5 py-2 text-[12.5px] text-danger-ink">{error}</li>}
          {visible.map((item, i) => (
            <li key={keyOf(item)} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(item)}
                className={cn("w-full rounded-lg px-2.5 py-1.5 text-left text-[13px]", i === active && "bg-hover")}
              >
                {render(item)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && q.trim() && !loading && !error && visible.length === 0 && items.length === 0 && (
        <p className="absolute inset-x-0 top-10 z-30 rounded-xl border border-line bg-surface px-3 py-2 text-[12.5px] text-muted shadow-pop">No matches for “{q.trim()}”.</p>
      )}
    </div>
  );
}

/** Live counter for copy fields, warning near the limit. */
export function Counter({ value, max }: { value: string; max: number }) {
  return <span className={cn("tabular text-[11.5px]", value.length > max ? "text-danger-ink" : value.length > max * 0.9 ? "text-warning-ink" : "text-faint")}>{value.length}/{max}</span>;
}
