/** Display formatting shared by server and client components. */

const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number | null | undefined, currency = "USD", opts: { compact?: boolean } = {}): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  const key = `${currency}:${opts.compact ? "c" : ""}`;
  let f = moneyFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: opts.compact ? "compact" : "standard",
      maximumFractionDigits: opts.compact ? 1 : 2,
    });
    moneyFormatters.set(key, f);
  }
  return f.format(amount);
}

const intFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const decFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatNumber(n: number | null | undefined, decimals = false): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return (decimals ? decFormatter : intFormatter).format(n);
}

export function formatPercent(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}

export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function formatRelative(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return "never";
  const diff = Math.round((now - ms) / 1000);
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)} h ago`;
  return `${Math.round(diff / 86_400)} d ago`;
}

/** True when `ms` is missing or older than `maxAgeMs`. */
export function isStale(ms: number | null | undefined, maxAgeMs: number, now = Date.now()): boolean {
  return !ms || now - ms > maxAgeMs;
}

export function formatDateTime(ms: number | string | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/** Delivery column labels for Meta effective_status values. */
export const DELIVERY: Record<string, { label: string; tone: "success" | "muted" | "warning" | "danger" | "info" }> = {
  ACTIVE: { label: "Active", tone: "success" },
  PAUSED: { label: "Off", tone: "muted" },
  CAMPAIGN_PAUSED: { label: "Campaign off", tone: "muted" },
  ADSET_PAUSED: { label: "Ad set off", tone: "muted" },
  IN_PROCESS: { label: "In process", tone: "info" },
  PENDING_REVIEW: { label: "In review", tone: "warning" },
  PREAPPROVED: { label: "Preapproved", tone: "info" },
  DISAPPROVED: { label: "Rejected", tone: "danger" },
  WITH_ISSUES: { label: "Error", tone: "danger" },
  PENDING_BILLING_INFO: { label: "Pending billing", tone: "warning" },
  ARCHIVED: { label: "Archived", tone: "muted" },
  DELETED: { label: "Deleted", tone: "muted" },
};

export function delivery(status: string) {
  return DELIVERY[status] ?? { label: status.replaceAll("_", " ").toLowerCase(), tone: "muted" as const };
}
