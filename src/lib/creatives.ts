import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { SQUARE_ASPECTS, VERTICAL_ASPECTS, baseName } from "@/app/(app)/library/pairing";
import { UserError } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { creativeAssets, creatives } from "@/lib/db/schema";
import type { MediaPick } from "@/lib/launch/spec";

type Asset = typeof creativeAssets.$inferSelect;

/**
 * Loads and checks the files of a media pick. Two files must be the same kind and match their
 * placements (feed 1:1 / 4:5, Stories & Reels 9:16); a single file runs everywhere. Flexible-format
 * files (`more`) can be any mix of images and videos.
 */
export async function loadMedia(clientId: string, pick: MediaPick): Promise<{ square: Asset; vertical: Asset; more: Asset[] }> {
  const moreIds = pick.moreAssetIds ?? [];
  if (moreIds.length && pick.verticalAssetId) throw new UserError("A Flexible-format ad has no separate Stories & Reels file.");
  if (new Set([pick.feedAssetId, ...moreIds]).size !== moreIds.length + 1) throw new UserError("Each file can be used once per ad.");
  const verticalId = pick.verticalAssetId || pick.feedAssetId;
  const rows = await db()
    .select()
    .from(creativeAssets)
    .where(and(eq(creativeAssets.clientId, clientId), inArray(creativeAssets.id, [pick.feedAssetId, verticalId, ...moreIds])));
  const square = rows.find((a) => a.id === pick.feedAssetId);
  const vertical = rows.find((a) => a.id === verticalId);
  const more = moreIds.map((id) => rows.find((a) => a.id === id));
  if (!square || !vertical || more.some((a) => !a)) throw new UserError("A media file is missing from this client's library.");
  if (square.id !== vertical.id) {
    if (square.kind !== vertical.kind) throw new UserError(`${square.fileName}: use two images or two videos, not one of each.`);
    if (!SQUARE_ASPECTS.has(square.aspect)) throw new UserError(`${square.fileName}: the feed file must be 1:1 or 4:5. Crop it, or use it for every placement.`);
    if (!VERTICAL_ASPECTS.has(vertical.aspect)) throw new UserError(`${vertical.fileName}: the Stories & Reels file must be 9:16.`);
  }
  return { square, vertical, more: more as Asset[] };
}

/** The library creative for a media pick, created if needed, so launches and the library share one record. */
export async function findOrCreateCreative(clientId: string, pick: MediaPick, userId: string) {
  const { square, vertical } = await loadMedia(clientId, pick);
  const [existing] = await db()
    .select({ id: creatives.id, kind: creatives.kind })
    .from(creatives)
    .where(and(eq(creatives.clientId, clientId), eq(creatives.squareAssetId, square.id), eq(creatives.verticalAssetId, vertical.id), isNull(creatives.archivedAt)))
    .limit(1);
  if (existing) return existing;
  const [row] = await db()
    .insert(creatives)
    .values({ clientId, name: baseName(square.fileName), kind: square.kind, squareAssetId: square.id, verticalAssetId: vertical.id })
    .returning({ id: creatives.id, kind: creatives.kind });
  await audit(userId, "creative.create", { type: "creative", id: row.id }, { from: "builder" });
  return row;
}
