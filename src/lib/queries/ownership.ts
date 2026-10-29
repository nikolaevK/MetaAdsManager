import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { UserError } from "@/lib/action-result";
import { db } from "@/lib/db";
import { adAccounts, ads, adsets, launches, type LaunchStatus } from "@/lib/db/schema";
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

/** Objects created by a launch go live only through its approval flow, never via a manual toggle. */
export async function assertNotAwaitingApproval(lvl: Level, ids: string[]) {
  const campaignIds =
    lvl === "campaign"
      ? ids
      : (
          await db()
            .selectDistinct({ id: (lvl === "adset" ? adsets : ads).campaignId })
            .from(lvl === "adset" ? adsets : ads)
            .where(inArray((lvl === "adset" ? adsets : ads).id, ids))
        ).map((r) => r.id);
  if (campaignIds.length === 0) return;
  const [pending] = await db()
    .select({ name: launches.name })
    .from(launches)
    .where(and(inArray(launches.metaCampaignId, campaignIds), inArray(launches.status, NOT_APPROVED)))
    .limit(1);
  if (pending) throw new UserError(`"${pending.name}" belongs to a launch that hasn't been approved. Approve it from Launches.`);
}
