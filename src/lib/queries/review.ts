import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { adAccounts, ads, reviewEvents, type IssueInfo, type ReviewFeedback } from "@/lib/db/schema";

export const SNAPSHOT_STATUSES = ["DISAPPROVED", "WITH_ISSUES", "PENDING_REVIEW", "IN_PROCESS"];

export type Reason = { scope: string; title: string; detail: string };

const SCOPE_LABEL: Record<string, string> = {
  global: "All placements",
  facebook: "Facebook",
  instagram: "Instagram",
  audience_network: "Audience Network",
  messenger: "Messenger",
};

/** Flattens Meta's review feedback ({ global|placement: { reason: text } }) and issues_info. */
export function reasonsOf(feedback: ReviewFeedback, issues: IssueInfo): Reason[] {
  const out: Reason[] = [];
  for (const [scope, reasons] of Object.entries(feedback ?? {})) {
    for (const [title, detail] of Object.entries(reasons ?? {})) {
      out.push({ scope: SCOPE_LABEL[scope] ?? scope.replaceAll("_", " "), title: title.replaceAll("_", " "), detail });
    }
  }
  for (const issue of issues ?? []) {
    const title = issue.error_summary ?? (issue.error_code ? `Error ${issue.error_code}` : "Issue");
    out.push({ scope: issue.level ? issue.level.toLowerCase() : "Delivery", title, detail: issue.error_message ?? "" });
  }
  return out;
}

export async function getReviewData(accountId: string | null, allAccounts: boolean) {
  const scope = !allAccounts && accountId ? eq(reviewEvents.adAccountId, accountId) : undefined;
  const eventFields = {
    id: reviewEvents.id,
    adId: reviewEvents.adId,
    adName: reviewEvents.adName,
    adAccountId: reviewEvents.adAccountId,
    accountName: adAccounts.name,
    fromStatus: reviewEvents.fromStatus,
    toStatus: reviewEvents.toStatus,
    feedback: reviewEvents.feedback,
    issues: reviewEvents.issues,
    createdAt: reviewEvents.createdAt,
    acknowledgedAt: reviewEvents.acknowledgedAt,
    thumbnailUrl: ads.thumbnailUrl,
  };

  const [open, history, snapshot] = await Promise.all([
    db()
      .select(eventFields)
      .from(reviewEvents)
      .leftJoin(adAccounts, eq(adAccounts.id, reviewEvents.adAccountId))
      .leftJoin(ads, eq(ads.id, reviewEvents.adId))
      .where(and(isNull(reviewEvents.acknowledgedAt), scope))
      .orderBy(desc(reviewEvents.createdAt))
      .limit(500),
    db()
      .select(eventFields)
      .from(reviewEvents)
      .leftJoin(adAccounts, eq(adAccounts.id, reviewEvents.adAccountId))
      .leftJoin(ads, eq(ads.id, reviewEvents.adId))
      .where(and(isNotNull(reviewEvents.acknowledgedAt), scope))
      .orderBy(desc(reviewEvents.createdAt))
      .limit(50),
    accountId
      ? db()
          .select({
            id: ads.id,
            name: ads.name,
            effectiveStatus: ads.effectiveStatus,
            thumbnailUrl: ads.thumbnailUrl,
            reviewFeedback: ads.reviewFeedback,
            issuesInfo: ads.issuesInfo,
            updatedTime: ads.updatedTime,
          })
          .from(ads)
          .where(and(eq(ads.adAccountId, accountId), inArray(ads.effectiveStatus, SNAPSHOT_STATUSES)))
          .orderBy(ads.effectiveStatus, ads.name)
          .limit(500)
      : Promise.resolve([]),
  ]);

  return { open, history, snapshot };
}
