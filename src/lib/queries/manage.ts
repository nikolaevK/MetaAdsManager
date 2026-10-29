import "server-only";
import { and, between, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "@/lib/db";
import { ads, adsets, campaigns, insightsDaily } from "@/lib/db/schema";
import type { DateRange } from "@/lib/dates";
import { RESULT_LABELS } from "@/lib/meta/actions";
import { addSums, emptySums, METRIC_BY_KEY, type MetricSums } from "@/lib/metrics";
import { metricSums } from "./metric-sql";

export type TableLevel = "campaigns" | "adsets" | "ads";
export const STATUS_FILTERS = ["all", "active", "off", "issues", "rejected", "spent"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export type TableRow = MetricSums & {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  parentId: string | null;
  parentName: string | null;
  campaignId: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  /** Ad sets inside a CBO campaign show the campaign's budget. */
  usesCampaignBudget: boolean;
  thumbnailUrl: string | null;
  issue: string | null;
  resultLabel: string;
  objective: string | null;
  bidStrategy: string | null;
  optimizationGoal: string | null;
  startTime: string | null;
  endTime: string | null;
  createdTime: string | null;
};

/** Non-metric columns that can be sorted on. Metric keys from the registry are sortable too. */
export const ATTRIBUTE_SORT_KEYS = ["name", "delivery", "budget", "objective", "bidStrategy", "optimizationGoal", "startTime", "endTime", "createdTime"] as const;
export type SortKey = string;

export const isSortKey = (k: string | undefined): k is SortKey =>
  !!k && ((ATTRIBUTE_SORT_KEYS as readonly string[]).includes(k) || METRIC_BY_KEY.has(k));

const metricSelect = {
  ...metricSums,
  resultTypes: sql<string | null>`group_concat(distinct ${insightsDaily.resultType})`,
};

function resultLabel(types: string | null, fallbackEvent?: string | null): string {
  const list = types?.split(",").filter(Boolean) ?? [];
  if (list.length > 1) return "Multiple conversions";
  const t = list[0] ?? fallbackEvent ?? null;
  return t ? (RESULT_LABELS[t] ?? t) : "Results";
}

function statusWhere(status: AnySQLiteColumn, eff: AnySQLiteColumn, filter: StatusFilter): SQL | undefined {
  switch (filter) {
    case "active":
      return eq(eff, "ACTIVE");
    case "off":
      return eq(status, "PAUSED");
    case "issues":
      return inArray(eff, ["DISAPPROVED", "WITH_ISSUES", "PENDING_REVIEW", "IN_PROCESS"]);
    case "rejected":
      return inArray(eff, ["DISAPPROVED", "WITH_ISSUES"]);
    default:
      return undefined;
  }
}

const search = (col: AnySQLiteColumn, q?: string) => (q ? sql`instr(lower(${col}), ${q.toLowerCase()}) > 0` : undefined);

const NO_ATTRS = { objective: null, bidStrategy: null, optimizationGoal: null, startTime: null, endTime: null, createdTime: null };

export async function getTableRows(
  accountId: string,
  level: TableLevel,
  range: DateRange,
  filter: { campaignIds?: string[]; adsetIds?: string[]; q?: string; status?: StatusFilter },
): Promise<TableRow[]> {
  const rows = await queryRows(accountId, level, range, filter);
  return filter.status === "spent" ? rows.filter((r) => r.spend > 0) : rows;
}

async function queryRows(
  accountId: string,
  level: TableLevel,
  range: DateRange,
  filter: { campaignIds?: string[]; adsetIds?: string[]; q?: string; status?: StatusFilter },
): Promise<TableRow[]> {
  const dateCond = between(insightsDaily.date, range.since, range.until);
  const status = filter.status ?? "all";

  if (level === "campaigns") {
    const rows = await db()
      .select({ c: campaigns, ...metricSelect })
      .from(campaigns)
      .leftJoin(insightsDaily, and(eq(insightsDaily.campaignId, campaigns.id), dateCond))
      .where(
        and(
          eq(campaigns.adAccountId, accountId),
          filter.campaignIds?.length ? inArray(campaigns.id, filter.campaignIds) : undefined,
          search(campaigns.name, filter.q),
          statusWhere(campaigns.status, campaigns.effectiveStatus, status),
        ),
      )
      .groupBy(campaigns.id)
      .limit(2000);
    return rows.map(({ c, resultTypes, ...m }) => ({
      ...m,
      id: c.id,
      name: c.name,
      status: c.status,
      effectiveStatus: c.effectiveStatus,
      parentId: null,
      parentName: null,
      campaignId: c.id,
      dailyBudget: c.dailyBudget,
      lifetimeBudget: c.lifetimeBudget,
      usesCampaignBudget: false,
      thumbnailUrl: null,
      issue: null,
      resultLabel: resultLabel(resultTypes),
      objective: c.objective,
      bidStrategy: c.bidStrategy,
      optimizationGoal: null,
      startTime: c.startTime,
      endTime: c.stopTime,
      createdTime: c.createdTime,
    }));
  }

  if (level === "adsets") {
    const parent = alias(campaigns, "parent");
    const rows = await db()
      .select({
        s: adsets,
        parentName: parent.name,
        parentDaily: parent.dailyBudget,
        parentLifetime: parent.lifetimeBudget,
        parentObjective: parent.objective,
        parentBid: parent.bidStrategy,
        ...metricSelect,
      })
      .from(adsets)
      .leftJoin(parent, eq(parent.id, adsets.campaignId))
      .leftJoin(insightsDaily, and(eq(insightsDaily.adsetId, adsets.id), dateCond))
      .where(
        and(
          eq(adsets.adAccountId, accountId),
          filter.campaignIds?.length ? inArray(adsets.campaignId, filter.campaignIds) : undefined,
          filter.adsetIds?.length ? inArray(adsets.id, filter.adsetIds) : undefined,
          search(adsets.name, filter.q),
          statusWhere(adsets.status, adsets.effectiveStatus, status),
        ),
      )
      .groupBy(adsets.id)
      .limit(2000);
    return rows.map(({ s, parentName, parentDaily, parentLifetime, parentObjective, parentBid, resultTypes, ...m }) => {
      const usesCampaignBudget = s.dailyBudget === null && s.lifetimeBudget === null && (parentDaily !== null || parentLifetime !== null);
      return {
        ...m,
        id: s.id,
        name: s.name,
        status: s.status,
        effectiveStatus: s.effectiveStatus,
        parentId: s.campaignId,
        parentName,
        campaignId: s.campaignId,
        dailyBudget: s.dailyBudget,
        lifetimeBudget: s.lifetimeBudget,
        usesCampaignBudget,
        thumbnailUrl: null,
        issue: null,
        resultLabel: resultLabel(resultTypes, s.promotedObject?.custom_event_type as string | undefined),
        objective: parentObjective,
        bidStrategy: parentBid,
        optimizationGoal: s.optimizationGoal,
        startTime: s.startTime,
        endTime: s.endTime,
        createdTime: s.createdTime,
      };
    });
  }

  const parent = alias(adsets, "parent");
  const rows = await db()
    .select({ a: ads, parentName: parent.name, parentEvent: parent.promotedObject, parentGoal: parent.optimizationGoal, ...metricSelect })
    .from(ads)
    .leftJoin(parent, eq(parent.id, ads.adsetId))
    .leftJoin(insightsDaily, and(eq(insightsDaily.adId, ads.id), dateCond))
    .where(
      and(
        eq(ads.adAccountId, accountId),
        filter.adsetIds?.length ? inArray(ads.adsetId, filter.adsetIds) : undefined,
        filter.campaignIds?.length && !filter.adsetIds?.length ? inArray(ads.campaignId, filter.campaignIds) : undefined,
        search(ads.name, filter.q),
        statusWhere(ads.status, ads.effectiveStatus, status),
      ),
    )
    .groupBy(ads.id)
    .limit(2000);
  return rows.map(({ a, parentName, parentEvent, parentGoal, resultTypes, ...m }) => ({
    ...m,
    ...NO_ATTRS,
    id: a.id,
    name: a.name,
    status: a.status,
    effectiveStatus: a.effectiveStatus,
    parentId: a.adsetId,
    parentName,
    campaignId: a.campaignId,
    dailyBudget: null,
    lifetimeBudget: null,
    usesCampaignBudget: false,
    thumbnailUrl: a.thumbnailUrl,
    issue:
      a.issuesInfo?.[0]?.error_summary ??
      a.issuesInfo?.[0]?.error_message ??
      (a.reviewFeedback ? (Object.values(a.reviewFeedback).flatMap((r) => Object.keys(r))[0] ?? null) : null),
    resultLabel: resultLabel(resultTypes, parentEvent?.custom_event_type as string | undefined),
    optimizationGoal: parentGoal,
    createdTime: a.createdTime,
  }));
}

const DELIVERY_RANK: Record<string, number> = { ACTIVE: 0, IN_PROCESS: 1, PENDING_REVIEW: 2, WITH_ISSUES: 3, DISAPPROVED: 4 };

export function sortRows(rows: TableRow[], key: SortKey, dir: "asc" | "desc"): TableRow[] {
  const metric = METRIC_BY_KEY.get(key);
  const val = (r: TableRow): number | string | null => {
    if (metric) return metric.value(r);
    switch (key) {
      case "name":
        return r.name.toLowerCase();
      case "delivery":
        return DELIVERY_RANK[r.effectiveStatus] ?? 9;
      case "budget":
        return r.dailyBudget ?? r.lifetimeBudget ?? null;
      case "objective":
      case "bidStrategy":
      case "optimizationGoal":
      case "startTime":
      case "endTime":
      case "createdTime":
        return r[key];
      default:
        return null;
    }
  };
  const mult = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (va === vb) return 0;
    if (va === null) return 1; // nulls last regardless of direction
    if (vb === null) return -1;
    return (va < vb ? -1 : 1) * mult;
  });
}

export function totals(rows: MetricSums[]): MetricSums {
  return rows.reduce((t, r) => addSums(t, r), emptySums());
}

/** Campaign / ad set pickers for the create flows. */
export async function getParentOptions(accountId: string) {
  const [campaignRows, adsetRows] = await Promise.all([
    db()
      .select({ id: campaigns.id, name: campaigns.name, objective: campaigns.objective, daily: campaigns.dailyBudget, lifetime: campaigns.lifetimeBudget, bidStrategy: campaigns.bidStrategy })
      .from(campaigns)
      .where(eq(campaigns.adAccountId, accountId))
      .orderBy(campaigns.name)
      .limit(2000),
    db()
      .select({ id: adsets.id, name: adsets.name, campaignId: adsets.campaignId })
      .from(adsets)
      .where(eq(adsets.adAccountId, accountId))
      .orderBy(adsets.name)
      .limit(2000),
  ]);
  return {
    campaigns: campaignRows.map((c) => ({ id: c.id, name: c.name, objective: c.objective, hasBudget: c.daily !== null || c.lifetime !== null, bidStrategy: c.bidStrategy })),
    adsets: adsetRows,
  };
}
