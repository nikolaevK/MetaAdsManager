import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { adAccounts, creativeAssets, creatives, launches, type LaunchStatus } from "@/lib/db/schema";
import { enqueue, PRIORITY } from "@/lib/jobs/queue";
import type { HandlerResult } from "@/lib/jobs/types";
import { graphBatch, graphBatchUpdate } from "@/lib/meta/client";
import { errorMessage, MetaApiError } from "@/lib/meta/errors";
import { ensureMetaMedia } from "@/lib/meta/media";
import { DEFAULT_PLACEMENTS } from "@/lib/meta/editor-types";
import { Ledger, type CreateItem } from "./ledger";
import {
  adPayload,
  adsetPayload,
  campaignPayload,
  creativeDestination,
  creativeGroups,
  creativePayload,
  creativePositions,
  creativeRef,
  registrableDomain,
  type MediaRef,
} from "./payloads";
import { normalizeSpec, type LaunchSpec } from "./spec";

type Launch = typeof launches.$inferSelect;

async function load(launchId: string) {
  const [launch] = await db().select().from(launches).where(eq(launches.id, launchId)).limit(1);
  if (!launch) return null;
  const [account] = await db().select().from(adAccounts).where(eq(adAccounts.id, launch.adAccountId)).limit(1);
  if (!account) throw new Error("Ad account no longer connected");
  return { launch, account, spec: normalizeSpec(launch.spec) };
}

async function update(launchId: string, values: Partial<Launch>) {
  await db().update(launches).set(values).where(eq(launches.id, launchId));
}

/** Compare-and-set on status, so a stale job can never move a launch it no longer owns. */
async function transition(launchId: string, from: LaunchStatus[], values: Partial<Launch>): Promise<boolean> {
  const rows = await db()
    .update(launches)
    .set(values)
    .where(and(eq(launches.id, launchId), inArray(launches.status, from)))
    .returning({ id: launches.id });
  return rows.length > 0;
}

/** One dedupe key per job type, so e.g. an approval is never swallowed by a build job still finishing. */
export const launchJobKey = (type: "build" | "activate" | "rollback", launchId: string) => `launch:${type}:${launchId}`;

/** Resolves every library creative used by the launch to Meta media refs (uploading as needed). */
async function prepareMedia(launch: Launch, spec: LaunchSpec, accountId: string) {
  const ids = [...new Set(spec.ads.map((a) => a.creativeId))];
  const libs = await db()
    .select()
    .from(creatives)
    .where(and(inArray(creatives.id, ids), eq(creatives.clientId, launch.clientId)));
  if (libs.length !== ids.length) throw new Error("A creative used by this launch no longer exists in the library");

  // Flexible-format ads carry more files than their library creative.
  const assetIds = [...new Set([...libs.flatMap((c) => [c.squareAssetId, c.verticalAssetId]), ...spec.ads.flatMap((a) => a.moreAssetIds ?? [])])];
  const assets = await db()
    .select()
    .from(creativeAssets)
    .where(and(inArray(creativeAssets.id, assetIds), eq(creativeAssets.clientId, launch.clientId)));
  if (assets.length !== assetIds.length) throw new Error("A media file used by this launch no longer exists in the library");

  const media = new Map<string, MediaRef>();
  const waiting: string[] = [];
  for (const asset of assets) {
    const state = await ensureMetaMedia(asset, accountId, "background");
    if (state.ready) media.set(asset.id, state.ref);
    else waiting.push(state.detail);
  }
  return { libs, media, waiting };
}

/**
 * Re-entrant launch builder. Order: media → creatives → campaign → ad sets → ads, everything PAUSED.
 * Each run resumes from the ledger, so retries never duplicate objects.
 */
export async function buildLaunch(launchId: string): Promise<HandlerResult> {
  const ctx = await load(launchId);
  if (!ctx || !["queued", "building"].includes(ctx.launch.status)) return;
  const { launch, account, spec } = ctx;
  await update(launchId, { status: "building", step: "Uploading media", error: null });

  // 1. Media: images → /adimages (hash); videos → /advideos, then poll until processed.
  const { libs, media, waiting } = await prepareMedia(launch, spec, account.id);
  if (waiting.length) {
    await update(launchId, { step: waiting.join(" · ") });
    return { retryInMs: 10_000, note: waiting.join("; ") };
  }

  const ledger = await Ledger.load(launchId, account.id);

  // 2. One creative per ad and per kind of ad set (where clicks go + which placements to split):
  //    1:1 + 9:16 pair via asset_feed_spec placement rules, enhancements per the ad's toggles.
  await update(launchId, { step: "Creating ad creatives" });
  const groups = creativeGroups(spec, DEFAULT_PLACEMENTS);
  await ledger.createMany(
    groups.first.flatMap((j, g) => {
      const adset = spec.adsets[j];
      return spec.ads.map((ad, i): CreateItem => {
        const lib = libs.find((c) => c.id === ad.creativeId)!;
        return {
          ref: creativeRef(i, g),
          kind: "creative",
          name: ad.name,
          edge: `${account.id}/adcreatives`,
          payload: creativePayload({
            name: ad.name,
            pageId: spec.pageId,
            instagramUserId: spec.instagramUserId,
            square: media.get(lib.squareAssetId)!,
            vertical: media.get(lib.verticalAssetId)!,
            more: ad.moreAssetIds?.map((id) => media.get(id)!),
            ad,
            destination: creativeDestination(adset),
            urlTags: ad.urlTags ?? spec.urlTags,
            positions: creativePositions(adset.placements, DEFAULT_PLACEMENTS),
          }),
        };
      });
    }),
  );

  // 3. Campaign (unless the launch adds to an existing one)
  const target = spec.target;
  let campaignId: string;
  if (target.mode === "new") {
    await update(launchId, { step: "Creating campaign" });
    await ledger.createMany([
      {
        ref: "campaign",
        kind: "campaign",
        name: spec.campaign.name,
        edge: `${account.id}/campaigns`,
        payload: campaignPayload(spec, account.currency),
        reconcileEdge: `${account.id}/campaigns`,
      },
    ]);
    campaignId = ledger.id("campaign");
    await update(launchId, { metaCampaignId: campaignId });
  } else campaignId = target.campaignId;

  // 4. Ad sets (unless the ads go into an existing one)
  if (target.mode !== "adset") {
    await update(launchId, { step: "Creating ad sets" });
    await ledger.createMany(
      spec.adsets.map((s, j) => ({
        ref: `adset:${j}`,
        kind: "adset" as const,
        name: s.name,
        edge: `${account.id}/adsets`,
        payload: adsetPayload(spec, s, campaignId, account.currency),
        reconcileEdge: `${campaignId}/adsets`,
      })),
    );
  }
  const adsetId = (j: number) => (target.mode === "adset" ? target.adsetId : ledger.id(`adset:${j}`));

  // 5. Ads: every ad definition in every ad set.
  await update(launchId, { step: "Creating ads" });
  await ledger.createMany(
    spec.adsets.flatMap((_, j) =>
      spec.ads.map((ad, i) => ({
        ref: `ad:${j}:${i}`,
        kind: "ad" as const,
        name: ad.name,
        edge: `${account.id}/ads`,
        payload: adPayload(ad.name, adsetId(j), ledger.id(creativeRef(i, groups.groupOf[j])), {
          conversionDomain: spec.adsets[j].destination === "website" && spec.adsets[j].pixelId ? registrableDomain(ad.url) : undefined,
          appId: spec.adsets[j].destination === "app" ? spec.adsets[j].app?.id : undefined,
        }),
        reconcileEdge: `${adsetId(j)}/ads`,
      })),
    ),
  );

  await update(launchId, { status: "ready_for_review", step: null });
  await enqueue("structure.sync", { adAccountId: account.id }, {
    dedupeKey: `structure:${account.id}`,
    priority: PRIORITY.launch,
    adAccountId: account.id,
  });
  await audit(null, "launch.built", { type: "launch", id: launchId }, { campaignId });
}

/** Called when building fails for good: record why and delete whatever was created. */
export async function failBuild(launchId: string, err: unknown): Promise<void> {
  const moved = await transition(launchId, ["queued", "building"], {
    status: "rolling_back",
    error: errorMessage(err),
    step: "Rolling back",
  });
  if (!moved) return;
  await enqueue("launch.rollback", { launchId, finalStatus: "failed" }, {
    dedupeKey: launchJobKey("rollback", launchId),
    priority: PRIORITY.launch,
    maxAttempts: 10,
  });
}

const DELETE_ORDER = ["ad", "adset", "campaign", "creative"] as const;

/** Meta's "object does not exist" (code 100, subcode 33). */
const isGone = (err: MetaApiError) => err.code === 100 && (err.subcode === 33 || /does not exist|has been deleted/i.test(err.message));

/**
 * Deletes created objects children-first. Idempotent: already-deleted objects count as done.
 * Only runs while the launch is "rolling_back", so a re-queued old job can't touch a live launch.
 */
export async function rollbackLaunch(launchId: string, finalStatus: LaunchStatus): Promise<HandlerResult> {
  const ctx = await load(launchId);
  if (!ctx || ctx.launch.status !== "rolling_back") return;
  const ledger = await Ledger.load(launchId, ctx.account.id);
  // Requests whose outcome is unknown may have created objects; find them so they get deleted too.
  await ledger.resolvePending();
  let firstError: Error | undefined;

  for (const kind of DELETE_ORDER) {
    const rows = ledger.all().filter((r) => r.kind === kind && r.status === "created" && r.metaId);
    if (rows.length === 0) continue;
    const results = await graphBatch(
      rows.map((r) => ({ method: "DELETE" as const, relativeUrl: r.metaId! })),
      { accountId: ctx.account.id, mode: "background" },
    );
    const deleted: string[] = [];
    for (const [k, r] of results.entries()) {
      // Already gone (e.g. removed with its parent) counts as deleted; any other error, including other code-100
      // validation errors, means the object may still exist and the rollback must be retried.
      if (r.ok || isGone(r.error)) deleted.push(rows[k].ref);
      else firstError ??= r.error;
    }
    await ledger.markMany(deleted, "deleted");
  }
  if (firstError) throw firstError;

  if (!(await transition(launchId, ["rolling_back"], { status: finalStatus, step: null, metaCampaignId: null }))) return;
  await enqueue("structure.sync", { adAccountId: ctx.account.id }, {
    dedupeKey: `structure:${ctx.account.id}`,
    priority: PRIORITY.launch,
    adAccountId: ctx.account.id,
  });
  await audit(null, "launch.rolled_back", { type: "launch", id: launchId }, { finalStatus });
}

export async function failRollback(launchId: string, err: unknown): Promise<void> {
  await transition(launchId, ["rolling_back"], {
    status: "failed",
    step: null,
    error: `Rollback incomplete: ${errorMessage(err)}. Some paused objects may remain in Ads Manager.`,
  });
}

/**
 * Activates ads → ad sets → campaign. The campaign goes last, so until it is ACTIVE nothing can
 * deliver; on any failure everything touched is re-paused. Only objects the launch created are switched
 * on: an existing campaign or ad set it added to keeps whatever status it has.
 */
export async function activateLaunch(launchId: string): Promise<HandlerResult> {
  const ctx = await load(launchId);
  if (!ctx || ctx.launch.status !== "activating") return;
  const { account } = ctx;
  const ledger = await Ledger.load(launchId, account.id);
  const ids = (kind: string) => ledger.all().filter((r) => r.kind === kind && r.status === "created").map((r) => r.metaId!);
  const stages = [ids("ad"), ids("adset"), ids("campaign")].filter((s) => s.length > 0);

  const activated: string[] = [];
  try {
    for (const stage of stages) {
      const results = await graphBatchUpdate(
        stage.map((id) => ({ method: "POST" as const, relativeUrl: id, params: { status: "ACTIVE" } })),
        { accountId: account.id, mode: "interactive" },
      );
      results.forEach((r, k) => r.ok && activated.push(stage[k]));
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) throw failed.error;
    }
  } catch (err) {
    if (activated.length) {
      await graphBatchUpdate(
        activated.reverse().map((id) => ({ method: "POST" as const, relativeUrl: id, params: { status: "PAUSED" } })),
        { accountId: account.id, mode: "interactive" },
      ).catch(() => undefined);
    }
    throw err;
  }

  if (!(await transition(launchId, ["activating"], { status: "active", activatedAt: Date.now(), error: null, step: null }))) return;
  await enqueue("structure.sync", { adAccountId: account.id }, {
    dedupeKey: `structure:${account.id}`,
    priority: PRIORITY.launch,
    adAccountId: account.id,
  });
  await audit(ctx.launch.approvedBy, "launch.activated", { type: "launch", id: launchId });
}

export async function failActivation(launchId: string, err: unknown): Promise<void> {
  const msg = err instanceof MetaApiError ? err.display : errorMessage(err);
  // The failure may have come after everything was switched on (e.g. while recording success), so pause what the
  // launch created before saying so: campaign first, which stops delivery fastest.
  let paused = false;
  try {
    const ctx = await load(launchId);
    if (ctx) {
      const ledger = await Ledger.load(launchId, ctx.account.id);
      const ids = (["campaign", "adset", "ad"] as const).flatMap((kind) => ledger.all().filter((r) => r.kind === kind && r.status === "created").map((r) => r.metaId!));
      const results = await graphBatchUpdate(
        ids.map((id) => ({ method: "POST" as const, relativeUrl: id, params: { status: "PAUSED" } })),
        { accountId: ctx.account.id, mode: "interactive" },
      );
      paused = results.every((r) => r.ok);
    }
  } catch (pauseErr) {
    console.error(`[launch] couldn't re-pause launch ${launchId}:`, pauseErr);
  }
  await transition(launchId, ["activating"], {
    status: "activation_failed",
    error: paused
      ? `Activation failed, everything was re-paused: ${msg}`
      : `Activation failed and re-pausing didn't finish: ${msg}. Check the campaign in Ads Manager and pause anything still running.`,
  });
}
