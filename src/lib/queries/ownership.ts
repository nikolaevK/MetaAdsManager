import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { UserError } from "@/lib/action-result";
import { db } from "@/lib/db";
import { adAccounts, ads, adsets, launchObjects, launches, type LaunchStatus } from "@/lib/db/schema";
import { TABLES, type Level } from "@/lib/meta/mutations";

export type ConnectedAccount = typeof adAccounts.$inferSelect;

/**
 * Only objects mirrored in our DB can be read or edited, and all must belong to one connected account.
 * This stops a crafted request from touching anything else the token can reach.
 */
export async function resolveAccount(lvl: Level, ids: string[]): Promise<ConnectedAccount> {
  const table = TABLES[lvl];
  const rows = await db()
    .select({ id: table.id, adAccountId: table.adAccountId })
    .from(table)
    .where(inArray(table.id, ids));
  const accounts = new Set(rows.map((r) => r.adAccountId));
  if (rows.length !== ids.length || accounts.size !== 1) throw new UserError("Some selected items were not found. Refresh and try again.");
  const [accountId] = accounts;
  const [account] = await db().select().from(adAccounts).where(eq(adAccounts.id, accountId)).limit(1);
  if (!account) throw new UserError("Ad account is not connected.");
  return account;
}

export async function connectedAccount(accountId: string): Promise<ConnectedAccount> {
  if (!/^act_\d+$/.test(accountId)) throw new UserError("Invalid ad account.");
  const [account] = await db().select().from(adAccounts).where(eq(adAccounts.id, accountId)).limit(1);
  if (!account) throw new UserError("Ad account is not connected.");
  return account;
}

const NOT_APPROVED: LaunchStatus[] = ["queued", "building", "ready_for_review", "activating", "activation_failed", "rolling_back", "failed"];

/**
 * What an admin approves must be what goes live. Until its launch is approved, an object a launch created, and
 * anything inside it, can't be switched on, edited, duplicated or added to; switching it off is always allowed
 * (callers skip this check for PAUSED / ARCHIVED). Existing campaigns and ad sets a launch only adds to aren't
 * locked: the launch's own new objects are.
 */
export async function assertNotAwaitingApproval(lvl: Level, ids: string[]) {
  if (ids.length === 0) return;
  // Meta ids are unique across object types, so the object and its ancestors are matched in one list.
  const related = new Set(ids);
  if (lvl === "ad") {
    const rows = await db().select({ adsetId: ads.adsetId, campaignId: ads.campaignId }).from(ads).where(inArray(ads.id, ids));
    for (const r of rows) related.add(r.adsetId).add(r.campaignId);
  } else if (lvl === "adset") {
    const rows = await db().select({ campaignId: adsets.campaignId }).from(adsets).where(inArray(adsets.id, ids));
    for (const r of rows) related.add(r.campaignId);
  }
  const [pending] = await db()
    .select({ name: launches.name })
    .from(launchObjects)
    .innerJoin(launches, eq(launches.id, launchObjects.launchId))
    .where(and(inArray(launchObjects.metaId, [...related]), inArray(launches.status, NOT_APPROVED)))
    .limit(1);
  if (pending) throw new UserError(`This is part of the launch "${pending.name}", which is waiting for approval. Approve or discard it on Launches first.`);
}
