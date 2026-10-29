import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { pendingMigrations } from "@/lib/db/migrations";

/**
 * Lets the error screen tell "the database needs `npm run db:migrate`" or "the database is unreachable" apart
 * from other failures. Unauthenticated on purpose (the session check itself needs the database), so it
 * returns counts only.
 */
export async function GET(): Promise<Response> {
  await connection();
  const headers = { "cache-control": "no-store" };
  try {
    await db().run(sql`select 1`);
    const pending = await pendingMigrations();
    return Response.json({ database: "ok", pendingMigrations: pending.length }, { headers });
  } catch {
    return Response.json({ database: "unreachable", pendingMigrations: 0 }, { status: 503, headers });
  }
}
