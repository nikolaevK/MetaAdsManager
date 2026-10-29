"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { failure, UserError, type ActionState } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { namingConventions, utmRules } from "@/lib/db/schema";
import { validateUtmParams } from "@/lib/launch/utm";

const internalId = z.string().min(1).max(64);
const pattern = z.string().trim().min(1, "Pattern is required").max(300);

const conventionSchema = z.object({
  id: internalId.optional(),
  name: z.string().trim().min(1, "Name is required").max(120),
  campaignPattern: pattern,
  adsetPattern: pattern,
  adPattern: pattern,
});

export async function saveNamingConvention(input: z.input<typeof conventionSchema>): Promise<ActionState> {
  try {
    const user = await requireUser("admin");
    const { id, ...values } = conventionSchema.parse(input);
    if (id) {
      const res = await db().update(namingConventions).set(values).where(eq(namingConventions.id, id)).returning({ id: namingConventions.id });
      if (!res.length) throw new UserError("Naming convention not found.");
      await audit(user.id, "naming.update", { type: "naming_convention", id }, values);
    } else {
      const [row] = await db().insert(namingConventions).values(values).returning({ id: namingConventions.id });
      await audit(user.id, "naming.create", { type: "naming_convention", id: row.id }, values);
    }
    refresh();
    return { ok: true, message: "Naming convention saved" };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteNamingConvention(input: { id: string }): Promise<ActionState> {
  try {
    const user = await requireUser("admin");
    const { id } = z.object({ id: internalId }).parse(input);
    // Clients using it fall back to the default convention (FK is ON DELETE SET NULL).
    const res = await db().delete(namingConventions).where(eq(namingConventions.id, id)).returning({ name: namingConventions.name });
    if (!res.length) throw new UserError("Naming convention not found.");
    await audit(user.id, "naming.delete", { type: "naming_convention", id }, { name: res[0].name });
    refresh();
    return { ok: true, message: "Naming convention deleted" };
  } catch (err) {
    return failure(err);
  }
}

const utmSchema = z.object({
  id: internalId.optional(),
  name: z.string().trim().min(1, "Name is required").max(120),
  params: z
    .array(z.object({ key: z.string().trim().max(100), value: z.string().trim().max(500) }))
    .max(30)
    .transform((rows) => rows.filter((r) => r.key && r.value)),
});

export async function saveUtmRule(input: z.input<typeof utmSchema>): Promise<ActionState> {
  try {
    const user = await requireUser("admin");
    const { id, name, params } = utmSchema.parse(input);
    if (params.length === 0) return { ok: false, error: "Add at least one parameter.", fieldErrors: { params: ["Add at least one parameter."] } };
    const problem = validateUtmParams(params);
    if (problem) return { ok: false, error: problem, fieldErrors: { params: [problem] } };
    if (id) {
      const res = await db().update(utmRules).set({ name, params }).where(eq(utmRules.id, id)).returning({ id: utmRules.id });
      if (!res.length) throw new UserError("UTM rule not found.");
      await audit(user.id, "utm.update", { type: "utm_rule", id }, { name, params });
    } else {
      const [row] = await db().insert(utmRules).values({ name, params }).returning({ id: utmRules.id });
      await audit(user.id, "utm.create", { type: "utm_rule", id: row.id }, { name, params });
    }
    refresh();
    return { ok: true, message: "UTM rule saved" };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteUtmRule(input: { id: string }): Promise<ActionState> {
  try {
    const user = await requireUser("admin");
    const { id } = z.object({ id: internalId }).parse(input);
    const res = await db().delete(utmRules).where(eq(utmRules.id, id)).returning({ name: utmRules.name });
    if (!res.length) throw new UserError("UTM rule not found.");
    await audit(user.id, "utm.delete", { type: "utm_rule", id }, { name: res[0].name });
    refresh();
    return { ok: true, message: "UTM rule deleted" };
  } catch (err) {
    return failure(err);
  }
}
