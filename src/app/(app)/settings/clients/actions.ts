"use server";

import { and, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { failure, UserError, type ActionState } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  adAccounts,
  clients,
  creativeAssets,
  creatives,
  ignoredAdAccounts,
  insightsDaily,
  jobs,
  namingConventions,
  rateLimitState,
  reviewEvents,
  utmRules,
} from "@/lib/db/schema";
import { kickWorker } from "@/lib/jobs/kick";
import { enqueue, PRIORITY } from "@/lib/jobs/queue";
import { ACCOUNT_STATUS, getRemoteAdAccount, listRemoteAdAccounts } from "@/lib/meta/accounts";
import { deleteObjects } from "@/lib/storage";

// Internal ids are UUIDs by default, but seeded rows may use other stable strings.
const internalId = z.string().min(1).max(64);
const clientId = internalId;
const accountId = z.string().regex(/^act_\d+$/);
const metaId = z.string().regex(/^\d+$/);
const name = z.string().trim().min(1, "Name is required").max(120);

async function requireClient(id: string) {
  const [row] = await db().select({ id: clients.id }).from(clients).where(eq(clients.id, id)).limit(1);
  if (!row) throw new UserError("Client not found.");
}

async function requireAccount(id: string) {
  const [row] = await db().select().from(adAccounts).where(eq(adAccounts.id, id)).limit(1);
  if (!row) throw new UserError("Ad account is not connected.");
  return row;
}

// ── Clients ──────────────────────────────────────────────────────────────────

export async function createClient(input: { name: string }): Promise<ActionState> {
  try {
    const user = await requireUser("admin");
    const data = z.object({ name }).parse(input);
    const [row] = await db().insert(clients).values({ name: data.name }).returning({ id: clients.id });
    await audit(user.id, "client.create", { type: "client", id: row.id }, { name: data.name });
    refresh();
    return { ok: true, message: `Client "${data.name}" created` };
  } catch (err) {
    return failure(err);
  }
}

export async function renameClient(input: { id: string; name: string }): Promise<ActionState> {
  try {
    const user = await requireUser("admin");
    const data = z.object({ id: clientId, name }).parse(input);
    await requireClient(data.id);
    await db().update(clients).set({ name: data.name }).where(eq(clients.id, data.id));
    await audit(user.id, "client.rename", { type: "client", id: data.id }, { name: data.name });
    refresh();
    return { ok: true, message: "Client renamed" };
  } catch (err) {
    return failure(err);
  }
}

export async function setClientConventions(input: {
  id: string;
  namingConventionId: string | null;
  utmRuleId: string | null;
}): Promise<ActionState> {
  try {
    const user = await requireUser("admin");
    const data = z
      .object({ id: clientId, namingConventionId: internalId.nullable(), utmRuleId: internalId.nullable() })
      .parse(input);
    await requireClient(data.id);
    if (data.namingConventionId) {
      const [n] = await db().select({ id: namingConventions.id }).from(namingConventions).where(eq(namingConventions.id, data.namingConventionId));
      if (!n) throw new UserError("Naming convention not found.");
    }
    if (data.utmRuleId) {
      const [u] = await db().select({ id: utmRules.id }).from(utmRules).where(eq(utmRules.id, data.utmRuleId));
      if (!u) throw new UserError("UTM rule not found.");
    }
    await db()
      .update(clients)
      .set({ namingConventionId: data.namingConventionId, utmRuleId: data.utmRuleId })
      .where(eq(clients.id, data.id));
    await audit(user.id, "client.conventions", { type: "client", id: data.id }, data);
    refresh();
    return { ok: true, message: "Client defaults saved" };
  } catch (err) {
    return failure(err);
  }
}

/** Deletes the client, its accounts' mirrored data, launches, templates and library files. */
export async function deleteClient(input: { id: string }): Promise<ActionState> {
  try {
    const user = await requireUser("admin");
    const { id } = z.object({ id: clientId }).parse(input);
    await requireClient(id);
    const accounts = await db().select({ id: adAccounts.id }).from(adAccounts).where(eq(adAccounts.clientId, id));
    for (const a of accounts) await purgeAccountData(a.id);
    if (accounts.length) {
      await db().insert(ignoredAdAccounts).values(accounts.map((a) => ({ id: a.id, ignoredBy: user.id }))).onConflictDoNothing();
    }
    const assets = await db().select({ key: creativeAssets.storageKey }).from(creativeAssets).where(eq(creativeAssets.clientId, id));
    // Creatives reference assets with ON DELETE RESTRICT, so remove them before the cascade.
    await db().delete(creatives).where(eq(creatives.clientId, id));
    await db().delete(clients).where(eq(clients.id, id));
    await deleteObjects(assets.map((a) => a.key)).catch(() => undefined);
    await audit(user.id, "client.delete", { type: "client", id }, { accounts: accounts.map((a) => a.id) });
    refresh();
    return { ok: true, message: "Client deleted" };
  } catch (err) {
    return failure(err);
  }
}

// ── Ad accounts ──────────────────────────────────────────────────────────────

export type ConnectableAccount = {
  id: string;
  name: string;
  status: string;
  currency: string;
  timezone: string;
  business: string | null;
};

export async function listConnectableAccounts(): Promise<{ ok: true; items: ConnectableAccount[] } | { ok: false; error: string }> {
  try {
    await requireUser("admin");
    const [remote, connected] = await Promise.all([
      listRemoteAdAccounts(),
      db().select({ id: adAccounts.id }).from(adAccounts),
    ]);
    const taken = new Set(connected.map((a) => a.id));
    return {
      ok: true,
      items: remote
        .filter((a) => !taken.has(a.id))
        .map((a) => ({
          id: a.id,
          name: a.name,
          status: ACCOUNT_STATUS[a.account_status] ?? String(a.account_status),
          currency: a.currency,
          timezone: a.timezone_name,
          business: a.business?.name ?? null,
        })),
    };
  } catch (err) {
    return { ok: false, error: failure(err)?.error ?? "Could not load ad accounts" };
  }
}

export async function connectAccount(input: { clientId: string; accountId: string }): Promise<ActionState> {
  try {
    const user = await requireUser("admin");
    const data = z.object({ clientId, accountId }).parse(input);
    await requireClient(data.clientId);
    const [existing] = await db().select({ id: adAccounts.id }).from(adAccounts).where(eq(adAccounts.id, data.accountId));
    if (existing) throw new UserError("This ad account is already connected.");

    // Read details from Meta rather than trusting the browser.
    const remote = await getRemoteAdAccount(data.accountId);
    // An explicit connect lifts a previous disconnect.
    await db().delete(ignoredAdAccounts).where(eq(ignoredAdAccounts.id, remote.id));
    await db().insert(adAccounts).values({
      id: remote.id,
      clientId: data.clientId,
      name: remote.name,
      currency: remote.currency,
      timezoneName: remote.timezone_name,
      accountStatus: remote.account_status,
      businessId: remote.business?.id ?? null,
    });

    const base = { adAccountId: remote.id };
    await enqueue("structure.sync", base, { dedupeKey: `structure:${remote.id}`, priority: PRIORITY.structure, adAccountId: remote.id });
    await enqueue("review.sync", base, { dedupeKey: `review:${remote.id}`, priority: PRIORITY.review, adAccountId: remote.id });
    await enqueue("insights.sync", { ...base, range: "backfill" }, {
      dedupeKey: `insights:${remote.id}:backfill`,
      priority: PRIORITY.backfill,
      adAccountId: remote.id,
    });
    await audit(user.id, "ad_account.connect", { type: "ad_account", id: remote.id }, { clientId: data.clientId, name: remote.name });
    kickWorker();
    refresh();
    return { ok: true, message: `Connected ${remote.name}. Initial sync started.` };
  } catch (err) {
    return failure(err);
  }
}

/** Mirrored rows without a foreign key to ad_accounts must be removed explicitly. */
async function purgeAccountData(id: string) {
  await db().delete(insightsDaily).where(eq(insightsDaily.adAccountId, id));
  await db().delete(reviewEvents).where(eq(reviewEvents.adAccountId, id));
  await db().delete(jobs).where(and(eq(jobs.adAccountId, id), inArray(jobs.status, ["queued", "failed", "succeeded"])));
  await db().delete(rateLimitState).where(eq(rateLimitState.key, `account:${id}`));
}

export async function disconnectAccount(input: { accountId: string }): Promise<ActionState> {
  try {
    const user = await requireUser("admin");
    const { accountId: id } = z.object({ accountId }).parse(input);
    const account = await requireAccount(id);
    await purgeAccountData(id);
    // Cascades to mirrored campaigns/ad sets/ads, media cache and launches.
    await db().delete(adAccounts).where(eq(adAccounts.id, id));
    // Otherwise auto-discovery would re-import it within the next cycle.
    await db().insert(ignoredAdAccounts).values({ id, ignoredBy: user.id }).onConflictDoNothing();
    await audit(user.id, "ad_account.disconnect", { type: "ad_account", id }, { name: account.name });
    refresh();
    return { ok: true, message: `Disconnected ${account.name}` };
  } catch (err) {
    return failure(err);
  }
}

export async function moveAccount(input: { accountId: string; clientId: string }): Promise<ActionState> {
  try {
    const user = await requireUser("admin");
    const data = z.object({ accountId, clientId }).parse(input);
    const account = await requireAccount(data.accountId);
    await requireClient(data.clientId);
    if (account.clientId === data.clientId) return { ok: true, message: "No change" };
    await db().update(adAccounts).set({ clientId: data.clientId }).where(eq(adAccounts.id, data.accountId));
    await audit(user.id, "ad_account.move", { type: "ad_account", id: data.accountId }, { from: account.clientId, to: data.clientId });
    refresh();
    return { ok: true, message: `Moved ${account.name}` };
  } catch (err) {
    return failure(err);
  }
}

export async function setAccountDefaults(input: {
  accountId: string;
  pageId: string | null;
  instagramUserId: string | null;
}): Promise<ActionState> {
  try {
    const user = await requireUser("admin");
    const data = z
      .object({ accountId, pageId: metaId.nullable(), instagramUserId: metaId.nullable() })
      .parse(input);
    await requireAccount(data.accountId);
    await db()
      .update(adAccounts)
      .set({ defaultPageId: data.pageId, defaultInstagramUserId: data.instagramUserId })
      .where(eq(adAccounts.id, data.accountId));
    await audit(user.id, "ad_account.defaults", { type: "ad_account", id: data.accountId }, data);
    refresh();
    return { ok: true, message: "Default identity saved" };
  } catch (err) {
    return failure(err);
  }
}
