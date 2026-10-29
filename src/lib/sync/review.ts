import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { adAccounts, ads, reviewEvents, type IssueInfo, type ReviewFeedback } from "@/lib/db/schema";
import { graphAll, graphBatch } from "@/lib/meta/client";

export const IN_REVIEW = ["PENDING_REVIEW", "IN_PROCESS"];
export const PROBLEM = ["DISAPPROVED", "WITH_ISSUES"];
const WATCHED = [...IN_REVIEW, ...PROBLEM, "PREAPPROVED"];

export const AD_REVIEW_FIELDS = "id,name,status,effective_status,ad_review_feedback,issues_info";

export type RemoteAdReview = {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  ad_review_feedback?: { global?: Record<string, string>; placement_specific?: Record<string, Record<string, string>> };
  issues_info?: IssueInfo;
};

export function normalizeFeedback(f: RemoteAdReview["ad_review_feedback"]): ReviewFeedback {
  if (!f) return null;
  const out: Record<string, Record<string, string>> = {};
  if (f.global) out.global = f.global;
  for (const [placement, reasons] of Object.entries(f.placement_specific ?? {})) out[placement] = reasons;
  return Object.keys(out).length ? out : null;
}

/** Records an inbox event when an ad gets rejected/flagged, or clears review. */
export async function recordTransitions(
  adAccountId: string,
  before: Map<string, string>,
  after: RemoteAdReview[],
): Promise<number> {
  const events = after.flatMap((ad) => {
    const prev = before.get(ad.id);
    const next = ad.effective_status;
    if (prev === next) return [];
    const rejected = PROBLEM.includes(next);
    const approved = prev !== undefined && IN_REVIEW.includes(prev) && next === "ACTIVE";
    if (!rejected && !approved) return [];
    return [
      {
        adId: ad.id,
        adAccountId,
        adName: ad.name,
        fromStatus: prev ?? null,
        toStatus: next,
        feedback: normalizeFeedback(ad.ad_review_feedback),
        issues: ad.issues_info ?? null,
        // Approvals are informational; only rejections need someone to act.
        acknowledgedAt: approved ? Date.now() : null,
      },
    ];
  });
  if (events.length) await db().insert(reviewEvents).values(events).onConflictDoNothing();
  return events.length;
}

/**
 * Polls ads in review or with problems. Ads we last saw in review but which no longer match the
 * filter have changed state, so they are re-fetched by id to learn the outcome.
 */
export async function syncReview(adAccountId: string): Promise<void> {
  // Without a first structure sync there's no baseline: every historical rejection would look new
  // and flood the inbox. The scheduler retries on its next tick, after structure has synced.
  const [account] = await db()
    .select({ lastStructureSyncAt: adAccounts.lastStructureSyncAt })
    .from(adAccounts)
    .where(eq(adAccounts.id, adAccountId))
    .limit(1);
  if (!account?.lastStructureSyncAt) return;

  const remote = await graphAll<RemoteAdReview>(`${adAccountId}/ads`, {
    params: {
      fields: AD_REVIEW_FIELDS,
      filtering: [{ field: "effective_status", operator: "IN", value: WATCHED }],
      limit: 200,
    },
    accountId: adAccountId,
    mode: "background",
  });

  const local = await db()
    .select({ id: ads.id, effectiveStatus: ads.effectiveStatus })
    .from(ads)
    .where(and(eq(ads.adAccountId, adAccountId), inArray(ads.effectiveStatus, WATCHED)));
  const remoteIds = new Set(remote.map((r) => r.id));
  const changed = local.filter((a) => !remoteIds.has(a.id)).map((a) => a.id);

  // Graph v26 removed `GET /?ids=`, so each ad is looked up on its own inside a batch.
  const lookups = await graphBatch<RemoteAdReview>(
    changed.map((id) => ({ method: "GET", relativeUrl: `${id}?fields=${AD_REVIEW_FIELDS}` })),
    { accountId: adAccountId, mode: "background" },
  );
  for (const r of lookups) {
    if (r.ok) remote.push(r.data);
    // A deleted ad fails its own lookup; structure sync will remove it.
    else if (r.error.isTransient) throw r.error;
  }

  const ids = remote.map((r) => r.id);
  const before = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db()
      .select({ id: ads.id, effectiveStatus: ads.effectiveStatus })
      .from(ads)
      .where(inArray(ads.id, ids.slice(i, i + 500)));
    for (const r of rows) before.set(r.id, r.effectiveStatus);
  }

  await recordTransitions(adAccountId, before, remote);

  const now = Date.now();
  for (const ad of remote) {
    if (!before.has(ad.id)) continue; // new ads arrive with the next structure sync
    await db()
      .update(ads)
      .set({
        status: ad.status,
        effectiveStatus: ad.effective_status,
        reviewFeedback: normalizeFeedback(ad.ad_review_feedback),
        issuesInfo: ad.issues_info ?? null,
        syncedAt: now,
      })
      .where(eq(ads.id, ad.id));
  }
  await db().update(adAccounts).set({ lastReviewSyncAt: now }).where(eq(adAccounts.id, adAccountId));
}
