import "server-only";
import { env } from "@/lib/env";
import type { Role } from "@/lib/db/schema";
import { getCurrentUser, hasRole, type SessionUser } from "./session";

/** Route-handler auth: JSON errors instead of redirects, plus a same-origin check for writes. */
export async function authorizeRoute(
  request: Request,
  min: Role,
): Promise<{ user: SessionUser } | { error: Response }> {
  if (request.method !== "GET" && request.method !== "HEAD" && !isSameOrigin(request)) {
    return { error: Response.json({ error: "Cross-origin request rejected" }, { status: 403 }) };
  }
  const user = await getCurrentUser();
  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!hasRole(user, min)) return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    const o = new URL(origin);
    return o.host === host || o.origin === new URL(env().APP_URL).origin;
  } catch {
    return false;
  }
}
