"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { passwordChecksBusy, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, getCurrentUser } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/redirect";
import { clearFailures, reserveAttempt } from "@/lib/auth/throttle";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

const schema = z.object({
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(256),
  next: z.string().optional(),
});

// Equalises timing for unknown emails so responses don't reveal which accounts exist.
const DUMMY_HASH =
  "scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

/**
 * The client address as seen by the closest proxy: the last X-Forwarded-For entry (proxies append to it, and
 * Next fills it from the socket when it's absent). Earlier entries are whatever the client claims.
 */
async function clientIp(): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for");
  return forwarded?.split(",").at(-1)?.trim() || "unknown";
}

export async function login(_: unknown, formData: FormData): Promise<{ error: string } | null> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter your email and password." };
  const { email, password, next } = parsed.data;

  const ip = await clientIp();
  // Attempts are counted before the (slow) password check, atomically, so a burst of parallel guesses can't all
  // slip under the limit. The tight limit is per email + address; looser per-email and per-address limits slow
  // distributed guessing without letting one stranger lock a colleague out after five tries.
  const wait = await reserveAttempt([
    { key: `pair:${email}|${ip}`, max: 5 },
    { key: `email:${email}`, max: 20 },
    { key: `ip:${ip}`, max: 30 },
  ]);
  if (wait > 0) return { error: `Too many attempts. Try again in ${Math.ceil(wait / 60_000)} min.` };
  if (passwordChecksBusy()) return { error: "Too many sign-ins at once. Try again in a moment." };

  const [user] = await db().select().from(users).where(eq(users.email, email)).limit(1);
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid || user.disabled) return { error: "Incorrect email or password." };

  await clearFailures([`pair:${email}|${ip}`, `email:${email}`, `ip:${ip}`]);
  await createSession(user.id);
  await audit(user.id, "auth.login", undefined, { ip });
  redirect(safeNext(next));
}

export async function logout(): Promise<void> {
  const user = await getCurrentUser();
  await destroySession();
  if (user) await audit(user.id, "auth.logout");
  redirect("/login");
}
