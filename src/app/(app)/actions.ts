"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { failure, type ActionState } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { adAccounts } from "@/lib/db/schema";
import { kickWorker } from "@/lib/jobs/kick";
import { enqueue, PRIORITY } from "@/lib/jobs/queue";
import { ACCOUNT_COOKIE } from "@/lib/workspace";

export async function selectAccount(accountId: string): Promise<void> {
  await requireUser();
  const id = z.string().regex(/^act_\d+$/).parse(accountId);
  const [exists] = await db().select({ id: adAccounts.id }).from(adAccounts).where(eq(adAccounts.id, id)).limit(1);
  if (!exists) return;
  (await cookies()).set(ACCOUNT_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/** "Refresh" button: pulls structure, review state and recent insights for the account now. */
export async function syncNow(accountId: string): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const id = z.string().regex(/^act_\d+$/).parse(accountId);
    const opts = { adAccountId: id, priority: PRIORITY.launch };
    await enqueue("structure.sync", { adAccountId: id }, { ...opts, dedupeKey: `structure:${id}` });
    await enqueue("review.sync", { adAccountId: id }, { ...opts, dedupeKey: `review:${id}` });
    await enqueue("insights.sync", { adAccountId: id, range: "recent" }, { ...opts, dedupeKey: `insights:${id}:recent` });
    await audit(user.id, "sync.manual", { type: "ad_account", id });
    kickWorker();
    refresh();
    return { ok: true, message: "Sync started. Data refreshes in a few seconds." };
  } catch (err) {
    return failure(err);
  }
}
