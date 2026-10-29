/** Column catalog for the campaigns table: setting columns + every registry metric, plus presets. */
import { METRIC_BY_KEY, METRICS, type MetricGroup } from "./metrics";

export type TableLevelKey = "campaigns" | "adsets" | "ads";

export type ColumnGroup = "Settings" | MetricGroup;

export type ColumnDef = {
  key: string;
  label: string;
  group: ColumnGroup;
  description: string;
  /** Levels where the column means something; hidden elsewhere. */
  levels?: TableLevelKey[];
};

export const SETTING_COLUMNS: ColumnDef[] = [
  { key: "delivery", label: "Delivery", group: "Settings", description: "Current delivery status, plus review issues." },
  { key: "budget", label: "Budget", group: "Settings", description: "Daily or lifetime budget. Click to edit.", levels: ["campaigns", "adsets"] },
  { key: "objective", label: "Objective", group: "Settings", description: "Campaign objective.", levels: ["campaigns", "adsets"] },
  { key: "bidStrategy", label: "Bid strategy", group: "Settings", description: "Campaign bid strategy.", levels: ["campaigns", "adsets"] },
  { key: "optimizationGoal", label: "Optimization", group: "Settings", description: "What the ad set optimizes delivery for.", levels: ["adsets", "ads"] },
  { key: "startTime", label: "Starts", group: "Settings", description: "Scheduled start.", levels: ["campaigns", "adsets"] },
  { key: "endTime", label: "Ends", group: "Settings", description: "Scheduled end, if any.", levels: ["campaigns", "adsets"] },
  { key: "createdTime", label: "Created", group: "Settings", description: "When the object was created in Meta (ad age)." },
];

export const COLUMNS: ColumnDef[] = [
  ...SETTING_COLUMNS,
  ...METRICS.map((m) => ({ key: m.key, label: m.label, group: m.group, description: m.description })),
];
export const COLUMN_BY_KEY = new Map(COLUMNS.map((c) => [c.key, c]));
export const COLUMN_GROUPS: ColumnGroup[] = ["Settings", "Performance", "Delivery", "Engagement", "Conversions", "Video"];

export type ColumnPreset = { id: string; name: string; description: string; columns: string[] };

export const PRESETS: ColumnPreset[] = [
  {
    id: "performance",
    name: "Performance",
    description: "Results, cost and the core funnel",
    columns: ["delivery", "budget", "results", "cpr", "spend", "impressions", "cpm", "linkClicks", "ctr", "cpc", "roas"],
  },
  {
    id: "ecommerce",
    name: "E-commerce",
    description: "Purchases, ROAS, AOV and cart events",
    columns: ["delivery", "budget", "spend", "purchases", "costPerPurchase", "purchaseValue", "roas", "aov", "convRate", "addToCart", "costPerAtc", "initiateCheckout", "costPerCheckout"],
  },
  {
    id: "leads",
    name: "Leads",
    description: "Lead volume and cost",
    columns: ["delivery", "budget", "spend", "leads", "costPerLead", "linkClicks", "ctr", "cpc", "landingPageViews", "lpvRate"],
  },
  {
    id: "engagement",
    name: "Engagement",
    description: "Clicks, landing page views and post engagement",
    columns: ["delivery", "spend", "impressions", "clicks", "ctrAll", "linkClicks", "ctr", "cpc", "landingPageViews", "costPerLpv", "lpvRate", "postEngagement"],
  },
  {
    id: "video",
    name: "Video & creative",
    description: "Hook rate, hold rate and watch-through",
    columns: ["delivery", "spend", "impressions", "videoViews", "hookRate", "thruplays", "holdRate", "costPerThruplay", "videoP25", "videoP50", "videoP75", "videoP100", "ctr", "roas"],
  },
  {
    id: "setup",
    name: "Setup",
    description: "Objective, bidding, optimization and schedule",
    columns: ["delivery", "budget", "objective", "bidStrategy", "optimizationGoal", "startTime", "endTime", "createdTime", "spend"],
  },
];

export const DEFAULT_PRESET = PRESETS[0];

/** Drops unknown keys and duplicates, so stored sets survive registry changes. */
export function cleanColumns(keys: readonly string[]): string[] {
  return [...new Set(keys)].filter((k) => COLUMN_BY_KEY.has(k));
}

export const isMetricColumn = (key: string) => METRIC_BY_KEY.has(key);
