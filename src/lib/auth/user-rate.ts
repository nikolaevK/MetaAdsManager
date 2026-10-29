import "server-only";
import { UserError } from "@/lib/action-result";

const WINDOW_MS = 60_000;
const g = globalThis as unknown as { __userCalls?: Map<string, number[]> };
const calls: Map<string, number[]> = (g.__userCalls ??= new Map());

/**
 * Every user shares one Meta token, so one person (or a stuck script) hammering live reads could exhaust its rate
 * limit for everybody and stall syncs and launches. Caps a user's live Meta lookups per minute (per process).
 */
export function takeMetaQuota(userId: string, perMinute = 90): void {
  const now = Date.now();
  const recent = (calls.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= perMinute) throw new UserError("That's a lot of requests to Meta in a short time. Wait a minute and try again.");
  recent.push(now);
  calls.set(userId, recent);
  if (calls.size > 1_000) calls.delete(calls.keys().next().value!);
}
