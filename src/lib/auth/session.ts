import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { sessions, users, type Role } from "@/lib/db/schema";

export const SESSION_COOKIE = "mam_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const RENEW_WHEN_LEFT_MS = 1000 * 60 * 60 * 24 * 6; // slide expiry after a day of use

export type SessionUser = { id: string; email: string; name: string; role: Role };

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const h = await headers();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await db()
    .insert(sessions)
    .values({
      id: hashToken(token),
      userId,
      expiresAt,
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    });
  await setCookie(token, expiresAt);
  // Opportunistic cleanup of expired sessions.
  await db().delete(sessions).where(lt(sessions.expiresAt, Date.now()));
}

async function setCookie(token: string, expiresAt: number) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db().delete(sessions).where(eq(sessions.id, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

/** Validates the session cookie against the DB. Deduped per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  // Session checks compare against the clock, so they must always run at request time.
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const now = Date.now();
  const [row] = await db()
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      disabled: users.disabled,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row || row.disabled) return null;

  // Sliding expiry: the DB row is authoritative; src/proxy.ts refreshes the cookie's lifetime.
  if (row.expiresAt - now < RENEW_WHEN_LEFT_MS) {
    await db().update(sessions).set({ expiresAt: now + SESSION_TTL_MS }).where(eq(sessions.id, row.sessionId));
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role };
});

const RANK: Record<Role, number> = { viewer: 0, buyer: 1, admin: 2 };

export function hasRole(user: SessionUser, min: Role): boolean {
  return RANK[user.role] >= RANK[min];
}

/** For Server Components / Server Actions: redirects to /login when unauthenticated. */
export async function requireUser(min: Role = "viewer"): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasRole(user, min)) throw new ForbiddenError(min);
  return user;
}

export class ForbiddenError extends Error {
  constructor(required: Role) {
    super(`This action requires the ${required} role.`);
    this.name = "ForbiddenError";
  }
}
