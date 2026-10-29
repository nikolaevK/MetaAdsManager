"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { failure } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/session";
import { takeMetaQuota } from "@/lib/auth/user-rate";
import { db } from "@/lib/db";
import { adAccounts } from "@/lib/db/schema";
import { CONVERSION_EVENTS, PIXEL_EVENT_NAMES, type ConversionEvent } from "@/lib/launch/spec";
import { getDsaDefaults, listApps, listCustomAudiences, listInstagramAccounts, listLeadForms, listPages, listPixels, pixelEventCounts, type PageSource } from "@/lib/meta/accounts";

/** Live Meta lookups for pickers (pages, IG accounts, pixels, audiences). Connected accounts only. */

type Lookup<T> = { ok: true; items: T[] } | { ok: false; error: string };

async function connectedRow(accountId: string) {
  const id = z.string().regex(/^act_\d+$/).parse(accountId);
  const [row] = await db().select({ id: adAccounts.id, businessId: adAccounts.businessId }).from(adAccounts).where(eq(adAccounts.id, id)).limit(1);
  if (!row) throw new Error("Ad account is not connected");
  return row;
}

async function connected(accountId: string): Promise<string> {
  return (await connectedRow(accountId)).id;
}

function fail<T>(err: unknown): Lookup<T> {
  return { ok: false, error: failure(err)?.error ?? "Lookup failed" };
}

// Pickers mount often (every ad set tab, every sheet open): reuse a recent answer instead of calling Meta each
// time. Per process and short-lived, so new Pages, pixels or audiences show up within minutes (or via Reload).
const g = globalThis as unknown as { __lookupCache?: Map<string, { at: number; value: unknown }> };
const cache = (g.__lookupCache ??= new Map());
const MINUTE = 60_000;

async function cached<T>(key: string, ttlMs: number, fresh: boolean | undefined, load: () => Promise<T>, userId: string): Promise<T> {
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  takeMetaQuota(userId);
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return value;
}

export type PageOption = { id: string; name: string; instagram?: { id: string; username?: string }; source: PageSource };

export async function lookupPages(accountId: string, fresh?: boolean): Promise<Lookup<PageOption>> {
  try {
    const user = await requireUser("buyer");
    const account = await connectedRow(accountId);
    const pages = await cached(`pages:${account.id}`, 5 * MINUTE, fresh, () => listPages(account.id, account.businessId), user.id);
    return { ok: true, items: pages.map((p) => ({ id: p.id, name: p.name, instagram: p.instagram_business_account, source: p.source })) };
  } catch (err) {
    return fail(err);
  }
}

export type InstagramOption = { id: string; username?: string };

export async function lookupInstagramAccounts(accountId: string, fresh?: boolean): Promise<Lookup<InstagramOption>> {
  try {
    const user = await requireUser("buyer");
    const id = await connected(accountId);
    const list = await cached(`instagram:${id}`, 5 * MINUTE, fresh, () => listInstagramAccounts(id), user.id);
    return { ok: true, items: list.map((a) => ({ id: a.id, username: a.username })) };
  } catch (err) {
    return fail(err);
  }
}

export async function lookupDsaDefaults(accountId: string): Promise<{ ok: true; beneficiary?: string; payor?: string } | { ok: false; error: string }> {
  try {
    const user = await requireUser("buyer");
    const id = await connected(accountId);
    return { ok: true, ...(await cached(`dsa:${id}`, 10 * MINUTE, false, () => getDsaDefaults(id), user.id)) };
  } catch (err) {
    return { ok: false, error: failure(err)?.error ?? "Lookup failed" };
  }
}

export type LeadFormOption = { id: string; name: string; active: boolean };

export async function lookupLeadForms(accountId: string, pageId: string, fresh?: boolean): Promise<Lookup<LeadFormOption>> {
  try {
    const user = await requireUser("buyer");
    const id = await connected(accountId);
    const page = z.string().regex(/^\d{1,32}$/).parse(pageId);
    const forms = await cached(`lead-forms:${id}:${page}`, 5 * MINUTE, fresh, () => listLeadForms(page, id), user.id);
    return { ok: true, items: forms.map((f) => ({ id: f.id, name: f.name, active: !f.status || f.status === "ACTIVE" })) };
  } catch (err) {
    return fail(err);
  }
}

export type AppOption = { id: string; name: string; storeUrls: string[] };

export async function lookupApps(accountId: string, fresh?: boolean): Promise<Lookup<AppOption>> {
  try {
    const user = await requireUser("buyer");
    const id = await connected(accountId);
    const apps = await cached(`apps:${id}`, 10 * MINUTE, fresh, () => listApps(id), user.id);
    return { ok: true, items: apps.map((a) => ({ id: a.id, name: a.name, storeUrls: Object.values(a.object_store_urls ?? {}).filter((u) => /^https?:\/\//.test(u)) })) };
  } catch (err) {
    return fail(err);
  }
}

export async function lookupPixels(accountId: string, fresh?: boolean): Promise<Lookup<{ id: string; name: string; lastFired?: string }>> {
  try {
    const user = await requireUser("buyer");
    const id = await connected(accountId);
    const pixels = await cached(`pixels:${id}`, 5 * MINUTE, fresh, () => listPixels(id), user.id);
    return { ok: true, items: pixels.map((p) => ({ id: p.id, name: p.name, lastFired: p.last_fired_time })) };
  } catch (err) {
    return fail(err);
  }
}

/** Conversion events the pixel received in the last 7 days, with counts (PageView and custom events can't be optimized for). */
export async function lookupPixelEvents(accountId: string, pixelId: string): Promise<Lookup<{ event: ConversionEvent; count: number }>> {
  try {
    const user = await requireUser("buyer");
    const id = z.string().regex(/^\d{1,32}$/).parse(pixelId);
    const account = await connected(accountId);
    const counts = await cached(`pixel-events:${account}:${id}`, 2 * MINUTE, false, () => pixelEventCounts(id, account), user.id);
    return {
      ok: true,
      items: CONVERSION_EVENTS.filter((e) => counts[PIXEL_EVENT_NAMES[e]] > 0).map((e) => ({ event: e, count: counts[PIXEL_EVENT_NAMES[e]] })),
    };
  } catch (err) {
    return fail(err);
  }
}

export async function lookupAudiences(accountId: string, fresh?: boolean): Promise<Lookup<{ id: string; name: string; subtype?: string; size?: number }>> {
  try {
    const user = await requireUser("buyer");
    const id = await connected(accountId);
    const list = await cached(`audiences:${id}`, 3 * MINUTE, fresh, () => listCustomAudiences(id), user.id);
    return {
      ok: true,
      items: list.map((a) => ({ id: a.id, name: a.name, subtype: a.subtype, size: a.approximate_count_lower_bound })),
    };
  } catch (err) {
    return fail(err);
  }
}
