/** Browser-side upload of one creative file to the library. Shared by the library and the campaign builder. */

import { contentFingerprint } from "@/lib/fingerprint";

export const ACCEPT = "image/jpeg,image/png,video/mp4,video/quicktime";
export const accepted = (file: File) => ACCEPT.split(",").includes(file.type);

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "video/mp4": "mp4", "video/quicktime": "mov" };
/** Bigger files go up in parallel parts that retry on their own. */
const MULTIPART_FROM_BYTES = 100 * 1024 * 1024;

export type UploadedAsset = { id: string; kind: "image" | "video"; fileName: string; width: number | null; height: number | null; aspect: string };

export function dimensions(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    if (file.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => resolve({ width: v.videoWidth, height: v.videoHeight });
      v.onerror = () => reject(new Error("Could not read video"));
      v.src = url;
    } else {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("Could not read image"));
      img.src = url;
    }
  }).finally(() => URL.revokeObjectURL(url));
}

/**
 * Sends the file straight to Blob storage (with a token from /api/media/upload, so there is no 4.5 MB request
 * limit), then adds it to the client's library. Resolves with the stored asset (or the existing copy of identical bytes).
 */
export async function uploadAsset(file: File, clientId: string): Promise<{ asset: UploadedAsset; duplicate: boolean }> {
  // Same caps as /api/media/upload, checked up front so a huge file fails with a clear reason.
  const image = file.type.startsWith("image/");
  if (file.size > (image ? 30 * 1024 ** 2 : 4 * 1024 ** 3)) throw new Error(`Too large: ${image ? "images" : "videos"} can be up to ${image ? "30 MB" : "4 GB"}`);
  if (!file.size) throw new Error("The file is empty");
  const { width, height } = await dimensions(file);
  // Loaded on first upload, not with every page that shows the uploader (~30 KB gzipped).
  const { upload } = await import("@vercel/blob/client");
  const [blob, sha256] = await Promise.all([
    upload(`${clientId}/${crypto.randomUUID()}.${EXTENSIONS[file.type]}`, file, {
      access: "private",
      handleUploadUrl: "/api/media/upload",
      contentType: file.type,
      multipart: file.size >= MULTIPART_FROM_BYTES,
    }).catch((err: unknown) => {
      // The SDK replaces the route's error with a generic one; this is the usual cause.
      if (err instanceof Error && /client token/i.test(err.message)) throw new Error("Couldn't start the upload. Check that file storage (Vercel Blob) is set up.");
      throw err;
    }),
    contentFingerprint(file),
  ]);
  const res = await fetch("/api/media/upload", {
    method: "PUT",
    body: JSON.stringify({ pathname: blob.pathname, fileName: file.name, width, height, sha256 }),
    headers: { "content-type": "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as { asset?: UploadedAsset; error?: string; duplicate?: boolean };
  if (!res.ok || !body.asset) throw new Error(body.error ?? `Upload failed (${res.status})`);
  return { asset: body.asset, duplicate: !!body.duplicate };
}
