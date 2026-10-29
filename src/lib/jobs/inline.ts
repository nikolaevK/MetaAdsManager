import { runWorker } from "./worker";

const g = globalThis as unknown as { __inlineWorker?: NodeJS.Timeout };

export function startInlineWorker(intervalMs = 15_000): void {
  if (g.__inlineWorker) return;
  let running = false;
  g.__inlineWorker = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runWorker({ budgetMs: intervalMs - 1_000 });
    } catch (err) {
      console.error("[jobs] inline worker tick failed", err);
    } finally {
      running = false;
    }
  }, intervalMs);
  console.log("[jobs] inline worker started");
}
