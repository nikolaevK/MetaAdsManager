"use server";

import { inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { failure, UserError, type ActionState } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { toMinorUnits } from "@/lib/launch/payloads";
import { graphBatchUpdate } from "@/lib/meta/client";
import { kickWorker } from "@/lib/jobs/kick";
import { enqueue, PRIORITY } from "@/lib/jobs/queue";
import { duplicate, rename, setStatus, TABLES, updateBudget, type Level } from "@/lib/meta/mutations";
import { mirrorPatch, type Change } from "@/lib/meta/objects";
import { assertNotAwaitingApproval, resolveAccount } from "@/lib/queries/ownership";

const level = z.enum(["campaign", "adset", "ad"]);
const metaId = z.string().regex(/^\d+$/);

/** Current mirrored values, captured before a write so History can undo it. */
async function mirrored(lvl: Level, ids: string[]) {
  const table = TABLES[lvl];
  const rows = await db().select().from(table).where(inArray(table.id, ids));
  return new Map(rows.map((r) => [r.id, r as { status: string; name: string; dailyBudget?: number | null; lifetimeBudget?: number | null }]));
}

export async function setStatusAction(input: { level: Level; ids: string[]; status: "ACTIVE" | "PAUSED" | "ARCHIVED" }): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const data = z
      .object({ level, ids: z.array(metaId).min(1).max(200), status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]) })
      .parse(input);
    const account = await resolveAccount(data.level, data.ids);
    // Switching off is always allowed; switching on waits for a pending launch's approval.
    if (data.status === "ACTIVE") await assertNotAwaitingApproval(data.level, data.ids);
    const before = await mirrored(data.level, data.ids);
    const res = await setStatus(data.level, data.ids, data.status, account.id);
    // Archiving can't be reliably reversed through the API, so it isn't offered for undo.
    const changes: Change[] =
      data.status === "ARCHIVED"
        ? []
        : res.updated.map((id) => ({ level: data.level, id, before: { status: before.get(id)?.status }, after: { status: data.status } }));
    await audit(user.id, `${data.level}.status`, { type: data.level, id: data.ids.join(",") }, { status: data.status, errors: res.errors, accountId: account.id, changes });
    refresh();
    if (res.errors.length) return { ok: false, error: `${res.errors.length} failed: ${res.errors[0].message}` };
    const verb = data.status === "ACTIVE" ? "turned on" : data.status === "PAUSED" ? "turned off" : "archived";
    return { ok: true, message: `${res.updated.length} ${data.level}${res.updated.length === 1 ? "" : "s"} ${verb}` };
  } catch (err) {
    return failure(err);
  }
}

export async function updateBudgetAction(input: { level: "campaign" | "adset"; id: string; amount: number; kind: "daily" | "lifetime" }): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const data = z
      .object({ level: z.enum(["campaign", "adset"]), id: metaId, amount: z.number().positive().max(10_000_000), kind: z.enum(["daily", "lifetime"]) })
      .parse(input);
    const account = await resolveAccount(data.level, [data.id]);
    await assertNotAwaitingApproval(data.level, [data.id]);
    const field = data.kind === "daily" ? "daily_budget" : "lifetime_budget";
    const prev = (await mirrored(data.level, [data.id])).get(data.id);
    const minor = toMinorUnits(data.amount, account.currency);
    await updateBudget(data.level, data.id, field, minor, account.id);
    const old = data.kind === "daily" ? prev?.dailyBudget : prev?.lifetimeBudget;
    const changes: Change[] = old ? [{ level: data.level, id: data.id, before: { [field]: old }, after: { [field]: minor } }] : [];
    await audit(user.id, `${data.level}.budget`, { type: data.level, id: data.id }, { amount: data.amount, kind: data.kind, accountId: account.id, changes });
    refresh();
    return { ok: true, message: "Budget updated" };
  } catch (err) {
    return failure(err);
  }
}

export async function renameAction(input: { level: Level; id: string; name: string }): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const data = z.object({ level, id: metaId, name: z.string().trim().min(1).max(400) }).parse(input);
    const account = await resolveAccount(data.level, [data.id]);
    await assertNotAwaitingApproval(data.level, [data.id]);
    const prev = (await mirrored(data.level, [data.id])).get(data.id);
    await rename(data.level, data.id, data.name, account.id);
    const changes: Change[] = prev ? [{ level: data.level, id: data.id, before: { name: prev.name }, after: { name: data.name } }] : [];
    await audit(user.id, `${data.level}.rename`, { type: data.level, id: data.id }, { name: data.name, accountId: account.id, changes });
    refresh();
    return { ok: true, message: "Renamed" };
  } catch (err) {
    return failure(err);
  }
}

export async function duplicateAction(input: { level: Level; id: string }): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const data = z.object({ level, id: metaId }).parse(input);
    const account = await resolveAccount(data.level, [data.id]);
    // A copy belongs to no launch, so copying unapproved objects would let them go live without approval.
    await assertNotAwaitingApproval(data.level, [data.id]);
    const failed = await duplicate(data.level, data.id, account.id);
    await enqueue("structure.sync", { adAccountId: account.id }, {
      dedupeKey: `structure:${account.id}`,
      priority: PRIORITY.launch,
      adAccountId: account.id,
    });
    await audit(user.id, `${data.level}.duplicate`, { type: data.level, id: data.id }, { accountId: account.id });
    kickWorker();
    if (failed.length) {
      const more = failed.length > 1 ? ` (and ${failed.length - 1} more)` : "";
      return { ok: false, error: `Duplicated (paused), but part of it couldn't be copied: ${failed[0]}${more}. Check the copy after the next sync.` };
    }
    return { ok: true, message: "Duplicated (paused). The copy appears after the next sync." };
  } catch (err) {
    return failure(err);
  }
}

const bulkSchema = z.object({
  level,
  items: z
    .array(
      z.object({
        id: metaId,
        name: z.string().trim().min(1).max(400).optional(),
        budget: z.object({ kind: z.enum(["daily", "lifetime"]), amount: z.number().positive().max(10_000_000) }).optional(),
      }),
    )
    .min(1)
    .max(200),
});

/** Bulk rename / budget change from the bulk edit dialog: one batch call, per-item results, undoable. */
export async function bulkUpdateAction(input: z.input<typeof bulkSchema>): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const data = bulkSchema.parse(input);
    if (data.level === "ad" && data.items.some((i) => i.budget)) throw new UserError("Ads don't have budgets.");
    const ids = data.items.map((i) => i.id);
    const account = await resolveAccount(data.level, ids);
    await assertNotAwaitingApproval(data.level, ids);
    const before = await mirrored(data.level, ids);

    const planned = data.items
      .map((i) => {
        const params: Record<string, string | number> = {};
        const prev: Record<string, string | number> = {};
        const row = before.get(i.id);
        if (i.name && i.name !== row?.name) {
          params.name = i.name;
          if (row) prev.name = row.name;
        }
        if (i.budget) {
          const field = i.budget.kind === "daily" ? "daily_budget" : "lifetime_budget";
          params[field] = toMinorUnits(i.budget.amount, account.currency);
          const old = i.budget.kind === "daily" ? row?.dailyBudget : row?.lifetimeBudget;
          if (old) prev[field] = old;
        }
        return { id: i.id, params, prev };
      })
      .filter((p) => Object.keys(p.params).length > 0);
    if (planned.length === 0) return { ok: true, message: "Nothing to change" };

    const results = await graphBatchUpdate(
      planned.map((p) => ({ method: "POST" as const, relativeUrl: p.id, params: p.params })),
      { accountId: account.id },
    );
    const changes: Change[] = [];
    const errors: string[] = [];
    for (const [k, r] of results.entries()) {
      const p = planned[k];
      if (!r.ok) {
        errors.push(r.error.display);
        continue;
      }
      await mirrorPatch(data.level, p.id, p.params);
      changes.push({ level: data.level, id: p.id, before: p.prev, after: p.params });
    }
    await audit(user.id, `${data.level}.bulk_edit`, { type: data.level, id: ids.join(",") }, { accountId: account.id, changes, errors });
    refresh();
    if (errors.length) return { ok: false, error: `${changes.length} updated, ${errors.length} failed: ${errors[0]}` };
    return { ok: true, message: `Updated ${changes.length} ${data.level === "adset" ? "ad set" : data.level}${changes.length === 1 ? "" : "s"}` };
  } catch (err) {
    return failure(err);
  }
}
