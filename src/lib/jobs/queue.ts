import "server-only";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";

export type Job = typeof jobs.$inferSelect;

export const JOB_TYPES = [
  "accounts.discover",
  "structure.sync",
  "insights.sync",
  "review.sync",
  "launch.build",
  "launch.activate",
  "launch.rollback",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** Lower runs first. */
export const PRIORITY = { launch: 1, review: 2, structure: 4, insightsRecent: 5, insightsFull: 6, backfill: 7 } as const;

export type EnqueueOptions = {
  runAt?: number;
  /** At most one queued/running job per key (enforced by a partial unique index). */
  dedupeKey?: string;
  priority?: number;
  adAccountId?: string;
  maxAttempts?: number;
};

/** Returns false when an identical job (same dedupe key) is already queued or running. */
export async function enqueue(type: JobType, payload: Record<string, unknown>, opts: EnqueueOptions = {}): Promise<boolean> {
  const rows = await db()
    .insert(jobs)
    .values({
      type,
      payload,
      runAt: opts.runAt ?? Date.now(),
      dedupeKey: opts.dedupeKey,
      priority: opts.priority ?? 5,
      adAccountId: opts.adAccountId,
      maxAttempts: opts.maxAttempts ?? 6,
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id });
  return rows.length > 0;
}

/** Atomically claims the next due job (single UPDATE … RETURNING, safe across processes). */
export async function claimNext(workerId: string): Promise<Job | null> {
  const now = Date.now();
  const [job] = await db()
    .update(jobs)
    .set({ status: "running", lockedAt: now, lockedBy: workerId })
    .where(
      and(
        eq(jobs.status, "queued"),
        eq(
          jobs.id,
          sql`(select ${jobs.id} from ${jobs} where ${jobs.status} = 'queued' and ${jobs.runAt} <= ${now}
               order by ${jobs.priority} asc, ${jobs.runAt} asc limit 1)`,
        ),
      ),
    )
    .returning();
  return job ?? null;
}

/** Only the worker that holds the lock may finish a job (a reaped job may already run elsewhere). */
const owned = (job: Job) => and(eq(jobs.id, job.id), job.lockedBy ? eq(jobs.lockedBy, job.lockedBy) : undefined);

export async function complete(job: Job): Promise<void> {
  await db()
    .update(jobs)
    .set({ status: "succeeded", finishedAt: Date.now(), lockedAt: null, lockedBy: null, lastError: null })
    .where(owned(job));
}

export async function reschedule(
  job: Job,
  runAt: number,
  opts: { payload?: Record<string, unknown>; countAttempt: boolean; note?: string },
): Promise<void> {
  await db()
    .update(jobs)
    .set({
      status: "queued",
      runAt,
      lockedAt: null,
      lockedBy: null,
      attempts: opts.countAttempt ? job.attempts + 1 : job.attempts,
      payload: opts.payload ?? job.payload,
      lastError: opts.note ?? job.lastError,
    })
    .where(owned(job));
}

export async function fail(job: Job, error: string): Promise<void> {
  await db()
    .update(jobs)
    .set({ status: "failed", attempts: job.attempts + 1, finishedAt: Date.now(), lockedAt: null, lockedBy: null, lastError: error })
    .where(owned(job));
}

/** Jobs whose worker died mid-run go back to the queue. */
export async function reapStale(maxRunMs = 30 * 60_000): Promise<void> {
  await db()
    .update(jobs)
    .set({ status: "queued", lockedAt: null, lockedBy: null })
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, Date.now() - maxRunMs)));
}

export async function pruneFinished(olderThanMs = 14 * 86_400_000): Promise<void> {
  await db()
    .delete(jobs)
    .where(and(inArray(jobs.status, ["succeeded", "failed"]), lt(jobs.finishedAt, Date.now() - olderThanMs)));
}
