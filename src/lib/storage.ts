import "server-only";
import { del, get } from "@vercel/blob";

/**
 * Library files live in a private Vercel Blob store. Keys are blob pathnames, "<clientId>/<id>.<ext>". The SDK
 * authenticates from the environment (BLOB_READ_WRITE_TOKEN, or Vercel's OIDC token with BLOB_STORE_ID).
 */

async function open(key: string, range?: { start: number; end: number }) {
  const res = await get(key, { access: "private", headers: range ? { Range: `bytes=${range.start}-${range.end}` } : undefined });
  return res?.statusCode === 200 ? res : null;
}

/** The whole file, or null if it's missing. */
export async function readObject(key: string): Promise<Buffer | null> {
  const res = await open(key);
  return res && Buffer.from(await new Response(res.stream).arrayBuffer());
}

/** Bytes [start, end) of a file, or null if it's missing. */
export async function readRange(key: string, start: number, end: number): Promise<Buffer | null> {
  const res = await open(key, { start, end: end - 1 });
  return res && Buffer.from(await new Response(res.stream).arrayBuffer());
}

/** The file's first bytes and total size, reading no further; null if it's missing. */
export async function readHead(key: string, bytes = 16): Promise<{ head: Buffer; size: number } | null> {
  const res = await open(key, { start: 0, end: bytes - 1 });
  if (!res) return null;
  const total = res.headers.get("content-range")?.split("/")[1] ?? res.headers.get("content-length");
  const reader = res.stream.getReader();
  const parts: Uint8Array[] = [];
  for (let n = 0; n < bytes; ) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.length;
  }
  await reader.cancel();
  return { head: Buffer.concat(parts).subarray(0, bytes), size: Number(total) };
}

/** Streams the file, or bytes [start, end] of it (inclusive, as in HTTP ranges); null if it's missing. */
export async function streamObject(key: string, range?: { start: number; end: number }): Promise<ReadableStream | null> {
  return (await open(key, range))?.stream ?? null;
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length) await del(keys);
}

const NON_VIDEO_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1", "avif", "avis", "M4A ", "M4B ", "M4P "]);

/** Magic-byte sniffing: never trust the client's Content-Type. */
export function sniffMediaType(head: Buffer): { kind: "image" | "video"; mime: string; ext: string } | null {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { kind: "image", mime: "image/jpeg", ext: "jpg" };
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { kind: "image", mime: "image/png", ext: "png" };
  if (head.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = head.subarray(8, 12).toString("latin1");
    // Same container, not video: HEIC/HEIF/AVIF stills and M4A/M4B audio. Meta's ad APIs reject them.
    if (NON_VIDEO_BRANDS.has(brand)) return null;
    if (brand === "qt  ") return { kind: "video", mime: "video/quicktime", ext: "mov" };
    return { kind: "video", mime: "video/mp4", ext: "mp4" };
  }
  return null;
}
