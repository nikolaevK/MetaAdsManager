import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "@/lib/env";

/** Local-disk object storage. Keys are generated server-side: "<clientId>/<uuid>.<ext>". */

const KEY_RE = /^[A-Za-z0-9-]{1,64}\/[A-Za-z0-9-]{1,64}\.[a-z0-9]{2,5}$/;

function root(): string {
  return path.resolve(env().STORAGE_DIR);
}

export function resolveKey(key: string): string {
  if (!KEY_RE.test(key)) throw new Error("Invalid storage key");
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Invalid storage key");
  return full;
}

export class UploadTooLargeError extends Error {}
export class UploadRejectedError extends Error {}

const HEAD_BYTES = 16;

/**
 * Streams a request body to disk while hashing it. `inspect` sees the first bytes as soon as they
 * arrive and either rejects the upload or sets its size cap, so junk is aborted immediately rather
 * than after a multi-GB transfer. Data lands in a temp file that's only renamed on success.
 */
export async function writeUpload(
  folder: string,
  ext: string,
  body: ReadableStream<Uint8Array>,
  opts: { maxBytes: number; inspect: (head: Buffer) => { error: string } | { maxBytes: number } },
): Promise<{ key: string; size: number; sha256: string }> {
  const key = `${folder}/${randomUUID()}.${ext}`;
  const finalPath = resolveKey(key);
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  const tmpPath = `${finalPath}.part`;

  const hash = createHash("sha256");
  let size = 0;
  let maxBytes = opts.maxBytes;
  let head = Buffer.alloc(0);
  let inspected = false;
  const inspect = (): Error | null => {
    inspected = true;
    const verdict = opts.inspect(head);
    if ("error" in verdict) return new UploadRejectedError(verdict.error);
    maxBytes = Math.min(maxBytes, verdict.maxBytes);
    return size > maxBytes ? new UploadTooLargeError(`File exceeds ${maxBytes} bytes`) : null;
  };
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (head.length < HEAD_BYTES) head = Buffer.concat([head, chunk.subarray(0, HEAD_BYTES - head.length)]);
      if (!inspected && head.length >= HEAD_BYTES) {
        const err = inspect();
        if (err) return cb(err);
      }
      if (size > maxBytes) return cb(new UploadTooLargeError(`File exceeds ${maxBytes} bytes`));
      hash.update(chunk);
      cb(null, chunk);
    },
    flush(cb) {
      // Files shorter than HEAD_BYTES are inspected at the end.
      cb(inspected ? null : inspect());
    },
  });

  try {
    await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), meter, createWriteStream(tmpPath));
    await fs.rename(tmpPath, finalPath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true });
    throw err;
  }
  return { key, size, sha256: hash.digest("hex") };
}

export async function readObject(key: string): Promise<Buffer> {
  return fs.readFile(resolveKey(key));
}

export async function readRange(key: string, start: number, endExclusive: number): Promise<Buffer> {
  const handle = await fs.open(resolveKey(key), "r");
  try {
    const buf = Buffer.alloc(endExclusive - start);
    const { bytesRead } = await handle.read(buf, 0, buf.length, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function statObject(key: string): Promise<{ size: number } | null> {
  try {
    const s = await fs.stat(resolveKey(key));
    return { size: s.size };
  } catch {
    return null;
  }
}

export function streamObject(key: string, range?: { start: number; end: number }): ReadableStream {
  return Readable.toWeb(createReadStream(resolveKey(key), range)) as ReadableStream;
}

export async function deleteObject(key: string): Promise<void> {
  await fs.rm(resolveKey(key), { force: true });
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
