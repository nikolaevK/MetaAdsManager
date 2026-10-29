import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

/**
 * Design system primitives. Server-safe (no hooks). Every color comes from a semantic token in
 * globals.css, so light and dark themes work without per-component overrides.
 */

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ── Buttons ──────────────────────────────────────────────────────────────────

type Variant = "primary" | "create" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-white shadow-xs border-transparent hover:bg-primary-hover [box-shadow:inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(0_0_0/0.08)]",
  // The brand CTA: reserved for the main "make something" action on a screen.
  create:
    "border-transparent text-white bg-gradient-to-b from-brand-from to-primary shadow-glow hover:brightness-110 [box-shadow:inset_0_1px_0_rgb(255_255_255/0.18),0_4px_14px_-4px_color-mix(in_oklab,var(--primary)_55%,transparent)]",
  secondary: "bg-surface text-ink border-line shadow-xs hover:bg-hover hover:border-line",
  ghost: "bg-transparent text-muted border-transparent hover:bg-hover hover:text-ink",
  subtle: "bg-hover text-ink border-transparent hover:bg-line-soft",
  danger: "bg-surface text-danger-ink border-line shadow-xs hover:bg-danger-soft hover:border-danger/30",
};
const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-9 px-3.5 text-[13.5px] gap-2 rounded-lg",
  lg: "h-10 px-4 text-sm gap-2 rounded-xl",
  icon: "size-8 rounded-lg",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra?: string) {
  return cn(
    "inline-flex items-center justify-center border font-medium whitespace-nowrap select-none",
    "transition-[background-color,border-color,color,filter,box-shadow] duration-150",
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)]",
    "disabled:opacity-50 disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    VARIANTS[variant],
    SIZES[size],
    extra,
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

// ── Form controls ────────────────────────────────────────────────────────────

const fieldBase = cn(
  "w-full rounded-lg border border-line bg-surface px-3 text-[13.5px] text-ink shadow-xs",
  "placeholder:text-faint transition-[border-color,box-shadow] duration-150",
  "hover:border-[color-mix(in_oklab,var(--line)_60%,var(--muted))]",
  "focus:border-primary focus:outline-none focus:ring-4 focus:ring-[var(--ring)]",
  "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted",
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/15",
);

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldBase, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(fieldBase, "py-2 leading-snug", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(fieldBase, "h-9 cursor-pointer pr-8", className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-[13px] font-medium text-ink", className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | string[];
  children: ReactNode;
  htmlFor?: string;
}) {
  const err = Array.isArray(error) ? error[0] : error;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {err ? <p className="text-xs text-danger-ink">{err}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-xl border border-line bg-surface shadow-card", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  actions,
  icon: Icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-muted">
            <Icon className="size-4" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-[14.5px] font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── Status ───────────────────────────────────────────────────────────────────

export type Tone = "success" | "muted" | "warning" | "danger" | "info";

const TONE_DOT: Record<Tone, string> = {
  success: "bg-success shadow-[0_0_0_3px_var(--success-soft)]",
  muted: "bg-faint",
  warning: "bg-warning shadow-[0_0_0_3px_var(--warning-soft)]",
  danger: "bg-danger shadow-[0_0_0_3px_var(--danger-soft)]",
  info: "bg-primary shadow-[0_0_0_3px_var(--primary-soft)]",
};
const TONE_BADGE: Record<Tone, string> = {
  success: "bg-success-soft text-success-ink ring-success/20",
  muted: "bg-hover text-muted ring-line",
  warning: "bg-warning-soft text-warning-ink ring-warning/25",
  danger: "bg-danger-soft text-danger-ink ring-danger/20",
  info: "bg-primary-soft text-primary-ink ring-primary/20",
};

export function StatusDot({ tone, label }: { tone: Tone; label: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} aria-hidden />
      {label}
    </span>
  );
}

export function Badge({ tone = "muted", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset",
        TONE_BADGE[tone],
        className,
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", TONE_DOT[tone].split(" ")[0])} aria-hidden />}
      {children}
    </span>
  );
}

const ALERT_ICON: Record<Tone, LucideIcon> = { success: CircleCheck, muted: Info, warning: TriangleAlert, danger: CircleAlert, info: Info };

export function Alert({ tone = "danger", children, title }: { tone?: Tone; children: ReactNode; title?: ReactNode }) {
  const Icon = ALERT_ICON[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-2.5 rounded-lg px-3 py-2.5 text-[13px] ring-1 ring-inset", TONE_BADGE[tone])}>
      <Icon className="mt-px size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? "opacity-90" : undefined}>{children}</div>
      </div>
    </div>
  );
}

// ── Page scaffolding ─────────────────────────────────────────────────────────

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  /** Defaults to `pb-5`; pass e.g. "pb-0" inside gap-based stacks. */
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-3", className ?? "pb-5")}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-medium uppercase tracking-wider text-faint">{eyebrow}</p>}
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[13.5px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
  icon: Icon,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {Icon && (
        <span className="mb-2 grid size-12 place-items-center rounded-2xl border border-line bg-gradient-to-b from-surface to-surface-2 text-muted shadow-card">
          <Icon className="size-5" />
        </span>
      )}
      <p className="text-[15px] font-semibold tracking-tight">{title}</p>
      {children && <div className="max-w-md text-[13px] text-muted">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded-md bg-[length:800px_100%]",
        "bg-[linear-gradient(90deg,var(--line-soft)_0%,var(--hover)_40%,var(--line-soft)_80%)]",
        className,
      )}
    />
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="space-y-2 rounded-xl border border-line bg-surface p-4 shadow-card">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────────

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line bg-surface-2 px-1 font-sans text-[11px] font-medium text-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-from to-brand-to text-[12px] font-semibold text-white",
        className,
      )}
    >
      {initials || "?"}
    </span>
  );
}

/** KPI tile: label, big value, optional delta pill and inline visual (e.g. sparkline). */
export function Stat({
  label,
  value,
  delta,
  footer,
  visual,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: { text: string; tone: "success" | "danger" | "muted" };
  footer?: ReactNode;
  visual?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 shadow-card", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-muted">{label}</span>
        {delta && <Badge tone={delta.tone}>{delta.text}</Badge>}
      </div>
      <div className="flex items-end justify-between gap-3">
        <span className="tabular text-[22px] font-semibold leading-none tracking-tight">{value}</span>
        {visual}
      </div>
      {footer && <div className="text-xs text-faint">{footer}</div>}
    </div>
  );
}

/** Pill-style segmented control built from links or buttons supplied by the caller. */
export function Segmented({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="tablist" className={cn("inline-flex items-center gap-0.5 rounded-xl border border-line bg-surface-2 p-0.5", className)}>
      {children}
    </div>
  );
}

export function segmentClass(active: boolean) {
  return cn(
    "inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-[10px] px-3 text-[13px] font-medium transition-colors [&_svg]:size-4",
    active ? "bg-surface text-ink shadow-card ring-1 ring-line" : "text-muted hover:text-ink",
  );
}
