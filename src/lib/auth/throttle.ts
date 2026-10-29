import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { loginAttempts } from "@/lib/db/schema";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

/** Returns ms until the key is unlocked, or 0 if login may be attempted. */
export async function lockedFor(key: string): Promise<number> {
  const [row] = await db().select().from(loginAttempts).where(eq(loginAttempts.key, key)).limit(1);
  if (!row?.lockedUntil) return 0;
  return Math.max(0, row.lockedUntil - Date.now());
}

export async function recordFailure(key: string): Promise<void> {
  const now = Date.now();
  const [row] = await db().select().from(loginAttempts).where(eq(loginAttempts.key, key)).limit(1);
  const fresh = !row || now - row.firstAt > WINDOW_MS;
  const count = fresh ? 1 : row.count + 1;
  const values = {
    key,
    count,
    firstAt: fresh ? now : row.firstAt,
    lockedUntil: count >= MAX_FAILURES ? now + LOCK_MS : null,
  };
  await db().insert(loginAttempts).values(values).onConflictDoUpdate({ target: loginAttempts.key, set: values });
}

export async function clearFailures(key: string): Promise<void> {
  await db().delete(loginAttempts).where(eq(loginAttempts.key, key));
}
