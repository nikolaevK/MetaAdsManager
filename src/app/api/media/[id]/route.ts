import { eq } from "drizzle-orm";
import { authorizeRoute } from "@/lib/auth/route";
import { db } from "@/lib/db";
import { creativeAssets } from "@/lib/db/schema";
import { statObject, streamObject } from "@/lib/storage";

/** Serves library files to signed-in users, with Range support so videos can seek (Safari needs it). */
export async function GET(request: Request, ctx: RouteContext<"/api/media/[id]">) {
  const auth = await authorizeRoute(request, "viewer");
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return new Response("Not found", { status: 404 });
  const [asset] = await db().select().from(creativeAssets).where(eq(creativeAssets.id, id)).limit(1);
  if (!asset) return new Response("Not found", { status: 404 });
  const stat = await statObject(asset.storageKey);
  if (!stat) return new Response("Not found", { status: 404 });
  const size = stat.size;

  const headers: Record<string, string> = {
    "Content-Type": asset.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
  };

  const range = request.headers.get("range");
  if (!range) {
    return new Response(streamObject(asset.storageKey), { status: 200, headers: { ...headers, "Content-Length": String(size) } });
  }

  const unsatisfiable = () =>
    new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (m[1] === "" && m[2] === "")) return unsatisfiable();

  let start: number;
  let end: number;
  if (m[1] === "") {
    // Suffix range: last N bytes.
    const suffix = Number(m[2]);
    if (suffix === 0) return unsatisfiable();
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return unsatisfiable();

  return new Response(streamObject(asset.storageKey, { start, end }), {
    status: 206,
    headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
  });
}
