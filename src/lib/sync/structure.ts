import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "@/lib/db";
import { adAccounts, ads, adsets, campaigns } from "@/lib/db/schema";
import { graphAll } from "@/lib/meta/client";
import { normalizeFeedback, recordTransitions, type RemoteAdReview } from "./review";

type RemoteCampaign = {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  bid_strategy?: string;
  start_time?: string;
  stop_time?: string;
  created_time?: string;
  updated_time?: string;
};

type RemoteAdset = Omit<RemoteCampaign, "objective" | "bid_strategy" | "stop_time"> & {
  campaign_id: string;
  optimization_goal?: string;
  billing_event?: string;
  promoted_object?: Record<string, unknown>;
  end_time?: string;
};

type RemoteAd = RemoteAdReview & {
  adset_id: string;
  campaign_id: string;
  creative?: { id: string; thumbnail_url?: string };
  created_time?: string;
  updated_time?: string;
};

const int = (v?: string) => (v === undefined || v === "" ? null : Number(v));

/** Upsert in chunks; every column except the primary key is overwritten from `excluded`. */
async function upsertAll<T extends Record<string, unknown>>(table: SQLiteTable, idColumn: unknown, rows: T[]) {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]).filter((k) => k !== "id");
  const set = Object.fromEntries(
    columns.map((k) => {
      const col = (table as unknown as Record<string, { name: string }>)[k];
      return [k, sql.raw(`excluded."${col.name}"`)];
    }),
  );
  for (let i = 0; i < rows.length; i += 200) {
    await db()
      .insert(table)
      .values(rows.slice(i, i + 200) as never)
      .onConflictDoUpdate({ target: idColumn as never, set });
  }
}

/** Mirrors campaigns, ad sets and ads into SQLite so the UI never reads Meta live. */
export async function syncStructure(adAccountId: string): Promise<void> {
  const startedAt = Date.now();
  const opts = { accountId: adAccountId, mode: "background" as const };

  const remoteCampaigns = await graphAll<RemoteCampaign>(`${adAccountId}/campaigns`, {
    ...opts,
    params: {
      fields:
        "id,name,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy,start_time,stop_time,created_time,updated_time",
      limit: 200,
    },
  });
  const remoteAdsets = await graphAll<RemoteAdset>(`${adAccountId}/adsets`, {
    ...opts,
    params: {
      fields:
        "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,promoted_object,start_time,end_time,created_time,updated_time",
      limit: 200,
    },
  });
  const remoteAds = await graphAll<RemoteAd>(`${adAccountId}/ads`, {
    ...opts,
    params: {
      fields:
        "id,name,adset_id,campaign_id,status,effective_status,creative{id,thumbnail_url},ad_review_feedback,issues_info,created_time,updated_time",
      thumbnail_width: 128,
      thumbnail_height: 128,
      limit: 200,
    },
  });

  const before = new Map(
    (
      await db().select({ id: ads.id, s: ads.effectiveStatus }).from(ads).where(eq(ads.adAccountId, adAccountId))
    ).map((r) => [r.id, r.s]),
  );

  await upsertAll(
    campaigns,
    campaigns.id,
    remoteCampaigns.map((c) => ({
      id: c.id,
      adAccountId,
      name: c.name,
      status: c.status,
      effectiveStatus: c.effective_status,
      objective: c.objective ?? null,
      dailyBudget: int(c.daily_budget),
      lifetimeBudget: int(c.lifetime_budget),
      bidStrategy: c.bid_strategy ?? null,
      startTime: c.start_time ?? null,
      stopTime: c.stop_time ?? null,
      createdTime: c.created_time ?? null,
      updatedTime: c.updated_time ?? null,
      syncedAt: startedAt,
    })),
  );
  await upsertAll(
    adsets,
    adsets.id,
    remoteAdsets.map((s) => ({
      id: s.id,
      adAccountId,
      campaignId: s.campaign_id,
      name: s.name,
      status: s.status,
      effectiveStatus: s.effective_status,
      dailyBudget: int(s.daily_budget),
      lifetimeBudget: int(s.lifetime_budget),
      optimizationGoal: s.optimization_goal ?? null,
      billingEvent: s.billing_event ?? null,
      promotedObject: s.promoted_object ?? null,
      startTime: s.start_time ?? null,
      endTime: s.end_time ?? null,
      createdTime: s.created_time ?? null,
      updatedTime: s.updated_time ?? null,
      syncedAt: startedAt,
    })),
  );
  await upsertAll(
    ads,
    ads.id,
    remoteAds.map((a) => ({
      id: a.id,
      adAccountId,
      campaignId: a.campaign_id,
      adsetId: a.adset_id,
      name: a.name,
      status: a.status,
      effectiveStatus: a.effective_status,
      creativeId: a.creative?.id ?? null,
      thumbnailUrl: a.creative?.thumbnail_url ?? null,
      reviewFeedback: normalizeFeedback(a.ad_review_feedback),
      issuesInfo: a.issues_info ?? null,
      createdTime: a.created_time ?? null,
      updatedTime: a.updated_time ?? null,
      syncedAt: startedAt,
    })),
  );

  // Anything not returned was deleted (or archived) in Meta.
  for (const table of [ads, adsets, campaigns] as const) {
    await db()
      .delete(table)
      .where(and(eq(table.adAccountId, adAccountId), lt(table.syncedAt, startedAt)));
  }

  // Only diff once we have a baseline; the first sync shouldn't flood the inbox with history.
  if (before.size > 0) await recordTransitions(adAccountId, before, remoteAds);

  await db().update(adAccounts).set({ lastStructureSyncAt: startedAt }).where(eq(adAccounts.id, adAccountId));
}
