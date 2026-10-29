"use server";

import { and, between, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { failure, UserError, type ActionState } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { takeMetaQuota } from "@/lib/auth/user-rate";
import { addDays, daysBetween, isIsoDate, MAX_RANGE_DAYS, zonedLocalToIso } from "@/lib/dates";
import { db } from "@/lib/db";
import { insightsDaily } from "@/lib/db/schema";
import { kickWorker } from "@/lib/jobs/kick";
import { enqueue, PRIORITY } from "@/lib/jobs/queue";
import { creativeFeaturesSpec, fromMinorUnits, toMinorUnits } from "@/lib/launch/payloads";
import { CREATIVE_FEATURES, MAX_FEED_BODY } from "@/lib/launch/spec";
import { graph, type Params } from "@/lib/meta/client";
import { MetaApiError } from "@/lib/meta/errors";
import {
  BID_STRATEGIES,
  DEFAULT_PLACEMENTS,
  type AdData,
  type AdsetData,
  type CampaignData,
  type DetailedItem,
  type GeoItem,
  type Issue,
  type LoadResult,
} from "@/lib/meta/editor-types";
import { audienceSchema, placementsSchema } from "@/lib/meta/editor-schemas";
import { createObject, fetchObject, REMOVE_SPEND_CAP, updateObject, type Change } from "@/lib/meta/objects";
import { extractPreviewSrc, PREVIEW_FORMATS, type PreviewFormat } from "@/lib/meta/previews";
import {
  applyAudience,
  applyPlacements,
  audienceFromTargeting,
  countryName,
  creativeInfo,
  MAX_TEXT_OPTIONS,
  placementsFromTargeting,
  rebuildCreative,
} from "@/lib/meta/targeting";
import { emptySums, type MetricSums } from "@/lib/metrics";
import { metricSums } from "@/lib/queries/metric-sql";
import { assertNotAwaitingApproval, connectedAccount, resolveAccount, type ConnectedAccount } from "@/lib/queries/ownership";

type Obj = Record<string, unknown>;
const metaId = z.string().regex(/^\d+$/);
const levelSchema = z.enum(["campaign", "adset", "ad"]);
const money = z.number().positive().max(10_000_000);

const str = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));
const major = (v: unknown, currency: string) => (v === undefined || v === null || v === "" || Number(v) <= 0 ? null : fromMinorUnits(Number(v), currency));
const issues = (v: unknown): Issue[] =>
  (Array.isArray(v) ? v : []).map((i: Obj) => ({ message: String(i.error_summary ?? i.error_message ?? "Issue"), level: str(i.level) ?? undefined }));

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
    const user = await requireUser("viewer");
    takeMetaQuota(user.id);
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
      maxTexts: info.maxTexts,
      fixedTexts: info.fixedTexts,
      website: info.website,
      features: info.features,
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
    await assertNotAwaitingApproval("campaign", [objId]);
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
    await assertNotAwaitingApproval("adset", [objId]);
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

const httpUrl = z.url({ protocol: /^https?$/, message: "Enter a full https:// URL" });
const copySchema = z.object({
  primaryTexts: z.array(z.string().trim().min(1, "Primary text can't be empty").max(2200)).min(1).max(MAX_TEXT_OPTIONS),
  headlines: z.array(z.string().trim().min(1, "Headline can't be empty").max(255)).min(1).max(MAX_TEXT_OPTIONS),
  description: z.string().trim().max(255),
  url: httpUrl.or(z.literal("")),
  displayLink: z.string().trim().max(100),
  // Any Meta CTA enum value (the picker offers the common ones; existing ads may use others).
  cta: z.string().regex(/^[A-Z_]{2,40}$/),
  urlTags: z.string().trim().max(1000),
});

const adPatch = z.object({
  name: z.string().trim().min(1).max(400).optional(),
  copy: copySchema.optional(),
  /** Advantage+ creative enhancements to keep on; every other one is opted out. */
  features: z.array(z.enum(CREATIVE_FEATURES)).optional(),
  /** Multi-advertiser ads for the new creative; unset = keep the old creative's setting. */
  multiAdvertiser: z.enum(["on", "off"]).optional(),
});

const CREATIVE_EDIT_FIELDS = "id,name,object_story_spec,asset_feed_spec,url_tags,object_story_id,effective_object_story_id,degrees_of_freedom_spec";

/** The ad's creative with its multi-advertiser setting; that field is re-read without when Meta won't return it. */
async function creativeForEdit(adId: string, accountId: string): Promise<Obj | undefined> {
  try {
    const live = await graph<{ creative?: Obj }>(adId, { params: { fields: `creative{${CREATIVE_EDIT_FIELDS},contextual_multi_ads}` }, accountId });
    return live.creative;
  } catch (err) {
    if (!(err instanceof MetaApiError) || err.code !== 100) throw err;
    const live = await graph<{ creative?: Obj }>(adId, { params: { fields: `creative{${CREATIVE_EDIT_FIELDS}}` }, accountId });
    return live.creative;
  }
}

export async function saveAdAction(id: string, patch: z.input<typeof adPatch>): Promise<ActionState> {
  try {
    const user = await requireUser("buyer");
    const objId = metaId.parse(id);
    const p = adPatch.parse(patch);
    const account = await resolveAccount("ad", [objId]);
    await assertNotAwaitingApproval("ad", [objId]);
    const params: Params = {};
    if (p.name) params.name = p.name;
    let message = "Ad updated";
    if (p.copy || p.features || p.multiAdvertiser) {
      const creative = await creativeForEdit(objId, account.id);
      const info = creativeInfo(creative);
      if (!info.editable) throw new UserError("This ad's creative can't be edited here (existing post or carousel). Edit it in Meta Ads Manager.");
      const copy = p.copy ?? info.copy;
      if (copy.primaryTexts.length > info.maxTexts || copy.headlines.length > info.maxTexts)
        throw new UserError(info.maxTexts === 1 ? "This ad's format allows one primary text and one headline." : `This ad's format allows up to ${info.maxTexts} text options.`);
      if (info.fixedTexts && (copy.primaryTexts.length !== info.copy.primaryTexts.length || copy.headlines.length !== info.copy.headlines.length))
        throw new UserError("This ad's texts are tied to placements: change their wording, not how many there are.");
      if (info.website && !copy.url) throw new UserError("Enter the website URL.");
      const inFeed = copy.primaryTexts.length > 1 || copy.headlines.length > 1 || info.format === "placement" || info.format === "flexible";
      if (inFeed && copy.primaryTexts.some((t) => t.length > MAX_FEED_BODY))
        throw new UserError(`This ad's format allows primary texts of up to ${MAX_FEED_BODY.toLocaleString("en-US")} characters.`);
      // Unchanged toggles keep the creative's current enhancement settings (including ones this app doesn't list).
      const current = ((creative?.degrees_of_freedom_spec ?? {}) as Obj).creative_features_spec;
      const features = p.features ? { ...(current && typeof current === "object" ? (current as Obj) : {}), ...creativeFeaturesSpec(p.features) } : current && typeof current === "object" ? (current as Obj) : creativeFeaturesSpec([]);
      const multi = p.multiAdvertiser === "on" ? "OPT_IN" : p.multiAdvertiser === "off" ? "OPT_OUT" : undefined;
      const creativeId = await createObject("adcreatives", account.id, rebuildCreative(creative, copy, features, multi));
      params.creative = { creative_id: creativeId };
      message = "Ad updated. The new creative goes through Meta review before it delivers.";
    }
    if (Object.keys(params).length === 0) return { ok: true, message: "No changes" };
    await saveAndAudit(user.id, "ad", objId, params, account);
    await afterWrite(account);
    return { ok: true, message };
  } catch (err) {
    return failure(err);
  }
}

// ── Previews ─────────────────────────────────────────────────────────────────

const formatSchema = z.enum(PREVIEW_FORMATS.map((f) => f.id) as [PreviewFormat, ...PreviewFormat[]]);
type PreviewResult = { ok: true; src: string } | { ok: false; error: string };

/** Placement render of a live ad. */
export async function previewAdAction(adId: string, format: PreviewFormat): Promise<PreviewResult> {
  try {
    const user = await requireUser("viewer");
    takeMetaQuota(user.id);
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

// ── Lookups ──────────────────────────────────────────────────────────────────

type Lookup<T> = { ok: true; items: T[] } | { ok: false; error: string };

export async function searchLocationsAction(accountId: string, q: string): Promise<Lookup<GeoItem>> {
  try {
    const user = await requireUser("buyer");
    takeMetaQuota(user.id);
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
    const user = await requireUser("buyer");
    takeMetaQuota(user.id);
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
