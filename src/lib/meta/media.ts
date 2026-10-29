import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { creativeAssets, metaMedia } from "@/lib/db/schema";
import type { MediaRef } from "@/lib/launch/payloads";
import { readObject, readRange, statObject } from "@/lib/storage";
import { graph } from "./client";
import type { CallMode } from "./rate-limit";

type Asset = typeof creativeAssets.$inferSelect;

export type MediaState = { ready: true; ref: MediaRef } | { ready: false; detail: string };

async function upsert(assetId: string, adAccountId: string, values: Partial<typeof metaMedia.$inferInsert>) {
  await db()
    .insert(metaMedia)
    .values({ assetId, adAccountId, ...values })
    .onConflictDoUpdate({ target: [metaMedia.assetId, metaMedia.adAccountId], set: values });
}

/**
 * Makes sure a library asset exists in the ad account's media library.
 * Images: POST /adimages → hash. Videos: chunked POST /advideos, then poll until processed.
 * Re-entrant: call repeatedly until it reports ready.
 */
export async function ensureMetaMedia(asset: Asset, adAccountId: string, mode: CallMode): Promise<MediaState> {
  const [cached] = await db()
    .select()
    .from(metaMedia)
    .where(and(eq(metaMedia.assetId, asset.id), eq(metaMedia.adAccountId, adAccountId)))
    .limit(1);

  if (asset.kind === "image") {
    if (cached?.imageHash) return { ready: true, ref: { kind: "image", hash: cached.imageHash } };
    const bytes = await readObject(asset.storageKey);
    const form = new FormData();
    form.set("filename", new Blob([new Uint8Array(bytes)], { type: asset.mimeType }), asset.fileName);
    const res = await graph<{ images: Record<string, { hash: string; url: string }> }>(`${adAccountId}/adimages`, {
      method: "POST",
      form,
      accountId: adAccountId,
      mode,
      timeoutMs: 180_000,
    });
    const img = Object.values(res.images)[0];
    if (!img?.hash) throw new Error(`Meta did not return an image hash for ${asset.fileName}`);
    await upsert(asset.id, adAccountId, { imageHash: img.hash, imageUrl: img.url });
    return { ready: true, ref: { kind: "image", hash: img.hash } };
  }

  // Video
  if (cached?.videoId && cached.videoStatus === "ready" && cached.thumbnailUrl) {
    return { ready: true, ref: { kind: "video", videoId: cached.videoId, thumbnailUrl: cached.thumbnailUrl } };
  }
  if (cached?.videoId && (cached.videoStatus === "processing" || cached.videoStatus === "ready")) {
    return pollVideo(asset, adAccountId, cached.videoId, mode);
  }
  const videoId = await uploadVideoChunked(asset, adAccountId, mode);
  await upsert(asset.id, adAccountId, { videoId, videoStatus: "processing" });
  return { ready: false, detail: `Uploaded ${asset.fileName}; Meta is processing the video` };
}

async function pollVideo(asset: Asset, adAccountId: string, videoId: string, mode: CallMode): Promise<MediaState> {
  const res = await graph<{ status?: { video_status?: string; processing_progress?: number } }>(videoId, {
    params: { fields: "status" },
    accountId: adAccountId,
    mode,
  });
  const status = res.status?.video_status;
  if (status === "error") {
    await upsert(asset.id, adAccountId, { videoStatus: "error" });
    throw new Error(`Meta failed to process video ${asset.fileName}`);
  }
  if (status !== "ready") {
    return { ready: false, detail: `Processing ${asset.fileName} (${res.status?.processing_progress ?? 0}%)` };
  }
  const thumbs = await graph<{ data: { uri: string; is_preferred: boolean }[] }>(`${videoId}/thumbnails`, {
    params: { fields: "uri,is_preferred" },
    accountId: adAccountId,
    mode,
  });
  const thumb = thumbs.data.find((t) => t.is_preferred) ?? thumbs.data[0];
  if (!thumb) return { ready: false, detail: `Waiting for thumbnails of ${asset.fileName}` };
  await upsert(asset.id, adAccountId, { videoStatus: "ready", thumbnailUrl: thumb.uri });
  return { ready: true, ref: { kind: "video", videoId, thumbnailUrl: thumb.uri } };
}

/** Resumable upload: start → transfer chunks at the offsets Meta asks for → finish. */
async function uploadVideoChunked(asset: Asset, adAccountId: string, mode: CallMode): Promise<string> {
  const stat = await statObject(asset.storageKey);
  if (!stat) throw new Error(`File for ${asset.fileName} is missing from storage`);
  const path = `${adAccountId}/advideos`;
  const common = { method: "POST" as const, accountId: adAccountId, mode, host: "video" as const };

  const start = await graph<{ upload_session_id: string; video_id: string; start_offset: string; end_offset: string }>(
    path,
    { ...common, params: { upload_phase: "start", file_size: stat.size } },
  );
  let from = Number(start.start_offset);
  let to = Number(start.end_offset);
  while (from < to) {
    const chunk = await readRange(asset.storageKey, from, to);
    const form = new FormData();
    form.set("video_file_chunk", new Blob([new Uint8Array(chunk)]), "chunk");
    const next = await graph<{ start_offset: string; end_offset: string }>(path, {
      ...common,
      params: { upload_phase: "transfer", upload_session_id: start.upload_session_id, start_offset: from },
      form,
      timeoutMs: 300_000,
    });
    from = Number(next.start_offset);
    to = Number(next.end_offset);
  }
  await graph(path, {
    ...common,
    params: { upload_phase: "finish", upload_session_id: start.upload_session_id, title: asset.fileName },
  });
  return start.video_id;
}
