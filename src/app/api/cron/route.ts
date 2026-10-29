import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { runWorker } from "@/lib/jobs/worker";

/**
 * Scheduler + worker tick. Call every minute from Vercel Cron, a system crontab, or any scheduler:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron
 */
async function handle(request: Request): Promise<Response> {
  const secret = env().CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });

  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runWorker({ budgetMs: 50_000 });
  return Response.json(result);
}

export const GET = handle;
export const POST = handle;
