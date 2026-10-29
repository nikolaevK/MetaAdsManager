import { mkdirSync } from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

const url = env().DATABASE_URL;
if (url.startsWith("file:")) {
  mkdirSync(path.dirname(path.resolve(url.slice("file:".length))), { recursive: true });
}

await migrate(db(), { migrationsFolder: "drizzle" });
if (url.startsWith("file:")) {
  // WAL lets the web server read while the worker writes. Persistent per database file.
  await db().run("PRAGMA journal_mode = WAL");
}
console.log(`Migrations applied to ${url.startsWith("file:") ? url : url.replace(/\/\/.*@/, "//***@")}`);
