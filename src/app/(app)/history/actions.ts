"use server";

import { eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { failure, UserError, type ActionState } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { updateObject, type Change } from "@/lib/meta/objects";
import { assertNotAwaitingApproval, resolveAccount } from "@/lib/queries/ownership";

/** Re-applies the before-values captured with an edit. The undo is logged too, but isn't itself undoable. */
export async function undoChangeAction(auditId: string): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const id = z.string().min(1).max(64).parse(auditId);
    const [row] = await db().select().from(auditLog).where(eq(auditLog.id, id)).limit(1);
    const details = (row?.details ?? {}) as { changes?: Change[]; accountId?: string; undoOf?: string };
    if (!row || !details.changes?.length) throw new UserError("This change can't be undone.");
    const [already] = await db()
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(sql`json_extract(${auditLog.details}, '$.undoOf') = ${row.id}`)
      .limit(1);
    if (already) throw new UserError("Already undone.");

    const reverted: Change[] = [];
    const errors: string[] = [];
    for (const change of details.changes) {
      if (Object.keys(change.before).length === 0) continue;
      try {
        const account = await resolveAccount(change.level, [change.id]);
        if (details.accountId && account.id !== details.accountId) throw new UserError("Object moved to another account.");
        if (change.before.status === "ACTIVE") await assertNotAwaitingApproval(change.level, [change.id]);
        reverted.push(await updateObject(change.level, change.id, change.before, account.id));
      } catch (err) {
        errors.push(failure(err)?.error ?? "Failed");
      }
    }
    await audit(user.id, `${row.entityType ?? "object"}.undo`, { type: row.entityType ?? "object", id: row.entityId ?? "" }, {
      accountId: details.accountId,
      undoOf: row.id,
      changes: reverted,
      errors,
    });
    refresh();
    if (errors.length) return { ok: false, error: `${reverted.length} reverted, ${errors.length} failed: ${errors[0]}` };
    return { ok: true, message: "Change undone" };
  } catch (err) {
    return failure(err);
  }
}
