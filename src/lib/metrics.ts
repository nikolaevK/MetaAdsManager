/**
 * Metric registry shared by the campaigns table, overview tiles and charts (server + client safe).
 *
 * Every metric is derived from additive daily sums (MetricSums), so the same definition works for a
 * row, a totals footer, a day in a chart, or a whole date range. Non-additive Meta metrics (reach,
 * frequency) are deliberately absent: they can't be rebuilt from per-ad daily rows.
 */
import { formatMoney, formatNumber, formatPercent } from "./format";

export const SUM_KEYS = [
  "spend",
  "impressions",
  "clicks",
  "linkClicks",
  "results",
  "purchases",
  "purchaseValue",
  "leads",
  "landingPageViews",
  "addToCart",
  "initiateCheckout",
  "postEngagement",
  "videoViews",
  "thruplays",
  "videoP25",
  "videoP50",
  "videoP75",
  "videoP100",
] as const;
export type SumKey = (typeof SUM_KEYS)[number];
export type MetricSums = Record<SumKey, number>;

export const emptySums = (): MetricSums => Object.fromEntries(SUM_KEYS.map((k) => [k, 0])) as MetricSums;

export function addSums(into: MetricSums, m: MetricSums): MetricSums {
  for (const k of SUM_KEYS) into[k] += m[k] ?? 0;
  return into;
}

export type MetricFormat = "money" | "number" | "percent" | "decimal";
export type MetricGroup = "Performance" | "Delivery" | "Engagement" | "Conversions" | "Video";

export type MetricDef = {
  key: string;
  label: string;
  group: MetricGroup;
  format: MetricFormat;
  /** up = higher is better, down = lower is better, neutral = no judgement (spend, volume). */
  good: "up" | "down" | "neutral";
  value: (m: MetricSums) => number | null;
  description: string;
};

const div = (a: number, b: number, mult = 1) => (b > 0 ? (a / b) * mult : null);

export const METRICS: MetricDef[] = [
  // Performance
  { key: "results", label: "Results", group: "Performance", format: "number", good: "up", value: (m) => m.results, description: "Conversions for each ad set's optimization event (link clicks when it has none)." },
  { key: "cpr", label: "Cost per result", group: "Performance", format: "money", good: "down", value: (m) => div(m.spend, m.results), description: "Amount spent ÷ results." },
  { key: "spend", label: "Amount spent", group: "Performance", format: "money", good: "neutral", value: (m) => m.spend, description: "Total spend in the date range." },
  { key: "roas", label: "Purchase ROAS", group: "Performance", format: "decimal", good: "up", value: (m) => (m.purchaseValue > 0 ? div(m.purchaseValue, m.spend) : null), description: "Purchase conversion value ÷ amount spent." },
  { key: "purchaseValue", label: "Purchase value", group: "Performance", format: "money", good: "up", value: (m) => m.purchaseValue, description: "Total purchase conversion value reported by the pixel / CAPI." },

  // Delivery
  { key: "impressions", label: "Impressions", group: "Delivery", format: "number", good: "neutral", value: (m) => m.impressions, description: "Times your ads were on screen." },
  { key: "cpm", label: "CPM", group: "Delivery", format: "money", good: "down", value: (m) => div(m.spend, m.impressions, 1000), description: "Cost per 1,000 impressions." },

  // Engagement
  { key: "linkClicks", label: "Link clicks", group: "Engagement", format: "number", good: "up", value: (m) => m.linkClicks, description: "Clicks on links that lead to destinations on or off Meta." },
  { key: "ctr", label: "CTR (link)", group: "Engagement", format: "percent", good: "up", value: (m) => div(m.linkClicks, m.impressions, 100), description: "Link clicks ÷ impressions." },
  { key: "cpc", label: "CPC (link)", group: "Engagement", format: "money", good: "down", value: (m) => div(m.spend, m.linkClicks), description: "Amount spent ÷ link clicks." },
  { key: "clicks", label: "Clicks (all)", group: "Engagement", format: "number", good: "up", value: (m) => m.clicks, description: "All clicks, including profile, reactions and expansions." },
  { key: "ctrAll", label: "CTR (all)", group: "Engagement", format: "percent", good: "up", value: (m) => div(m.clicks, m.impressions, 100), description: "All clicks ÷ impressions." },
  { key: "cpcAll", label: "CPC (all)", group: "Engagement", format: "money", good: "down", value: (m) => div(m.spend, m.clicks), description: "Amount spent ÷ all clicks." },
  { key: "landingPageViews", label: "Landing page views", group: "Engagement", format: "number", good: "up", value: (m) => m.landingPageViews, description: "Link clicks where the landing page finished loading." },
  { key: "costPerLpv", label: "Cost per landing page view", group: "Engagement", format: "money", good: "down", value: (m) => div(m.spend, m.landingPageViews), description: "Amount spent ÷ landing page views." },
  { key: "lpvRate", label: "Landing page view rate", group: "Engagement", format: "percent", good: "up", value: (m) => div(m.landingPageViews, m.linkClicks, 100), description: "Landing page views ÷ link clicks. Low values point to slow pages." },
  { key: "postEngagement", label: "Post engagement", group: "Engagement", format: "number", good: "up", value: (m) => m.postEngagement, description: "Reactions, comments, shares, saves and clicks on the ad." },

  // Conversions
  { key: "purchases", label: "Purchases", group: "Conversions", format: "number", good: "up", value: (m) => m.purchases, description: "Purchase events attributed to your ads." },
  { key: "costPerPurchase", label: "Cost per purchase", group: "Conversions", format: "money", good: "down", value: (m) => div(m.spend, m.purchases), description: "Amount spent ÷ purchases (CPA)." },
  { key: "aov", label: "Average order value", group: "Conversions", format: "money", good: "up", value: (m) => div(m.purchaseValue, m.purchases), description: "Purchase value ÷ purchases." },
  { key: "convRate", label: "Conversion rate", group: "Conversions", format: "percent", good: "up", value: (m) => div(m.purchases, m.linkClicks, 100), description: "Purchases ÷ link clicks." },
  { key: "addToCart", label: "Adds to cart", group: "Conversions", format: "number", good: "up", value: (m) => m.addToCart, description: "Add-to-cart events attributed to your ads." },
  { key: "costPerAtc", label: "Cost per add to cart", group: "Conversions", format: "money", good: "down", value: (m) => div(m.spend, m.addToCart), description: "Amount spent ÷ adds to cart." },
  { key: "initiateCheckout", label: "Checkouts initiated", group: "Conversions", format: "number", good: "up", value: (m) => m.initiateCheckout, description: "Initiate-checkout events attributed to your ads." },
  { key: "costPerCheckout", label: "Cost per checkout initiated", group: "Conversions", format: "money", good: "down", value: (m) => div(m.spend, m.initiateCheckout), description: "Amount spent ÷ checkouts initiated." },
  { key: "leads", label: "Leads", group: "Conversions", format: "number", good: "up", value: (m) => m.leads, description: "Lead events (pixel and instant forms)." },
  { key: "costPerLead", label: "Cost per lead", group: "Conversions", format: "money", good: "down", value: (m) => div(m.spend, m.leads), description: "Amount spent ÷ leads." },

  // Video
  { key: "videoViews", label: "3-second video plays", group: "Video", format: "number", good: "up", value: (m) => m.videoViews, description: "Times a video played for at least 3 seconds." },
  { key: "hookRate", label: "Hook rate", group: "Video", format: "percent", good: "up", value: (m) => div(m.videoViews, m.impressions, 100), description: "3-second plays ÷ impressions: how well the first seconds stop the scroll." },
  { key: "thruplays", label: "ThruPlays", group: "Video", format: "number", good: "up", value: (m) => m.thruplays, description: "Plays to completion, or at least 15 seconds." },
  { key: "holdRate", label: "Hold rate", group: "Video", format: "percent", good: "up", value: (m) => div(m.thruplays, m.videoViews, 100), description: "ThruPlays ÷ 3-second plays: how well the video keeps attention." },
  { key: "costPerThruplay", label: "Cost per ThruPlay", group: "Video", format: "money", good: "down", value: (m) => div(m.spend, m.thruplays), description: "Amount spent ÷ ThruPlays." },
  { key: "videoP25", label: "Video plays at 25%", group: "Video", format: "number", good: "up", value: (m) => m.videoP25, description: "Plays that reached 25% of the video." },
  { key: "videoP50", label: "Video plays at 50%", group: "Video", format: "number", good: "up", value: (m) => m.videoP50, description: "Plays that reached 50% of the video." },
  { key: "videoP75", label: "Video plays at 75%", group: "Video", format: "number", good: "up", value: (m) => m.videoP75, description: "Plays that reached 75% of the video." },
  { key: "videoP100", label: "Video plays at 100%", group: "Video", format: "number", good: "up", value: (m) => m.videoP100, description: "Plays that reached the end of the video." },
];

export const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]));
export const METRIC_GROUPS: MetricGroup[] = ["Performance", "Delivery", "Engagement", "Conversions", "Video"];

export function formatMetric(def: Pick<MetricDef, "format">, value: number | null, currency: string, opts: { compact?: boolean } = {}): string {
  if (value === null || !Number.isFinite(value)) return "—";
  switch (def.format) {
    case "money":
      return formatMoney(value, currency, opts);
    case "percent":
      return formatPercent(value);
    case "decimal":
      return formatNumber(value, true);
    default:
      return opts.compact ? compactNumber(value) : formatNumber(value);
  }
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
export const compactNumber = (n: number) => compact.format(n);

/** Relative change, or null when there's no meaningful baseline. */
export function change(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || !(previous > 0)) return null;
  return ((current - previous) / previous) * 100;
}

/** "good" / "bad" / "neutral" verdict for a change, given which direction is better. */
export function verdict(def: Pick<MetricDef, "good">, pct: number | null): "good" | "bad" | "neutral" {
  if (pct === null || Math.abs(pct) < 0.05 || def.good === "neutral") return "neutral";
  return (pct > 0) === (def.good === "up") ? "good" : "bad";
}
