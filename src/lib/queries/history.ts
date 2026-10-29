import "server-only";
import { desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ads, adsets, auditLog, campaigns, launches, users } from "@/lib/db/schema";
import type { Change } from "@/lib/meta/objects";

export type HistoryEntry = {
  id: string;
  action: string;
  createdAt: number;
  userName: string | null;
  entityType: string | null;
  entityIds: string[];
  names: string[];
  changes: Change[];
  details: Record<string, unknown>;
  undoneAt: number | null;
  undoable: boolean;
};

/** Account activity, newest first: edits made here (undoable when before-values were captured), launches, syncs. */
export async function getHistory(accountId: string, limit = 150): Promise<HistoryEntry[]> {
  const accountLaunches = db().select({ id: launches.id }).from(launches).where(eq(launches.adAccountId, accountId));
  const rows = await db()
    .select({ a: auditLog, userName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(
      or(
        sql`json_extract(${auditLog.details}, '$.accountId') = ${accountId}`,
        sql`${auditLog.entityType} = 'ad_account' and ${auditLog.entityId} = ${accountId}`,
        sql`${auditLog.entityType} = 'launch' and ${auditLog.entityId} in ${accountLaunches}`,
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  // Undo entries point at what they reverted.
  const undone = new Map<string, number>();
  for (const { a } of rows) {
    const of = (a.details as { undoOf?: string } | null)?.undoOf;
    if (of) undone.set(of, a.createdAt);
  }

  const ids = new Set<string>();
  for (const { a } of rows) for (const id of a.entityId?.split(",") ?? []) if (/^\d+$/.test(id)) ids.add(id);
  const list = [...ids];
  const names = new Map<string, string>();
  if (list.length) {
    const [c, s, ad] = await Promise.all([
      db().select({ id: campaigns.id, name: campaigns.name }).from(campaigns).where(inArray(campaigns.id, list)),
      db().select({ id: adsets.id, name: adsets.name }).from(adsets).where(inArray(adsets.id, list)),
      db().select({ id: ads.id, name: ads.name }).from(ads).where(inArray(ads.id, list)),
    ]);
    for (const r of [...c, ...s, ...ad]) names.set(r.id, r.name);
  }

  return rows.map(({ a, userName }) => {
    const details = (a.details ?? {}) as Record<string, unknown>;
    const changes = Array.isArray(details.changes) ? (details.changes as Change[]) : [];
    const entityIds = a.entityId?.split(",").filter(Boolean) ?? [];
    return {
      id: a.id,
      action: a.action,
      createdAt: a.createdAt,
      userName,
      entityType: a.entityType,
      entityIds,
      names: entityIds.map((id) => names.get(id) ?? (typeof details.name === "string" ? details.name : id)),
      changes,
      details,
      undoneAt: undone.get(a.id) ?? null,
      undoable: changes.length > 0 && changes.every((c) => Object.keys(c.before).length > 0) && !undone.has(a.id) && !details.undoOf,
    };
  });
}
