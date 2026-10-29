import "server-only";
import { sql } from "drizzle-orm";
import journal from "../../../drizzle/meta/_journal.json";
import { db } from "./index";

const g = globalThis as unknown as { __schemaOk?: boolean };

/**
 * Migrations in drizzle/ the database hasn't applied yet, by the rule drizzle's migrator uses (a migration is
 * applied once a row with a later-or-equal created_at exists). Remembered once clean, so it costs one query per process.
 */
export async function pendingMigrations(): Promise<string[]> {
  if (g.__schemaOk) return [];
  let last = 0;
  try {
    const [row] = await db().values<[number | null]>(sql`select max(created_at) from __drizzle_migrations`);
    last = Number(row?.[0] ?? 0);
  } catch (err) {
    // No migrations table yet means nothing was applied; anything else (e.g. the database is unreachable) is a real error.
    if (!/no such table/i.test(chainText(err))) throw err;
  }
  const pending = journal.entries.filter((e) => e.when > last).map((e) => e.tag);
  g.__schemaOk = pending.length === 0;
  return pending;
}

/** Every message in an error's cause chain (Drizzle wraps the driver error). */
export function chainText(err: unknown): string {
  const out: string[] = [];
  for (let e = err, depth = 0; e && depth < 6; e = (e as { cause?: unknown }).cause, depth++) out.push(e instanceof Error ? e.message : String(e));
  return out.join(" | ");
}

/** A query failed because the schema is older than the code (a migration wasn't run). */
export const isSchemaError = (err: unknown) => /no such (table|column)|has no column named/i.test(chainText(err));
