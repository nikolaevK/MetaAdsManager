import "server-only";
import { UserError } from "@/lib/action-result";
import { graph, graphAll } from "./client";

export type RemoteAdAccount = {
  id: string;
  name: string;
  account_status: number;
  currency: string;
  timezone_name: string;
  business?: { id: string; name: string };
};

export const ACCOUNT_STATUS: Record<number, string> = {
  1: "Active",
  2: "Disabled",
  3: "Unsettled",
  7: "Pending risk review",
  8: "Pending settlement",
  9: "In grace period",
  100: "Pending closure",
  101: "Closed",
  201: "Any active",
  202: "Any closed",
};

export function listRemoteAdAccounts(): Promise<RemoteAdAccount[]> {
  return graphAll<RemoteAdAccount>("me/adaccounts", {
    params: { fields: "id,name,account_status,currency,timezone_name,business{id,name}", limit: 200 },
  });
}

export function getRemoteAdAccount(id: string): Promise<RemoteAdAccount> {
  return graph<RemoteAdAccount>(id, {
    params: { fields: "id,name,account_status,currency,timezone_name,business{id,name}" },
    accountId: id,
  });
}

export type RemotePage = { id: string; name: string; instagram_business_account?: { id: string; username?: string } };
/** Where a Page came from: already promoted by the ad account, owned/managed by its Business, or only reachable by the token. */
export type PageSource = "promoted" | "business" | "token";

/**
 * Pages the ad account can run ads for. `promote_pages` alone often comes back empty for system users
 * (it only lists Pages the account already advertised for), so it's merged with the Pages of the account's
 * Business and the Pages the token can act on. Each Page keeps its most specific source, so the picker can
 * list the ad account's own Pages first. Throws only if every source fails.
 */
export async function listPages(adAccountId: string, businessId?: string | null): Promise<(RemotePage & { source: PageSource })[]> {
  const opts = { params: { fields: "id,name,instagram_business_account{id,username}", limit: 100 }, accountId: adAccountId, maxPages: 10 };
  const sources: [string, PageSource][] = [
    [`${adAccountId}/promote_pages`, "promoted"],
    ...(businessId ? ([[`${businessId}/owned_pages`, "business"], [`${businessId}/client_pages`, "business"]] as [string, PageSource][]) : []),
    ["me/accounts", "token"],
  ];
  const results = await Promise.allSettled(sources.map(([path]) => graphAll<RemotePage>(path, opts)));
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length === results.length) throw failures[0].reason;
  const pages = new Map<string, RemotePage & { source: PageSource }>();
  results.forEach((r, k) => {
    if (r.status !== "fulfilled") return;
    for (const p of r.value) {
      const known = pages.get(p.id);
      // Sources are ordered most specific first; later ones only fill in a missing Instagram account.
      if (!known) pages.set(p.id, { ...p, source: sources[k][1] });
      else if (!known.instagram_business_account && p.instagram_business_account) known.instagram_business_account = p.instagram_business_account;
    }
  });
  return [...pages.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type RemoteInstagram = { id: string; username?: string };

/**
 * Instagram accounts assigned to the ad account in Business Settings. Unlike the Business's own Instagram list
 * (which needs the app's Full access tier), this works with a system-user token.
 */
export function listInstagramAccounts(adAccountId: string): Promise<RemoteInstagram[]> {
  return graphAll<RemoteInstagram>(`${adAccountId}/instagram_accounts`, { params: { fields: "id,username", limit: 100 }, accountId: adAccountId, maxPages: 5 });
}

export type RemoteLeadForm = { id: string; name: string; status?: string; locale?: string };

/**
 * Instant forms on a Page. The edge needs a Page access token, which the system user can get for Pages it was
 * assigned with the advertise task; it is used for this call only and never stored or sent to the browser.
 */
export async function listLeadForms(pageId: string, adAccountId: string): Promise<RemoteLeadForm[]> {
  const page = await graph<{ access_token?: string }>(pageId, { params: { fields: "access_token" }, accountId: adAccountId });
  if (!page.access_token) throw new UserError("The system user can't act on this Page. Assign the Page to it in Business Settings (with permission to create ads).");
  return graphAll<RemoteLeadForm>(`${pageId}/leadgen_forms`, {
    params: { fields: "id,name,status,locale", limit: 100 },
    accountId: adAccountId,
    token: page.access_token,
    maxPages: 5,
  });
}

/** The ad account's default EU (DSA) beneficiary and payer, used when an ad set doesn't name its own. */
export async function getDsaDefaults(adAccountId: string): Promise<{ beneficiary?: string; payor?: string }> {
  const a = await graph<{ default_dsa_beneficiary?: string; default_dsa_payor?: string }>(adAccountId, {
    params: { fields: "default_dsa_beneficiary,default_dsa_payor" },
    accountId: adAccountId,
  });
  return { beneficiary: a.default_dsa_beneficiary || undefined, payor: a.default_dsa_payor || undefined };
}

export type RemoteApp = { id: string; name: string; object_store_urls?: Record<string, string> };

/** Mobile apps the ad account can promote (App promotion campaigns). */
export function listApps(adAccountId: string): Promise<RemoteApp[]> {
  return graphAll<RemoteApp>(`${adAccountId}/advertisable_applications`, {
    params: { fields: "id,name,object_store_urls", limit: 100 },
    accountId: adAccountId,
  });
}

export type RemotePixel = { id: string; name: string; last_fired_time?: string };

export function listPixels(adAccountId: string): Promise<RemotePixel[]> {
  return graphAll<RemotePixel>(`${adAccountId}/adspixels`, {
    params: { fields: "id,name,last_fired_time", limit: 100 },
    accountId: adAccountId,
  });
}

export type PixelStats = { data?: { data?: { value: string; count: number }[] }[] };

/** Totals per event name across the hourly buckets of GET /{pixel}/stats. */
export function sumPixelStats(stats: PixelStats): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const bucket of stats.data ?? []) for (const d of bucket.data ?? []) totals[d.value] = (totals[d.value] ?? 0) + d.count;
  return totals;
}

/** How often the pixel received each event over the last 7 days (the most Meta keeps; 168 hourly buckets fit one page). */
export async function pixelEventCounts(pixelId: string, adAccountId: string): Promise<Record<string, number>> {
  const stats = await graph<PixelStats>(`${pixelId}/stats`, {
    params: { aggregation: "event", start_time: Math.floor(Date.now() / 1000) - 7 * 86_400, limit: 500 },
    accountId: adAccountId,
  });
  return sumPixelStats(stats);
}

export type RemoteAudience = {
  id: string;
  name: string;
  subtype?: string;
  approximate_count_lower_bound?: number;
};

export function listCustomAudiences(adAccountId: string): Promise<RemoteAudience[]> {
  return graphAll<RemoteAudience>(`${adAccountId}/customaudiences`, {
    params: { fields: "id,name,subtype,approximate_count_lower_bound", limit: 200 },
    accountId: adAccountId,
  });
}

/** Cheap token health check used on the System page. */
export function whoAmI(): Promise<{ id: string; name: string }> {
  return graph<{ id: string; name: string }>("me", { params: { fields: "id,name" } });
}
