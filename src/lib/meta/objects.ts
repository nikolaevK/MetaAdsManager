import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ads, adsets, campaigns } from "@/lib/db/schema";
import { graph, type Params } from "./client";
import { TABLES, type Level } from "./mutations";

/** Fields the editor reads live (the mirror only keeps what the tables need). */
export const FIELDS: Record<Level, string> = {
  campaign: [
    "id,name,status,effective_status,objective,buying_type,special_ad_categories",
    "daily_budget,lifetime_budget,budget_remaining,bid_strategy,spend_cap,start_time,stop_time,created_time,issues_info",
  ].join(","),
  adset: [
    "id,name,status,effective_status,campaign_id,campaign{id,name,objective,daily_budget,lifetime_budget,bid_strategy}",
    "daily_budget,lifetime_budget,budget_remaining,bid_amount,bid_strategy,bid_constraints,billing_event,optimization_goal",
    "promoted_object,destination_type,targeting,attribution_spec,start_time,end_time,learning_stage_info,created_time,issues_info",
  ].join(","),
  ad: [
    "id,name,status,effective_status,adset_id,campaign_id,created_time,ad_review_feedback,issues_info",
    "adset{id,name,targeting,optimization_goal,promoted_object}",
    "creative{id,name,object_story_spec,asset_feed_spec,url_tags,thumbnail_url,image_url,object_type,effective_object_story_id,object_story_id}",
  ].join(","),
};

export async function fetchObject<T = Record<string, unknown>>(level: Level, id: string, accountId: string): Promise<T> {
  return graph<T>(id, { params: { fields: FIELDS[level], thumbnail_width: 600, thumbnail_height: 600 }, accountId });
}

/** Meta param → mirror column, so tables reflect an edit before the next sync. */
function mirrorValues(level: Level, params: Params): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));
  if (typeof params.name === "string") out.name = params.name;
  if (typeof params.status === "string" && params.status !== "ARCHIVED" && params.status !== "DELETED") {
    out.status = params.status;
    out.effectiveStatus = params.status;
  }
  if ("daily_budget" in params) out.dailyBudget = num(params.daily_budget);
  if ("lifetime_budget" in params) out.lifetimeBudget = num(params.lifetime_budget);
  if (typeof params.start_time === "string") out.startTime = params.start_time;
  if (level === "campaign") {
    if (typeof params.bid_strategy === "string") out.bidStrategy = params.bid_strategy;
    if ("stop_time" in params) out.stopTime = params.stop_time || null;
  }
  if (level === "adset" && "end_time" in params) out.endTime = params.end_time || null;
  if (level === "ad" && params.creative && typeof params.creative === "object") {
    out.creativeId = (params.creative as { creative_id?: string }).creative_id ?? null;
  }
  return out;
}

export async function mirrorPatch(level: Level, id: string, params: Params): Promise<void> {
  const values = mirrorValues(level, params);
  if (Object.keys(values).length === 0) return;
  const table = TABLES[level];
  await db().update(table).set(values).where(eq(table.id, id));
}

/** Reads the current value of every param about to change, in the shape POST accepts (for undo). */
async function snapshot(level: Level, id: string, params: Params, accountId: string): Promise<Params> {
  const keys = Object.keys(params).filter((k) => k !== "status");
  const before: Params = {};
  if ("status" in params) {
    const table = TABLES[level];
    const [row] = await db().select({ status: table.status }).from(table).where(eq(table.id, id)).limit(1);
    if (row) before.status = row.status;
  }
  if (keys.length === 0) return before;
  const fields = keys.map((k) => (k === "creative" ? "creative{id}" : k)).join(",");
  const current = await graph<Record<string, unknown>>(id, { params: { fields }, accountId });
  for (const k of keys) {
    if (k === "creative") {
      const c = current.creative as { id?: string } | undefined;
      if (c?.id) before.creative = { creative_id: c.id };
    } else if (k === "spend_cap" && current[k] === undefined) {
      before[k] = REMOVE_SPEND_CAP;
    } else if (k === "stop_time" || k === "end_time") {
      // An absent end time is cleared with an empty value; 0 would mean 1970.
      before[k] = current[k] ?? "";
    } else if (current[k] !== undefined) {
      before[k] = current[k];
    }
  }
  return before;
}

/** Marketing API sentinel that clears a campaign spending limit. */
export const REMOVE_SPEND_CAP = 922337203685478;

export type Change = { level: Level; id: string; before: Params; after: Params };

/** POSTs a partial update, keeps the mirror in step, and returns before/after for the audit log + undo. */
export async function updateObject(level: Level, id: string, params: Params, accountId: string): Promise<Change> {
  const before = await snapshot(level, id, params, accountId);
  await graph(id, { method: "POST", params, accountId });
  await mirrorPatch(level, id, params);
  return { level, id, before, after: params };
}

export async function createObject(edge: "campaigns" | "adsets" | "ads" | "adcreatives", accountId: string, params: Params): Promise<string> {
  const res = await graph<{ id: string }>(`${accountId}/${edge}`, { method: "POST", params, accountId, timeoutMs: 120_000 });
  return res.id;
}

export { ads, adsets, campaigns };
