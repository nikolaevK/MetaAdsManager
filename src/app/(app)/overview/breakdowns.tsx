"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/components/ui";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { compactNumber, type MetricSums } from "@/lib/metrics";

// Validated categorical order (globals.css --series-*). Assigned by rank of spend, folded to "Other" past 5.
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)"];
const OTHER = "var(--faint)";

/** Part-to-whole: one 100% stacked bar + a legend that carries every name and number. */
export function SpendMix({ items, total, currency, dateQuery }: { items: { id: string; name: string; spend: number }[]; total: number; currency: string; dateQuery: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const head = items.slice(0, SERIES.length);
  const restSpend = Math.max(0, total - head.reduce((s, i) => s + i.spend, 0));
  const segments = [
    ...head.map((i, k) => ({ ...i, color: SERIES[k], href: `/campaigns?level=adsets&campaigns=${i.id}&${dateQuery}` as string | null })),
    ...(restSpend > total * 0.001 ? [{ id: "other", name: "All other campaigns", spend: restSpend, color: OTHER, href: null as string | null }] : []),
  ].filter((s) => s.spend > 0);
  const share = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-3.5 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label="Share of spend by campaign; values listed below">
        {segments.map((s) => (
          <span
            key={s.id}
            onMouseEnter={() => setHover(s.id)}
            onMouseLeave={() => setHover(null)}
            className="h-full min-w-[3px] transition-opacity first:rounded-l-full last:rounded-r-full"
            style={{ width: `${share(s.spend)}%`, background: s.color, opacity: hover && hover !== s.id ? 0.35 : 1 }}
          />
        ))}
      </div>
      <ul className="flex flex-col">
        {segments.map((s) => {
          const body = (
            <>
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-ink">{s.name}</span>
              <span className="tabular w-12 text-right text-muted">{share(s.spend) < 1 ? "<1" : Math.round(share(s.spend))}%</span>
              <span className="tabular w-24 text-right font-medium text-ink">{formatMoney(s.spend, currency)}</span>
            </>
          );
          const cls = cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition-colors", hover === s.id && "bg-hover");
          return (
            <li key={s.id} onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}>
              {s.href ? (
                <Link href={s.href} className={cn(cls, "group hover:bg-hover")}>
                  {body}
                  <ChevronRight className="size-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </Link>
              ) : (
                <div className={cn(cls, "pr-7")}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type Step = { key: keyof MetricSums; label: string; rateLabel: string };
const STEPS: Step[] = [
  { key: "impressions", label: "Impressions", rateLabel: "" },
  { key: "linkClicks", label: "Link clicks", rateLabel: "CTR" },
  { key: "landingPageViews", label: "Landing page views", rateLabel: "Page load rate" },
  { key: "addToCart", label: "Adds to cart", rateLabel: "Add-to-cart rate" },
  { key: "initiateCheckout", label: "Checkouts initiated", rateLabel: "Checkout rate" },
  { key: "purchases", label: "Purchases", rateLabel: "Purchase rate" },
];

/**
 * Funnel as pass-through rates: each bar is the share of the previous step that made it here, so a
 * drop-off is visible at every stage (bars scaled to impressions would make every later step a sliver).
 */
export function Funnel({ sums, currency }: { sums: MetricSums; currency: string }) {
  // Lead-gen accounts end the funnel at leads instead of the cart steps.
  const steps: Step[] =
    sums.purchases === 0 && sums.addToCart === 0 && sums.leads > 0
      ? [...STEPS.slice(0, 3), { key: "leads", label: "Leads", rateLabel: "Lead rate" }]
      : STEPS;
  // Drop the trailing steps the account doesn't track at all.
  let last = steps.length - 1;
  while (last > 1 && sums[steps[last].key] === 0) last--;
  const shown = steps.slice(0, last + 1);
  const final = shown[shown.length - 1];

  return (
    <div className="flex flex-col gap-1">
      <p className="mb-1 grid grid-cols-[minmax(0,8.5rem)_1fr_4.5rem_3.5rem] gap-3 text-[11px] font-medium uppercase tracking-wider text-faint max-sm:grid-cols-[minmax(0,7rem)_1fr_4rem_3rem]">
        <span>Step</span>
        <span>Share of previous step</span>
        <span className="text-right">Rate</span>
        <span className="text-right">Count</span>
      </p>
      <ol className="flex flex-col gap-2.5">
        {shown.map((s, i) => {
          const value = sums[s.key];
          const prevValue = i > 0 ? sums[shown[i - 1].key] : null;
          const rate = prevValue && prevValue > 0 ? (value / prevValue) * 100 : null;
          return (
            <li key={s.key} className="grid grid-cols-[minmax(0,8.5rem)_1fr_4.5rem_3.5rem] items-center gap-3 text-[13px] max-sm:grid-cols-[minmax(0,7rem)_1fr_4rem_3rem]">
              <span className="truncate text-muted">{s.label}</span>
              <span className="relative h-5 overflow-hidden rounded-md bg-hover">
                <span className="absolute inset-y-0 left-0 rounded-md bg-chart-1 transition-[width]" style={{ width: `${i === 0 ? 100 : Math.min(100, rate ?? 0)}%` }} />
              </span>
              <span className="tabular text-right text-[12px] text-muted" title={s.rateLabel}>
                {i === 0 ? "" : rate === null ? "—" : formatPercent(rate)}
              </span>
              <span className="tabular text-right font-medium text-ink">{compactNumber(value)}</span>
            </li>
          );
        })}
      </ol>
      {shown.length > 2 && sums.impressions > 0 && (
        <p className="mt-2 border-t border-line-soft pt-2 text-[12.5px] text-muted">
          {formatNumber(sums[final.key])} {final.label.toLowerCase()} from {formatNumber(sums.impressions)} impressions ·{" "}
          {sums[final.key] > 0 ? `${formatMoney(sums.spend / sums[final.key], currency)} each` : "none yet"}
        </p>
      )}
    </div>
  );
}
