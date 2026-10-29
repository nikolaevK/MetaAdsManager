/** Browser-side upload of one creative file to /api/media/upload. Shared by the library and the campaign builder. */

export const ACCEPT = "image/jpeg,image/png,video/mp4,video/quicktime";
export const accepted = (file: File) => ACCEPT.split(",").includes(file.type);

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

/** Streams the file to the client's library. Resolves with the stored asset (or the existing copy of identical bytes). */
export async function uploadAsset(file: File, clientId: string): Promise<{ asset: UploadedAsset; duplicate: boolean }> {
  // Same caps as /api/media/upload, checked up front so a huge file fails with a clear reason.
  const image = file.type.startsWith("image/");
  if (file.size > (image ? 30 * 1024 ** 2 : 4 * 1024 ** 3)) throw new Error(`Too large: ${image ? "images" : "videos"} can be up to ${image ? "30 MB" : "4 GB"}`);
  const { width, height } = await dimensions(file);
  const res = await fetch("/api/media/upload", {
    method: "PUT",
    body: file,
    headers: {
      "x-client-id": clientId,
      "x-file-name": encodeURIComponent(file.name),
      "x-width": String(width),
      "x-height": String(height),
      "content-type": file.type,
    },
  });
  const body = (await res.json().catch(() => ({}))) as { asset?: UploadedAsset; error?: string; duplicate?: boolean };
  if (!res.ok || !body.asset) throw new Error(body.error ?? `Upload failed (${res.status})`);
  return { asset: body.asset, duplicate: !!body.duplicate };
}
