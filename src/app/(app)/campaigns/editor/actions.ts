"use server";

import { and, between, desc, eq, isNull } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { failure, UserError, type ActionState } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { addDays, daysBetween, isIsoDate, MAX_RANGE_DAYS, zonedLocalToIso } from "@/lib/dates";
import { db } from "@/lib/db";
import { ads, adsets, clients, creativeAssets, creatives, insightsDaily, utmRules } from "@/lib/db/schema";
import { findOrCreateCreative, loadMedia } from "@/lib/creatives";
import { kickWorker } from "@/lib/jobs/kick";
import { enqueue, PRIORITY } from "@/lib/jobs/queue";
import { creativeFeaturesSpec, creativePayload, creativePositions, fromCopy, fromMinorUnits, toMinorUnits } from "@/lib/launch/payloads";
import { destinationFromAdset } from "@/lib/launch/objectives";
import { CONVERSION_EVENTS, mediaPickSchema } from "@/lib/launch/spec";
import { buildUrlTags, DEFAULT_UTM_PARAMS } from "@/lib/launch/utm";
import { graph, type Params } from "@/lib/meta/client";
import {
  BID_STRATEGIES,
  DEFAULT_PLACEMENTS,
  needsBidAmount,
  usesPixel,
  type AdData,
  type AdsetData,
  type CampaignData,
  type DetailedItem,
  type GeoItem,
  type Issue,
  type LibraryAsset,
  type LibraryCreative,
  type LoadResult,
} from "@/lib/meta/editor-types";
import { audienceSchema, placementsSchema } from "@/lib/meta/editor-schemas";
import { ensureMetaMedia } from "@/lib/meta/media";
import { createObject, fetchObject, REMOVE_SPEND_CAP, updateObject, type Change } from "@/lib/meta/objects";
import { extractPreviewSrc, generatePreview, PREVIEW_FORMATS, type PreviewFormat } from "@/lib/meta/previews";
import {
  applyAudience,
  applyPlacements,
  audienceFromTargeting,
  countryName,
  creativeInfo,
  placementsFromTargeting,
  rebuildCreative,
} from "@/lib/meta/targeting";
import { emptySums, type MetricSums } from "@/lib/metrics";
import { metricSums } from "@/lib/queries/metric-sql";
import { connectedAccount, resolveAccount, type ConnectedAccount } from "@/lib/queries/ownership";

type Obj = Record<string, unknown>;
const metaId = z.string().regex(/^\d+$/);
const levelSchema = z.enum(["campaign", "adset", "ad"]);
const money = z.number().positive().max(10_000_000);

const str = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));
const major = (v: unknown, currency: string) => (v === undefined || v === null || v === "" || Number(v) <= 0 ? null : fromMinorUnits(Number(v), currency));
const issues = (v: unknown): Issue[] =>
  (Array.isArray(v) ? v : []).map((i: Obj) => ({ message: String(i.error_summary ?? i.error_message ?? "Issue"), level: str(i.level) ?? undefined }));

type CreateResult = { ok: boolean; message?: string; error?: string; id?: string };

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: failure(err)?.error ?? "Something went wrong" };
}

function attributionLabel(spec: unknown): string {
  const list = Array.isArray(spec) ? (spec as { event_type: string; window_days: number }[]) : [];
  if (!list.length) return "Default";
  const name: Record<string, string> = { CLICK_THROUGH: "click", VIEW_THROUGH: "view", ENGAGED_VIDEO_VIEW: "engaged view" };
  return list.map((s) => `${s.window_days}-day ${name[s.event_type] ?? s.event_type.toLowerCase()}`).join(", ");
}

async function afterWrite(account: ConnectedAccount) {
  await enqueue("structure.sync", { adAccountId: account.id }, { dedupeKey: `structure:${account.id}`, priority: PRIORITY.launch, adAccountId: account.id });
  kickWorker();
  refresh();
}

// ── Load ─────────────────────────────────────────────────────────────────────

export async function loadObjectAction(level: "campaign" | "adset" | "ad", id: string): Promise<LoadResult<CampaignData | AdsetData | AdData>> {
  try {
    await requireUser("viewer");
    const lvl = levelSchema.parse(level);
    const objId = metaId.parse(id);
    const account = await resolveAccount(lvl, [objId]);
    const o = await fetchObject<Obj>(lvl, objId, account.id);
    const cur = account.currency;

    if (lvl === "campaign") {
      const data: CampaignData = {
        id: objId,
        name: String(o.name),
        status: String(o.status),
        effectiveStatus: String(o.effective_status),
        objective: str(o.objective),
        specialAdCategories: (o.special_ad_categories as string[] | undefined)?.filter((c) => c !== "NONE") ?? [],
        budgetType: o.lifetime_budget && Number(o.lifetime_budget) > 0 ? "lifetime" : o.daily_budget && Number(o.daily_budget) > 0 ? "daily" : null,
        budget: major(o.lifetime_budget, cur) ?? major(o.daily_budget, cur),
        budgetRemaining: major(o.budget_remaining, cur),
        bidStrategy: str(o.bid_strategy),
        spendCap: major(o.spend_cap, cur),
        startTime: str(o.start_time),
        stopTime: str(o.stop_time),
        createdTime: str(o.created_time),
        issues: issues(o.issues_info),
      };
      return { ok: true, data };
    }

    if (lvl === "adset") {
      const camp = (o.campaign ?? {}) as Obj;
      const campaignBudget = Number(camp.daily_budget ?? 0) > 0 || Number(camp.lifetime_budget ?? 0) > 0;
      const promoted = (o.promoted_object ?? {}) as Obj;
      const constraints = (o.bid_constraints ?? {}) as Obj;
      const data: AdsetData = {
        id: objId,
        name: String(o.name),
        status: String(o.status),
        effectiveStatus: String(o.effective_status),
        campaignId: String(o.campaign_id),
        campaignName: String(camp.name ?? ""),
        objective: str(camp.objective),
        campaignBudget,
        budgetType: Number(o.lifetime_budget ?? 0) > 0 ? "lifetime" : Number(o.daily_budget ?? 0) > 0 ? "daily" : null,
        budget: major(o.lifetime_budget, cur) ?? major(o.daily_budget, cur),
        bidStrategy: str(o.bid_strategy) ?? str(camp.bid_strategy),
        bidAmount: major(o.bid_amount, cur),
        roasFloor: constraints.roas_average_floor ? Number(constraints.roas_average_floor) / 10000 : null,
        optimizationGoal: str(o.optimization_goal),
        billingEvent: str(o.billing_event),
        pixelId: str(promoted.pixel_id),
        conversionEvent: str(promoted.custom_event_type),
        destinationType: str(o.destination_type),
        attribution: attributionLabel(o.attribution_spec),
        startTime: str(o.start_time),
        endTime: str(o.end_time),
        learning: str(((o.learning_stage_info ?? {}) as Obj).status),
        audience: audienceFromTargeting(o.targeting),
        placements: placementsFromTargeting(o.targeting, DEFAULT_PLACEMENTS),
        createdTime: str(o.created_time),
        issues: issues(o.issues_info),
      };
      return { ok: true, data };
    }

    const creative = (o.creative ?? {}) as Obj;
    const info = creativeInfo(creative);
    const feedback = (o.ad_review_feedback ?? {}) as Record<string, Record<string, string>>;
    const data: AdData = {
      id: objId,
      name: String(o.name),
      status: String(o.status),
      effectiveStatus: String(o.effective_status),
      adsetId: String(o.adset_id),
      adsetName: String(((o.adset ?? {}) as Obj).name ?? ""),
      campaignId: String(o.campaign_id),
      creativeId: str(creative.id),
      creativeName: str(creative.name),
      thumbnailUrl: str(creative.thumbnail_url) ?? str(creative.image_url),
      format: info.format,
      pageId: info.pageId,
      instagramUserId: info.instagramUserId,
      copy: info.copy,
      copyEditable: info.editable,
      review: Object.values(feedback).flatMap((r) => Object.entries(r).map(([k, v]) => `${k}: ${v}`)),
      issues: issues(o.issues_info),
      createdTime: str(o.created_time),
    };
    return { ok: true, data };
  } catch (err) {
    return fail(err);
  }
}

// ── Save (edit) ──────────────────────────────────────────────────────────────

const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

async function saveAndAudit(userId: string, level: "campaign" | "adset" | "ad", id: string, params: Params, account: ConnectedAccount, extra?: Obj) {
  const change = await updateObject(level, id, params, account.id);
  await audit(userId, `${level}.update`, { type: level, id }, { accountId: account.id, fields: Object.keys(params), changes: [change] satisfies Change[], ...extra });
}

const campaignPatch = z.object({
  name: z.string().trim().min(1).max(400).optional(),
  budgetType: z.enum(["daily", "lifetime"]).optional(),
  budget: money.optional(),
  bidStrategy: z.enum(BID_STRATEGIES).optional(),
  spendCap: z.number().min(0).max(100_000_000).nullable().optional(),
  startTime: localTime.optional(),
  stopTime: localTime.nullable().optional(),
});

export async function saveCampaignAction(id: string, patch: z.input<typeof campaignPatch>): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const objId = metaId.parse(id);
    const p = campaignPatch.parse(patch);
    const account = await resolveAccount("campaign", [objId]);
    const params: Params = {};
    if (p.name) params.name = p.name;
    if (p.budget && p.budgetType) params[p.budgetType === "daily" ? "daily_budget" : "lifetime_budget"] = toMinorUnits(p.budget, account.currency);
    if (p.bidStrategy) params.bid_strategy = p.bidStrategy;
    if (p.spendCap !== undefined) params.spend_cap = p.spendCap ? toMinorUnits(p.spendCap, account.currency) : REMOVE_SPEND_CAP;
    if (p.startTime) params.start_time = zonedLocalToIso(p.startTime, account.timezoneName);
    if (p.stopTime !== undefined) params.stop_time = p.stopTime ? zonedLocalToIso(p.stopTime, account.timezoneName) : "";
    if (Object.keys(params).length === 0) return { ok: true, message: "No changes" };
    await saveAndAudit(user.id, "campaign", objId, params, account);
    await afterWrite(account);
    return { ok: true, message: "Campaign updated" };
  } catch (err) {
    return failure(err);
  }
}

const adsetPatch = z.object({
  name: z.string().trim().min(1).max(400).optional(),
  budgetType: z.enum(["daily", "lifetime"]).optional(),
  budget: money.optional(),
  bidStrategy: z.enum(BID_STRATEGIES).optional(),
  bidAmount: money.nullable().optional(),
  roasFloor: z.number().min(0.01).max(1000).nullable().optional(),
  startTime: localTime.optional(),
  endTime: localTime.nullable().optional(),
  audience: audienceSchema.optional(),
  placements: placementsSchema.optional(),
});

export async function saveAdsetAction(id: string, patch: z.input<typeof adsetPatch>): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const objId = metaId.parse(id);
    const p = adsetPatch.parse(patch);
    const account = await resolveAccount("adset", [objId]);
    const params: Params = {};
    if (p.name) params.name = p.name;
    if (p.budget && p.budgetType) params[p.budgetType === "daily" ? "daily_budget" : "lifetime_budget"] = toMinorUnits(p.budget, account.currency);
    if (p.bidStrategy) params.bid_strategy = p.bidStrategy;
    if (p.bidAmount !== undefined && p.bidAmount !== null) params.bid_amount = toMinorUnits(p.bidAmount, account.currency);
    if (p.roasFloor) params.bid_constraints = { roas_average_floor: Math.round(p.roasFloor * 10000) };
    if (p.startTime) params.start_time = zonedLocalToIso(p.startTime, account.timezoneName);
    if (p.endTime !== undefined) params.end_time = p.endTime ? zonedLocalToIso(p.endTime, account.timezoneName) : "";
    if (p.audience || p.placements) {
      // Targeting is replaced wholesale by Meta, so patch the live spec rather than rebuilding it.
      const live = await graph<{ targeting?: Obj }>(objId, { params: { fields: "targeting" }, accountId: account.id });
      let targeting: Obj = live.targeting ?? {};
      if (p.audience) targeting = applyAudience(targeting, p.audience);
      if (p.placements) targeting = applyPlacements(targeting, p.placements);
      params.targeting = targeting;
    }
    if (Object.keys(params).length === 0) return { ok: true, message: "No changes" };
    await saveAndAudit(user.id, "adset", objId, params, account);
    await afterWrite(account);
    return { ok: true, message: "Ad set updated" };
  } catch (err) {
    return failure(err);
  }
}

const copySchema = z.object({
  primaryText: z.string().trim().min(1, "Primary text is required").max(2200),
  headline: z.string().trim().min(1, "Headline is required").max(255),
  description: z.string().trim().max(255),
  url: z.url({ protocol: /^https?$/, message: "Enter a full https:// URL" }),
  // Any Meta CTA enum value (the picker offers CTA_TYPES; existing ads may use others).
  cta: z.string().regex(/^[A-Z_]{2,40}$/),
  urlTags: z.string().trim().max(1000),
});

const adPatch = z.object({ name: z.string().trim().min(1).max(400).optional(), copy: copySchema.optional() });

export async function saveAdAction(id: string, patch: z.input<typeof adPatch>): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const objId = metaId.parse(id);
    const p = adPatch.parse(patch);
    const account = await resolveAccount("ad", [objId]);
    const params: Params = {};
    if (p.name) params.name = p.name;
    let message = "Ad updated";
    if (p.copy) {
      const live = await graph<{ creative?: Obj }>(objId, {
        params: { fields: "creative{id,name,object_story_spec,asset_feed_spec,url_tags,object_story_id,effective_object_story_id,degrees_of_freedom_spec}" },
        accountId: account.id,
      });
      const info = creativeInfo(live.creative);
      if (!info.editable) throw new UserError("This ad's creative can't be edited here (existing post or carousel). Edit it in Meta Ads Manager.");
      // Keep the enhancement choices the ad was built with; only creatives without any get everything opted out.
      const dof = (live.creative?.degrees_of_freedom_spec ?? {}) as Obj;
      const features = dof.creative_features_spec && typeof dof.creative_features_spec === "object" ? (dof.creative_features_spec as Obj) : creativeFeaturesSpec([]);
      const creativeId = await createObject("adcreatives", account.id, rebuildCreative(live.creative, p.copy, features));
      params.creative = { creative_id: creativeId };
      message = "Ad updated. The new copy goes through Meta review before it delivers.";
    }
    if (Object.keys(params).length === 0) return { ok: true, message: "No changes" };
    await saveAndAudit(user.id, "ad", objId, params, account);
    await afterWrite(account);
    return { ok: true, message };
  } catch (err) {
    return failure(err);
  }
}

// ── Create ───────────────────────────────────────────────────────────────────

const ATTRIBUTION: Record<string, { event_type: string; window_days: number }[]> = {
  "7d_click_1d_view": [
    { event_type: "CLICK_THROUGH", window_days: 7 },
    { event_type: "VIEW_THROUGH", window_days: 1 },
  ],
  "7d_click": [{ event_type: "CLICK_THROUGH", window_days: 7 }],
  "1d_click": [{ event_type: "CLICK_THROUGH", window_days: 1 }],
  "1d_click_1d_view": [
    { event_type: "CLICK_THROUGH", window_days: 1 },
    { event_type: "VIEW_THROUGH", window_days: 1 },
  ],
};

const createAdsetSchema = z.object({
  campaignId: metaId,
  name: z.string().trim().min(1).max(400),
  optimizationGoal: z.enum(["OFFSITE_CONVERSIONS", "VALUE", "LANDING_PAGE_VIEWS", "LINK_CLICKS", "REACH", "IMPRESSIONS", "AD_RECALL_LIFT", "THRUPLAY"]),
  pixelId: metaId.optional(),
  conversionEvent: z.enum(CONVERSION_EVENTS).optional(),
  budgetType: z.enum(["daily", "lifetime"]),
  budget: money.optional(),
  bidStrategy: z.enum(BID_STRATEGIES),
  bidAmount: money.optional(),
  roasFloor: z.number().min(0.01).max(1000).optional(),
  startTime: localTime.optional(),
  endTime: localTime.optional(),
  attribution: z.enum(["7d_click_1d_view", "7d_click", "1d_click", "1d_click_1d_view"]),
  audience: audienceSchema,
  placements: placementsSchema,
});

export async function createAdsetAction(input: z.input<typeof createAdsetSchema>): Promise<CreateResult> {
  try {
    const user = await requireUser("buyer");
    const s = createAdsetSchema.parse(input);
    const account = await resolveAccount("campaign", [s.campaignId]);
    const campaign = await graph<Obj>(s.campaignId, { params: { fields: "objective,daily_budget,lifetime_budget,bid_strategy" }, accountId: account.id });
    const cbo = Number(campaign.daily_budget ?? 0) > 0 || Number(campaign.lifetime_budget ?? 0) > 0;
    const lifetime = cbo ? Number(campaign.lifetime_budget ?? 0) > 0 : s.budgetType === "lifetime";
    const bidStrategy = cbo ? String(campaign.bid_strategy ?? "LOWEST_COST_WITHOUT_CAP") : s.bidStrategy;

    if (usesPixel(s.optimizationGoal) && (!s.pixelId || !s.conversionEvent)) throw new UserError("Choose a pixel and conversion event.");
    if (!cbo && !s.budget) throw new UserError("Enter an ad set budget.");
    if (lifetime && !s.endTime) throw new UserError("Lifetime budgets need an end date.");
    if (needsBidAmount(bidStrategy) && !s.bidAmount) throw new UserError("This bid strategy needs a cost or bid amount.");
    if (bidStrategy === "LOWEST_COST_WITH_MIN_ROAS" && (s.optimizationGoal !== "VALUE" || !s.roasFloor))
      throw new UserError("A ROAS goal needs the “Conversion value” optimization and a minimum ROAS.");

    const targeting = applyPlacements(applyAudience({}, s.audience), s.placements);
    const params: Params = {
      name: s.name,
      campaign_id: s.campaignId,
      status: "PAUSED",
      billing_event: s.optimizationGoal === "THRUPLAY" ? "THRUPLAY" : "IMPRESSIONS",
      optimization_goal: s.optimizationGoal,
      targeting,
      start_time: s.startTime ? zonedLocalToIso(s.startTime, account.timezoneName) : new Date().toISOString(),
    };
    if (s.endTime) params.end_time = zonedLocalToIso(s.endTime, account.timezoneName);
    if (["OFFSITE_CONVERSIONS", "VALUE", "LANDING_PAGE_VIEWS", "LINK_CLICKS"].includes(s.optimizationGoal)) params.destination_type = "WEBSITE";
    if (usesPixel(s.optimizationGoal)) {
      params.promoted_object = { pixel_id: s.pixelId, custom_event_type: s.conversionEvent };
      params.attribution_spec = ATTRIBUTION[s.attribution];
    }
    if (!cbo) {
      params[s.budgetType === "daily" ? "daily_budget" : "lifetime_budget"] = toMinorUnits(s.budget!, account.currency);
      params.bid_strategy = s.bidStrategy;
    }
    if (needsBidAmount(bidStrategy) && s.bidAmount) params.bid_amount = toMinorUnits(s.bidAmount, account.currency);
    if (bidStrategy === "LOWEST_COST_WITH_MIN_ROAS" && s.roasFloor) params.bid_constraints = { roas_average_floor: Math.round(s.roasFloor * 10000) };

    const id = await createObject("adsets", account.id, params);
    await db()
      .insert(adsets)
      .values({
        id,
        adAccountId: account.id,
        campaignId: s.campaignId,
        name: s.name,
        status: "PAUSED",
        effectiveStatus: "PAUSED",
        dailyBudget: (params.daily_budget as number | undefined) ?? null,
        lifetimeBudget: (params.lifetime_budget as number | undefined) ?? null,
        optimizationGoal: s.optimizationGoal,
        billingEvent: params.billing_event as string,
        promotedObject: (params.promoted_object as Obj | undefined) ?? null,
        startTime: params.start_time as string,
        endTime: (params.end_time as string | undefined) ?? null,
        createdTime: new Date().toISOString(),
        syncedAt: Date.now(),
      })
      .onConflictDoNothing();
    await audit(user.id, "adset.created", { type: "adset", id }, { accountId: account.id, name: s.name, campaignId: s.campaignId });
    await afterWrite(account);
    return { ok: true, message: "Ad set created (off). Add an ad next.", id };
  } catch (err) {
    return fail(err);
  }
}

const createAdSchema = z.object({
  adsetId: metaId,
  name: z.string().trim().min(1).max(400),
  pageId: metaId,
  instagramUserId: metaId.optional(),
  // Flexible format is only offered in the campaign builder.
  media: mediaPickSchema.omit({ moreAssetIds: true }),
  copy: copySchema,
});

/** The ad's files + copy → creative spec matching this ad set's destination and placements (uploads media to Meta if needed). */
async function buildAdCreative(account: ConnectedAccount, input: z.infer<typeof createAdSchema>) {
  const { square, vertical } = await loadMedia(account.clientId, input.media);
  const sq = await ensureMetaMedia(square, account.id, "interactive");
  const vt = vertical.id === square.id ? sq : await ensureMetaMedia(vertical, account.id, "interactive");
  if (!sq.ready || !vt.ready) {
    throw new UserError("Meta is still processing this video. Try again in a minute.");
  }
  const live = await graph<{ targeting?: Obj; destination_type?: string; promoted_object?: Obj }>(input.adsetId, {
    params: { fields: "targeting,destination_type,promoted_object" },
    accountId: account.id,
  });
  return creativePayload({
    name: input.name,
    pageId: input.pageId,
    instagramUserId: input.instagramUserId,
    square: sq.ref,
    vertical: vt.ref,
    ad: fromCopy(input.copy),
    destination: destinationFromAdset(live.destination_type, live.promoted_object),
    urlTags: input.copy.urlTags,
    positions: creativePositions(placementsFromTargeting(live.targeting, DEFAULT_PLACEMENTS), DEFAULT_PLACEMENTS),
  });
}

export async function createAdAction(input: z.input<typeof createAdSchema>): Promise<CreateResult> {
  try {
    const user = await requireUser("buyer");
    const a = createAdSchema.parse(input);
    const account = await resolveAccount("adset", [a.adsetId]);
    const payload = await buildAdCreative(account, a);
    // Keep the files in the library as a creative, like the campaign builder does.
    await findOrCreateCreative(account.clientId, a.media, user.id);
    const creativeId = await createObject("adcreatives", account.id, payload);
    const id = await createObject("ads", account.id, { name: a.name, adset_id: a.adsetId, creative: { creative_id: creativeId }, status: "PAUSED" });
    const [parent] = await db().select({ campaignId: adsets.campaignId }).from(adsets).where(eq(adsets.id, a.adsetId)).limit(1);
    await db()
      .insert(ads)
      .values({
        id,
        adAccountId: account.id,
        campaignId: parent?.campaignId ?? "",
        adsetId: a.adsetId,
        name: a.name,
        status: "PAUSED",
        effectiveStatus: "PAUSED",
        creativeId,
        createdTime: new Date().toISOString(),
        syncedAt: Date.now(),
      })
      .onConflictDoNothing();
    await audit(user.id, "ad.created", { type: "ad", id }, { accountId: account.id, name: a.name, adsetId: a.adsetId, creativeId });
    await afterWrite(account);
    return { ok: true, message: "Ad created (off). It's reviewed by Meta once you turn it on.", id };
  } catch (err) {
    return fail(err);
  }
}

// ── Previews ─────────────────────────────────────────────────────────────────

const formatSchema = z.enum(PREVIEW_FORMATS.map((f) => f.id) as [PreviewFormat, ...PreviewFormat[]]);
type PreviewResult = { ok: true; src: string } | { ok: false; error: string };

/** Placement render of a live ad. */
export async function previewAdAction(adId: string, format: PreviewFormat): Promise<PreviewResult> {
  try {
    await requireUser("viewer");
    const id = metaId.parse(adId);
    const fmt = formatSchema.parse(format);
    const account = await resolveAccount("ad", [id]);
    const res = await graph<{ data: { body: string }[] }>(`${id}/previews`, { params: { ad_format: fmt }, accountId: account.id });
    const body = res.data[0]?.body;
    if (!body) throw new UserError("Meta returned no preview for this placement.");
    return { ok: true, src: extractPreviewSrc(body) };
  } catch (err) {
    return fail(err);
  }
}

/** Placement render of an ad that hasn't been created yet. */
export async function previewNewAdAction(input: z.input<typeof createAdSchema>, format: PreviewFormat): Promise<PreviewResult> {
  try {
    await requireUser("buyer");
    const a = createAdSchema.parse({ ...input, name: input.name || "Preview" });
    const account = await resolveAccount("adset", [a.adsetId]);
    const payload = await buildAdCreative(account, a);
    return { ok: true, src: await generatePreview(account.id, payload, formatSchema.parse(format)) };
  } catch (err) {
    if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Fill in the ad first" };
    return fail(err);
  }
}

// ── Lookups ──────────────────────────────────────────────────────────────────

type Lookup<T> = { ok: true; items: T[] } | { ok: false; error: string };

export async function searchLocationsAction(accountId: string, q: string): Promise<Lookup<GeoItem>> {
  try {
    await requireUser("buyer");
    const account = await connectedAccount(accountId);
    const query = z.string().trim().min(1).max(100).parse(q);
    const res = await graph<{ data: Obj[] }>("search", {
      params: { type: "adgeolocation", q: query, location_types: ["country", "region", "city", "zip", "geo_market"], limit: 12 },
      accountId: account.id,
    });
    return {
      ok: true,
      items: res.data.map((d) => ({
        kind: String(d.type) as GeoItem["kind"],
        key: String(d.type === "country" ? d.country_code ?? d.key : d.key),
        name: String(d.type === "country" ? countryName(String(d.country_code ?? d.key)) : d.name),
        detail: [d.region, d.country_name].filter(Boolean).join(", ") || undefined,
      })),
    };
  } catch (err) {
    return fail(err);
  }
}

export async function searchDetailedAction(accountId: string, q: string): Promise<Lookup<DetailedItem>> {
  try {
    await requireUser("buyer");
    const account = await connectedAccount(accountId);
    const query = z.string().trim().min(1).max(100).parse(q);
    const map = (d: Obj): DetailedItem => ({
      id: String(d.id),
      name: String(d.name),
      type: String(d.type ?? "interests"),
      path: Array.isArray(d.path) ? (d.path as string[]) : undefined,
      size: Number(d.audience_size_upper_bound ?? d.audience_size ?? 0) || undefined,
    });
    try {
      // Unified search covers interests, behaviors and demographics.
      const res = await graph<{ data: Obj[] }>(`${account.id}/targetingsearch`, { params: { q: query, limit: 25 }, accountId: account.id });
      return { ok: true, items: res.data.map(map) };
    } catch {
      const res = await graph<{ data: Obj[] }>("search", { params: { type: "adinterest", q: query, limit: 25 }, accountId: account.id });
      return { ok: true, items: res.data.map((d) => map({ ...d, type: "interests" })) };
    }
  } catch (err) {
    return fail(err);
  }
}

/** Library creatives of the account's client, for the "new ad" picker. */
export async function libraryCreativesAction(accountId: string): Promise<Lookup<LibraryCreative>> {
  try {
    await requireUser("buyer");
    const account = await connectedAccount(accountId);
    const rows = await db()
      .select({ c: creatives })
      .from(creatives)
      .where(and(eq(creatives.clientId, account.clientId), isNull(creatives.archivedAt)))
      .orderBy(desc(creatives.createdAt))
      .limit(300);
    return {
      ok: true,
      items: rows.map(({ c }) => ({ id: c.id, name: c.name, kind: c.kind, single: c.squareAssetId === c.verticalAssetId, assetId: c.squareAssetId, verticalAssetId: c.verticalAssetId })),
    };
  } catch (err) {
    return fail(err);
  }
}

/** Library files of the account's client, for uploading / cropping media right in the "new ad" form. */
export async function libraryAssetsAction(accountId: string): Promise<{ ok: true; clientId: string; items: LibraryAsset[] } | { ok: false; error: string }> {
  try {
    await requireUser("buyer");
    const account = await connectedAccount(accountId);
    const items = await db()
      .select({ id: creativeAssets.id, kind: creativeAssets.kind, fileName: creativeAssets.fileName, width: creativeAssets.width, height: creativeAssets.height, aspect: creativeAssets.aspect })
      .from(creativeAssets)
      .where(eq(creativeAssets.clientId, account.clientId))
      .orderBy(desc(creativeAssets.createdAt))
      .limit(500);
    return { ok: true, clientId: account.clientId, items };
  } catch (err) {
    return fail(err);
  }
}

/** Default URL parameters for new ads: the client's UTM rule. */
export async function defaultUrlTagsAction(accountId: string): Promise<string> {
  await requireUser("buyer");
  const account = await connectedAccount(accountId);
  const [client] = await db().select().from(clients).where(eq(clients.id, account.clientId)).limit(1);
  if (!client?.utmRuleId) return buildUrlTags(DEFAULT_UTM_PARAMS);
  const [rule] = await db().select().from(utmRules).where(eq(utmRules.id, client.utmRuleId)).limit(1);
  return buildUrlTags(rule?.params ?? DEFAULT_UTM_PARAMS);
}

// ── Per-object charts ────────────────────────────────────────────────────────

export async function objectSeriesAction(
  level: "campaign" | "adset" | "ad",
  id: string,
  since: string,
  until: string,
): Promise<LoadResult<{ date: string; sums: MetricSums }[]>> {
  try {
    await requireUser("viewer");
    const lvl = levelSchema.parse(level);
    const objId = metaId.parse(id);
    if (!isIsoDate(since) || !isIsoDate(until) || since > until || daysBetween(since, until) > MAX_RANGE_DAYS) throw new UserError("Invalid date range.");
    const account = await resolveAccount(lvl, [objId]);
    const col = lvl === "campaign" ? insightsDaily.campaignId : lvl === "adset" ? insightsDaily.adsetId : insightsDaily.adId;
    const rows = await db()
      .select({ date: insightsDaily.date, ...metricSums })
      .from(insightsDaily)
      .where(and(eq(insightsDaily.adAccountId, account.id), eq(col, objId), between(insightsDaily.date, since, until)))
      .groupBy(insightsDaily.date);
    const byDate = new Map(rows.map(({ date, ...sums }) => [date, sums as MetricSums]));
    const data = Array.from({ length: daysBetween(since, until) }, (_, i) => {
      const date = addDays(since, i);
      return { date, sums: byDate.get(date) ?? emptySums() };
    });
    return { ok: true, data };
  } catch (err) {
    return fail(err);
  }
}
