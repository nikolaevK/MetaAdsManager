"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { failure } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { adAccounts } from "@/lib/db/schema";
import { CONVERSION_EVENTS, PIXEL_EVENT_NAMES, type ConversionEvent } from "@/lib/launch/spec";
import { listApps, listCustomAudiences, listPages, listPixels, pixelEventCounts, type PageSource } from "@/lib/meta/accounts";

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

export type PageOption = { id: string; name: string; instagram?: { id: string; username?: string }; source: PageSource };

export async function lookupPages(accountId: string): Promise<Lookup<PageOption>> {
  try {
    await requireUser("buyer");
    const account = await connectedRow(accountId);
    const pages = await listPages(account.id, account.businessId);
    return { ok: true, items: pages.map((p) => ({ id: p.id, name: p.name, instagram: p.instagram_business_account, source: p.source })) };
  } catch (err) {
    return fail(err);
  }
}

export type AppOption = { id: string; name: string; storeUrls: string[] };

export async function lookupApps(accountId: string): Promise<Lookup<AppOption>> {
  try {
    await requireUser("buyer");
    const apps = await listApps(await connected(accountId));
    return { ok: true, items: apps.map((a) => ({ id: a.id, name: a.name, storeUrls: Object.values(a.object_store_urls ?? {}).filter((u) => /^https?:\/\//.test(u)) })) };
  } catch (err) {
    return fail(err);
  }
}

export async function lookupPixels(accountId: string): Promise<Lookup<{ id: string; name: string; lastFired?: string }>> {
  try {
    await requireUser("buyer");
    const pixels = await listPixels(await connected(accountId));
    return { ok: true, items: pixels.map((p) => ({ id: p.id, name: p.name, lastFired: p.last_fired_time })) };
  } catch (err) {
    return fail(err);
  }
}

/** Conversion events the pixel received in the last 7 days, with counts (PageView and custom events can't be optimized for). */
export async function lookupPixelEvents(accountId: string, pixelId: string): Promise<Lookup<{ event: ConversionEvent; count: number }>> {
  try {
    await requireUser("buyer");
    const id = z.string().regex(/^\d{1,32}$/).parse(pixelId);
    const counts = await pixelEventCounts(id, await connected(accountId));
    return {
      ok: true,
      items: CONVERSION_EVENTS.filter((e) => counts[PIXEL_EVENT_NAMES[e]] > 0).map((e) => ({ event: e, count: counts[PIXEL_EVENT_NAMES[e]] })),
    };
  } catch (err) {
    return fail(err);
  }
}

export async function lookupAudiences(accountId: string): Promise<Lookup<{ id: string; name: string; subtype?: string; size?: number }>> {
  try {
    await requireUser("buyer");
    const list = await listCustomAudiences(await connected(accountId));
    return {
      ok: true,
      items: list.map((a) => ({ id: a.id, name: a.name, subtype: a.subtype, size: a.approximate_count_lower_bound })),
    };
  } catch (err) {
    return fail(err);
  }
}
