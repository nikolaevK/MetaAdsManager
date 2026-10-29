"use server";

import { and, eq, inArray, or } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { failure, UserError, type ActionState } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { creativeAssets, creatives } from "@/lib/db/schema";
import { deleteObject } from "@/lib/storage";
import { getWorkspace } from "@/lib/workspace";
import { findPairs, SQUARE_ASPECTS, VERTICAL_ASPECTS } from "./pairing";

const uuid = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);

/** Every library write is scoped to the client selected in the workspace. */
async function workspaceClientId(): Promise<string> {
  const { client } = await getWorkspace();
  if (!client) throw new UserError("Select a client first.");
  return client.id;
}

async function unpairedAssets(clientId: string) {
  const refs = await db()
    .select({ s: creatives.squareAssetId, v: creatives.verticalAssetId })
    .from(creatives)
    .where(eq(creatives.clientId, clientId));
  const used = new Set(refs.flatMap((r) => [r.s, r.v]));
  const all = await db().select().from(creativeAssets).where(eq(creativeAssets.clientId, clientId));
  return all.filter((a) => !used.has(a.id));
}

/** After an upload: turn matching "<name>_1x1" + "<name>_9x16" files into creatives. */
export async function autoPairAction(uploadedIds: string[]): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const ids = new Set(z.array(uuid).max(500).parse(uploadedIds));
    // Pair within the client the files were uploaded to (not whatever the workspace cookie says now,
    // which another tab may have switched).
    const owners = await db()
      .selectDistinct({ clientId: creativeAssets.clientId })
      .from(creativeAssets)
      .where(inArray(creativeAssets.id, [...ids]));
    if (owners.length > 1) throw new UserError("Uploaded files belong to different clients.");
    const clientId = owners[0]?.clientId ?? (await workspaceClientId());
    // Only pairs that include something just uploaded, so older loose files aren't surprise-paired.
    const pairs = findPairs(await unpairedAssets(clientId)).filter((p) => ids.has(p.square.id) || ids.has(p.vertical.id));
    if (pairs.length) {
      await db()
        .insert(creatives)
        .values(
          pairs.map((p) => ({
            clientId,
            name: p.name,
            kind: p.square.kind,
            squareAssetId: p.square.id,
            verticalAssetId: p.vertical.id,
          })),
        );
      await audit(user.id, "creative.autopair", { type: "client", id: clientId }, { count: pairs.length });
    }
    refresh();
    return {
      ok: true,
      message: pairs.length
        ? `Created ${pairs.length} creative${pairs.length === 1 ? "" : "s"} from matching 1:1 + 9:16 files`
        : "Uploaded. Pair the files below to create creatives.",
    };
  } catch (err) {
    return failure(err);
  }
}

const creativeInput = z.object({
  name: z.string().trim().min(1).max(200),
  squareAssetId: uuid,
  /** Omitted (or the same id) = a single-file creative used for every placement. */
  verticalAssetId: uuid.optional(),
  angle: z.string().trim().max(100).optional(),
});

export async function createCreativeAction(input: z.input<typeof creativeInput>): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const data = creativeInput.parse(input);
    const clientId = await workspaceClientId();
    const verticalId = data.verticalAssetId ?? data.squareAssetId;
    const assets = await db()
      .select()
      .from(creativeAssets)
      .where(and(eq(creativeAssets.clientId, clientId), inArray(creativeAssets.id, [data.squareAssetId, verticalId])));
    const square = assets.find((a) => a.id === data.squareAssetId);
    const vertical = assets.find((a) => a.id === verticalId);
    if (!square || !vertical) throw new UserError("Pick files from this client's library.");
    // A single file runs as-is in every placement (Meta crops/letterboxes); a pair is split by placement.
    if (square.id !== vertical.id) {
      if (square.kind !== vertical.kind) throw new UserError("Both files must be images, or both videos.");
      if (!SQUARE_ASPECTS.has(square.aspect)) throw new UserError("The feed file must be 1:1 or 4:5.");
      if (!VERTICAL_ASPECTS.has(vertical.aspect)) throw new UserError("The Stories/Reels file must be 9:16.");
    }

    const [row] = await db()
      .insert(creatives)
      .values({
        clientId,
        name: data.name,
        kind: square.kind,
        squareAssetId: square.id,
        verticalAssetId: vertical.id,
        angle: data.angle || null,
      })
      .returning();
    await audit(user.id, "creative.create", { type: "creative", id: row.id }, { name: data.name });
    refresh();
    return { ok: true, message: `Creative "${data.name}" created` };
  } catch (err) {
    return failure(err);
  }
}

export async function updateCreativeAction(input: { id: string; name: string; angle?: string }): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const data = z
      .object({ id: uuid, name: z.string().trim().min(1).max(200), angle: z.string().trim().max(100).optional() })
      .parse(input);
    const clientId = await workspaceClientId();
    const updated = await db()
      .update(creatives)
      .set({ name: data.name, angle: data.angle || null })
      .where(and(eq(creatives.id, data.id), eq(creatives.clientId, clientId)))
      .returning({ id: creatives.id });
    if (!updated.length) throw new UserError("Creative not found.");
    await audit(user.id, "creative.update", { type: "creative", id: data.id }, { name: data.name, angle: data.angle });
    refresh();
    return { ok: true, message: "Creative updated" };
  } catch (err) {
    return failure(err);
  }
}

export async function archiveCreativeAction(input: { id: string; archived: boolean }): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const data = z.object({ id: uuid, archived: z.boolean() }).parse(input);
    const clientId = await workspaceClientId();
    const updated = await db()
      .update(creatives)
      .set({ archivedAt: data.archived ? Date.now() : null })
      .where(and(eq(creatives.id, data.id), eq(creatives.clientId, clientId)))
      .returning({ id: creatives.id });
    if (!updated.length) throw new UserError("Creative not found.");
    await audit(user.id, data.archived ? "creative.archive" : "creative.restore", { type: "creative", id: data.id });
    refresh();
    return { ok: true, message: data.archived ? "Creative archived" : "Creative restored" };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteAssetAction(input: { id: string }): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const { id } = z.object({ id: uuid }).parse(input);
    const clientId = await workspaceClientId();
    const [asset] = await db()
      .select()
      .from(creativeAssets)
      .where(and(eq(creativeAssets.id, id), eq(creativeAssets.clientId, clientId)))
      .limit(1);
    if (!asset) throw new UserError("File not found.");
    const [used] = await db()
      .select({ id: creatives.id })
      .from(creatives)
      .where(or(eq(creatives.squareAssetId, id), eq(creatives.verticalAssetId, id)))
      .limit(1);
    if (used) throw new UserError("This file is used by a creative. Archive the creative instead.");

    await db().delete(creativeAssets).where(eq(creativeAssets.id, id));
    await deleteObject(asset.storageKey);
    await audit(user.id, "asset.delete", { type: "asset", id }, { fileName: asset.fileName });
    refresh();
    return { ok: true, message: `Deleted ${asset.fileName}` };
  } catch (err) {
    return failure(err);
  }
}
