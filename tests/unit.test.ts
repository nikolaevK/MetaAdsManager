import { describe, expect, it } from "vitest";
import { addDays, resolveDateRange, todayIn } from "@/lib/dates";
import { isTransient, MetaApiError } from "@/lib/meta/errors";
import { parseUsageHeaders } from "@/lib/meta/usage-headers";
import { renderName } from "@/lib/launch/naming";
import { adsetPayload, campaignPayload, creativeGroups, creativePayload, placementRules, toMinorUnits } from "@/lib/launch/payloads";
import { blankState, computeNames, launchIssues, toLaunchInput } from "@/lib/launch/draft";
import { destinationFromAdset, destinationType, goalsFor } from "@/lib/launch/objectives";
import { EVENT_ACTION_TYPES, RESULT_LABELS } from "@/lib/meta/actions";
import { sumPixelStats } from "@/lib/meta/accounts";
import {
  CONVERSION_EVENTS,
  CREATIVE_FEATURES,
  DEFAULT_TEMPLATE_CONFIG,
  PIXEL_EVENT_NAMES,
  normalizeSpec,
  templateConfigSchema,
  templatePlacements,
  validateLaunch,
  type AdsetInput,
  type LaunchSpec,
  type TemplateConfig,
} from "@/lib/launch/spec";
import { buildUrlTags, validateUtmParams } from "@/lib/launch/utm";
import { DEFAULT_AUDIENCE, DEFAULT_PLACEMENTS } from "@/lib/meta/editor-types";
import { extractPreviewSrc } from "@/lib/meta/previews";

const config: TemplateConfig = { ...DEFAULT_TEMPLATE_CONFIG, pixelId: "123" };

const adset = (over: Partial<AdsetInput> = {}): AdsetInput => ({
  name: "Set",
  budget: 40,
  destination: "website",
  messagingApps: [],
  optimizationGoal: "OFFSITE_CONVERSIONS",
  pixelId: "123",
  conversionEvent: "PURCHASE",
  attribution: { clickDays: 7, viewDays: 1, engagedViewDays: 0 },
  audience: { ...DEFAULT_AUDIENCE, ageMin: 25, excludedCustomAudiences: [{ id: "77", name: "Buyers" }] },
  placements: templatePlacements(config),
  ...over,
});

const spec = (campaign: Partial<LaunchSpec["campaign"]> = {}, adsets: AdsetInput[] = [adset()]): LaunchSpec => ({
  version: 2,
  clientId: "c1",
  adAccountId: "act_1",
  pageId: "111",
  instagramUserId: "222",
  campaign: {
    name: "Camp",
    objective: "OUTCOME_SALES",
    budgetLevel: "campaign",
    budgetSchedule: "daily",
    budget: 150.5,
    bidStrategy: "LOWEST_COST_WITHOUT_CAP",
    specialAdCategories: [],
    specialAdCountries: [],
    ...campaign,
  },
  adsets,
  ads: [{ name: "Ad", creativeId: "cr1", primaryTexts: ["Body"], headlines: ["Head"], url: "https://example.com", cta: "SHOP_NOW", creativeFeaturesOptIn: [] }],
  urlTags: "",
});

const ad = { primaryTexts: ["Body"], headlines: ["Head"], url: "https://example.com", cta: "SHOP_NOW", creativeFeaturesOptIn: [] as never[] };
const sq = { kind: "image" as const, hash: "sq" };
const vt = { kind: "image" as const, hash: "vt" };
const positions = { facebook: config.placements.facebook, instagram: config.placements.instagram };

describe("usage headers", () => {
  it("takes the max across app, account and BUC dimensions; BUC regain time is minutes", () => {
    const now = 1_000_000;
    const h = new Headers({
      "x-app-usage": JSON.stringify({ call_count: 10, total_time: 30, total_cputime: 5 }),
      "x-ad-account-usage": JSON.stringify({ acc_id_util_pct: 40, reset_time_duration: 0 }),
      "x-business-use-case-usage": JSON.stringify({
        "999": [{ type: "ads_management", call_count: 95, total_time: 20, total_cputime: 10, estimated_time_to_regain_access: 3 }],
      }),
    });
    const u = parseUsageHeaders(h, now);
    expect(u.app).toEqual({ pct: 30, regainAt: null });
    expect(u.account).toEqual({ pct: 95, regainAt: now + 3 * 60_000 });
  });

  it("ignores malformed headers", () => {
    expect(parseUsageHeaders(new Headers({ "x-app-usage": "not json" }))).toEqual({});
  });
});

describe("MetaApiError", () => {
  it("classifies throttling and transient errors", () => {
    expect(new MetaApiError(400, { code: 17, message: "User request limit reached" }).isRateLimit).toBe(true);
    expect(new MetaApiError(400, { code: 80004, message: "Too many calls" }).isTransient).toBe(true);
    expect(new MetaApiError(500, { code: 1, message: "Unknown" }).isTransient).toBe(true);
    const invalid = new MetaApiError(400, { code: 100, message: "Invalid parameter", error_user_msg: "Pick a page" });
    expect(invalid.isTransient).toBe(false);
    expect(invalid.message).toBe("Pick a page");
  });

  it("treats network failures as transient but not programming errors", () => {
    expect(isTransient(new TypeError("fetch failed", { cause: new Error("ECONNRESET") }))).toBe(true);
    expect(isTransient(new DOMException("timed out", "TimeoutError"))).toBe(true);
    expect(isTransient(new TypeError("Cannot read properties of undefined (reading 'hash')"))).toBe(false);
  });
});

describe("naming conventions", () => {
  it("renders tokens and collapses separators around empty values", () => {
    const p = "{client} | {objective} | {label} | {date}";
    expect(renderName(p, { client: "Acme", objective: "Sales", label: "", date: "261028" })).toBe("Acme | Sales | 261028");
    expect(renderName(p, { client: "", objective: "Sales", label: "BFCM", date: "" })).toBe("Sales | BFCM");
  });

  it("keeps unknown tokens visible", () => {
    expect(renderName("{client}_{typo}", { client: "Acme" })).toBe("Acme_{typo}");
  });
});

describe("UTM rules", () => {
  it("encodes values but preserves Meta macros", () => {
    expect(
      buildUrlTags([
        { key: "utm_source", value: "{{site_source_name}}" },
        { key: "utm_campaign", value: "fall sale {{campaign.name}}" },
        { key: "", value: "skipped" },
      ]),
    ).toBe("utm_source={{site_source_name}}&utm_campaign=fall%20sale%20{{campaign.name}}");
  });

  it("rejects unknown macros and duplicate keys", () => {
    expect(validateUtmParams([{ key: "a", value: "{{nope}}" }])).toMatch(/Unknown/);
    expect(validateUtmParams([{ key: "a", value: "1" }, { key: "a", value: "2" }])).toMatch(/Duplicate/);
    expect(validateUtmParams([{ key: "utm_content", value: "{{ad.name}}" }])).toBeNull();
  });
});

describe("payload builders", () => {
  it("handles minor units incl. zero-decimal currencies", () => {
    expect(toMinorUnits(150.5, "USD")).toBe(15050);
    expect(toMinorUnits(5000, "JPY")).toBe(5000);
  });

  it("CBO puts the budget and bid strategy on the campaign, ABO on the ad set", () => {
    const cbo = spec();
    expect(campaignPayload(cbo, "USD")).toMatchObject({ daily_budget: 15050, bid_strategy: "LOWEST_COST_WITHOUT_CAP", status: "PAUSED" });
    expect(adsetPayload(cbo, cbo.adsets[0], "c", "USD")).not.toHaveProperty("daily_budget");

    const abo = spec({ budgetLevel: "adset", bidStrategy: "COST_CAP" }, [adset({ bidAmount: 12 })]);
    expect(campaignPayload(abo, "USD")).toMatchObject({ is_adset_budget_sharing_enabled: false });
    expect(campaignPayload(abo, "USD")).not.toHaveProperty("daily_budget");
    expect(adsetPayload(abo, abo.adsets[0], "c", "USD")).toMatchObject({ daily_budget: 4000, bid_strategy: "COST_CAP", bid_amount: 1200 });
  });

  it("declares special ad categories with their countries and the spending limit", () => {
    const p = campaignPayload(spec({ specialAdCategories: ["HOUSING"], specialAdCountries: ["CA"], spendCap: 500 }), "USD");
    expect(p).toMatchObject({ special_ad_categories: ["HOUSING"], special_ad_category_country: ["CA"], spend_cap: 50000 });
  });

  it("website ad set carries pixel event, destination, targeting, attribution and the Advantage+ audience flag", () => {
    const s = spec();
    const p = adsetPayload(s, s.adsets[0], "camp1", "USD") as Record<string, Record<string, unknown>>;
    expect(p.destination_type).toBe("WEBSITE");
    expect(p.promoted_object).toEqual({ pixel_id: "123", custom_event_type: "PURCHASE" });
    expect(p.targeting.publisher_platforms).toEqual(["facebook", "instagram"]);
    expect(p.targeting.excluded_custom_audiences).toEqual([{ id: "77", name: "Buyers" }]);
    expect(p.targeting.targeting_automation).toEqual({ advantage_audience: 0 });
    expect(p.targeting.age_min).toBe(25);
    expect(p.attribution_spec).toEqual([
      { event_type: "CLICK_THROUGH", window_days: 7 },
      { event_type: "VIEW_THROUGH", window_days: 1 },
    ]);
    expect(p.status).toBe("PAUSED");
  });

  it("messaging ad sets map one or several apps to destination_type and optimize for conversations", () => {
    expect(destinationType("OUTCOME_ENGAGEMENT", "messaging", ["WHATSAPP"])).toBe("WHATSAPP");
    expect(destinationType("OUTCOME_ENGAGEMENT", "messaging", ["WHATSAPP", "MESSENGER"])).toBe("MESSAGING_MESSENGER_WHATSAPP");
    expect(destinationType("OUTCOME_SALES", "messaging", ["MESSENGER", "INSTAGRAM_DIRECT", "WHATSAPP"])).toBe("MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP");
    expect(goalsFor("OUTCOME_TRAFFIC", "messaging", ["WHATSAPP", "MESSENGER"])).toEqual(["CONVERSATIONS"]);

    const s = spec({ objective: "OUTCOME_ENGAGEMENT" }, [adset({ destination: "messaging", messagingApps: ["MESSENGER", "WHATSAPP"], optimizationGoal: "CONVERSATIONS" })]);
    const p = adsetPayload(s, s.adsets[0], "c", "USD");
    expect(p).toMatchObject({ destination_type: "MESSAGING_MESSENGER_WHATSAPP", optimization_goal: "CONVERSATIONS", promoted_object: { page_id: "111" } });
    expect(p).not.toHaveProperty("attribution_spec");

    // Sales → Messenger alone may carry the pixel event; other messaging apps never do.
    const sales = (apps: AdsetInput["messagingApps"]) => spec({}, [adset({ destination: "messaging", messagingApps: apps, optimizationGoal: "CONVERSATIONS" })]);
    expect(adsetPayload(sales(["MESSENGER"]), sales(["MESSENGER"]).adsets[0], "c", "USD").promoted_object).toEqual({ page_id: "111", pixel_id: "123", custom_event_type: "PURCHASE" });
    expect(adsetPayload(sales(["WHATSAPP"]), sales(["WHATSAPP"]).adsets[0], "c", "USD").promoted_object).toEqual({ page_id: "111" });
  });

  it("\"on your ad\" engagement uses ON_POST, or ON_VIDEO for video-view goals", () => {
    expect(destinationType("OUTCOME_ENGAGEMENT", "on_ad", [], "POST_ENGAGEMENT")).toBe("ON_POST");
    expect(destinationType("OUTCOME_ENGAGEMENT", "on_ad", [], "THRUPLAY")).toBe("ON_VIDEO");
  });

  it("reads an existing ad set's destination back for the in-table editor", () => {
    expect(destinationFromAdset("MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", null)).toEqual({ kind: "messaging", apps: ["INSTAGRAM_DIRECT", "WHATSAPP"] });
    expect(destinationFromAdset(undefined, { application_id: "5", object_store_url: "https://apps.apple.com/x" })).toMatchObject({ kind: "app", storeUrl: "https://apps.apple.com/x" });
    expect(destinationFromAdset("WEBSITE", { pixel_id: "1" }).kind).toBe("website");
  });

  it("app promotion promotes the app and awareness promotes the Page, without a destination type", () => {
    const app = spec({ objective: "OUTCOME_APP_PROMOTION" }, [adset({ destination: "app", optimizationGoal: "APP_INSTALLS", app: { id: "55", storeUrl: "https://apps.apple.com/app/id1" } })]);
    const p = adsetPayload(app, app.adsets[0], "c", "USD");
    expect(p.promoted_object).toEqual({ application_id: "55", object_store_url: "https://apps.apple.com/app/id1" });
    expect(p).not.toHaveProperty("destination_type");

    const aw = spec({ objective: "OUTCOME_AWARENESS" }, [adset({ optimizationGoal: "REACH" })]);
    const q = adsetPayload(aw, aw.adsets[0], "c", "USD");
    expect(q.promoted_object).toEqual({ page_id: "111" });
    expect(q).not.toHaveProperty("destination_type");
  });

  it("splits placements into a 1:1 rule and a 9:16 rule, dropping positions the format can't serve", () => {
    const pos = { facebook: ["feed", "video_feeds", "story", "facebook_reels"], instagram: ["stream", "explore_home", "reels"] };
    const img = placementRules(pos, "image");
    expect(img.square).toEqual({ publisher_platforms: ["facebook", "instagram"], facebook_positions: ["feed"], instagram_positions: ["stream", "explore_home"] });
    expect(img.vertical).toEqual({ publisher_platforms: ["facebook", "instagram"], facebook_positions: ["story", "facebook_reels"], instagram_positions: ["reels"] });
    const vid = placementRules(pos, "video");
    expect(vid.square.facebook_positions).toEqual(["feed", "video_feeds"]);
    expect(vid.square.instagram_positions).toEqual(["stream"]);
  });

  it("creative pairs both assets in one asset_feed_spec and opts out of every enhancement not switched on", () => {
    const p = creativePayload({
      name: "Ad 1",
      pageId: "111",
      instagramUserId: "222",
      square: sq,
      vertical: vt,
      ad: { ...ad, displayLink: "example.com/offer", creativeFeaturesOptIn: ["inline_comment"] },
      destination: { kind: "website" },
      urlTags: "utm_source=fb",
      positions,
    }) as Record<string, Record<string, unknown>>;
    const afs = p.asset_feed_spec;
    expect(afs.ad_formats).toEqual(["SINGLE_IMAGE"]);
    expect(afs.optimization_type).toBe("PLACEMENT");
    expect(afs.images).toEqual([
      { hash: "sq", adlabels: [{ name: "sq_1x1" }] },
      { hash: "vt", adlabels: [{ name: "vt_9x16" }] },
    ]);
    expect(afs.link_urls).toEqual([{ website_url: "https://example.com", display_url: "example.com/offer" }]);
    const rules = afs.asset_customization_rules as Record<string, unknown>[];
    expect(rules).toHaveLength(2);
    expect(rules[0].image_label).toEqual({ name: "sq_1x1" });
    expect(rules[1].image_label).toEqual({ name: "vt_9x16" });
    expect(p.object_story_spec).toEqual({ page_id: "111", instagram_user_id: "222" });
    expect(p.url_tags).toBe("utm_source=fb");
    const features = (p.degrees_of_freedom_spec as { creative_features_spec: Record<string, { enroll_status: string }> }).creative_features_spec;
    expect(Object.keys(features)).toHaveLength(CREATIVE_FEATURES.length);
    expect(features.inline_comment.enroll_status).toBe("OPT_IN");
    expect(features.image_touchups.enroll_status).toBe("OPT_OUT");
  });

  it("carries every primary text and headline option", () => {
    const texts = { ...ad, primaryTexts: ["One", "Two"], headlines: ["H1", "H2", "H3"] };
    const paired = creativePayload({ name: "n", pageId: "1", square: sq, vertical: vt, ad: texts, destination: { kind: "website" }, urlTags: "", positions }) as Record<string, Record<string, unknown>>;
    expect(paired.asset_feed_spec.bodies).toEqual([{ text: "One" }, { text: "Two" }]);
    expect(paired.asset_feed_spec.titles).toEqual([{ text: "H1" }, { text: "H2" }, { text: "H3" }]);

    // One file + several texts the way Ads Manager stores it (Meta asks for link_data's link otherwise):
    // the file and link in link_data, the texts in the asset feed.
    const single = creativePayload({ name: "n", pageId: "1", square: sq, vertical: sq, ad: texts, destination: { kind: "website" }, urlTags: "", positions }) as Record<string, Record<string, Record<string, unknown>>>;
    expect(single.object_story_spec.link_data).toMatchObject({ image_hash: "sq", link: "https://example.com" });
    expect(single.object_story_spec.link_data).not.toHaveProperty("message");
    expect(single.asset_feed_spec).toEqual({ bodies: [{ text: "One" }, { text: "Two" }], titles: [{ text: "H1" }, { text: "H2" }, { text: "H3" }], optimization_type: "DEGREES_OF_FREEDOM" });
  });

  it("puts every Flexible-format file in one feed for Meta to mix", () => {
    const video = { kind: "video" as const, videoId: "v1", thumbnailUrl: "https://x/t.jpg" };
    const p = creativePayload({ name: "n", pageId: "1", square: sq, vertical: sq, more: [vt, video], ad, destination: { kind: "website" }, urlTags: "u=1", positions }) as Record<string, Record<string, unknown>>;
    expect(p.asset_feed_spec).toMatchObject({
      images: [{ hash: "sq" }, { hash: "vt" }],
      videos: [{ video_id: "v1", thumbnail_url: "https://x/t.jpg" }],
      ad_formats: ["AUTOMATIC_FORMAT"],
      optimization_type: "REGULAR",
      bodies: [{ text: "Body" }],
      link_urls: [{ website_url: "https://example.com" }],
    });
    expect(p.asset_feed_spec).not.toHaveProperty("asset_customization_rules");
    expect(p.object_story_spec).toEqual({ page_id: "1" });
    expect(p.url_tags).toBe("u=1");
  });

  it("messaging creatives use the feed file, the first text and one call to action per app", () => {
    const one = creativePayload({ name: "n", pageId: "1", square: sq, vertical: vt, ad, destination: { kind: "messaging", apps: ["WHATSAPP"] }, urlTags: "a=b", positions }) as Record<string, Record<string, unknown>>;
    expect(one.asset_feed_spec).toBeUndefined();
    expect(one.url_tags).toBeUndefined();
    expect(one.object_story_spec.link_data).toMatchObject({
      image_hash: "sq",
      link: "https://api.whatsapp.com/send",
      call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } },
    });

    const many = creativePayload({ name: "n", pageId: "1", square: sq, vertical: vt, ad, destination: { kind: "messaging", apps: ["MESSENGER", "WHATSAPP"] }, urlTags: "", positions }) as Record<string, Record<string, unknown>>;
    expect(many.asset_feed_spec.optimization_type).toBe("DOF_MESSAGING_DESTINATION");
    expect((many.asset_feed_spec.call_to_actions as { type: string }[]).map((c) => c.type)).toEqual(["MESSAGE_PAGE", "WHATSAPP_MESSAGE"]);
  });

  it("app creatives link to the store", () => {
    const p = creativePayload({ name: "n", pageId: "1", square: sq, vertical: sq, ad: { ...ad, cta: "INSTALL_MOBILE_APP" }, destination: { kind: "app", storeUrl: "https://play.google.com/store/apps/details?id=x" }, urlTags: "u=1", positions }) as Record<string, Record<string, Record<string, unknown>>>;
    expect(p.object_story_spec.link_data).toMatchObject({ link: "https://play.google.com/store/apps/details?id=x", call_to_action: { type: "INSTALL_MOBILE_APP" } });
    expect(p.url_tags).toBeUndefined();
  });

  it("builds one creative per ad for each distinct kind of ad set", () => {
    const g = creativeGroups(spec({}, [adset(), adset({ name: "B" }), adset({ destination: "messaging", messagingApps: ["WHATSAPP"] })]), DEFAULT_PLACEMENTS);
    expect(g).toEqual({ groupOf: [0, 0, 1], first: [0, 2], count: 2 });
  });

  it("template validation requires both a feed and a stories/reels placement", () => {
    const bad = templateConfigSchema.safeParse({ ...config, placements: { facebook: ["feed"], instagram: ["stream"] } });
    expect(bad.success).toBe(false);
    expect(templateConfigSchema.safeParse(config).success).toBe(true);
  });
});

describe("launch validation", () => {
  const where = (s: LaunchSpec) => validateLaunch(s).map((i) => `${i.where}: ${i.message}`);

  it("keeps Flexible format to website ad sets and one text per placement-customized ad", () => {
    const flexible = { ...spec(), ads: [{ ...spec().ads[0], moreAssetIds: ["b"] }] };
    expect(where(flexible)).toEqual([]);
    const messaging = { ...flexible, adsets: [adset({ destination: "messaging", messagingApps: ["WHATSAPP"] })] };
    expect(where(messaging).join()).toMatch(/Flexible format runs only/);

    // Meta rejects several bodies on a creative with placement rules (1885878).
    const withMedia = (media: { feedAssetId: string; verticalAssetId?: string }) =>
      validateLaunch({ ...spec(), ads: [{ url: "https://example.com", primaryTexts: ["A", "B"], headlines: ["H"], media }] }).map((i) => i.message);
    expect(withMedia({ feedAssetId: "f", verticalAssetId: "v" }).join()).toMatch(/one primary text and one headline/);
    expect(withMedia({ feedAssetId: "f" })).toEqual([]);
  });

  it("checks budgets for CBO and ABO, lifetime end dates and pixels", () => {
    expect(where(spec())).toEqual([]);
    expect(where(spec({ budget: undefined }))[0]).toMatch(/campaign budget/);
    expect(where(spec({ budgetLevel: "adset" }, [adset({ budget: undefined })]))[0]).toMatch(/^Ad set 1: Enter a budget/);
    expect(where(spec({ budgetSchedule: "lifetime" })).join()).toMatch(/end date/);
    expect(where(spec({}, [adset({ pixelId: undefined })])).join()).toMatch(/pixel/);
  });

  it("rejects destinations and goals the objective doesn't offer", () => {
    expect(where(spec({ objective: "OUTCOME_LEADS" }, [adset({ destination: "messaging", messagingApps: ["WHATSAPP"] })])).join()).toMatch(/isn't available for Leads/);
    expect(where(spec({ objective: "OUTCOME_TRAFFIC" }, [adset({ optimizationGoal: "VALUE" })])).join()).toMatch(/performance goal/);
    expect(where(spec({}, [adset({ destination: "messaging", messagingApps: ["INSTAGRAM_DIRECT"], optimizationGoal: "CONVERSATIONS" })])).join()).toBe("");
  });

  it("enforces special ad category targeting limits", () => {
    const s = spec({ specialAdCategories: ["HOUSING"], specialAdCountries: ["US"] }, [adset({ audience: { ...DEFAULT_AUDIENCE, ageMin: 25, genders: "women" } })]);
    const out = where(s).join("\n");
    expect(out).toMatch(/18–65\+ age range/);
    expect(out).toMatch(/by gender/);
  });

  it("needs a website URL only when an ad set sends people to a website", () => {
    const s = spec({ objective: "OUTCOME_ENGAGEMENT" }, [adset({ destination: "messaging", messagingApps: ["WHATSAPP"], optimizationGoal: "CONVERSATIONS" })]);
    expect(where({ ...s, ads: [{ ...s.ads[0], url: undefined }] })).toEqual([]);
    expect(where({ ...spec(), ads: [{ ...s.ads[0], url: undefined }] }).join()).toMatch(/website URL/);
  });
});

describe("campaign builder state", () => {
  it("turns a blank draft into a launch input that only misses media and copy", () => {
    const state = blankState({ pageId: "111", igId: "", urlTags: "utm_source=fb", template: { id: "t1", config } });
    const names = computeNames(state, { client: "Acme", account: "Acme US", dateToken: "261028", patterns: { campaignPattern: "{client} | {objective} | {budget}", adsetPattern: "{geo} | {age}", adPattern: "{creative}" }, creative: () => undefined });
    expect(names.campaign).toBe("Acme | Sales | CBO");
    const input = toLaunchInput(state, names, { idempotencyKey: crypto.randomUUID(), clientId: "c1", adAccountId: "act_1", timeZone: "UTC" });
    expect(input.adsets[0]).toMatchObject({ destination: "website", optimizationGoal: "OFFSITE_CONVERSIONS", pixelId: "123", conversionEvent: "PURCHASE" });
    const { issues } = launchIssues(input);
    expect(issues.every((i) => i.step === "ads")).toBe(true);
    expect(issues.map((i) => i.message)).toContain("Add an image or video.");
  });

  it("checks the picked files fit their placements and the ad sets' goals", () => {
    const state = blankState({ pageId: "111", igId: "", urlTags: "", template: { id: "t1", config } });
    const ad = { ...state.ads[0], feedAssetId: "f", verticalAssetId: "v", primaryTexts: ["Body"], headlines: ["Head"], url: "https://a.example" };
    const files: Record<string, { kind: "image" | "video"; aspect: string }> = { f: { kind: "image", aspect: "16:9" }, v: { kind: "image", aspect: "9:16" } };
    const ctx = { client: "A", account: "B", dateToken: "1", patterns: { campaignPattern: "c", adsetPattern: "s", adPattern: "a" }, creative: () => undefined };
    const check = (s: typeof state) => launchIssues(toLaunchInput(s, computeNames(s, ctx), { idempotencyKey: crypto.randomUUID(), clientId: "c1", adAccountId: "act_1", timeZone: "UTC" }), (id) => files[id]).issues.map((i) => i.message);
    expect(check({ ...state, ads: [ad] })).toContain("The feed file must be 1:1 or 4:5. Crop it, or remove the Stories & Reels file.");
    files.f.aspect = "4:5";
    expect(check({ ...state, ads: [ad] })).toEqual([]);
    const awareness = { ...state, campaign: { ...state.campaign, objective: "OUTCOME_AWARENESS" as const }, adsets: [{ ...state.adsets[0], goal: "THRUPLAY" }], ads: [ad] };
    expect(check(awareness)).toContain("An ad set optimizes for video views, so this ad needs a video.");
  });

  it("reports an impossible date instead of crashing", () => {
    const state = blankState({ pageId: "111", igId: "", urlTags: "", template: { id: "t1", config } });
    const s = { ...state, campaign: { ...state.campaign, start: "275760-09-13T00:00" } };
    const names = computeNames(s, { client: "A", account: "B", dateToken: "1", patterns: { campaignPattern: "c", adsetPattern: "s", adPattern: "a" }, creative: () => undefined });
    expect(() => toLaunchInput(s, names, { idempotencyKey: crypto.randomUUID(), clientId: "c1", adAccountId: "act_1", timeZone: "UTC" })).not.toThrow();
  });
});

describe("v1 launch specs", () => {
  it("upgrade to the builder's shape with the template's settings", () => {
    const v1 = {
      clientId: "c1",
      adAccountId: "act_1",
      templateId: "t",
      pageId: "111",
      campaign: { name: "Old", budget: 100 },
      adsets: [{ name: "US", countries: ["US"], ageMin: 25, ageMax: 65 }],
      ads: [{ name: "A", creativeId: "x", primaryText: "Body", headline: "Head", url: "https://example.com", cta: "SHOP_NOW" }],
      config,
      urlTags: "utm_source=fb",
    };
    const s = normalizeSpec(v1);
    expect(s.version).toBe(2);
    expect(s.campaign).toMatchObject({ objective: "OUTCOME_SALES", budgetLevel: "campaign", budget: 100, bidStrategy: "LOWEST_COST_WITHOUT_CAP" });
    expect(s.adsets[0]).toMatchObject({ destination: "website", optimizationGoal: "OFFSITE_CONVERSIONS", pixelId: "123", placements: { automatic: false } });
    expect(s.adsets[0].audience.locations).toEqual([{ kind: "country", key: "US", name: "US" }]);
    expect(s.ads[0]).toMatchObject({ primaryTexts: ["Body"], headlines: ["Head"] });
    expect(normalizeSpec(s)).toBe(s);
  });

  it("fill in template fields that older snapshots don't have", () => {
    const old: Partial<TemplateConfig> = { ...config };
    delete old.devicePlatforms;
    delete old.exclusionAudiences;
    delete old.creativeFeaturesOptIn;
    const s = normalizeSpec({ clientId: "c1", adAccountId: "act_1", pageId: "1", campaign: { name: "x", budget: 1 }, adsets: [{ name: "a", countries: ["US"], ageMin: 18, ageMax: 65 }], ads: [], config: old, urlTags: "" });
    expect(s.adsets[0].placements.devices).toEqual(["mobile", "desktop"]);
    expect(s.adsets[0].audience.excludedCustomAudiences).toEqual([]);
  });
});

describe("dates", () => {
  it("resolves Ads Manager presets in the account timezone", () => {
    const now = new Date("2026-10-28T03:00:00Z"); // still Oct 27 in Los Angeles
    expect(todayIn("America/Los_Angeles", now)).toBe("2026-10-27");
    expect(resolveDateRange({ preset: "last_7d" }, "America/Los_Angeles", now)).toEqual({
      since: "2026-10-20",
      until: "2026-10-26",
      preset: "last_7d",
    });
    expect(resolveDateRange({ preset: "last_month" }, "UTC", now)).toMatchObject({ since: "2026-09-01", until: "2026-09-30" });
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("falls back to last 7 days for invalid custom ranges", () => {
    expect(resolveDateRange({ since: "2026-10-10", until: "2026-10-01" }, "UTC").preset).toBe("last_7d");
  });
});

describe("previews", () => {
  it("only accepts facebook.com iframe sources", () => {
    expect(extractPreviewSrc('<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?d=1&amp;t=2"></iframe>')).toBe(
      "https://www.facebook.com/ads/api/preview_iframe.php?d=1&t=2",
    );
    expect(() => extractPreviewSrc('<iframe src="https://evil.example/x"></iframe>')).toThrow();
  });
});

describe("conversion events", () => {
  it("can report results for every event an ad set can optimize for", () => {
    // An event without action types counts 0 results (Schedule did, on 36 live ad sets).
    for (const ev of CONVERSION_EVENTS) {
      expect(EVENT_ACTION_TYPES[ev]?.length, ev).toBeGreaterThan(0);
      expect(RESULT_LABELS[ev], ev).toBeTruthy();
      expect(PIXEL_EVENT_NAMES[ev], ev).toBeTruthy();
    }
  });

  it("totals a pixel's hourly stats per event", () => {
    const stats = {
      data: [
        { start_time: "2026-10-28T22:00:00+0000", aggregation: "event", data: [{ value: "PageView", count: 40 }, { value: "Schedule", count: 2 }] },
        { start_time: "2026-10-28T23:00:00+0000", aggregation: "event", data: [{ value: "Schedule", count: 3 }, { value: "Lead", count: 1 }] },
      ],
    };
    expect(sumPixelStats(stats)).toEqual({ PageView: 40, Schedule: 5, Lead: 1 });
  });
});
