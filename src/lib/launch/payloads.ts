/** Pure builders for the exact payloads sent to the Marketing API (unit tested). */
import { needsBidAmount, type Placements } from "@/lib/meta/editor-types";
import { applyAudience, applyPlacements } from "@/lib/meta/targeting";
import { destinationType, isConversionGoal, LEAD_CTAS, LEAD_FORM_LINK, MESSAGING_CTA, pixelUse, type Destination, type MessagingApp } from "./objectives";
import { CREATIVE_FEATURES, VERTICAL_POSITIONS, type AdInput, type AdsetInput, type LaunchSpec, type TemplateConfig } from "./spec";

import { toMinorUnits } from "@/lib/money";

export { fromMinorUnits, toMinorUnits } from "@/lib/money";

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
    // Required by the API when the campaign has no campaign-level budget. Sharing only exists for daily budgets.
    p.is_adset_budget_sharing_enabled = !!c.budgetSharing && c.budgetSchedule === "daily";
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
  if (adset.destination === "instant_form" || objective === "OUTCOME_AWARENESS") return { page_id: spec.pageId };
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
  if (c.budgetLevel === "campaign") {
    const per = c.budgetSchedule === "daily" ? "daily" : "lifetime";
    if (adset.minSpend) p[`${per}_min_spend_target`] = toMinorUnits(adset.minSpend, currency);
    if (adset.maxSpend) p[`${per}_spend_cap`] = toMinorUnits(adset.maxSpend, currency);
  }
  if (adset.dsaBeneficiary && adset.dsaPayor) {
    p.dsa_beneficiary = adset.dsaBeneficiary;
    p.dsa_payor = adset.dsaPayor;
  }
  if (needsBidAmount(c.bidStrategy) && adset.bidAmount) p.bid_amount = toMinorUnits(adset.bidAmount, currency);
  if (c.bidStrategy === "LOWEST_COST_WITH_MIN_ROAS" && adset.roasFloor) p.bid_constraints = { roas_average_floor: Math.round(adset.roasFloor * 10000) };
  return p;
}

export type MediaRef = { kind: "image"; hash: string } | { kind: "video"; videoId: string; thumbnailUrl: string };

// Positions the paired-creative rules understand; other placements are served by Meta's defaults.
const FB_CREATIVE = new Set(["feed", "profile_feed", "marketplace", "search", "instream_video", "story", "facebook_reels"]);
const IG_CREATIVE = new Set(["stream", "profile_feed", "explore_home", "ig_search", "story", "reels", "profile_reels"]);

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
  image: { facebook: new Set(["instream_video"]), instagram: new Set<string>() },
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

/** Where an ad's clicks go: decided by its ad set. */
export type CreativeDestination = { kind: Destination; apps?: readonly MessagingApp[]; storeUrl?: string };

export const sameMedia = (a: MediaRef, b: MediaRef) =>
  a.kind === "image" ? b.kind === "image" && a.hash === b.hash : b.kind === "video" && a.videoId === b.videoId;

const hasPositions = (spec: Payload) => Array.isArray(spec.publisher_platforms) && spec.publisher_platforms.length > 0;

type CreativeAd = Pick<AdInput, "primaryTexts" | "headlines" | "description" | "url" | "displayLink" | "cta" | "creativeFeaturesOptIn"> &
  Partial<Pick<AdInput, "multiAdvertiser" | "shopDestination" | "leadFormId">>;

/**
 * Settings every creative states explicitly, because Meta's defaults switch them on: Advantage+ enhancements,
 * multi-advertiser ads, and (website ads only, when the buyer turned it off) routing clicks to a Meta shop.
 */
function creativeControls(ad: CreativeAd, website: boolean): Payload {
  const p: Payload = {
    degrees_of_freedom_spec: { creative_features_spec: creativeFeaturesSpec(ad.creativeFeaturesOptIn) },
    contextual_multi_ads: { enroll_status: ad.multiAdvertiser ? "OPT_IN" : "OPT_OUT" },
  };
  if (website && ad.shopDestination === false) p.destination_spec = { destination_type: "WEBSITE_AND_SHOP_OPT_OUT" };
  return p;
}

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
  /** Clicks go to a website (not a chat or app store). */
  website?: boolean;
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
  const p: Payload = { name: args.name, object_story_spec: objectStorySpec, ...creativeControls(ad, args.website ?? true) };
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

  if (destination.kind === "instant_form") {
    // The form opens on Facebook / Instagram: one file for every placement, the first text option, and a CTA
    // that carries the form (the link is Meta's placeholder for lead ads).
    const type = (LEAD_CTAS as readonly string[]).includes(ad.cta) ? ad.cta : LEAD_CTAS[0];
    const cta = { type, value: { link: LEAD_FORM_LINK, lead_gen_form_id: ad.leadFormId } };
    const p = singleMediaCreativePayload({ ...base, ad: { ...ad, primaryTexts: ad.primaryTexts.slice(0, 1), headlines: ad.headlines.slice(0, 1) }, media: square, urlTags: "", link: LEAD_FORM_LINK, cta, website: false });
    return p;
  }

  if (destination.kind === "messaging") {
    const apps = destination.apps?.length ? destination.apps : (["MESSENGER"] as const);
    const ctas = apps.map((a) => ({ type: MESSAGING_CTA[a].type, value: { app_destination: a, link: MESSAGING_CTA[a].link } }));
    const p = singleMediaCreativePayload({ ...base, media: square, urlTags: "", link: ctas[0].value.link, cta: ctas[0], website: false });
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
      ...creativeControls(ad, destination.kind !== "app"),
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
    const p = singleMediaCreativePayload({ ...base, media: single, urlTags, link, cta: { type: ad.cta, value: { link } }, textsInFeed: !oneText, website: destination.kind !== "app" });
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

/** Second-level suffixes under which the registrable domain has three labels (example.co.uk). */
const TWO_PART_SUFFIXES = new Set(["co.uk", "org.uk", "ac.uk", "com.au", "net.au", "org.au", "co.nz", "com.br", "com.mx", "co.jp", "co.in", "com.sg", "co.za", "com.ar", "com.co", "com.tr", "co.il", "com.hk"]);

/** The domain a pixel campaign's conversions are attributed to: the website's registrable domain (shop.example.com → example.com). */
export function registrableDomain(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2 || /^\d+$/.test(labels.at(-1)!)) return undefined;
  const keep = labels.length >= 3 && TWO_PART_SUFFIXES.has(labels.slice(-2).join(".")) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

export function adPayload(name: string, adsetId: string, creativeId: string, extra: { conversionDomain?: string; appId?: string } = {}): Payload {
  const p: Payload = { name, adset_id: adsetId, creative: { creative_id: creativeId }, status: "PAUSED" };
  // Meta requires it on ads in campaigns that share data with a pixel (Ads Manager always sets it).
  if (extra.conversionDomain) p.conversion_domain = extra.conversionDomain;
  // App ads no longer track installs or app events unless told to.
  if (extra.appId)
    p.tracking_specs = [
      { "action.type": ["mobile_app_install"], application: [extra.appId] },
      { "action.type": ["app_custom_event"], application: [extra.appId] },
    ];
  return p;
}

/** What makes two ad sets need different creatives for the same ad: where clicks go, and which placements to split. */
export function creativeVariantKey(adset: AdsetInput, defaults: Placements): string {
  const apps = adset.destination === "messaging" ? [...adset.messagingApps].sort() : [];
  const store = adset.destination === "app" ? adset.app?.storeUrl : undefined;
  // Chat and instant-form creatives use one file everywhere, so placements don't split them.
  const positions = adset.destination === "messaging" || adset.destination === "instant_form" ? null : creativePositions(adset.placements, defaults);
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
