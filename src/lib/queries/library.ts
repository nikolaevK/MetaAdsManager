import "server-only";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { creativeAssets, creatives } from "@/lib/db/schema";

export type Asset = typeof creativeAssets.$inferSelect;
export type Creative = typeof creatives.$inferSelect;

export type LibraryFilter = { q?: string; kind?: "image" | "video"; archived?: boolean };

export async function getLibrary(clientId: string, filter: LibraryFilter) {
  const [creativeRows, assetRows] = await Promise.all([
    db()
      .select()
      .from(creatives)
      .where(
        and(
          eq(creatives.clientId, clientId),
          filter.archived ? isNotNull(creatives.archivedAt) : isNull(creatives.archivedAt),
          filter.kind ? eq(creatives.kind, filter.kind) : undefined,
          filter.q ? sql`instr(lower(${creatives.name}), ${filter.q.toLowerCase()}) > 0` : undefined,
        ),
      )
      .orderBy(desc(creatives.createdAt))
      .limit(500),
    db().select().from(creativeAssets).where(eq(creativeAssets.clientId, clientId)).orderBy(desc(creativeAssets.createdAt)),
  ]);

  // Referenced by any creative (archived ones too: assets can't be deleted out from under them).
  const referenced = new Set(
    (
      await db()
        .select({ s: creatives.squareAssetId, v: creatives.verticalAssetId })
        .from(creatives)
        .where(eq(creatives.clientId, clientId))
    ).flatMap((r) => [r.s, r.v]),
  );
  const assets = new Map(assetRows.map((a) => [a.id, a]));
  const unpaired = assetRows.filter(
    (a) =>
      !referenced.has(a.id) &&
      (!filter.kind || a.kind === filter.kind) &&
      (!filter.q || a.fileName.toLowerCase().includes(filter.q.toLowerCase())),
  );
  return { creatives: creativeRows, assets, unpaired };
}
