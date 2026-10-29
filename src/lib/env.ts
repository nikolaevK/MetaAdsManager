import "server-only";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1).default("file:./data/app.db"),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  META_ACCESS_TOKEN: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_APP_ID: z.string().optional(),
  META_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v26.0"),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  /** Point the Graph client at a mock server (local testing only). Unset = graph.facebook.com. */
  META_GRAPH_BASE_URL: z.url().optional(),
  APP_URL: z.url().default("http://localhost:3000"),
  CRON_SECRET: z.string().optional(),
  STORAGE_DIR: z.string().default("./storage"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/**
 * Parsed lazily so `next build` never needs runtime secrets. Re-parsed in development because
 * `next dev` reloads .env.local in place (e.g. after adding the Meta token).
 */
export function env(): Env {
  if (!cached || process.env.NODE_ENV === "development") {
    const blankToUndefined = Object.fromEntries(
      Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v]),
    );
    cached = schema.parse(blankToUndefined);
  }
  return cached;
}

/** Missing/invalid server configuration; the message is safe to show to signed-in users. */
export class ConfigError extends Error {}

export function requireMetaToken(): string {
  const token = env().META_ACCESS_TOKEN;
  if (!token) throw new ConfigError("META_ACCESS_TOKEN is not configured. Add it to .env.local and restart.");
  return token;
}
