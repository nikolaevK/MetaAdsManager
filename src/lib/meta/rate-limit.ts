import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { rateLimitState } from "@/lib/db/schema";
import { RateLimitedError } from "./errors";
import type { ParsedUsage, UsageReading } from "./usage-headers";

/** Background work (sync, launches) yields above this usage so interactive edits keep headroom. */
const BACKGROUND_DEFER_PCT = 85;
/** Between this and the defer threshold, background calls are paced with a short sleep. */
const BACKGROUND_SLOW_PCT = 65;
const DEFER_MS = 60_000;
/** Re-read DB state (written by other processes) at most this often per key. */
const DB_REFRESH_MS = 5_000;
/** Persist at most this often unless something material changed. */
const PERSIST_EVERY_MS = 15_000;

type State = { pct: number; blockedUntil: number | null; updatedAt: number; persistedAt: number; checkedAt: number };

const g = globalThis as unknown as { __metaUsage?: Map<string, State> };
const memory = (g.__metaUsage ??= new Map());

export const bucketKeys = (accountId?: string) => (accountId ? ["app", `account:${accountId}`] : ["app"]);

export type CallMode = "interactive" | "background";

async function load(keys: string[]): Promise<void> {
  const now = Date.now();
  const stale = keys.filter((k) => now - (memory.get(k)?.checkedAt ?? 0) > DB_REFRESH_MS);
  if (stale.length === 0) return;
  const rows = await db().select().from(rateLimitState).where(inArray(rateLimitState.key, stale));
  for (const key of stale) {
    const row = rows.find((r) => r.key === key);
    const mem = memory.get(key);
    if (row && (!mem || row.updatedAt > mem.updatedAt)) {
      memory.set(key, {
        pct: row.usagePct,
        blockedUntil: row.blockedUntil,
        updatedAt: row.updatedAt,
        persistedAt: row.updatedAt,
        checkedAt: now,
      });
    } else if (mem) {
      mem.checkedAt = now;
    } else {
      memory.set(key, { pct: 0, blockedUntil: null, updatedAt: 0, persistedAt: 0, checkedAt: now });
    }
  }
}

/**
 * Called before every Meta request. Throws RateLimitedError when the bucket is blocked
 * (or, for background work, nearly exhausted) so the job queue can reschedule instead of hammering.
 */
export async function gate(accountId: string | undefined, mode: CallMode): Promise<void> {
  const keys = bucketKeys(accountId);
  await load(keys);
  const now = Date.now();
  let slowFor = 0;
  for (const key of keys) {
    const s = memory.get(key);
    if (!s) continue;
    if (s.blockedUntil && s.blockedUntil > now) throw new RateLimitedError(s.blockedUntil, key);
    // Usage decays over Meta's rolling 1h window; stale readings older than 5 min are not trusted.
    if (mode === "background" && now - s.updatedAt < 5 * 60_000) {
      if (s.pct >= BACKGROUND_DEFER_PCT) throw new RateLimitedError(now + DEFER_MS, key);
      if (s.pct >= BACKGROUND_SLOW_PCT) slowFor = Math.max(slowFor, (s.pct - BACKGROUND_SLOW_PCT) * 150);
    }
  }
  if (slowFor > 0) await new Promise((r) => setTimeout(r, slowFor));
}

async function write(key: string, reading: UsageReading, raw?: string) {
  const now = Date.now();
  const prev = memory.get(key);
  const blockedUntil = reading.regainAt && reading.regainAt > now ? reading.regainAt : null;
  const next: State = {
    pct: reading.pct,
    blockedUntil,
    updatedAt: now,
    persistedAt: prev?.persistedAt ?? 0,
    checkedAt: now,
  };
  const material =
    !prev ||
    Math.abs(prev.pct - reading.pct) >= 5 ||
    (prev.blockedUntil ?? 0) !== (blockedUntil ?? 0) ||
    now - prev.persistedAt > PERSIST_EVERY_MS;
  memory.set(key, next);
  if (!material) return;
  next.persistedAt = now;
  const values = { key, usagePct: reading.pct, blockedUntil, raw: raw ?? null, updatedAt: now };
  await db().insert(rateLimitState).values(values).onConflictDoUpdate({ target: rateLimitState.key, set: values });
}

export async function recordUsage(accountId: string | undefined, usage: ParsedUsage, raw?: string): Promise<void> {
  if (usage.app) await write("app", usage.app, raw);
  if (usage.account && accountId) await write(`account:${accountId}`, usage.account, raw);
}

/** When Meta returns a throttling error, block the bucket even if headers were missing. */
export async function recordThrottle(accountId: string | undefined, retryAfterMs: number): Promise<void> {
  const key = accountId ? `account:${accountId}` : "app";
  await write(key, { pct: 100, regainAt: Date.now() + retryAfterMs });
}

export async function clearBlock(key: string): Promise<void> {
  memory.delete(key);
  await db().update(rateLimitState).set({ blockedUntil: null, updatedAt: Date.now() }).where(eq(rateLimitState.key, key));
}
