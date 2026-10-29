import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? "file:./data/app.db";

export default defineConfig({
  dialect: "turso",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  },
});
