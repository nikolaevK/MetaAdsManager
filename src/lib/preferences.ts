import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { cleanColumns, DEFAULT_PRESET } from "@/lib/columns";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/db/schema";
import { METRIC_BY_KEY } from "@/lib/metrics";

const keys = z.array(z.string().max(40)).max(60);

export const columnPrefsSchema = z.object({
  columns: keys,
  sets: z
    .array(z.object({ id: z.string().min(1).max(40), name: z.string().trim().min(1).max(60), columns: keys }))
    .max(20)
    .default([]),
});
export type ColumnPrefs = z.infer<typeof columnPrefsSchema>;

export const overviewPrefsSchema = z.object({
  kpis: z.array(z.string().max(40)).min(1).max(12),
  chart: z.array(z.string().max(40)).min(1).max(2),
});
export type OverviewPrefs = z.infer<typeof overviewPrefsSchema>;

const SCHEMAS = { "campaigns.columns": columnPrefsSchema, overview: overviewPrefsSchema } as const;
type PrefKey = keyof typeof SCHEMAS;
type PrefValue<K extends PrefKey> = z.infer<(typeof SCHEMAS)[K]>;

export const DEFAULT_COLUMN_PREFS: ColumnPrefs = { columns: DEFAULT_PRESET.columns, sets: [] };
export const DEFAULT_OVERVIEW_PREFS: OverviewPrefs = {
  kpis: ["spend", "results", "cpr", "roas", "purchaseValue", "ctr", "cpm", "linkClicks"],
  chart: ["spend", "results"],
};

async function read<K extends PrefKey>(userId: string, key: K): Promise<PrefValue<K> | null> {
  const [row] = await db()
    .select({ value: userSettings.value })
    .from(userSettings)
    .where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
    .limit(1);
  const parsed = row ? SCHEMAS[key].safeParse(row.value) : null;
  return parsed?.success ? (parsed.data as PrefValue<K>) : null;
}

export async function writePref<K extends PrefKey>(userId: string, key: K, value: PrefValue<K>): Promise<void> {
  await db()
    .insert(userSettings)
    .values({ userId, key, value })
    .onConflictDoUpdate({ target: [userSettings.userId, userSettings.key], set: { value, updatedAt: Date.now() } });
}

export async function getColumnPrefs(userId: string): Promise<ColumnPrefs> {
  const stored = await read(userId, "campaigns.columns");
  if (!stored) return DEFAULT_COLUMN_PREFS;
  const columns = cleanColumns(stored.columns);
  return {
    columns: columns.length ? columns : DEFAULT_COLUMN_PREFS.columns,
    sets: stored.sets.map((s) => ({ ...s, columns: cleanColumns(s.columns) })).filter((s) => s.columns.length),
  };
}

export async function getOverviewPrefs(userId: string): Promise<OverviewPrefs> {
  const stored = await read(userId, "overview");
  const valid = (list: string[] | undefined) => [...new Set(list ?? [])].filter((k) => METRIC_BY_KEY.has(k));
  const kpis = valid(stored?.kpis);
  const chart = valid(stored?.chart);
  return {
    kpis: kpis.length ? kpis : DEFAULT_OVERVIEW_PREFS.kpis,
    chart: chart.length ? chart : DEFAULT_OVERVIEW_PREFS.chart,
  };
}
