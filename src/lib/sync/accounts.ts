import "server-only";
import { eq } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { adAccounts, clients, ignoredAdAccounts } from "@/lib/db/schema";
import { enqueue, PRIORITY } from "@/lib/jobs/queue";
import { listRemoteAdAccounts } from "@/lib/meta/accounts";

/** Client used for ad accounts that don't belong to a Meta Business. */
export const UNASSIGNED_CLIENT = "Unassigned";

/** Initial syncs for a newly added account (same keys the scheduler uses, so nothing doubles up). */
export async function enqueueInitialSync(adAccountId: string): Promise<void> {
  const opts = { adAccountId, priority: PRIORITY.structure };
  await enqueue("structure.sync", { adAccountId }, { ...opts, dedupeKey: `structure:${adAccountId}` });
  await enqueue("review.sync", { adAccountId }, { ...opts, priority: PRIORITY.review, dedupeKey: `review:${adAccountId}` });
  await enqueue("insights.sync", { adAccountId, range: "backfill" }, {
    ...opts,
    priority: PRIORITY.backfill,
    dedupeKey: `insights:${adAccountId}:backfill`,
  });
}

/**
 * Mirrors every ad account the Meta token can access. New accounts are filed under a client named
 * after their Meta Business (created on demand) and start syncing; known accounts get their name,
 * status and currency refreshed but keep whatever client a person assigned them to.
 */
export async function discoverAccounts(): Promise<{ added: string[]; updated: number }> {
  const remote = await listRemoteAdAccounts();
  const known = new Map((await db().select().from(adAccounts)).map((a) => [a.id, a]));
  const ignored = new Set((await db().select({ id: ignoredAdAccounts.id }).from(ignoredAdAccounts)).map((r) => r.id));
  const clientIds = new Map((await db().select().from(clients)).map((c) => [c.name.trim().toLowerCase(), c.id]));

  const added: string[] = [];
  let updated = 0;
  for (const r of remote) {
    const fields = {
      name: r.name,
      currency: r.currency,
      timezoneName: r.timezone_name,
      accountStatus: r.account_status,
      businessId: r.business?.id ?? null,
    };
    const existing = known.get(r.id);
    if (existing) {
      const changed = (Object.keys(fields) as (keyof typeof fields)[]).some((k) => existing[k] !== fields[k]);
      if (changed) {
        await db().update(adAccounts).set(fields).where(eq(adAccounts.id, r.id));
        updated++;
      }
      continue;
    }
    if (ignored.has(r.id)) continue;

    const clientName = r.business?.name?.trim() || UNASSIGNED_CLIENT;
    let clientId = clientIds.get(clientName.toLowerCase());
    if (!clientId) {
      const [created] = await db().insert(clients).values({ name: clientName }).returning({ id: clients.id });
      clientId = created.id;
      clientIds.set(clientName.toLowerCase(), clientId);
    }
    await db().insert(adAccounts).values({ id: r.id, clientId, ...fields }).onConflictDoNothing();
    await enqueueInitialSync(r.id);
    added.push(r.id);
  }

  if (added.length) await audit(null, "accounts.discovered", undefined, { added });
  return { added, updated };
}
