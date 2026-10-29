import { runWorker } from "@/lib/jobs/worker";

/** Long-running job worker for self-hosted deployments: `npm run worker`. */

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[worker] ${sig} received, finishing current jobs…`);
    stopping = true;
  });
}

console.log("[worker] started");
while (!stopping) {
  try {
    const { processed } = await runWorker({ budgetMs: 30_000 });
    if (processed > 0) console.log(`[worker] processed ${processed} job(s)`);
    else await new Promise((r) => setTimeout(r, 5_000));
  } catch (err) {
    console.error("[worker] tick failed", err);
    await new Promise((r) => setTimeout(r, 10_000));
  }
}
console.log("[worker] stopped");
process.exit(0);
