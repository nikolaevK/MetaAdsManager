import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { launchObjects, type LaunchObjectKind } from "@/lib/db/schema";
import { graph, graphBatch } from "@/lib/meta/client";

type Row = typeof launchObjects.$inferSelect;

export type CreateItem = {
  ref: string;
  kind: LaunchObjectKind;
  name: string;
  /** Edge to POST to, e.g. "act_1/campaigns". */
  edge: string;
  payload: Record<string, unknown>;
  /** Edge to search by name if a previous attempt's outcome is unknown, e.g. "<campaignId>/adsets". */
  reconcileEdge?: string;
};

/**
 * Durable record of every object a launch creates. Each object gets a "pending" row before the
 * request goes out, so a crash between Meta creating it and us saving the id is detectable; the
 * retry then looks it up by name instead of creating a duplicate.
 */
export class Ledger {
  private constructor(
    readonly launchId: string,
    private rows: Map<string, Row>,
    private readonly accountId: string,
  ) {}

  static async load(launchId: string, accountId: string): Promise<Ledger> {
    const rows = await db().select().from(launchObjects).where(eq(launchObjects.launchId, launchId));
    return new Ledger(launchId, new Map(rows.map((r) => [r.ref, r])), accountId);
  }

  isCreated(ref: string): boolean {
    const r = this.rows.get(ref);
    return r?.status === "created" && !!r.metaId;
  }

  id(ref: string): string {
    const r = this.rows.get(ref);
    if (!r?.metaId || r.status !== "created") throw new Error(`Launch object ${ref} has not been created`);
    return r.metaId;
  }

  all(): Row[] {
    return [...this.rows.values()];
  }

  private async save(item: Omit<CreateItem, "edge" | "reconcileEdge">, values: Partial<Row>) {
    const set = { kind: item.kind, name: item.name, payload: item.payload, ...values };
    const [row] = await db()
      .insert(launchObjects)
      .values({ launchId: this.launchId, ref: item.ref, ...set })
      .onConflictDoUpdate({ target: [launchObjects.launchId, launchObjects.ref], set })
      .returning();
    this.rows.set(item.ref, row);
  }

  async markStatus(ref: string, status: "deleted" | "created") {
    await db().update(launchObjects).set({ status }).where(eq(launchObjects.id, this.rows.get(ref)!.id));
    this.rows.get(ref)!.status = status;
  }

  private async reconcile(item: CreateItem, pendingSince: number): Promise<string | null> {
    if (!item.reconcileEdge) return null;
    const res = await graph<{ data: { id: string; name: string; created_time: string }[] }>(item.reconcileEdge, {
      params: {
        fields: "id,name,created_time",
        filtering: [{ field: "name", operator: "EQUAL", value: item.name }],
        limit: 50,
      },
      accountId: this.accountId,
      mode: "background",
    });
    const taken = new Set(this.all().map((r) => r.metaId));
    // Check the name ourselves too: never adopt (and later roll back) someone else's object.
    const match = res.data.find(
      (o) => o.name === item.name && !taken.has(o.id) && Date.parse(o.created_time) >= pendingSince - 120_000,
    );
    return match?.id ?? null;
  }

  /**
   * For rollback: rows still "pending" may exist in Meta (request sent, response lost). Look each
   * one up by name on the ad account and adopt it so it gets deleted with the rest.
   */
  async resolvePending(): Promise<void> {
    for (const row of this.all()) {
      if (row.status !== "pending" || row.kind === "creative") continue; // orphan creatives never deliver
      const found = await this.reconcile(
        { ref: row.ref, kind: row.kind, name: row.name, edge: "", payload: {}, reconcileEdge: `${this.accountId}/${row.kind}s` },
        row.updatedAt,
      );
      if (found) {
        await db().update(launchObjects).set({ metaId: found, status: "created" }).where(eq(launchObjects.id, row.id));
        this.rows.set(row.ref, { ...row, metaId: found, status: "created" });
      }
    }
  }

  /**
   * Creates every item not yet created, using one Graph batch call per 50 objects.
   * Successful creations are recorded even when siblings fail; the first error is then thrown.
   */
  async createMany(items: CreateItem[]): Promise<void> {
    const todo: CreateItem[] = [];
    for (const item of items) {
      if (this.isCreated(item.ref)) continue;
      const prev = this.rows.get(item.ref);
      if (prev?.status === "pending") {
        const found = await this.reconcile(item, prev.updatedAt);
        if (found) {
          await this.save(item, { metaId: found, status: "created" });
          continue;
        }
      }
      todo.push(item);
    }
    if (todo.length === 0) return;

    for (const item of todo) await this.save(item, { metaId: null, status: "pending" });

    const results = await graphBatch<{ id: string }>(
      todo.map((i) => ({ method: "POST", relativeUrl: i.edge, params: i.payload })),
      { accountId: this.accountId, mode: "background" },
    );
    let firstError: Error | undefined;
    for (const [k, r] of results.entries()) {
      if (r.ok) await this.save(todo[k], { metaId: r.data.id, status: "created" });
      else if (r.error.isTransient) {
        // Not executed, or a 5xx where Meta may still have created it: stay "pending" so the
        // retry reconciles by name instead of creating a duplicate.
        firstError ??= Object.assign(r.error, { message: `${todo[k].kind} "${todo[k].name}": ${r.error.message}` });
      } else {
        // A definite rejection (validation error), so the object doesn't exist.
        await this.save(todo[k], { metaId: null, status: "failed" });
        firstError ??= Object.assign(r.error, { message: `${todo[k].kind} "${todo[k].name}": ${r.error.message}` });
      }
    }
    if (firstError) throw firstError;
  }
}
