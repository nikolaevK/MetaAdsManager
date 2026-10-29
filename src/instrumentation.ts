/** With INLINE_WORKER=true the Next server also runs the job worker (handy for local dev / single box). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.INLINE_WORKER === "true") {
    const { startInlineWorker } = await import("./lib/jobs/inline");
    startInlineWorker();
  }
}
