"use server";

import { cleanColumns } from "@/lib/columns";
import { failure, type ActionState } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/session";
import { METRIC_BY_KEY } from "@/lib/metrics";
import { columnPrefsSchema, overviewPrefsSchema, writePref, type ColumnPrefs, type OverviewPrefs } from "@/lib/preferences";

/** Column layout of the campaigns table (current columns + named sets). Viewers can customise their own view. */
export async function saveColumnPrefsAction(input: ColumnPrefs): Promise<ActionState> {
  try {
    const user = await requireUser("viewer");
    const data = columnPrefsSchema.parse(input);
    await writePref(user.id, "campaigns.columns", {
      columns: cleanColumns(data.columns),
      sets: data.sets.map((s) => ({ ...s, columns: cleanColumns(s.columns) })),
    });
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function saveOverviewPrefsAction(input: OverviewPrefs): Promise<ActionState> {
  try {
    const user = await requireUser("viewer");
    const data = overviewPrefsSchema.parse(input);
    const valid = (list: string[]) => [...new Set(list)].filter((k) => METRIC_BY_KEY.has(k));
    await writePref(user.id, "overview", { kpis: valid(data.kpis), chart: valid(data.chart) });
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}
