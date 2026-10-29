import { describe, expect, it } from "vitest";
import { applyBudgetOp, applyNameOp } from "@/lib/bulk";
import { cleanColumns, PRESETS } from "@/lib/columns";
import {
  daysBetween,
  decodeRangeCookie,
  encodeRangeCookie,
  isIsoDate,
  isoToZonedLocal,
  previousPeriod,
  rangeInput,
  resolveDateRange,
  zonedLocalToIso,
} from "@/lib/dates";
import { creativePayload, fromCopy, singleMediaCreativePayload } from "@/lib/launch/payloads";
import { DEFAULT_TEMPLATE_CONFIG } from "@/lib/launch/spec";
import { DEFAULT_PLACEMENTS } from "@/lib/meta/editor-types";
import {
  applyAudience,
  applyPlacements,
  audienceFromTargeting,
  creativeInfo,
  placementsFromTargeting,
  rebuildCreative,
} from "@/lib/meta/targeting";
import { change, emptySums, formatMetric, METRIC_BY_KEY, METRICS, verdict } from "@/lib/metrics";

const m = (key: string) => METRIC_BY_KEY.get(key)!;

describe("metrics", () => {
  const sums = { ...emptySums(), spend: 200, impressions: 40_000, clicks: 900, linkClicks: 600, purchases: 10, purchaseValue: 700, videoViews: 8_000, thruplays: 2_000 };

  it("derives ratios from additive sums", () => {
    expect(m("roas").value(sums)).toBe(3.5);
    expect(m("cpm").value(sums)).toBe(5);
    expect(m("ctr").value(sums)).toBe(1.5);
    expect(m("aov").value(sums)).toBe(70);
    expect(m("hookRate").value(sums)).toBe(20);
    expect(m("holdRate").value(sums)).toBe(25);
  });

  it("returns null instead of dividing by zero, and ROAS needs purchase value", () => {
    expect(m("cpr").value(emptySums())).toBeNull();
    expect(m("roas").value({ ...emptySums(), spend: 50 })).toBeNull();
    expect(formatMetric(m("cpr"), null, "USD")).toBe("—");
  });

  it("judges a change by the metric's direction", () => {
    expect(verdict(m("cpr"), change(8, 10))).toBe("good");
    expect(verdict(m("roas"), change(2, 3))).toBe("bad");
    expect(verdict(m("spend"), change(200, 100))).toBe("neutral");
    expect(change(5, 0)).toBeNull();
  });

  it("every preset only references known columns", () => {
    for (const p of PRESETS) expect(cleanColumns(p.columns)).toEqual(p.columns);
    expect(cleanColumns(["spend", "nope", "spend", "roas"])).toEqual(["spend", "roas"]);
    expect(new Set(METRICS.map((x) => x.key)).size).toBe(METRICS.length);
  });
});

describe("date ranges", () => {
  const now = new Date("2026-10-28T19:00:00Z"); // Wednesday Oct 28 in Los Angeles

  it("weeks start on Monday; last N days exclude today", () => {
    expect(resolveDateRange({ preset: "this_week" }, "America/Los_Angeles", now)).toMatchObject({ since: "2026-10-26", until: "2026-10-28" });
    expect(resolveDateRange({ preset: "last_week" }, "America/Los_Angeles", now)).toMatchObject({ since: "2026-10-19", until: "2026-10-25" });
    expect(resolveDateRange({ preset: "last_3d" }, "America/Los_Angeles", now)).toMatchObject({ since: "2026-10-25", until: "2026-10-27" });
  });

  it("rejects impossible dates and over-long ranges instead of crashing", () => {
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(resolveDateRange({ since: "2026-02-31", until: "2026-03-05" }, "UTC", now).preset).toBe("last_7d");
    expect(resolveDateRange({ since: "1990-01-01", until: "2026-10-01" }, "UTC", now).preset).toBe("last_7d");
  });

  it("compares against the equally long period before", () => {
    const prev = previousPeriod({ since: "2026-10-01", until: "2026-10-15" });
    expect(prev).toEqual({ since: "2026-09-16", until: "2026-09-30" });
    expect(daysBetween(prev.since, prev.until)).toBe(15);
  });

  it("URL wins over the remembered cookie", () => {
    const cookie = encodeRangeCookie({ preset: "custom", since: "2026-10-01", until: "2026-10-15" });
    expect(decodeRangeCookie(cookie)).toEqual({ since: "2026-10-01", until: "2026-10-15" });
    expect(rangeInput({}, cookie)).toEqual({ since: "2026-10-01", until: "2026-10-15" });
    expect(rangeInput({ preset: "last_30d" }, cookie)).toMatchObject({ preset: "last_30d" });
    expect(rangeInput({}, "last_14d")).toEqual({ preset: "last_14d" });
  });

  it("converts schedule times in the ad account's timezone, across DST", () => {
    expect(zonedLocalToIso("2026-07-01T09:00", "America/Los_Angeles")).toBe("2026-07-01T16:00:00.000Z");
    expect(zonedLocalToIso("2026-12-01T09:00", "America/Los_Angeles")).toBe("2026-12-01T17:00:00.000Z");
    expect(isoToZonedLocal("2026-07-01T09:00:00-0700", "America/Los_Angeles")).toBe("2026-07-01T09:00");
    expect(isoToZonedLocal(zonedLocalToIso("2026-03-08T12:30", "Europe/Berlin"), "Europe/Berlin")).toBe("2026-03-08T12:30");
  });
});

describe("bulk edit", () => {
  it("changes budgets by amount or percent with a floor", () => {
    expect(applyBudgetOp(40, { mode: "increase", unit: "percent", value: 20 })).toBe(48);
    expect(applyBudgetOp(40, { mode: "decrease", unit: "amount", value: 15 })).toBe(25);
    expect(applyBudgetOp(5, { mode: "decrease", unit: "amount", value: 50 })).toBe(1);
    expect(applyBudgetOp(40, { mode: "set", unit: "amount", value: 40 })).toBeNull();
    expect(applyBudgetOp(33.33, { mode: "increase", unit: "percent", value: 10 })).toBe(36.66);
  });

  it("renames with prefix, suffix and literal find/replace", () => {
    expect(applyNameOp("Broad", { mode: "prefix", text: "[TEST] " })).toBe("[TEST] Broad");
    expect(applyNameOp("Broad", { mode: "suffix", text: " v2" })).toBe("Broad v2");
    expect(applyNameOp("US (a+b) us", { mode: "replace", find: "(a+b)", text: "CA" })).toBe("US CA us");
    expect(applyNameOp("US us", { mode: "replace", find: "us", text: "CA" })).toBe("CA CA");
    expect(applyNameOp("Same", { mode: "replace", find: "x", text: "y" })).toBeNull();
  });
});

describe("targeting editor", () => {
  const live = {
    geo_locations: { countries: ["US"], regions: [{ key: "3847", name: "California", country: "US" }], location_types: ["home", "recent"] },
    age_min: 25,
    age_max: 54,
    genders: [2],
    flexible_spec: [{ interests: [{ id: "1", name: "Yoga" }] }, { behaviors: [{ id: "9", name: "Engaged shoppers" }] }],
    custom_audiences: [{ id: "238", name: "Visitors" }],
    locales: [6],
    publisher_platforms: ["facebook"],
    facebook_positions: ["feed"],
    device_platforms: ["mobile"],
  };

  it("round-trips without dropping keys it doesn't manage", () => {
    const a = audienceFromTargeting(live);
    expect(a.genders).toBe("women");
    expect(a.locations.map((l) => `${l.kind}:${l.key}`)).toEqual(["country:US", "region:3847"]);
    expect(a.detailed).toEqual([{ id: "1", name: "Yoga", type: "interests" }]);
    const out = applyAudience(live, { ...a, genders: "all", ageMax: 65 });
    expect(out.genders).toBeUndefined();
    expect(out.age_max).toBe(65);
    expect(out.locales).toEqual([6]);
    expect((out.geo_locations as { location_types: string[] }).location_types).toEqual(["home", "recent"]);
    // The second "narrow further" group survives untouched.
    expect(out.flexible_spec).toEqual([{ interests: [{ id: "1", name: "Yoga" }] }, { behaviors: [{ id: "9", name: "Engaged shoppers" }] }]);
    expect(live.genders).toEqual([2]); // input not mutated
  });

  it("switching to Advantage+ placements removes manual positions", () => {
    const p = placementsFromTargeting(live, DEFAULT_PLACEMENTS);
    expect(p).toMatchObject({ automatic: false, platforms: ["facebook"], facebook: ["feed"] });
    const auto = applyPlacements(live, { ...p, automatic: true });
    expect(auto.publisher_platforms).toBeUndefined();
    expect(auto.facebook_positions).toBeUndefined();
    const manual = applyPlacements(live, { ...p, platforms: ["facebook", "instagram"], instagram: [] });
    expect(manual.publisher_platforms).toEqual(["facebook"]); // platforms with no positions are dropped
  });
});

describe("ad copy edits", () => {
  const linkCreative = {
    id: "777",
    name: "Hook",
    url_tags: "utm_source=fb",
    object_story_spec: {
      page_id: "111",
      instagram_actor_id: "222",
      link_data: { image_hash: "h", picture: "https://x/p.jpg", link: "https://a.example", message: "Old", name: "Old headline", call_to_action: { type: "SHOP_NOW", value: { link: "https://a.example" } } },
    },
  };
  const copy = { primaryText: "New text", headline: "New headline", description: "", url: "https://b.example", cta: "LEARN_MORE", urlTags: "utm_source=fb" };

  it("reads copy from link, video and flexible creatives; posts aren't editable", () => {
    expect(creativeInfo(linkCreative)).toMatchObject({ format: "image", editable: true, instagramUserId: "222", copy: { headline: "Old headline", cta: "SHOP_NOW" } });
    expect(creativeInfo({ object_story_id: "1_2" })).toMatchObject({ format: "post", editable: false });
    expect(creativeInfo({ object_story_spec: { page_id: "1", link_data: { child_attachments: [] } } }).editable).toBe(false);
  });

  it("rebuilds a link creative with the new copy and a valid image source", () => {
    const out = rebuildCreative(linkCreative, copy, {}) as { object_story_spec: Record<string, Record<string, unknown>>; url_tags: string };
    const ld = out.object_story_spec.link_data;
    expect(ld).toMatchObject({ image_hash: "h", link: "https://b.example", message: "New text", name: "New headline", call_to_action: { type: "LEARN_MORE", value: { link: "https://b.example" } } });
    expect(ld.picture).toBeUndefined();
    expect(ld.description).toBeUndefined();
    expect(out.object_story_spec.instagram_user_id).toBe("222");
    expect(out.object_story_spec.instagram_actor_id).toBeUndefined();
    expect(out.url_tags).toBe("utm_source=fb");
  });

  it("edits only the first text of a flexible (asset feed) creative", () => {
    const feed = {
      object_story_spec: { page_id: "1" },
      asset_feed_spec: { bodies: [{ text: "a" }], titles: [{ text: "b" }], link_urls: [{ website_url: "https://a.example", display_url: "a.example" }], call_to_action_types: ["SHOP_NOW"], images: [{ hash: "x" }] },
    };
    const out = rebuildCreative(feed, copy, {}) as { asset_feed_spec: Record<string, unknown> };
    expect(out.asset_feed_spec).toMatchObject({
      bodies: [{ text: "New text" }],
      titles: [{ text: "New headline" }],
      link_urls: [{ website_url: "https://b.example", display_url: "a.example" }],
      call_to_action_types: ["LEARN_MORE"],
      images: [{ hash: "x" }],
    });
    expect(out.asset_feed_spec.descriptions).toBeUndefined();
  });
});

describe("messaging creatives in the in-table editor", () => {
  const raw = {
    object_story_spec: { page_id: "1", link_data: { image_hash: "h", link: "https://api.whatsapp.com/send", message: "Hi", name: "Chat", call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } } } },
    asset_feed_spec: { optimization_type: "DOF_MESSAGING_DESTINATION", call_to_actions: [{ type: "MESSAGE_PAGE" }, { type: "WHATSAPP_MESSAGE" }] },
  };

  it("reads copy from link_data and keeps the apps' calls to action on rebuild", () => {
    const info = creativeInfo(raw);
    expect(info.copy).toMatchObject({ primaryText: "Hi", headline: "Chat", cta: "WHATSAPP_MESSAGE" });
    const out = rebuildCreative(raw, { ...info.copy, primaryText: "Hello" }, {}) as Record<string, Record<string, Record<string, unknown>>>;
    expect(out.asset_feed_spec).toEqual(raw.asset_feed_spec);
    expect(out.object_story_spec.link_data.message).toBe("Hello");
    expect(out.object_story_spec.link_data.call_to_action).toMatchObject({ type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } });
  });
});

describe("single-file creatives", () => {
  const ad = fromCopy({ primaryText: "Text", headline: "Head", url: "https://a.example", cta: "SHOP_NOW" });
  const positions = DEFAULT_TEMPLATE_CONFIG.placements;
  const website = { kind: "website" as const };

  it("uses link_data when both slots hold the same image", () => {
    const img = { kind: "image" as const, hash: "h1" };
    const p = creativePayload({ name: "n", pageId: "1", square: img, vertical: img, ad, destination: website, urlTags: "", positions }) as { object_story_spec: Record<string, unknown>; asset_feed_spec?: unknown };
    expect(p.asset_feed_spec).toBeUndefined();
    expect(p.object_story_spec.link_data).toMatchObject({ image_hash: "h1", name: "Head", call_to_action: { type: "SHOP_NOW", value: { link: "https://a.example" } } });
  });

  it("uses video_data for a single video", () => {
    const p = singleMediaCreativePayload({
      name: "n",
      pageId: "1",
      media: { kind: "video", videoId: "v1", thumbnailUrl: "https://t" },
      ad: { ...ad, description: "d" },
      urlTags: "a=b",
      link: "https://a.example",
      cta: { type: "SHOP_NOW", value: { link: "https://a.example" } },
    });
    expect((p.object_story_spec as Record<string, unknown>).video_data).toMatchObject({ video_id: "v1", image_url: "https://t", title: "Head", link_description: "d" });
    expect(p.url_tags).toBe("a=b");
  });

  it("falls back to one asset when the ad set only uses feed placements", () => {
    const sq = { kind: "image" as const, hash: "sq" };
    const vt = { kind: "image" as const, hash: "vt" };
    const p = creativePayload({ name: "n", pageId: "1", square: sq, vertical: vt, ad, destination: website, urlTags: "", positions: { facebook: ["feed"], instagram: ["stream"] } }) as { object_story_spec: Record<string, { image_hash?: string }> };
    expect(p.object_story_spec.link_data.image_hash).toBe("sq");
  });
});
