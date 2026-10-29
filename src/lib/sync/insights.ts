import "server-only";
import { and, between, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { db } from "@/lib/db";
import { adAccounts, adsets, insightsDaily } from "@/lib/db/schema";
import { addDays, todayIn } from "@/lib/dates";
import { EVENT_ACTION_TYPES, pickAction, sumActions, toActionMap, VIDEO_ACTION_KEYS, VIDEO_FIELDS, type ActionList } from "@/lib/meta/actions";
import { graph, graphAll } from "@/lib/meta/client";
import type { HandlerResult } from "@/lib/jobs/types";

export type InsightsRange = "recent" | "last_28d" | "backfill";

export type InsightsPayload = {
  adAccountId: string;
  range: InsightsRange;
  since?: string;
  until?: string;
  reportRunId?: string;
  startedAt?: number;
  restarts?: number;
};

const FIELDS = [
  "ad_id,adset_id,campaign_id,date_start,spend,impressions,clicks,inline_link_clicks,actions,action_values,conversions",
  ...Object.values(VIDEO_FIELDS),
].join(",");
const REPORT_TIMEOUT_MS = 30 * 60_000;

/** "recent" re-pulls 3 days because attribution keeps updating; full refresh covers 28d windows. */
export function rangeDates(range: InsightsRange, timeZone: string, now = new Date()) {
  const today = todayIn(timeZone, now);
  const back = range === "recent" ? 2 : range === "last_28d" ? 27 : 89;
  return { since: addDays(today, -back), until: today };
}

type Row = {
  ad_id: string;
  adset_id: string;
  campaign_id: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: ActionList;
  action_values?: ActionList;
  /** Newer standard events (Schedule, Contact, Subscribe…) are only reported here, as *_total / *_website. */
  conversions?: ActionList;
} & Partial<Record<(typeof VIDEO_FIELDS)[keyof typeof VIDEO_FIELDS], ActionList>>;

/**
 * Async report job: POST /insights → poll report_run_id → page results into insights_daily.
 * Returns retry instructions while Meta is still building the report.
 */
export async function runInsightsJob(p: InsightsPayload): Promise<HandlerResult> {
  const [account] = await db().select().from(adAccounts).where(eq(adAccounts.id, p.adAccountId)).limit(1);
  if (!account) return;
  const opts = { accountId: account.id, mode: "background" as const };

  if (!p.reportRunId) {
    const { since, until } = rangeDates(p.range, account.timezoneName);
    const res = await graph<{ report_run_id: string }>(`${account.id}/insights`, {
      ...opts,
      method: "POST",
      params: {
        level: "ad",
        time_increment: 1,
        time_range: { since, until },
        fields: FIELDS,
        use_unified_attribution_setting: true,
      },
    });
    return { retryInMs: 5_000, payload: { ...p, since, until, reportRunId: res.report_run_id, startedAt: Date.now() } };
  }

  const status = await graph<{ async_status: string; async_percent_completion: number }>(p.reportRunId, {
    ...opts,
    params: { fields: "async_status,async_percent_completion" },
  });

  if (status.async_status === "Job Completed") {
    const rows = await graphAll<Row>(`${p.reportRunId}/insights`, { ...opts, params: { limit: 500 } });
    await ingest(account.id, p.since!, p.until!, rows);
    const now = Date.now();
    await db()
      .update(adAccounts)
      .set({
        lastInsightsSyncAt: now,
        ...(p.range !== "recent" ? { lastFullInsightsSyncAt: now } : {}),
        ...(p.range === "backfill" ? { insightsBackfilledAt: now } : {}),
      })
      .where(eq(adAccounts.id, account.id));
    return;
  }

  const stuck = Date.now() - (p.startedAt ?? 0) > REPORT_TIMEOUT_MS;
  if (status.async_status === "Job Failed" || status.async_status === "Job Skipped" || stuck) {
    const restarts = (p.restarts ?? 0) + 1;
    if (restarts > 3) throw new Error(`Insights report ${p.reportRunId} failed: ${status.async_status}`);
    return { retryInMs: 60_000 * restarts, payload: { ...p, reportRunId: undefined, restarts } };
  }
  return { retryInMs: status.async_percent_completion >= 50 ? 3_000 : 8_000 };
}

async function ingest(adAccountId: string, since: string, until: string, rows: Row[]) {
  // Result definition follows each ad set's optimisation event, like Ads Manager's "Results".
  const events = new Map(
    (
      await db()
        .select({ id: adsets.id, promotedObject: adsets.promotedObject })
        .from(adsets)
        .where(eq(adsets.adAccountId, adAccountId))
    ).map((s) => [s.id, (s.promotedObject?.custom_event_type as string | undefined) ?? null]),
  );
  const now = Date.now();
  const values = rows.map((r) => {
    const actions = { ...toActionMap(r.conversions), ...toActionMap(r.actions) };
    for (const [key, field] of Object.entries(VIDEO_FIELDS) as [keyof typeof VIDEO_FIELDS, (typeof VIDEO_FIELDS)[keyof typeof VIDEO_FIELDS]][]) {
      const total = sumActions(r[field]);
      if (total > 0) actions[VIDEO_ACTION_KEYS[key]] = total;
    }
    const values = toActionMap(r.action_values);
    const linkClicks = Number(r.inline_link_clicks ?? 0);
    const event = events.get(r.adset_id) ?? null;
    const purchases = pickAction(actions, EVENT_ACTION_TYPES.PURCHASE);
    return {
      adId: r.ad_id,
      date: r.date_start,
      adAccountId,
      campaignId: r.campaign_id,
      adsetId: r.adset_id,
      spend: Number(r.spend ?? 0),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      linkClicks,
      results: event ? pickAction(actions, EVENT_ACTION_TYPES[event]) : linkClicks,
      resultType: event ?? "LINK_CLICKS",
      purchases,
      purchaseValue: pickAction(values, EVENT_ACTION_TYPES.PURCHASE),
      leads: pickAction(actions, EVENT_ACTION_TYPES.LEAD),
      actions,
      syncedAt: now,
    };
  });

  // Replace the whole window atomically: ads with no delivery on a day simply have no row.
  const statements: BatchItem<"sqlite">[] = [
    db()
      .delete(insightsDaily)
      .where(and(eq(insightsDaily.adAccountId, adAccountId), between(insightsDaily.date, since, until))),
  ];
  for (let i = 0; i < values.length; i += 200) {
    statements.push(
      db()
        .insert(insightsDaily)
        .values(values.slice(i, i + 200))
        .onConflictDoUpdate({
          target: [insightsDaily.adId, insightsDaily.date],
          set: {
            spend: sql`excluded.spend`,
            impressions: sql`excluded.impressions`,
            clicks: sql`excluded.clicks`,
            linkClicks: sql`excluded.link_clicks`,
            results: sql`excluded.results`,
            resultType: sql`excluded.result_type`,
            purchases: sql`excluded.purchases`,
            purchaseValue: sql`excluded.purchase_value`,
            leads: sql`excluded.leads`,
            actions: sql`excluded.actions`,
            syncedAt: sql`excluded.synced_at`,
          },
        }),
    );
  }
  await db().batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}
