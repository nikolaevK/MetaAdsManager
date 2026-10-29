import "server-only";
import { after } from "next/server";
import { runWorker } from "./worker";

/** Starts processing right after the response is sent, so users don't wait for the next cron tick. */
export function kickWorker(): void {
  after(async () => {
    try {
      await runWorker({ budgetMs: 240_000 });
    } catch (err) {
      console.error("[jobs] kicked worker failed", err);
    }
  });
}
