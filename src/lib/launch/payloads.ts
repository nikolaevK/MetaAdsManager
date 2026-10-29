/** Pure builders for the exact payloads sent to the Marketing API (unit tested). */
import { needsBidAmount, type Placements } from "@/lib/meta/editor-types";
import { applyAudience, applyPlacements } from "@/lib/meta/targeting";
import { destinationType, isConversionGoal, MESSAGING_CTA, pixelUse, type Destination, type MessagingApp } from "./objectives";
import { CREATIVE_FEATURES, VERTICAL_POSITIONS, type AdInput, type AdsetInput, type LaunchSpec, type TemplateConfig } from "./spec";

// Currencies Meta stores without minor units (offset 1). Everything else is offset 100.
const ZERO_DECIMAL = new Set(["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]);
const offset = (currency: string) => (ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100);
export const toMinorUnits = (amount: number, currency: string) => Math.round(amount * offset(currency));
export const fromMinorUnits = (minor: number, currency: string) => minor / offset(currency);

type Payload = Record<string, unknown>;

export function campaignPayload(spec: LaunchSpec, currency: string): Payload {
  const c = spec.campaign;
  const p: Payload = {
    name: c.name,
    objective: c.objective,
    status: "PAUSED",
    buying_type: "AUCTION",
    special_ad_categories: c.specialAdCategories,
  };
  if (c.specialAdCategories.length) p.special_ad_category_country = c.specialAdCountries.length ? c.specialAdCountries : ["US"];
  if (c.budgetLevel === "campaign") {
    p[c.budgetSchedule === "daily" ? "daily_budget" : "lifetime_budget"] = toMinorUnits(c.budget ?? 0, currency);
    p.bid_strategy = c.bidStrategy;
  } else {
    // Required by the API when the campaign has no campaign-level budget.
    p.is_adset_budget_sharing_enabled = false;
  }
  if (c.spendCap) p.spend_cap = toMinorUnits(c.spendCap, currency);
  return p;
}

export function attributionSpec(a: TemplateConfig["attribution"]) {
  const spec: { event_type: string; window_days: number }[] = [{ event_type: "CLICK_THROUGH", window_days: a.clickDays }];
  if (a.viewDays) spec.push({ event_type: "VIEW_THROUGH", window_days: a.viewDays });
  if (a.engagedViewDays) spec.push({ event_type: "ENGAGED_VIDEO_VIEW", window_days: a.engagedViewDays });
  return spec;
}

/** promoted_object for the ad set's objective, destination and goal (undefined = none). */
export function promotedObject(spec: Pick<LaunchSpec, "campaign" | "pageId">, adset: AdsetInput): Payload | undefined {
  const objective = spec.campaign.objective;
  if (adset.destination === "app" && adset.app) return { application_id: adset.app.id, object_store_url: adset.app.storeUrl };
  const pixel = pixelUse(objective, adset.destination, adset.optimizationGoal, adset.messagingApps);
  const withPixel = pixel !== "none" && adset.pixelId && adset.conversionEvent ? { pixel_id: adset.pixelId, custom_event_type: adset.conversionEvent } : undefined;
  if (adset.destination === "messaging") return { page_id: spec.pageId, ...withPixel };
  if (objective === "OUTCOME_AWARENESS") return { page_id: spec.pageId };
  return withPixel;
}

export function adsetPayload(spec: LaunchSpec, adset: AdsetInput, campaignId: string, currency: string): Payload {
  const c = spec.campaign;
  const goal = adset.optimizationGoal;
  const p: Payload = {
    name: adset.name,
    campaign_id: campaignId,
    status: "PAUSED",
    billing_event: goal === "THRUPLAY" ? "THRUPLAY" : "IMPRESSIONS",
    optimization_goal: goal,
    targeting: applyPlacements(applyAudience({}, adset.audience), adset.placements),
  };
  const destination = destinationType(c.objective, adset.destination, adset.messagingApps, goal);
  if (destination) p.destination_type = destination;
  const promoted = promotedObject(spec, adset);
  if (promoted) p.promoted_object = promoted;
  if (isConversionGoal(goal) && adset.pixelId) p.attribution_spec = attributionSpec(adset.attribution);
  if (c.startTime) p.start_time = c.startTime;
  if (c.endTime) p.end_time = c.endTime;
  if (c.budgetLevel === "adset") {
    p[c.budgetSchedule === "daily" ? "daily_budget" : "lifetime_budget"] = toMinorUnits(adset.budget ?? 0, currency);
    p.bid_strategy = c.bidStrategy;
  }
  if (needsBidAmount(c.bidStrategy) && adset.bidAmount) p.bid_amount = toMinorUnits(adset.bidAmount, currency);
  if (c.bidStrategy === "LOWEST_COST_WITH_MIN_ROAS" && adset.roasFloor) p.bid_constraints = { roas_average_floor: Math.round(adset.roasFloor * 10000) };
  return p;
}

export type MediaRef = { kind: "image"; hash: string } | { kind: "video"; videoId: string; thumbnailUrl: string };

// Positions the paired-creative rules understand; other placements are served by Meta's defaults.
const FB_CREATIVE = new Set(["feed", "profile_feed", "marketplace", "video_feeds", "search", "instream_video", "story", "facebook_reels"]);
const IG_CREATIVE = new Set(["stream", "profile_feed", "explore", "explore_home", "ig_search", "story", "reels"]);

/**
 * FB + IG positions an ad set serves, for splitting a paired creative into feed (1:1) and Stories/Reels
 * (9:16) rules. Advantage+ placements use `defaults`, the positions Meta would pick.
 */
export function creativePositions(p: Placements, defaults: Placements): { facebook: string[]; instagram: string[] } {
  const src = p.automatic ? defaults : p;
  return {
    facebook: src.platforms.includes("facebook") ? src.facebook.filter((x) => FB_CREATIVE.has(x)) : [],
    instagram: src.platforms.includes("instagram") ? src.instagram.filter((x) => IG_CREATIVE.has(x)) : [],
  };
}

// Positions a format can't serve; leaving them in a customization rule makes the API reject it.
const UNSUPPORTED = {
  image: { facebook: new Set(["instream_video", "video_feeds"]), instagram: new Set<string>() },
  video: { facebook: new Set<string>(), instagram: new Set(["explore_home"]) },
};

/** Splits FB + IG positions into the 1:1 rule and the 9:16 rule for this media kind. */
export function placementRules(positions: { facebook: readonly string[]; instagram: readonly string[] }, kind: "image" | "video") {
  const split = (platform: "facebook" | "instagram") => {
    const list = positions[platform].filter((p) => !UNSUPPORTED[kind][platform].has(p));
    return {
      square: list.filter((p) => !VERTICAL_POSITIONS[platform].has(p)),
      vertical: list.filter((p) => VERTICAL_POSITIONS[platform].has(p)),
    };
  };
  const fb = split("facebook");
  const ig = split("instagram");
  const spec = (f: string[], i: string[]) => {
    const s: Payload = { publisher_platforms: [...(f.length ? ["facebook"] : []), ...(i.length ? ["instagram"] : [])] };
    if (f.length) s.facebook_positions = f;
    if (i.length) s.instagram_positions = i;
    return s;
  };
  return { square: spec(fb.square, ig.square), vertical: spec(fb.vertical, ig.vertical) };
}

export function creativeFeaturesSpec(optIn: readonly string[]) {
  return Object.fromEntries(CREATIVE_FEATURES.map((f) => [f, { enroll_status: optIn.includes(f) ? "OPT_IN" : "OPT_OUT" }]));
}

/** Copy fields of an ad with a single text option, as the in-table editor edits them. */
export type AdCopy = { primaryText: string; headline: string; description?: string; url: string; cta: string };

/** Where an ad's clicks go: decided by its ad set. */
export type CreativeDestination = { kind: Destination; apps?: readonly MessagingApp[]; storeUrl?: string };

export const sameMedia = (a: MediaRef, b: MediaRef) =>
  a.kind === "image" ? b.kind === "image" && a.hash === b.hash : b.kind === "video" && a.videoId === b.videoId;

const hasPositions = (spec: Payload) => Array.isArray(spec.publisher_platforms) && spec.publisher_platforms.length > 0;

type CreativeAd = Pick<AdInput, "primaryTexts" | "headlines" | "description" | "url" | "displayLink" | "cta" | "creativeFeaturesOptIn">;

/** The single-text copy shape of the in-table editor, as a builder ad. */
export const fromCopy = (ad: AdCopy, optIn: readonly string[] = []): CreativeAd => ({
  primaryTexts: [ad.primaryText],
  headlines: [ad.headline],
  description: ad.description || undefined,
  url: ad.url,
  cta: ad.cta,
  creativeFeaturesOptIn: optIn as CreativeAd["creativeFeaturesOptIn"],
});

/**
 * One image or video for every placement: the classic link_data / video_data creative. With
 * `textsInFeed` the texts are left out here and carried by an asset feed instead (several text options).
 */
export function singleMediaCreativePayload(args: {
  name: string;
  pageId: string;
  instagramUserId?: string;
  media: MediaRef;
  ad: CreativeAd;
  urlTags: string;
  link: string;
  cta: Payload;
  textsInFeed?: boolean;
}): Payload {
  const { media, ad } = args;
  const inline = !args.textsInFeed;
  const objectStorySpec: Payload = { page_id: args.pageId };
  if (args.instagramUserId) objectStorySpec.instagram_user_id = args.instagramUserId;
  if (media.kind === "image") {
    objectStorySpec.link_data = {
      image_hash: media.hash,
      link: args.link,
      ...(inline ? { message: ad.primaryTexts[0], name: ad.headlines[0] } : {}),
      ...(ad.description ? { description: ad.description } : {}),
      ...(ad.displayLink ? { caption: ad.displayLink } : {}),
      call_to_action: args.cta,
    };
  } else {
    objectStorySpec.video_data = {
      video_id: media.videoId,
      image_url: media.thumbnailUrl,
      ...(inline ? { message: ad.primaryTexts[0], title: ad.headlines[0] } : {}),
      ...(ad.description ? { link_description: ad.description } : {}),
      call_to_action: ad.displayLink ? { ...args.cta, value: { ...(args.cta.value as Payload), link_caption: ad.displayLink } } : args.cta,
    };
  }
  const p: Payload = {
    name: args.name,
    object_story_spec: objectStorySpec,
    // Advantage+ creative enhancements default ON; opt out of everything not explicitly allowed.
    degrees_of_freedom_spec: { creative_features_spec: creativeFeaturesSpec(ad.creativeFeaturesOptIn) },
  };
  if (args.urlTags) p.url_tags = args.urlTags;
  return p;
}

/**
 * The creative for one ad in one kind of ad set. Website / app ads pair the 1:1 and 9:16 files with
 * placement rules and carry every text option; messaging ads use the feed file and the first text
 * option, with one call to action per messaging app. With `more` files the ad is Flexible format.
 */
export function creativePayload(args: {
  name: string;
  pageId: string;
  instagramUserId?: string;
  square: MediaRef;
  vertical: MediaRef;
  /** Flexible format: files after `square`, which Meta mixes per person (one file, a carousel or a video). */
  more?: readonly MediaRef[];
  ad: CreativeAd;
  destination: CreativeDestination;
  urlTags: string;
  positions: { facebook: readonly string[]; instagram: readonly string[] };
}): Payload {
  const { square, vertical, ad, destination } = args;
  const base = { name: args.name, pageId: args.pageId, instagramUserId: args.instagramUserId, ad };

  if (destination.kind === "messaging") {
    const apps = destination.apps?.length ? destination.apps : (["MESSENGER"] as const);
    const ctas = apps.map((a) => ({ type: MESSAGING_CTA[a].type, value: { app_destination: a, link: MESSAGING_CTA[a].link } }));
    const p = singleMediaCreativePayload({ ...base, media: square, urlTags: "", link: ctas[0].value.link, cta: ctas[0] });
    // Several apps: Meta picks the app per person, from the calls to action listed here.
    if (apps.length > 1) p.asset_feed_spec = { optimization_type: "DOF_MESSAGING_DESTINATION", call_to_actions: ctas };
    return p;
  }

  const link = destination.kind === "app" ? (destination.storeUrl ?? "") : (ad.url ?? "");
  const urlTags = destination.kind === "app" ? "" : args.urlTags;
  const media = (m: MediaRef, adlabel?: { name: string }) => {
    const labels = adlabel ? { adlabels: [adlabel] } : {};
    return m.kind === "image" ? { hash: m.hash, ...labels } : { video_id: m.videoId, thumbnail_url: m.thumbnailUrl, ...labels };
  };
  const texts: Payload = {
    bodies: ad.primaryTexts.map((text) => ({ text })),
    titles: ad.headlines.map((text) => ({ text })),
    // The link description can't be customized per placement, so there is only ever one.
    ...(ad.description ? { descriptions: [{ text: ad.description }] } : {}),
  };
  const feedCreative = (assetFeedSpec: Payload): Payload => {
    const objectStorySpec: Payload = { page_id: args.pageId };
    if (args.instagramUserId) objectStorySpec.instagram_user_id = args.instagramUserId;
    const p: Payload = {
      name: args.name,
      object_story_spec: objectStorySpec,
      asset_feed_spec: {
        ...assetFeedSpec,
        ...texts,
        link_urls: [{ website_url: link, ...(ad.displayLink ? { display_url: ad.displayLink } : {}) }],
        call_to_action_types: [ad.cta],
      },
      degrees_of_freedom_spec: { creative_features_spec: creativeFeaturesSpec(ad.creativeFeaturesOptIn) },
    };
    if (urlTags) p.url_tags = urlTags;
    return p;
  };

  if (args.more?.length) {
    // Flexible format: every file in one feed; Meta shows one, a carousel or a video per person.
    const files = [square, ...args.more];
    const images = files.filter((m) => m.kind === "image");
    const videos = files.filter((m) => m.kind === "video");
    return feedCreative({
      ...(images.length ? { images: images.map((m) => media(m)) } : {}),
      ...(videos.length ? { videos: videos.map((m) => media(m)) } : {}),
      ad_formats: ["AUTOMATIC_FORMAT"],
      optimization_type: "REGULAR",
    });
  }

  const kind = square.kind;
  const rules = placementRules(args.positions, kind);
  // A single-file creative, or placements that only use one ratio: no per-placement customization needed.
  const single = sameMedia(square, vertical) ? square : !hasPositions(rules.vertical) ? square : !hasPositions(rules.square) ? vertical : null;
  if (single) {
    const oneText = ad.primaryTexts.length === 1 && ad.headlines.length === 1;
    const p = singleMediaCreativePayload({ ...base, media: single, urlTags, link, cta: { type: ad.cta, value: { link } }, textsInFeed: !oneText });
    // Several text options, stored the way Ads Manager does: file and link in link_data / video_data,
    // the texts in an asset feed, and Meta picks the best combination per person.
    if (!oneText) p.asset_feed_spec = { bodies: texts.bodies, titles: texts.titles, optimization_type: "DEGREES_OF_FREEDOM" };
    return p;
  }

  const SQ = { name: "sq_1x1" };
  const VT = { name: "vt_9x16" };
  const label = kind === "image" ? "image_label" : "video_label";
  return feedCreative({
    ad_formats: [kind === "image" ? "SINGLE_IMAGE" : "SINGLE_VIDEO"],
    [kind === "image" ? "images" : "videos"]: [media(square, SQ), media(vertical, VT)],
    optimization_type: "PLACEMENT",
    asset_customization_rules: [
      { customization_spec: rules.square, [label]: SQ, priority: 1 },
      { customization_spec: rules.vertical, [label]: VT, priority: 2 },
    ],
  });
}

export function adPayload(name: string, adsetId: string, creativeId: string): Payload {
  return { name, adset_id: adsetId, creative: { creative_id: creativeId }, status: "PAUSED" };
}

/** What makes two ad sets need different creatives for the same ad: where clicks go, and which placements to split. */
export function creativeVariantKey(adset: AdsetInput, defaults: Placements): string {
  const apps = adset.destination === "messaging" ? [...adset.messagingApps].sort() : [];
  const store = adset.destination === "app" ? adset.app?.storeUrl : undefined;
  const positions = adset.destination === "messaging" ? null : creativePositions(adset.placements, defaults);
  return JSON.stringify([adset.destination, apps, store ?? null, positions]);
}

/**
 * Ad sets grouped by creative variant: `groupOf[j]` is ad set j's group, `first[g]` the first ad set
 * of group g. Each ad gets one creative per group (ref "creative:i" for group 0, "creative:i:g" after).
 */
export function creativeGroups(spec: Pick<LaunchSpec, "adsets">, defaults: Placements) {
  const keys: string[] = [];
  const first: number[] = [];
  const groupOf = spec.adsets.map((s, j) => {
    const key = creativeVariantKey(s, defaults);
    let g = keys.indexOf(key);
    if (g < 0) {
      g = keys.push(key) - 1;
      first.push(j);
    }
    return g;
  });
  return { groupOf, first, count: keys.length };
}

export const creativeRef = (adIndex: number, group: number) => (group === 0 ? `creative:${adIndex}` : `creative:${adIndex}:${group}`);

export const creativeDestination = (adset: Pick<AdsetInput, "destination" | "messagingApps" | "app">): CreativeDestination => ({
  kind: adset.destination,
  apps: adset.messagingApps,
  storeUrl: adset.app?.storeUrl,
});
