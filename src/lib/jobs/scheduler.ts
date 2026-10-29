import "server-only";
import { and, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { adAccounts, jobs } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { enqueue as enqueueJob, PRIORITY, pruneFinished } from "./queue";

const MIN = 60_000;
export const SYNC_INTERVALS = {
  discover: 30 * MIN,
  structure: 15 * MIN,
  review: 10 * MIN,
  insightsRecent: 60 * MIN,
  insightsFull: 24 * 60 * MIN,
};

const g = globalThis as unknown as { __lastSchedule?: number; __lastPrune?: number };
const FAILURE_BACKOFF_MS = 15 * MIN;

const due = (last: number | null, every: number, now: number) => !last || now - last >= every;

/** Enqueues periodic syncs for every connected ad account. Dedupe keys make this safe to call often. */
export async function scheduleRecurring(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - (g.__lastSchedule ?? 0) < 30_000) return;
  g.__lastSchedule = now;

  // Pick up every ad account the token can reach (new ones, renames, status changes).
  if (env().META_ACCESS_TOKEN) {
    const [recent] = await db()
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.type, "accounts.discover"), gt(jobs.createdAt, now - SYNC_INTERVALS.discover)))
      .limit(1);
    if (!recent) await enqueueJob("accounts.discover", {}, { dedupeKey: "accounts:discover", priority: PRIORITY.launch });
  }

  // Back off after a failure (e.g. the token lost access) instead of re-failing every 30 s.
  const failedRecently = new Set(
    (
      await db()
        .select({ key: jobs.dedupeKey })
        .from(jobs)
        .where(and(eq(jobs.status, "failed"), gt(jobs.finishedAt, now - FAILURE_BACKOFF_MS)))
    ).map((r) => r.key),
  );
  // Jobs already queued or running for a key would be deduped anyway; skipping them saves a write per account per tick.
  const active = new Set(
    (
      await db()
        .select({ key: jobs.dedupeKey })
        .from(jobs)
        .where(and(inArray(jobs.status, ["queued", "running"]), isNotNull(jobs.dedupeKey)))
    ).map((r) => r.key),
  );
  const enqueue = (type: Parameters<typeof enqueueJob>[0], payload: Record<string, unknown>, opts: Parameters<typeof enqueueJob>[2]) =>
    opts?.dedupeKey && (failedRecently.has(opts.dedupeKey) || active.has(opts.dedupeKey)) ? Promise.resolve() : enqueueJob(type, payload, opts);

  const accounts = await db().select().from(adAccounts);
  for (const a of accounts) {
    const base = { adAccountId: a.id };
    if (due(a.lastStructureSyncAt, SYNC_INTERVALS.structure, now)) {
      await enqueue("structure.sync", base, { dedupeKey: `structure:${a.id}`, priority: PRIORITY.structure, adAccountId: a.id });
    }
    if (due(a.lastReviewSyncAt, SYNC_INTERVALS.review, now)) {
      await enqueue("review.sync", base, { dedupeKey: `review:${a.id}`, priority: PRIORITY.review, adAccountId: a.id });
    }
    if (!a.insightsBackfilledAt) {
      await enqueue("insights.sync", { ...base, range: "backfill" }, {
        dedupeKey: `insights:${a.id}:backfill`,
        priority: PRIORITY.backfill,
        adAccountId: a.id,
      });
    } else if (due(a.lastFullInsightsSyncAt, SYNC_INTERVALS.insightsFull, now)) {
      await enqueue("insights.sync", { ...base, range: "last_28d" }, {
        dedupeKey: `insights:${a.id}:full`,
        priority: PRIORITY.insightsFull,
        adAccountId: a.id,
      });
    }
    if (due(a.lastInsightsSyncAt, SYNC_INTERVALS.insightsRecent, now)) {
      await enqueue("insights.sync", { ...base, range: "recent" }, {
        dedupeKey: `insights:${a.id}:recent`,
        priority: PRIORITY.insightsRecent,
        adAccountId: a.id,
      });
    }
  }
  // Old finished jobs only need clearing out now and then.
  if (now - (g.__lastPrune ?? 0) > 60 * MIN) {
    g.__lastPrune = now;
    await pruneFinished();
  }
}
