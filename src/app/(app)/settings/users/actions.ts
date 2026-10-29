"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { failure, UserError, type ActionState } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { hashPassword, PASSWORD_MIN_LENGTH, verifyPassword } from "@/lib/auth/password";
import { createSession, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ROLES, sessions, users } from "@/lib/db/schema";

const userId = z.string().min(1).max(64);
const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(256, "Password is too long");

async function findUser(id: string) {
  const [row] = await db().select({ id: users.id, email: users.email }).from(users).where(eq(users.id, id)).limit(1);
  if (!row) throw new UserError("User not found.");
  return row;
}

export async function createUser(input: { email: string; name: string; role: string; password: string }): Promise<ActionState> {
  try {
    const admin = await requireUser("admin");
    const data = z
      .object({
        email: z.email("Enter a valid email").max(254).transform((e) => e.toLowerCase()),
        name: z.string().trim().min(1, "Name is required").max(120),
        role: z.enum(ROLES),
        password,
      })
      .parse(input);
    const [exists] = await db().select({ id: users.id }).from(users).where(eq(users.email, data.email)).limit(1);
    if (exists) return { ok: false, error: "A user with this email already exists.", fieldErrors: { email: ["Already in use"] } };
    const [row] = await db()
      .insert(users)
      .values({ email: data.email, name: data.name, role: data.role, passwordHash: await hashPassword(data.password) })
      .returning({ id: users.id });
    await audit(admin.id, "user.create", { type: "user", id: row.id }, { email: data.email, role: data.role });
    refresh();
    return { ok: true, message: `${data.name} can now log in` };
  } catch (err) {
    return failure(err);
  }
}

export async function setUserRole(input: { id: string; role: string }): Promise<ActionState> {
  try {
    const admin = await requireUser("admin");
    const data = z.object({ id: userId, role: z.enum(ROLES) }).parse(input);
    if (data.id === admin.id) throw new UserError("You can't change your own role.");
    await findUser(data.id);
    await db().update(users).set({ role: data.role }).where(eq(users.id, data.id));
    await audit(admin.id, "user.role", { type: "user", id: data.id }, { role: data.role });
    refresh();
    return { ok: true, message: "Role updated" };
  } catch (err) {
    return failure(err);
  }
}

export async function setUserDisabled(input: { id: string; disabled: boolean }): Promise<ActionState> {
  try {
    const admin = await requireUser("admin");
    const data = z.object({ id: userId, disabled: z.boolean() }).parse(input);
    if (data.id === admin.id) throw new UserError("You can't disable your own account.");
    await findUser(data.id);
    await db().update(users).set({ disabled: data.disabled }).where(eq(users.id, data.id));
    // Disabling signs the user out everywhere immediately.
    if (data.disabled) await db().delete(sessions).where(eq(sessions.userId, data.id));
    await audit(admin.id, data.disabled ? "user.disable" : "user.enable", { type: "user", id: data.id });
    refresh();
    return { ok: true, message: data.disabled ? "User disabled and signed out" : "User enabled" };
  } catch (err) {
    return failure(err);
  }
}

export async function resetUserPassword(input: { id: string; password: string }): Promise<ActionState> {
  try {
    const admin = await requireUser("admin");
    const data = z.object({ id: userId, password }).parse(input);
    if (data.id === admin.id) throw new UserError("Use “Change my password” for your own account.");
    await findUser(data.id);
    await db().update(users).set({ passwordHash: await hashPassword(data.password) }).where(eq(users.id, data.id));
    await db().delete(sessions).where(eq(sessions.userId, data.id));
    await audit(admin.id, "user.reset_password", { type: "user", id: data.id });
    return { ok: true, message: "Password reset; the user was signed out" };
  } catch (err) {
    return failure(err);
  }
}

export async function changeMyPassword(input: { current: string; next: string }): Promise<ActionState> {
  try {
    const me = await requireUser();
    const data = z.object({ current: z.string().min(1, "Enter your current password").max(256), next: password }).parse(input);
    const [row] = await db().select({ hash: users.passwordHash }).from(users).where(eq(users.id, me.id)).limit(1);
    if (!row || !(await verifyPassword(data.current, row.hash))) {
      return { ok: false, error: "Current password is incorrect.", fieldErrors: { current: ["Incorrect password"] } };
    }
    await db().update(users).set({ passwordHash: await hashPassword(data.next) }).where(eq(users.id, me.id));
    // Sign out every other session, then issue a fresh one for this browser.
    await db().delete(sessions).where(eq(sessions.userId, me.id));
    await createSession(me.id);
    await audit(me.id, "user.change_password", { type: "user", id: me.id });
    return { ok: true, message: "Password changed. Other sessions were signed out." };
  } catch (err) {
    return failure(err);
  }
}
