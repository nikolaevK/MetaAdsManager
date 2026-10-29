"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { failure, UserError, type ActionState } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { runWorker } from "@/lib/jobs/worker";

export async function retryJob(input: { id: string }): Promise<ActionState> {
  try {
    const user = await requireUser("admin");
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(input);
    try {
      const res = await db()
        .update(jobs)
        .set({ status: "queued", attempts: 0, runAt: Date.now(), finishedAt: null, lockedAt: null, lockedBy: null })
        .where(and(eq(jobs.id, id), eq(jobs.status, "failed")))
        .returning({ type: jobs.type });
      if (!res.length) throw new UserError("Only failed jobs can be retried.");
      await audit(user.id, "job.retry", { type: "job", id }, { jobType: res[0].type });
    } catch (err) {
      // Partial unique index: another job with the same dedupe key is already queued or running.
      if (err instanceof Error && /UNIQUE constraint failed/i.test(`${err.message} ${String(err.cause ?? "")}`)) {
        throw new UserError("An identical job is already queued or running.");
      }
      throw err;
    }
    refresh();
    return { ok: true, message: "Job re-queued" };
  } catch (err) {
    return failure(err);
  }
}

export async function runWorkerNow(): Promise<ActionState> {
  try {
    const user = await requireUser("admin");
    const { processed } = await runWorker({ budgetMs: 45_000 });
    await audit(user.id, "jobs.run_worker", undefined, { processed });
    refresh();
    return { ok: true, message: processed ? `Processed ${processed} job${processed === 1 ? "" : "s"}` : "No jobs were due" };
  } catch (err) {
    return failure(err);
  }
}
