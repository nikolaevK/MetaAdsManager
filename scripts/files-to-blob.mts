import { readFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { creativeAssets } from "@/lib/db/schema";
import { contentFingerprint } from "@/lib/fingerprint";
import { readHead } from "@/lib/storage";

/**
 * npm run files:to-blob — one-off copy of library files from the old local folder (STORAGE_DIR, default ./storage)
 * into the Blob store, under the same keys. Safe to re-run: files already in Blob are skipped.
 */
const dir = path.resolve(process.env.STORAGE_DIR ?? "./storage");
let copied = 0;
let present = 0;
const missing: string[] = [];

for (const asset of await db().select().from(creativeAssets)) {
  if (await readHead(asset.storageKey)) {
    present++;
    continue;
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(dir, asset.storageKey));
  } catch {
    missing.push(asset.fileName);
    continue;
  }
  await put(asset.storageKey, bytes, { access: "private", contentType: asset.mimeType, multipart: bytes.length >= 100 * 1024 * 1024 });
  // New uploads are fingerprinted this way, so re-uploading one of these files is recognised as a duplicate.
  const sha256 = await contentFingerprint(new Blob([new Uint8Array(bytes)]));
  await db().update(creativeAssets).set({ sha256 }).where(eq(creativeAssets.id, asset.id));
  copied++;
}

console.log(`Copied ${copied} file(s) to Blob; ${present} were already there.`);
if (missing.length) console.warn(`Not found in ${dir}: ${missing.join(", ")}`);
