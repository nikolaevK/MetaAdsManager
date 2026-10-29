import { and, eq } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { authorizeRoute } from "@/lib/auth/route";
import { db } from "@/lib/db";
import { clients, creativeAssets } from "@/lib/db/schema";
import { deleteObject, sniffMediaType, UploadRejectedError, UploadTooLargeError, writeUpload } from "@/lib/storage";

const IMAGE_MAX_BYTES = 30 * 1024 * 1024;
const VIDEO_MAX_BYTES = 4 * 1024 * 1024 * 1024;

const json = (body: unknown, status: number) => Response.json(body, { status });

function positiveInt(value: string | null): number | null {
  if (!value || !/^\d{1,6}$/.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}

function aspectOf(width: number, height: number): string {
  const r = width / height;
  const near = (target: number) => Math.abs(r - target) < 0.02;
  if (near(1)) return "1:1";
  if (near(0.5625)) return "9:16";
  if (near(0.8)) return "4:5";
  if (near(16 / 9)) return "16:9";
  return "other";
}

/**
 * Streams a creative file to storage. The body is the raw file; metadata travels in headers so
 * nothing is buffered in memory. File type is decided by magic bytes, never by the client.
 */
export async function PUT(request: Request) {
  const auth = await authorizeRoute(request, "buyer");
  if ("error" in auth) return auth.error;

  const clientId = request.headers.get("x-client-id") ?? "";
  if (!/^[A-Za-z0-9-]{1,64}$/.test(clientId)) return json({ error: "Missing or invalid client" }, 400);

  let fileName = "";
  try {
    fileName = decodeURIComponent(request.headers.get("x-file-name") ?? "").trim().slice(0, 200);
  } catch {
    return json({ error: "Invalid file name" }, 400);
  }
  // Strip path components and control characters; the name is display-only.
  fileName = fileName.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f\u007f]/g, "");
  if (!fileName) return json({ error: "Missing file name" }, 400);

  const width = positiveInt(request.headers.get("x-width"));
  const height = positiveInt(request.headers.get("x-height"));
  if (!width || !height) return json({ error: "Missing or invalid dimensions" }, 400);
  if (!request.body) return json({ error: "Empty body" }, 400);

  const [client] = await db().select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) return json({ error: "Client not found" }, 400);

  // Storage keys need an extension up front; the real type is stored as mimeType in the DB.
  const detected: { type: ReturnType<typeof sniffMediaType> } = { type: null };
  let stored: Awaited<ReturnType<typeof writeUpload>>;
  try {
    stored = await writeUpload(client.id, "bin", request.body, {
      maxBytes: VIDEO_MAX_BYTES,
      // Decided from the first bytes, so an unsupported or oversized file is cut off immediately.
      inspect: (head) => {
        detected.type = sniffMediaType(head);
        if (!detected.type) return { error: "Unsupported file type" };
        return { maxBytes: detected.type.kind === "image" ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES };
      },
    });
  } catch (err) {
    if (err instanceof UploadTooLargeError) {
      return json({ error: detected.type?.kind === "image" ? "Images must be 30 MB or smaller" : "Videos must be 4 GB or smaller" }, 413);
    }
    if (err instanceof UploadRejectedError) return json({ error: "Unsupported file type. Use JPG, PNG, MP4 or MOV." }, 415);
    throw err;
  }
  const type = detected.type!;

  const [inserted] = await db()
    .insert(creativeAssets)
    .values({
      clientId: client.id,
      kind: type.kind,
      fileName,
      storageKey: stored.key,
      mimeType: type.mime,
      sizeBytes: stored.size,
      width,
      height,
      aspect: aspectOf(width, height),
      sha256: stored.sha256,
      createdBy: auth.user.id,
    })
    .onConflictDoNothing()
    .returning();

  if (!inserted) {
    // Same bytes already in this client's library: keep the original, drop the new copy.
    await deleteObject(stored.key);
    const [existing] = await db()
      .select()
      .from(creativeAssets)
      .where(and(eq(creativeAssets.clientId, client.id), eq(creativeAssets.sha256, stored.sha256)))
      .limit(1);
    return json({ asset: existing, duplicate: true }, 200);
  }

  await audit(auth.user.id, "asset.upload", { type: "asset", id: inserted.id }, { fileName, kind: type.kind, size: stored.size });
  return json({ asset: inserted, duplicate: false }, 201);
}
