/** With INLINE_WORKER=true the Next server also runs the job worker (handy for local dev / single box). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Not awaited: a slow or unreachable database must not hold up server start. Skipped while building.
  if (process.env.NEXT_PHASE !== "phase-production-build") void warnAboutPendingMigrations();
  if (process.env.INLINE_WORKER === "true") {
    const { startInlineWorker } = await import("./lib/jobs/inline");
    startInlineWorker();
  }
}

async function warnAboutPendingMigrations() {
  try {
    const { pendingMigrations } = await import("./lib/db/migrations");
    const pending = await pendingMigrations();
    if (pending.length) {
      console.warn(
        `\n⚠ The database is missing ${pending.length} migration(s): ${pending.join(", ")}.\n  Run \`npm run db:migrate\`; pages that use the new tables fail until then.\n`,
      );
    }
  } catch (err) {
    console.warn("[db] Couldn't check for pending migrations:", err instanceof Error ? err.message : err);
  }
}
