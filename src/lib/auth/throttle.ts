import "server-only";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { loginAttempts } from "@/lib/db/schema";

const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

/**
 * Counts a sign-in attempt against each key before the password is checked, with one atomic upsert per key, so
 * parallel attempts can't all read "not locked yet". Returns ms until every key allows another attempt (0 = go).
 * A successful sign-in clears its keys with clearFailures.
 */
export async function reserveAttempt(limits: { key: string; max: number }[]): Promise<number> {
  const now = Date.now();
  const expired = now - WINDOW_MS;
  let wait = 0;
  for (const { key, max } of limits) {
    const [row] = await db()
      .insert(loginAttempts)
      .values({ key, count: 1, firstAt: now, lockedUntil: null })
      .onConflictDoUpdate({
        target: loginAttempts.key,
        set: {
          count: sql`case when ${loginAttempts.firstAt} < ${expired} then 1 else ${loginAttempts.count} + 1 end`,
          firstAt: sql`case when ${loginAttempts.firstAt} < ${expired} then ${now} else ${loginAttempts.firstAt} end`,
        },
      })
      .returning();
    if (row.lockedUntil && row.lockedUntil > now) wait = Math.max(wait, row.lockedUntil - now);
    else if (row.count > max) {
      await db().update(loginAttempts).set({ lockedUntil: now + LOCK_MS }).where(inArray(loginAttempts.key, [key]));
      wait = Math.max(wait, LOCK_MS);
    }
  }
  return wait;
}

export async function clearFailures(keys: string[]): Promise<void> {
  await db().delete(loginAttempts).where(inArray(loginAttempts.key, keys));
}
