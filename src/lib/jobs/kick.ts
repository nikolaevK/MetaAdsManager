import "server-only";
import { after } from "next/server";
import { runWorker } from "./worker";

const g = globalThis as unknown as { __kick?: { running: boolean; again: boolean } };
const state = (g.__kick ??= { running: false, again: false });

/**
 * Starts processing right after the response is sent, so users don't wait for the next cron tick. One kicked
 * worker per process: kicks that arrive while it runs just ask it to look for new jobs once more before stopping.
 */
export function kickWorker(): void {
  after(async () => {
    if (state.running) {
      state.again = true;
      return;
    }
    state.running = true;
    try {
      do {
        state.again = false;
        await runWorker({ budgetMs: 240_000 });
      } while (state.again);
    } catch (err) {
      console.error("[jobs] kicked worker failed", err);
    } finally {
      state.running = false;
    }
  });
}
