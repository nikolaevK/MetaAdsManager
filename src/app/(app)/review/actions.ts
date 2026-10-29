"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { failure, type ActionState } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { reviewEvents } from "@/lib/db/schema";

export async function acknowledgeAction(input: { ids: string[] }): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const { ids } = z.object({ ids: z.array(z.string().regex(/^[A-Za-z0-9-]{1,64}$/)).min(1).max(500) }).parse(input);
    const done = await db()
      .update(reviewEvents)
      .set({ acknowledgedAt: Date.now(), acknowledgedBy: user.id })
      .where(and(inArray(reviewEvents.id, ids), isNull(reviewEvents.acknowledgedAt)))
      .returning({ id: reviewEvents.id });
    await audit(user.id, "review.acknowledge", { type: "review_event", id: ids.join(",").slice(0, 500) }, { count: done.length });
    refresh();
    return { ok: true, message: `Acknowledged ${done.length} item${done.length === 1 ? "" : "s"}` };
  } catch (err) {
    return failure(err);
  }
}

/** Acknowledges every open item for one account, or everywhere when accountId is null. */
export async function acknowledgeAllAction(input: { accountId: string | null }): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const { accountId } = z.object({ accountId: z.string().regex(/^act_\d+$/).nullable() }).parse(input);
    const done = await db()
      .update(reviewEvents)
      .set({ acknowledgedAt: Date.now(), acknowledgedBy: user.id })
      .where(and(isNull(reviewEvents.acknowledgedAt), accountId ? eq(reviewEvents.adAccountId, accountId) : undefined))
      .returning({ id: reviewEvents.id });
    await audit(user.id, "review.acknowledge_all", accountId ? { type: "ad_account", id: accountId } : undefined, {
      count: done.length,
    });
    refresh();
    return { ok: true, message: `Acknowledged ${done.length} item${done.length === 1 ? "" : "s"}` };
  } catch (err) {
    return failure(err);
  }
}
