import { count, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { runWorker } from "@/lib/jobs/worker";
import { discoverAccounts } from "@/lib/sync/accounts";

/** Imports every ad account the Meta token can access, then runs the first syncs: `npm run accounts:sync`. */
const { added, updated } = await discoverAccounts();
console.log(`Ad accounts: ${added.length} added, ${updated} updated.`);

const deadline = Date.now() + 10 * 60_000;
while (Date.now() < deadline) {
  const { processed } = await runWorker({ budgetMs: 30_000 });
  const [{ n }] = await db()
    .select({ n: count() })
    .from(jobs)
    .where(inArray(jobs.status, ["queued", "running"]));
  console.log(`Processed ${processed} job(s); ${n} still queued (insights reports can take a few minutes).`);
  if (n === 0) break;
  if (processed === 0) await new Promise((r) => setTimeout(r, 5_000));
}
process.exit(0);
