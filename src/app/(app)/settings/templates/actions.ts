"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { failure, UserError, type ActionState } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { clients, launchTemplates } from "@/lib/db/schema";
import { templateConfigSchema } from "@/lib/launch/spec";

const internalId = z.string().min(1).max(64);

const meta = z.object({
  id: internalId.optional(),
  name: z.string().trim().min(1, "Name is required").max(120),
  clientId: internalId.nullable(),
});

export async function saveTemplate(input: { id?: string; name: string; clientId: string | null; config: unknown }): Promise<ActionState> {
  let createdId: string | undefined;
  try {
    const user = await requireUser("admin");
    const data = meta.parse(input);
    const config = templateConfigSchema.parse(input.config);
    if (data.clientId) {
      const [c] = await db().select({ id: clients.id }).from(clients).where(eq(clients.id, data.clientId)).limit(1);
      if (!c) throw new UserError("Client not found.");
    }
    if (data.id) {
      const [existing] = await db().select({ id: launchTemplates.id }).from(launchTemplates).where(eq(launchTemplates.id, data.id)).limit(1);
      if (!existing) throw new UserError("Template not found.");
      await db()
        .update(launchTemplates)
        .set({ name: data.name, clientId: data.clientId, config })
        .where(eq(launchTemplates.id, data.id));
      await audit(user.id, "template.update", { type: "template", id: data.id }, { name: data.name });
      refresh();
      return { ok: true, message: "Template saved" };
    }
    const [row] = await db()
      .insert(launchTemplates)
      .values({ name: data.name, clientId: data.clientId, config })
      .returning({ id: launchTemplates.id });
    await audit(user.id, "template.create", { type: "template", id: row.id }, { name: data.name });
    createdId = row.id;
  } catch (err) {
    return failure(err);
  }
  redirect(`/settings/templates/${createdId}`);
}

export async function duplicateTemplate(input: { id: string }): Promise<ActionState> {
  let createdId: string | undefined;
  try {
    const user = await requireUser("admin");
    const { id } = z.object({ id: internalId }).parse(input);
    const [t] = await db().select().from(launchTemplates).where(eq(launchTemplates.id, id)).limit(1);
    if (!t) throw new UserError("Template not found.");
    const [row] = await db()
      .insert(launchTemplates)
      .values({ name: `${t.name} (copy)`.slice(0, 120), clientId: t.clientId, config: t.config })
      .returning({ id: launchTemplates.id });
    await audit(user.id, "template.duplicate", { type: "template", id: row.id }, { from: id });
    createdId = row.id;
  } catch (err) {
    return failure(err);
  }
  redirect(`/settings/templates/${createdId}`);
}

export async function deleteTemplate(input: { id: string }): Promise<ActionState> {
  try {
    const user = await requireUser("admin");
    const { id } = z.object({ id: internalId }).parse(input);
    const [t] = await db().select({ name: launchTemplates.name }).from(launchTemplates).where(eq(launchTemplates.id, id)).limit(1);
    if (!t) throw new UserError("Template not found.");
    // Launches keep their own frozen spec; their template_id is set to null.
    await db().delete(launchTemplates).where(eq(launchTemplates.id, id));
    await audit(user.id, "template.delete", { type: "template", id }, { name: t.name });
  } catch (err) {
    return failure(err);
  }
  redirect("/settings/templates");
}
