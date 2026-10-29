"use server";

import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { failure, UserError, type ActionState } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { hasRole, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  adAccounts,
  clients,
  creatives,
  launchDrafts,
  launchObjects,
  launches,
  launchTemplates,
  utmRules,
  type LaunchStatus,
} from "@/lib/db/schema";
import { kickWorker } from "@/lib/jobs/kick";
import { enqueue, PRIORITY } from "@/lib/jobs/queue";
import { findOrCreateCreative, loadMedia } from "@/lib/creatives";
import { VIDEO_GOALS } from "@/lib/launch/objectives";
import { creativeDestination, creativeGroups, creativePayload, creativePositions } from "@/lib/launch/payloads";
import { launchJobKey } from "@/lib/launch/pipeline";
import {
  adDraftInputSchema,
  adsetInputSchema,
  launchInputSchema,
  MAX_LAUNCH_CREATIVES,
  normalizeSpec,
  validateLaunch,
  zodIssues,
  type AdInput,
  type AdsetInput,
  type LaunchSpec,
  type MediaPick,
} from "@/lib/launch/spec";
import { buildUrlTags, DEFAULT_UTM_PARAMS } from "@/lib/launch/utm";
import { DEFAULT_PLACEMENTS } from "@/lib/meta/editor-types";
import { ensureMetaMedia } from "@/lib/meta/media";
import { generatePreview, PREVIEW_FORMATS, type PreviewFormat } from "@/lib/meta/previews";

type Account = typeof adAccounts.$inferSelect;

const formatSchema = z.enum(PREVIEW_FORMATS.map((f) => f.id) as [PreviewFormat, ...PreviewFormat[]]);

/** Turns zod issues into "Ad set 2 › budget: …" lines the builder can show. */
function describeIssues(err: z.ZodError): string {
  return zodIssues(err, 5)
    .map((i) => `${i.where} › ${i.message}`)
    .join("\n");
}

async function utmTagsFor(clientId: string): Promise<string> {
  const [client] = await db().select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client?.utmRuleId) return buildUrlTags(DEFAULT_UTM_PARAMS);
  const [rule] = await db().select().from(utmRules).where(eq(utmRules.id, client.utmRuleId)).limit(1);
  return buildUrlTags(rule?.params ?? DEFAULT_UTM_PARAMS);
}

async function assertTemplate(templateId: string, clientId: string) {
  const [row] = await db()
    .select({ id: launchTemplates.id })
    .from(launchTemplates)
    .where(and(eq(launchTemplates.id, templateId), or(isNull(launchTemplates.clientId), eq(launchTemplates.clientId, clientId))))
    .limit(1);
  if (!row) throw new UserError("Template not found for this client.");
}

async function loadAccount(accountId: string, clientId: string): Promise<Account> {
  const [account] = await db()
    .select()
    .from(adAccounts)
    .where(and(eq(adAccounts.id, accountId), eq(adAccounts.clientId, clientId)))
    .limit(1);
  if (!account) throw new UserError("Ad account is not connected to this client.");
  return account;
}

type PreviewResult = { ok: true; src: string } | { ok: false; error: string; processing?: boolean };

/** Uploads (or reuses) an ad's files in the ad account and builds the exact creative spec for an ad set. */
async function draftCreativeSpec(args: {
  account: Account;
  clientId: string;
  pageId: string;
  instagramUserId?: string;
  adset: Pick<AdsetInput, "destination" | "messagingApps" | "app" | "placements">;
  ad: Omit<AdInput, "creativeId">;
  media: MediaPick;
  urlTags: string;
}): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; error: string; processing: true }> {
  const { square, vertical, more } = await loadMedia(args.clientId, args.media);
  const sq = await ensureMetaMedia(square, args.account.id, "interactive");
  const vt = vertical.id === square.id ? sq : await ensureMetaMedia(vertical, args.account.id, "interactive");
  const extra = [];
  for (const asset of more) extra.push(await ensureMetaMedia(asset, args.account.id, "interactive"));
  if (!sq.ready || !vt.ready || extra.some((s) => !s.ready)) {
    const detail = [sq, vt, ...extra].flatMap((s) => (s.ready ? [] : [s.detail])).join(" · ");
    return { ok: false, processing: true, error: `Meta is still processing the video (${detail}). Try the preview again in a minute.` };
  }
  return {
    ok: true,
    payload: creativePayload({
      name: args.ad.name,
      pageId: args.pageId,
      instagramUserId: args.instagramUserId,
      square: sq.ref,
      vertical: vt.ref,
      more: extra.flatMap((s) => (s.ready ? [s.ref] : [])),
      ad: args.ad,
      destination: creativeDestination(args.adset),
      urlTags: args.urlTags,
      positions: creativePositions(args.adset.placements, DEFAULT_PLACEMENTS),
    }),
  };
}

const draftPreviewSchema = z.object({
  clientId: z.string().min(1),
  adAccountId: z.string().regex(/^act_\d+$/),
  pageId: z.string().regex(/^\d+$/, "Choose a Facebook Page first"),
  instagramUserId: z.string().regex(/^\d+$/).optional(),
  adset: adsetInputSchema.pick({ destination: true, messagingApps: true, app: true, placements: true }),
  ad: adDraftInputSchema.extend({ name: z.string().trim().max(400).default("Preview") }),
  format: formatSchema,
});

/** Real placement render for an ad that hasn't been launched yet, as it would run in the given ad set. */
export async function previewDraftAction(input: z.input<typeof draftPreviewSchema>): Promise<PreviewResult> {
  try {
    await requireUser("buyer");
    const data = draftPreviewSchema.parse(input);
    const account = await loadAccount(data.adAccountId, data.clientId);
    const { media, ...ad } = { ...data.ad, name: data.ad.name || "Preview" };
    const spec = await draftCreativeSpec({
      account,
      clientId: data.clientId,
      pageId: data.pageId,
      instagramUserId: data.instagramUserId,
      adset: data.adset,
      ad,
      media,
      urlTags: ad.urlTags ?? (await utmTagsFor(data.clientId)),
    });
    if (!spec.ok) return spec;
    return { ok: true, src: await generatePreview(account.id, spec.payload, data.format) };
  } catch (err) {
    if (err instanceof z.ZodError) return { ok: false, error: describeIssues(err) };
    return { ok: false, error: failure(err)?.error ?? "Preview failed" };
  }
}

/** Preview for an ad of an existing launch: uses the exact payload sent to /adcreatives when available. */
export async function previewLaunchAdAction(launchId: string, adIndex: number, format: PreviewFormat): Promise<PreviewResult> {
  try {
    const user = await requireUser("viewer");
    const data = z.object({ launchId: z.string().min(1), adIndex: z.number().int().min(0).max(49), format: formatSchema }).parse({ launchId, adIndex, format });
    const [launch] = await db().select().from(launches).where(eq(launches.id, data.launchId)).limit(1);
    if (!launch) throw new UserError("Launch not found.");
    const spec = normalizeSpec(launch.spec);
    const ad = spec.ads[data.adIndex];
    if (!ad) throw new UserError("Ad not found in this launch.");

    // Creatives of the first ad set's kind use the plain "creative:<i>" ref.
    const [built] = await db()
      .select({ payload: launchObjects.payload })
      .from(launchObjects)
      .where(and(eq(launchObjects.launchId, launch.id), eq(launchObjects.ref, `creative:${data.adIndex}`)))
      .limit(1);
    if (built?.payload) return { ok: true, src: await generatePreview(launch.adAccountId, built.payload, data.format) };

    // Creatives not built yet: building the spec may upload media, which viewers can't trigger.
    if (!hasRole(user, "buyer")) throw new UserError("Previews become available once the creatives are built.");
    const account = await loadAccount(launch.adAccountId, launch.clientId);
    const [lib] = await db()
      .select({ squareAssetId: creatives.squareAssetId, verticalAssetId: creatives.verticalAssetId })
      .from(creatives)
      .where(and(eq(creatives.id, ad.creativeId), eq(creatives.clientId, launch.clientId)))
      .limit(1);
    if (!lib) throw new UserError("This ad's creative is no longer in the library.");
    const draft = await draftCreativeSpec({
      account,
      clientId: launch.clientId,
      pageId: spec.pageId,
      instagramUserId: spec.instagramUserId,
      adset: spec.adsets[0],
      ad,
      media: ad.moreAssetIds?.length ? { feedAssetId: lib.squareAssetId, moreAssetIds: ad.moreAssetIds } : { feedAssetId: lib.squareAssetId, verticalAssetId: lib.verticalAssetId },
      urlTags: ad.urlTags ?? spec.urlTags,
    });
    if (!draft.ok) return draft;
    return { ok: true, src: await generatePreview(account.id, draft.payload, data.format) };
  } catch (err) {
    return { ok: false, error: failure(err)?.error ?? "Preview failed" };
  }
}

export async function createLaunchAction(input: unknown): Promise<ActionState> {
  let launchId: string;
  try {
    const user = await requireUser("buyer");
    const data = launchInputSchema.parse(input);
    const account = await loadAccount(data.adAccountId, data.clientId);
    if (data.templateId) await assertTemplate(data.templateId, data.clientId);

    const problems = validateLaunch(data);
    if (data.ads.length * creativeGroups(data, DEFAULT_PLACEMENTS).count > MAX_LAUNCH_CREATIVES)
      problems.push({ step: "ads", where: "Ads", message: `This launch would create more than ${MAX_LAUNCH_CREATIVES} creatives. Use fewer ads, or fewer ad sets with different destinations or placements.` });
    if (problems.length) return { ok: false, error: problems.map((p) => `${p.where} › ${p.message}`).join("\n") };

    // Each ad's files become (or reuse) a library creative, which the pipeline and previews work from.
    const { idempotencyKey, draftId, ads: draftAds, ...rest } = data;
    const ads: AdInput[] = [];
    for (const [i, { media, ...ad }] of draftAds.entries()) {
      const creative = await findOrCreateCreative(data.clientId, media, user.id);
      if (creative.kind === "image" && data.adsets.some((s) => VIDEO_GOALS.has(s.optimizationGoal)))
        return { ok: false, error: `Ad ${i + 1} › Video-view goals need a video, not an image.` };
      ads.push({ ...ad, creativeId: creative.id, ...(media.moreAssetIds?.length ? { moreAssetIds: media.moreAssetIds } : {}) });
    }
    const spec: LaunchSpec = { ...rest, ads, version: 2, urlTags: await utmTagsFor(data.clientId) };

    const [inserted] = await db()
      .insert(launches)
      .values({
        idempotencyKey,
        clientId: data.clientId,
        adAccountId: account.id,
        templateId: data.templateId ?? null,
        name: data.campaign.name,
        status: "queued",
        step: "Waiting for worker",
        spec,
        createdBy: user.id,
      })
      .onConflictDoNothing()
      .returning({ id: launches.id });

    if (inserted) {
      launchId = inserted.id;
      await enqueue("launch.build", { launchId }, {
        dedupeKey: launchJobKey("build", launchId),
        priority: PRIORITY.launch,
        adAccountId: account.id,
        maxAttempts: 8,
      });
      if (draftId) {
        await db()
          .update(launchDrafts)
          .set({ launchId })
          .where(and(eq(launchDrafts.id, draftId), eq(launchDrafts.clientId, data.clientId)));
      }
      await audit(user.id, "launch.created", { type: "launch", id: launchId }, {
        adsets: data.adsets.length,
        ads: data.ads.length,
        objective: data.campaign.objective,
      });
      kickWorker();
    } else {
      // Double submit: the same idempotency key already created a launch.
      const [existing] = await db()
        .select({ id: launches.id })
        .from(launches)
        .where(eq(launches.idempotencyKey, idempotencyKey))
        .limit(1);
      if (!existing) throw new UserError("Could not create the launch. Please try again.");
      launchId = existing.id;
    }
  } catch (err) {
    if (err instanceof z.ZodError) return { ok: false, error: describeIssues(err) };
    return failure(err);
  }
  redirect(`/launches/${launchId}`);
}

// ── Drafts ───────────────────────────────────────────────────────────────────

const MAX_DRAFT_BYTES = 1_000_000;

const draftSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).optional(),
  clientId: z.string().min(1).max(64),
  adAccountId: z.string().regex(/^act_\d+$/),
  name: z.string().trim().max(400),
  state: z.record(z.string(), z.unknown()),
});

/** Autosave for the campaign builder. Creates the draft on first save, then updates it in place. */
export async function saveDraftAction(input: z.input<typeof draftSchema>): Promise<{ ok: true; id: string; savedAt: number } | { ok: false; error: string }> {
  try {
    const user = await requireUser("buyer");
    const data = draftSchema.parse(input);
    if (JSON.stringify(data.state).length > MAX_DRAFT_BYTES) throw new UserError("This draft is too large to save.");
    await loadAccount(data.adAccountId, data.clientId);
    const name = data.name || "Untitled campaign";
    const now = Date.now();
    if (data.id) {
      const [row] = await db()
        .update(launchDrafts)
        .set({ name, state: data.state, adAccountId: data.adAccountId, updatedAt: now })
        .where(and(eq(launchDrafts.id, data.id), eq(launchDrafts.clientId, data.clientId)))
        .returning({ id: launchDrafts.id });
      if (row) return { ok: true, id: row.id, savedAt: now };
      // Never resurrect a draft someone deleted (here or in another tab).
      throw new UserError("This draft was deleted. Copy anything you need, then start a new campaign.");
    }
    const [row] = await db()
      .insert(launchDrafts)
      .values({ clientId: data.clientId, adAccountId: data.adAccountId, name, state: data.state, createdBy: user.id })
      .returning({ id: launchDrafts.id });
    return { ok: true, id: row.id, savedAt: now };
  } catch (err) {
    return { ok: false, error: failure(err)?.error ?? "Couldn't save the draft" };
  }
}

export async function deleteDraftAction(id: string): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const draftId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/).parse(id);
    const [row] = await db().delete(launchDrafts).where(eq(launchDrafts.id, draftId)).returning({ name: launchDrafts.name });
    if (!row) throw new UserError("Draft not found.");
    await audit(user.id, "launch_draft.deleted", { type: "launch_draft", id: draftId }, { name: row.name });
    refresh();
    return { ok: true, message: `Deleted draft “${row.name}”` };
  } catch (err) {
    return failure(err);
  }
}

// ── Lifecycle actions ────────────────────────────────────────────────────────

async function transition(
  launchId: string,
  from: LaunchStatus[],
  values: Partial<typeof launches.$inferInsert>,
): Promise<typeof launches.$inferSelect> {
  const id = z.string().min(1).max(64).parse(launchId);
  const [row] = await db()
    .update(launches)
    .set(values)
    .where(and(eq(launches.id, id), inArray(launches.status, from)))
    .returning();
  if (!row) throw new UserError("This launch changed in the meantime. Refresh and try again.");
  return row;
}

export async function approveLaunchAction(launchId: string): Promise<ActionState> {
  try {
    const user = await requireUser("admin");
    const launch = await transition(launchId, ["ready_for_review"], {
      status: "activating",
      step: "Activating",
      error: null,
      approvedBy: user.id,
      approvedAt: Date.now(),
    });
    await enqueue("launch.activate", { launchId: launch.id }, {
      dedupeKey: launchJobKey("activate", launch.id),
      priority: PRIORITY.launch,
      adAccountId: launch.adAccountId,
      maxAttempts: 5,
    });
    await audit(user.id, "launch.approved", { type: "launch", id: launch.id });
    kickWorker();
    refresh();
    return { ok: true, message: "Approved. Activating ads → ad sets → campaign." };
  } catch (err) {
    return failure(err);
  }
}

export async function retryActivationAction(launchId: string): Promise<ActionState> {
  try {
    const user = await requireUser("admin");
    const launch = await transition(launchId, ["activation_failed"], { status: "activating", step: "Activating", error: null });
    await enqueue("launch.activate", { launchId: launch.id }, {
      dedupeKey: launchJobKey("activate", launch.id),
      priority: PRIORITY.launch,
      adAccountId: launch.adAccountId,
      maxAttempts: 5,
    });
    await audit(user.id, "launch.activation_retried", { type: "launch", id: launch.id });
    kickWorker();
    refresh();
    return { ok: true, message: "Retrying activation." };
  } catch (err) {
    return failure(err);
  }
}

export async function discardLaunchAction(launchId: string): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const id = z.string().min(1).max(64).parse(launchId);
    const [current] = await db().select({ status: launches.status }).from(launches).where(eq(launches.id, id)).limit(1);
    if (!current) throw new UserError("Launch not found.");

    // A "failed" launch is normally fully rolled back, but an incomplete rollback leaves objects
    // (created, or pending with an unknown outcome) that discarding must still clean up.
    const [leftover] =
      current.status === "failed"
        ? await db()
            .select({ id: launchObjects.id })
            .from(launchObjects)
            .where(and(eq(launchObjects.launchId, id), inArray(launchObjects.status, ["created", "pending"])))
            .limit(1)
        : [];
    const cleanOnly = current.status === "failed" && !leftover;

    if (cleanOnly) {
      await transition(id, ["failed"], { status: "discarded", step: null });
    } else {
      const launch = await transition(id, ["ready_for_review", "activation_failed", "failed"], {
        status: "rolling_back",
        step: "Rolling back",
      });
      await enqueue("launch.rollback", { launchId: launch.id, finalStatus: "discarded" }, {
        dedupeKey: launchJobKey("rollback", launch.id),
        priority: PRIORITY.launch,
        adAccountId: launch.adAccountId,
        maxAttempts: 10,
      });
      kickWorker();
    }
    await audit(user.id, "launch.discarded", { type: "launch", id });
    refresh();
    return { ok: true, message: cleanOnly ? "Launch discarded." : "Discarding: deleting the paused objects from Meta." };
  } catch (err) {
    return failure(err);
  }
}

export async function retryBuildAction(launchId: string): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const launch = await transition(launchId, ["failed"], { status: "queued", step: "Waiting for worker", error: null });
    await enqueue("launch.build", { launchId: launch.id }, {
      dedupeKey: launchJobKey("build", launch.id),
      priority: PRIORITY.launch,
      adAccountId: launch.adAccountId,
      maxAttempts: 8,
    });
    await audit(user.id, "launch.retried", { type: "launch", id: launch.id });
    kickWorker();
    refresh();
    return { ok: true, message: "Rebuilding the launch." };
  } catch (err) {
    return failure(err);
  }
}
