import "server-only";
import { and, between, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ads, campaigns, insightsDaily } from "@/lib/db/schema";
import { addDays, daysBetween, previousPeriod, type DateRange } from "@/lib/dates";
import { emptySums, type MetricSums } from "@/lib/metrics";
import { metricSums } from "./metric-sql";

export type DayPoint = { date: string; sums: MetricSums };

async function totalsFor(accountId: string, since: string, until: string): Promise<MetricSums> {
  const [row] = await db()
    .select(metricSums)
    .from(insightsDaily)
    .where(and(eq(insightsDaily.adAccountId, accountId), between(insightsDaily.date, since, until)));
  return row ?? emptySums();
}

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

  const [current, previous, series, previousSeries, top, topAds, statusCounts] = await Promise.all([
    totalsFor(accountId, range.since, range.until),
    totalsFor(accountId, prev.since, prev.until),
    dailyFor(accountId, range.since, range.until),
    dailyFor(accountId, prev.since, prev.until),
    db()
      .select({ id: campaigns.id, name: campaigns.name, status: campaigns.effectiveStatus, ...metricSums })
      .from(insightsDaily)
      .innerJoin(campaigns, eq(campaigns.id, insightsDaily.campaignId))
      .where(inRange)
      .groupBy(campaigns.id)
      .orderBy(desc(sql`sum(${insightsDaily.spend})`))
      .limit(8),
    db()
      .select({ id: ads.id, name: ads.name, status: ads.effectiveStatus, thumbnailUrl: ads.thumbnailUrl, ...metricSums })
      .from(insightsDaily)
      .innerJoin(ads, eq(ads.id, insightsDaily.adId))
      .where(inRange)
      .groupBy(ads.id)
      .orderBy(desc(sql`sum(${insightsDaily.spend})`))
      .limit(6),
    db()
      .select({ status: ads.effectiveStatus, n: count() })
      .from(ads)
      .where(and(eq(ads.adAccountId, accountId), inArray(ads.effectiveStatus, ["ACTIVE", "PENDING_REVIEW", "IN_PROCESS", "DISAPPROVED", "WITH_ISSUES"])))
      .groupBy(ads.effectiveStatus),
  ]);

  const n = (s: string[]) => statusCounts.filter((c) => s.includes(c.status)).reduce((a, c) => a + c.n, 0);
  return {
    current,
    previous,
    previousRange: prev,
    series,
    previousSeries,
    top,
    topAds,
    ads: { active: n(["ACTIVE"]), inReview: n(["PENDING_REVIEW", "IN_PROCESS"]), problems: n(["DISAPPROVED", "WITH_ISSUES"]) },
  };
}

export type OverviewData = Awaited<ReturnType<typeof getOverview>>;
