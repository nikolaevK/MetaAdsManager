import "server-only";
import { and, between, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ads, campaigns, insightsDaily } from "@/lib/db/schema";
import { addDays, daysBetween, previousPeriod, type DateRange } from "@/lib/dates";
import { addSums, emptySums, type MetricSums } from "@/lib/metrics";
import { metricSums } from "./metric-sql";

export type DayPoint = { date: string; sums: MetricSums };

async function dailyFor(accountId: string, since: string, until: string): Promise<DayPoint[]> {
  const rows = await db()
    .select({ date: insightsDaily.date, ...metricSums })
    .from(insightsDaily)
    .where(and(eq(insightsDaily.adAccountId, accountId), between(insightsDaily.date, since, until)))
    .groupBy(insightsDaily.date);
  const byDate = new Map(rows.map(({ date, ...sums }) => [date, sums as MetricSums]));
  // Fill missing days so the chart has a continuous axis.
  return Array.from({ length: daysBetween(since, until) }, (_, i) => {
    const date = addDays(since, i);
    return { date, sums: byDate.get(date) ?? emptySums() };
  });
}

export async function getOverview(accountId: string, range: DateRange) {
  const prev = previousPeriod(range);
  const inRange = and(eq(insightsDaily.adAccountId, accountId), between(insightsDaily.date, range.since, range.until));

  const [series, previousSeries, topRows, topAdRows, statusCounts] = await Promise.all([
    dailyFor(accountId, range.since, range.until),
    dailyFor(accountId, prev.since, prev.until),
    // Left joins: spend of campaigns and ads archived or deleted since still counts (and still adds up to the totals).
    db()
      .select({ id: insightsDaily.campaignId, name: campaigns.name, status: campaigns.effectiveStatus, ...metricSums })
      .from(insightsDaily)
      .leftJoin(campaigns, eq(campaigns.id, insightsDaily.campaignId))
      .where(inRange)
      .groupBy(insightsDaily.campaignId)
      .orderBy(desc(sql`sum(${insightsDaily.spend})`))
      .limit(8),
    db()
      .select({ id: insightsDaily.adId, name: ads.name, status: ads.effectiveStatus, thumbnailUrl: ads.thumbnailUrl, ...metricSums })
      .from(insightsDaily)
      .leftJoin(ads, eq(ads.id, insightsDaily.adId))
      .where(inRange)
      .groupBy(insightsDaily.adId)
      .orderBy(desc(sql`sum(${insightsDaily.spend})`))
      .limit(6),
    db()
      .select({ status: ads.effectiveStatus, n: count() })
      .from(ads)
      .where(and(eq(ads.adAccountId, accountId), inArray(ads.effectiveStatus, ["ACTIVE", "PENDING_REVIEW", "IN_PROCESS", "DISAPPROVED", "WITH_ISSUES"])))
      .groupBy(ads.effectiveStatus),
  ]);

  const n = (s: string[]) => statusCounts.filter((c) => s.includes(c.status)).reduce((a, c) => a + c.n, 0);
  // Totals are the daily series summed: the same rows, without two more aggregate queries.
  const total = (points: DayPoint[]) => points.reduce((t, p) => addSums(t, p.sums), emptySums());
  const top = topRows.map((r) => ({ ...r, name: r.name ?? "Archived or deleted campaign", status: r.status ?? "ARCHIVED" }));
  const topAds = topAdRows.map((r) => ({ ...r, name: r.name ?? "Archived or deleted ad", status: r.status ?? "ARCHIVED" }));
  return {
    current: total(series),
    previous: total(previousSeries),
    previousRange: prev,
    series,
    previousSeries,
    top,
    topAds,
    ads: { active: n(["ACTIVE"]), inReview: n(["PENDING_REVIEW", "IN_PROCESS"]), problems: n(["DISAPPROVED", "WITH_ISSUES"]) },
  };
}

export type OverviewData = Awaited<ReturnType<typeof getOverview>>;
