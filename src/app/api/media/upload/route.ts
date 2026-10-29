import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { authorizeRoute } from "@/lib/auth/route";
import { db } from "@/lib/db";
import { clients, creativeAssets } from "@/lib/db/schema";
import { deleteObjects, readHead, sniffMediaType } from "@/lib/storage";

const IMAGE_MAX_BYTES = 30 * 1024 * 1024;
const VIDEO_MAX_BYTES = 4 * 1024 * 1024 * 1024;

/** "<clientId>/<uuid>.<ext>": picked by the browser, checked here. The extension only sets the upload's limits. */
const PATHNAME = /^([A-Za-z0-9-]{1,64})\/[0-9a-f-]{36}\.(jpg|png|mp4|mov)$/;
const CONTENT_TYPES = { jpg: "image/jpeg", png: "image/png", mp4: "video/mp4", mov: "video/quicktime" } as const;

const json = (body: unknown, status: number) => Response.json(body, { status });

const clientExists = async (id: string) =>
  (await db().select({ id: clients.id }).from(clients).where(eq(clients.id, id)).limit(1)).length > 0;

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
 * Step 1, Vercel Blob's client-upload handshake: a short-lived token for one path in a client's folder. The browser
 * then sends the file straight to Blob, so uploads aren't held to the 4.5 MB request limit of Vercel Functions.
 */
export async function POST(request: Request) {
  const auth = await authorizeRoute(request, "buyer");
  if ("error" in auth) return auth.error;
  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const match = PATHNAME.exec(pathname);
        if (!match || !(await clientExists(match[1]))) throw new Error("Invalid upload path");
        const ext = match[2] as keyof typeof CONTENT_TYPES;
        return {
          allowedContentTypes: [CONTENT_TYPES[ext]],
          maximumSizeInBytes: ext === "jpg" || ext === "png" ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES,
        };
      },
    });
    return Response.json(result);
  } catch (err) {
    console.error("[upload] couldn't issue an upload token:", err);
    return json({ error: err instanceof Error ? err.message : "Upload failed" }, 400);
  }
}

const uploaded = z.object({
  pathname: z.string().regex(PATHNAME),
  fileName: z.string().max(1000),
  width: z.number().int().min(1).max(999_999),
  height: z.number().int().min(1).max(999_999),
  /** Content fingerprint from the browser (lib/fingerprint), used to spot re-uploads. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

/**
 * Step 2, once the browser's upload finishes: decides the file type from its first bytes (never the client's
 * Content-Type), enforces the size caps, and adds it to the client's library. Anything rejected is deleted.
 */
export async function PUT(request: Request) {
  const auth = await authorizeRoute(request, "buyer");
  if ("error" in auth) return auth.error;

  const parsed = uploaded.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid upload" }, 400);
  const { pathname, width, height, sha256 } = parsed.data;
  // Strip path components and control characters; the name is display-only.
  const fileName = parsed.data.fileName.trim().slice(0, 200).replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f\u007f]/g, "");
  if (!fileName) return json({ error: "Missing file name" }, 400);
  const clientId = PATHNAME.exec(pathname)![1];
  if (!(await clientExists(clientId))) return json({ error: "Client not found" }, 400);

  // A retried request after the first one went through.
  const [registered] = await db().select().from(creativeAssets).where(eq(creativeAssets.storageKey, pathname)).limit(1);
  if (registered) return json({ asset: registered, duplicate: false }, 200);

  const stored = await readHead(pathname);
  if (!stored) return json({ error: "Upload not found" }, 404);
  const type = sniffMediaType(stored.head);
  if (!type) {
    await deleteObjects([pathname]);
    return json({ error: "Unsupported file type. Use JPG, PNG, MP4 or MOV." }, 415);
  }
  if (stored.size > (type.kind === "image" ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES)) {
    await deleteObjects([pathname]);
    return json({ error: type.kind === "image" ? "Images must be 30 MB or smaller" : "Videos must be 4 GB or smaller" }, 413);
  }

  const [inserted] = await db()
    .insert(creativeAssets)
    .values({
      clientId,
      kind: type.kind,
      fileName,
      storageKey: pathname,
      mimeType: type.mime,
      sizeBytes: stored.size,
      width,
      height,
      aspect: aspectOf(width, height),
      sha256,
      createdBy: auth.user.id,
    })
    .onConflictDoNothing()
    .returning();

  if (!inserted) {
    // Same bytes already in this client's library: keep the original, drop the new copy.
    await deleteObjects([pathname]);
    const [existing] = await db()
      .select()
      .from(creativeAssets)
      .where(and(eq(creativeAssets.clientId, clientId), eq(creativeAssets.sha256, sha256)))
      .limit(1);
    return json({ asset: existing, duplicate: true }, 200);
  }

  await audit(auth.user.id, "asset.upload", { type: "asset", id: inserted.id }, { fileName, kind: type.kind, size: stored.size });
  return json({ asset: inserted, duplicate: false }, 201);
}
