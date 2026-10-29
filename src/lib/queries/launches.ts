import "server-only";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "@/lib/db";
import {
  adAccounts,
  clients,
  creativeAssets,
  creatives,
  launchDrafts,
  launchObjects,
  launches,
  launchTemplates,
  namingConventions,
  users,
  utmRules,
} from "@/lib/db/schema";
import { DEFAULT_NAMING } from "@/lib/launch/naming";
import { normalizeSpec, templateConfigSchema, type TemplateConfig } from "@/lib/launch/spec";
import { DEFAULT_UTM_PARAMS } from "@/lib/launch/utm";

export async function listLaunches(clientId: string | null, limit = 200) {
  return db()
    .select({
      id: launches.id,
      name: launches.name,
      status: launches.status,
      step: launches.step,
      error: launches.error,
      createdAt: launches.createdAt,
      updatedAt: launches.updatedAt,
      adAccountId: launches.adAccountId,
      clientName: clients.name,
      accountName: adAccounts.name,
      createdByName: users.name,
    })
    .from(launches)
    .leftJoin(clients, eq(clients.id, launches.clientId))
    .leftJoin(adAccounts, eq(adAccounts.id, launches.adAccountId))
    .leftJoin(users, eq(users.id, launches.createdBy))
    .where(clientId ? eq(launches.clientId, clientId) : undefined)
    .orderBy(desc(launches.createdAt))
    .limit(limit);
}

export async function getLaunchDetail(id: string) {
  const approver = alias(users, "approver");
  const [row] = await db()
    .select({
      launch: launches,
      clientName: clients.name,
      accountName: adAccounts.name,
      currency: adAccounts.currency,
      templateName: launchTemplates.name,
      createdByName: users.name,
      approvedByName: approver.name,
    })
    .from(launches)
    .leftJoin(clients, eq(clients.id, launches.clientId))
    .leftJoin(adAccounts, eq(adAccounts.id, launches.adAccountId))
    .leftJoin(launchTemplates, eq(launchTemplates.id, launches.templateId))
    .leftJoin(users, eq(users.id, launches.createdBy))
    .leftJoin(approver, eq(approver.id, launches.approvedBy))
    .where(eq(launches.id, id))
    .limit(1);
  if (!row) return null;

  const spec = normalizeSpec(row.launch.spec);
  const creativeIds = [...new Set(spec.ads.map((a) => a.creativeId))];
  const [ledger, libs, [draft]] = await Promise.all([
    db().select().from(launchObjects).where(eq(launchObjects.launchId, id)).orderBy(asc(launchObjects.createdAt)),
    creativeIds.length
      ? db()
          .select({ id: creatives.id, name: creatives.name, kind: creatives.kind, squareAssetId: creatives.squareAssetId })
          .from(creatives)
          .where(inArray(creatives.id, creativeIds))
      : Promise.resolve([]),
    db().select({ id: launchDrafts.id }).from(launchDrafts).where(eq(launchDrafts.launchId, id)).limit(1),
  ]);
  return { ...row, spec, ledger, creatives: libs, draftId: draft?.id ?? null, currency: row.currency ?? "USD" };
}

export type BuilderTemplate = { id: string; name: string; config: TemplateConfig };
export type BuilderCreative = {
  id: string;
  name: string;
  kind: "image" | "video";
  angle: string | null;
  squareAssetId: string;
  verticalAssetId: string;
};
export type BuilderAsset = { id: string; kind: "image" | "video"; fileName: string; width: number | null; height: number | null; aspect: string };

/** Everything the launch builder needs for one client / ad account. */
export async function getBuilderData(clientId: string) {
  const [client] = await db().select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) return null;

  const [templateRows, creativeRows, assetRows, naming, utm] = await Promise.all([
    db()
      .select()
      .from(launchTemplates)
      .where(or(isNull(launchTemplates.clientId), eq(launchTemplates.clientId, clientId)))
      .orderBy(asc(launchTemplates.name)),
    db()
      .select({
        id: creatives.id,
        name: creatives.name,
        kind: creatives.kind,
        angle: creatives.angle,
        squareAssetId: creatives.squareAssetId,
        verticalAssetId: creatives.verticalAssetId,
      })
      .from(creatives)
      .where(and(eq(creatives.clientId, clientId), isNull(creatives.archivedAt)))
      .orderBy(desc(creatives.createdAt)),
    db()
      .select({
        id: creativeAssets.id,
        kind: creativeAssets.kind,
        fileName: creativeAssets.fileName,
        width: creativeAssets.width,
        height: creativeAssets.height,
        aspect: creativeAssets.aspect,
      })
      .from(creativeAssets)
      .where(eq(creativeAssets.clientId, clientId))
      .orderBy(desc(creativeAssets.createdAt))
      .limit(500),
    client.namingConventionId
      ? db().select().from(namingConventions).where(eq(namingConventions.id, client.namingConventionId)).limit(1)
      : Promise.resolve([]),
    client.utmRuleId ? db().select().from(utmRules).where(eq(utmRules.id, client.utmRuleId)).limit(1) : Promise.resolve([]),
  ]);

  const templates: BuilderTemplate[] = [];
  /** Templates that fail validation (e.g. seeded without a pixel) are shown disabled with a fix link. */
  const invalidTemplates: { id: string; name: string }[] = [];
  for (const t of templateRows) {
    const parsed = templateConfigSchema.safeParse(t.config);
    if (parsed.success) templates.push({ id: t.id, name: t.name, config: parsed.data });
    else invalidTemplates.push({ id: t.id, name: t.name });
  }

  const convention = naming[0];
  return {
    client,
    templates,
    invalidTemplates,
    creatives: creativeRows as BuilderCreative[],
    assets: assetRows as BuilderAsset[],
    naming: convention
      ? { campaignPattern: convention.campaignPattern, adsetPattern: convention.adsetPattern, adPattern: convention.adPattern }
      : DEFAULT_NAMING,
    utmParams: utm[0]?.params ?? DEFAULT_UTM_PARAMS,
  };
}

/** Drafts for an ad account still being built (not yet submitted as a launch), newest first. */
export async function listDrafts(adAccountId: string, limit = 20) {
  return db()
    .select({
      id: launchDrafts.id,
      name: launchDrafts.name,
      updatedAt: launchDrafts.updatedAt,
      createdByName: users.name,
    })
    .from(launchDrafts)
    .leftJoin(users, eq(users.id, launchDrafts.createdBy))
    .where(and(eq(launchDrafts.adAccountId, adAccountId), isNull(launchDrafts.launchId)))
    .orderBy(desc(launchDrafts.updatedAt))
    .limit(limit);
}

export async function getDraft(id: string) {
  const [row] = await db().select().from(launchDrafts).where(eq(launchDrafts.id, id)).limit(1);
  return row ?? null;
}
