import "server-only";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type DB = LibSQLDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __db?: DB; __dbClient?: Client };

function create(): DB {
  const { DATABASE_URL, DATABASE_AUTH_TOKEN } = env();
  const client = createClient({
    url: DATABASE_URL,
    authToken: DATABASE_AUTH_TOKEN,
    // Busy timeout for local file databases (web server + worker write concurrently).
    timeout: 5000,
  });
  globalForDb.__dbClient = client;
  return drizzle({ client, schema });
}

/** Lazy so importing modules never opens a connection during `next build`. */
export function db(): DB {
  globalForDb.__db ??= create();
  return globalForDb.__db;
}

export { schema };
