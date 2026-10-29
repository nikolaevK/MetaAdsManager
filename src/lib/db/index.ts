import "server-only";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type DB = LibSQLDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __db?: DB; __dbClient?: Client };

/** A request to a remote database (Turso) that hasn't answered by then fails instead of hanging the page or worker. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Failures before the request reached the server: safe to try once more, even for writes. */
const CONNECT_ERRORS = new Set(["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND"]);

async function remoteFetch(request: Request): Promise<Response> {
  const spare = request.clone();
  try {
    return await fetch(request, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    const code = (err as { cause?: { code?: string } }).cause?.code;
    if (!code || !CONNECT_ERRORS.has(code)) throw err;
    await new Promise((r) => setTimeout(r, 500));
    return fetch(spare, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  }
}

function create(): DB {
  const { DATABASE_URL, DATABASE_AUTH_TOKEN } = env();
  const client = createClient({
    url: DATABASE_URL,
    authToken: DATABASE_AUTH_TOKEN,
    // Busy timeout for local file databases (web server + worker write concurrently).
    timeout: 5000,
    // Remote (HTTP) databases: request timeout + one retry when the connection couldn't be opened.
    fetch: remoteFetch,
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
