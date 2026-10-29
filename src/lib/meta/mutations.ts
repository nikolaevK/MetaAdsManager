import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { ads, adsets, campaigns } from "@/lib/db/schema";
import { graph, graphAll, graphBatch, type Params } from "./client";
import { errorMessage, MetaApiError } from "./errors";

export type Level = "campaign" | "adset" | "ad";
export const TABLES = { campaign: campaigns, adset: adsets, ad: ads } as const;

/** Write-through: change in Meta first, then mirror locally so the table updates instantly. */
export async function setStatus(
  level: Level,
  ids: string[],
  status: "ACTIVE" | "PAUSED" | "ARCHIVED",
  adAccountId: string,
): Promise<{ updated: string[]; errors: { id: string; message: string }[] }> {
  const results = await graphBatch(
    ids.map((id) => ({ method: "POST" as const, relativeUrl: id, params: { status } })),
    { accountId: adAccountId },
  );
  const updated: string[] = [];
  const errors: { id: string; message: string }[] = [];
  results.forEach((r, k) => (r.ok ? updated.push(ids[k]) : errors.push({ id: ids[k], message: r.error.display })));
  if (updated.length) {
    const table = TABLES[level];
    if (status === "ARCHIVED") {
      await db().delete(table).where(inArray(table.id, updated));
    } else {
      // effective_status refreshes on the next sync; mirror the obvious part now.
      await db().update(table).set({ status, effectiveStatus: status }).where(inArray(table.id, updated));
    }
  }
  return { updated, errors };
}

export async function updateBudget(
  level: "campaign" | "adset",
  id: string,
  field: "daily_budget" | "lifetime_budget",
  minorUnits: number,
  adAccountId: string,
): Promise<void> {
  await graph(id, { method: "POST", params: { [field]: minorUnits }, accountId: adAccountId });
  const table = TABLES[level];
  await db()
    .update(table)
    .set(field === "daily_budget" ? { dailyBudget: minorUnits } : { lifetimeBudget: minorUnits })
    .where(inArray(table.id, [id]));
}

export async function rename(level: Level, id: string, name: string, adAccountId: string): Promise<void> {
  await graph(id, { method: "POST", params: { name }, accountId: adAccountId });
  const table = TABLES[level];
  await db().update(table).set({ name }).where(inArray(table.id, [id]));
}

const COPY_PARAMS = { status_option: "PAUSED", rename_options: { rename_strategy: "DEEP_RENAME", rename_suffix: " - Copy" } };

type Child = { id: string; name: string; adset_id?: string; creative?: { id: string }; tracking_specs?: unknown; conversion_domain?: string };
type Create = { path: string; params: Params; key: string };

const AD_FIELDS = "id,name,adset_id,creative{id},tracking_specs,conversion_domain";

/**
 * An ad is duplicated as a new ad on the same creative: /copies fails every time with Meta's generic
 * "unexpected error" (code 2) for Advantage+ creatives, while a new ad reusing the creative is accepted.
 */
const adCopy = (a: Child, adsetId: string, adAccountId: string): Create => ({
  path: `${adAccountId}/ads`,
  params: {
    name: `${a.name}${COPY_PARAMS.rename_options.rename_suffix}`,
    adset_id: adsetId,
    creative: { creative_id: a.creative?.id },
    status: "PAUSED",
    tracking_specs: a.tracking_specs,
    conversion_domain: a.conversion_domain,
  },
  key: "id",
});

const COPY_RETRY_MS = [1_000, 3_000];

/**
 * Runs one create per item, one at a time: parallel creates within one campaign make Meta fail some
 * with its generic "unexpected error" (code 2). Meta's temporary errors are retried; rate limits and
 * timeouts aren't (a timed-out create may exist). Returns each new id, or undefined where it failed.
 */
async function createEach(items: Child[], request: (c: Child) => Create, noun: string, adAccountId: string, failed: string[]) {
  const out: (string | undefined)[] = [];
  for (const c of items) {
    const { path, params, key } = request(c);
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await graph<Record<string, string>>(path, { method: "POST", params, accountId: adAccountId, timeoutMs: 120_000 });
        out.push(res[key]);
        break;
      } catch (err) {
        if (err instanceof MetaApiError && err.isTransient && !err.isRateLimit && attempt < COPY_RETRY_MS.length) {
          await new Promise((r) => setTimeout(r, COPY_RETRY_MS[attempt]));
          continue;
        }
        failed.push(`${noun} "${c.name}": ${errorMessage(err)}`);
        out.push(undefined);
        break;
      }
    }
  }
  return out;
}

/**
 * Duplicates as PAUSED copies. Meta refuses synchronous deep copies of 3+ objects, so each object is
 * copied on its own: the campaign, then its ad sets into the copy (both via /copies), then their ads
 * (see adCopy). Throws if nothing was copied; otherwise returns what couldn't be copied.
 */
export async function duplicate(level: Level, id: string, adAccountId: string): Promise<string[]> {
  if (level === "ad") {
    const ad = await graph<Child>(id, { params: { fields: AD_FIELDS }, accountId: adAccountId });
    const { path, params } = adCopy(ad, ad.adset_id!, adAccountId);
    await graph(path, { method: "POST", params, accountId: adAccountId });
    return [];
  }
  const top = await graph<Record<string, string>>(`${id}/copies`, { method: "POST", params: COPY_PARAMS, accountId: adAccountId, timeoutMs: 120_000 });
  const failed: string[] = [];
  try {
    // Source ad set id → its copy.
    const adsetCopies = new Map<string, string>();
    if (level === "adset") adsetCopies.set(id, top.copied_adset_id);
    else {
      const sets = await graphAll<Child>(`${id}/adsets`, { params: { fields: "id,name", limit: 200 }, accountId: adAccountId });
      const copies = await createEach(
        sets,
        (s) => ({ path: `${s.id}/copies`, params: { ...COPY_PARAMS, campaign_id: top.copied_campaign_id }, key: "copied_adset_id" }),
        "Ad set",
        adAccountId,
        failed,
      );
      copies.forEach((copy, k) => copy && adsetCopies.set(sets[k].id, copy));
    }
    // Ads of an ad set that failed to copy are skipped; that ad set is already reported.
    const ads = (await graphAll<Child>(`${id}/ads`, { params: { fields: AD_FIELDS, limit: 200 }, accountId: adAccountId }))
      .filter((a) => a.adset_id && adsetCopies.has(a.adset_id));
    await createEach(ads, (a) => adCopy(a, adsetCopies.get(a.adset_id!)!, adAccountId), "Ad", adAccountId, failed);
  } catch (err) {
    // The top-level copy exists by now, so report the rest rather than hide it behind an error.
    failed.push(errorMessage(err));
  }
  return failed;
}
