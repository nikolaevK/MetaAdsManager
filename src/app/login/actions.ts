"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, getCurrentUser } from "@/lib/auth/session";
import { clearFailures, lockedFor, recordFailure } from "@/lib/auth/throttle";
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

/** Only same-site relative paths are allowed as post-login destinations. */
function safeNext(next?: string): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/campaigns";
}

export async function login(_: unknown, formData: FormData): Promise<{ error: string } | null> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter your email and password." };
  const { email, password, next } = parsed.data;

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const keys = [`email:${email}`, `ip:${ip}`];
  const wait = Math.max(...(await Promise.all(keys.map(lockedFor))));
  if (wait > 0) return { error: `Too many attempts. Try again in ${Math.ceil(wait / 60_000)} min.` };

  const [user] = await db().select().from(users).where(eq(users.email, email)).limit(1);
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid || user.disabled) {
    await Promise.all(keys.map(recordFailure));
    return { error: "Incorrect email or password." };
  }

  await Promise.all(keys.map(clearFailures));
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
