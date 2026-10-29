import "server-only";
import { hostname } from "node:os";
import { activateLaunch, buildLaunch, failActivation, failBuild, failRollback, rollbackLaunch } from "@/lib/launch/pipeline";
import { errorMessage, isTransient, MetaApiError, RateLimitedError } from "@/lib/meta/errors";
import { discoverAccounts } from "@/lib/sync/accounts";
import { runInsightsJob, type InsightsPayload } from "@/lib/sync/insights";
import { syncReview } from "@/lib/sync/review";
import { syncStructure } from "@/lib/sync/structure";
import type { LaunchStatus } from "@/lib/db/schema";
import { claimNext, complete, fail, reapStale, reschedule, type Job, type JobType } from "./queue";
import { scheduleRecurring } from "./scheduler";
import type { HandlerResult } from "./types";

type Payload = Record<string, unknown>;
type Handler = {
  run: (payload: Payload) => Promise<HandlerResult>;
  /** Runs once attempts are exhausted or the error is permanent. */
  onFinalFailure?: (payload: Payload, err: unknown) => Promise<void>;
};

const HANDLERS: Record<JobType, Handler> = {
  "accounts.discover": { run: async () => void (await discoverAccounts()) },
  "structure.sync": { run: (p) => syncStructure(p.adAccountId as string) },
  "insights.sync": { run: (p) => runInsightsJob(p as InsightsPayload) },
  "review.sync": { run: (p) => syncReview(p.adAccountId as string) },
  "launch.build": {
    run: (p) => buildLaunch(p.launchId as string),
    onFinalFailure: (p, err) => failBuild(p.launchId as string, err),
  },
  "launch.activate": {
    run: (p) => activateLaunch(p.launchId as string),
    onFinalFailure: (p, err) => failActivation(p.launchId as string, err),
  },
  "launch.rollback": {
    run: (p) => rollbackLaunch(p.launchId as string, p.finalStatus as LaunchStatus),
    onFinalFailure: (p, err) => failRollback(p.launchId as string, err),
  },
};

function backoffMs(attempt: number): number {
  const base = Math.min(30 * 60_000, 15_000 * 2 ** (attempt - 1));
  return base + Math.floor(Math.random() * base * 0.2);
}

async function execute(job: Job): Promise<void> {
  const handler = HANDLERS[job.type as JobType];
  if (!handler) return fail(job, `Unknown job type ${job.type}`);
  try {
    const result = await handler.run(job.payload);
    if (result) {
      await reschedule(job, Date.now() + result.retryInMs, { payload: result.payload, countAttempt: false, note: result.note });
    } else {
      await complete(job);
    }
  } catch (err) {
    // Our own throttle gate: wait it out without burning an attempt.
    if (err instanceof RateLimitedError) {
      return reschedule(job, err.retryAt, { countAttempt: false, note: err.message });
    }
    const attempt = job.attempts + 1;
    if (isTransient(err) && attempt < job.maxAttempts) {
      const metaWait = err instanceof MetaApiError ? (err.retryAfterMs ?? 0) : 0;
      return reschedule(job, Date.now() + Math.max(backoffMs(attempt), metaWait), {
        countAttempt: true,
        note: errorMessage(err),
      });
    }
    console.error(`[jobs] ${job.type} ${job.id} failed permanently:`, err);
    await fail(job, errorMessage(err));
    await handler.onFinalFailure?.(job.payload, err);
  }
}

/**
 * Processes due jobs until the queue is empty or the time budget is spent.
 * Invoked by /api/cron, `npm run worker`, and after user actions that enqueue work.
 */
export async function runWorker(opts: { budgetMs?: number; concurrency?: number } = {}): Promise<{ processed: number }> {
  const workerId = `${hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
  const deadline = Date.now() + (opts.budgetMs ?? 50_000);
  await reapStale();
  await scheduleRecurring();
  let processed = 0;
  const lane = async () => {
    while (Date.now() < deadline) {
      const job = await claimNext(workerId);
      if (!job) return;
      await execute(job);
      processed++;
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 3 }, lane));
  return { processed };
}
