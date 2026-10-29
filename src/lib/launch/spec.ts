import { z } from "zod";
import { BID_STRATEGIES, SPECIAL_AD_CATEGORIES, type Placements } from "@/lib/meta/editor-types";
import { audienceSchema, placementsSchema } from "@/lib/meta/editor-schemas";
import {
  DESTINATION_LABELS,
  DESTINATIONS,
  goalsFor,
  LAUNCH_OBJECTIVES,
  MESSAGING_APPS,
  needsWebsite,
  OBJECTIVE_DESTINATIONS,
  pixelUse,
  type LaunchObjective,
} from "./objectives";

// FB + IG only. Positions are split by which asset (1:1 or 9:16) serves them.
export const FACEBOOK_POSITIONS = [
  "feed",
  "profile_feed",
  "marketplace",
  "video_feeds",
  "search",
  "instream_video",
  "story",
  "facebook_reels",
] as const;
export const INSTAGRAM_POSITIONS = [
  "stream",
  "profile_feed",
  "explore",
  "explore_home",
  "ig_search",
  "story",
  "reels",
] as const;

export const VERTICAL_POSITIONS = {
  facebook: new Set<string>(["story", "facebook_reels"]),
  instagram: new Set<string>(["story", "reels"]),
};

export const POSITION_LABELS: Record<string, string> = {
  feed: "Feed",
  profile_feed: "Profile feed",
  marketplace: "Marketplace",
  video_feeds: "Video feeds",
  search: "Search results",
  instream_video: "In-stream video",
  story: "Stories",
  facebook_reels: "Reels",
  stream: "Feed",
  explore: "Explore",
  explore_home: "Explore home",
  ig_search: "Search results",
  reels: "Reels",
};

export const CONVERSION_EVENTS = [
  "PURCHASE",
  "INITIATED_CHECKOUT",
  "ADD_TO_CART",
  "ADD_PAYMENT_INFO",
  "LEAD",
  "COMPLETE_REGISTRATION",
  "CONTACT",
  "SUBSCRIBE",
  "START_TRIAL",
  "SCHEDULE",
  "CONTENT_VIEW",
  "SEARCH",
  "ADD_TO_WISHLIST",
  "SUBMIT_APPLICATION",
  "CUSTOMIZE_PRODUCT",
  "DONATE",
  "FIND_LOCATION",
] as const;
export type ConversionEvent = (typeof CONVERSION_EVENTS)[number];

/** The standard pixel event each conversion event optimizes for, as the pixel reports it. */
export const PIXEL_EVENT_NAMES: Record<ConversionEvent, string> = {
  PURCHASE: "Purchase",
  INITIATED_CHECKOUT: "InitiateCheckout",
  ADD_TO_CART: "AddToCart",
  ADD_PAYMENT_INFO: "AddPaymentInfo",
  LEAD: "Lead",
  COMPLETE_REGISTRATION: "CompleteRegistration",
  CONTACT: "Contact",
  SUBSCRIBE: "Subscribe",
  START_TRIAL: "StartTrial",
  SCHEDULE: "Schedule",
  CONTENT_VIEW: "ViewContent",
  SEARCH: "Search",
  ADD_TO_WISHLIST: "AddToWishlist",
  SUBMIT_APPLICATION: "SubmitApplication",
  CUSTOMIZE_PRODUCT: "CustomizeProduct",
  DONATE: "Donate",
  FIND_LOCATION: "FindLocation",
};

export const OBJECTIVES = ["OUTCOME_SALES", "OUTCOME_LEADS"] as const;

export const CTA_TYPES = [
  "SHOP_NOW",
  "LEARN_MORE",
  "ORDER_NOW",
  "BUY_NOW",
  "GET_OFFER",
  "SIGN_UP",
  "SUBSCRIBE",
  "APPLY_NOW",
  "BOOK_NOW",
  "CONTACT_US",
  "GET_QUOTE",
] as const;

/**
 * Advantage+ creative enhancements Meta may apply. They default ON, so every feature here is
 * sent as OPT_OUT unless the template explicitly opts in.
 * Source: AdCreativeFeaturesSpec (Marketing API v26).
 */
export const CREATIVE_FEATURES = [
  "image_touchups",
  "image_templates",
  "image_animation",
  "image_background_gen",
  "text_optimizations",
  "text_translation",
  "inline_comment",
  "adapt_to_placement",
  "add_text_overlay",
  "description_automation",
  "media_type_automation",
  "reveal_details_over_time",
  "site_extensions",
  "product_extensions",
  "show_summary",
  "show_destination_blurbs",
  "creative_stickers",
  "profile_card",
  "video_highlights",
  "video_to_image",
  "multi_photo_to_video",
  "generate_cta",
  "replace_media_text",
  "text_extraction_for_headline",
  "text_extraction_for_tap_target",
  "translate_voiceover",
  "text_overlay_translation",
  "music_generation",
] as const;
export type CreativeFeature = (typeof CREATIVE_FEATURES)[number];
export const isCreativeFeature = (v: string): v is CreativeFeature => (CREATIVE_FEATURES as readonly string[]).includes(v);

const metaId = z.string().regex(/^\d+$/, "Expected a numeric Meta id");

export const templateConfigSchema = z
  .object({
    objective: z.enum(OBJECTIVES).default("OUTCOME_SALES"),
    pixelId: metaId,
    conversionEvent: z.enum(CONVERSION_EVENTS).default("PURCHASE"),
    budgetLevel: z.enum(["campaign", "adset"]).default("campaign"),
    budgetSchedule: z.enum(["daily", "lifetime"]).default("daily"),
    /** Default budget in major currency units (e.g. dollars). */
    defaultBudget: z.number().positive().default(100),
    attribution: z
      .object({
        clickDays: z.union([z.literal(1), z.literal(7)]).default(7),
        viewDays: z.union([z.literal(0), z.literal(1)]).default(1),
        engagedViewDays: z.union([z.literal(0), z.literal(1)]).default(0),
      })
      .default({ clickDays: 7, viewDays: 1, engagedViewDays: 0 }),
    placements: z.object({
      facebook: z.array(z.enum(FACEBOOK_POSITIONS)),
      instagram: z.array(z.enum(INSTAGRAM_POSITIONS)),
    }),
    devicePlatforms: z.array(z.enum(["mobile", "desktop"])).min(1).default(["mobile", "desktop"]),
    exclusionAudiences: z.array(z.object({ id: metaId, name: z.string() })).default([]),
    countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).default(["US"]),
    ageMin: z.number().int().min(18).max(65).default(18),
    ageMax: z.number().int().min(18).max(65).default(65),
    advantageAudience: z.boolean().default(false),
    /** Advantage+ creative features to keep ON. Everything else in CREATIVE_FEATURES is opted out. */
    creativeFeaturesOptIn: z.array(z.enum(CREATIVE_FEATURES)).default([]),
    cta: z.enum(CTA_TYPES).default("SHOP_NOW"),
  })
  .superRefine((c, ctx) => {
    const all = [...c.placements.facebook.map((p) => ["facebook", p]), ...c.placements.instagram.map((p) => ["instagram", p])];
    const vertical = all.filter(([pl, p]) => VERTICAL_POSITIONS[pl as "facebook" | "instagram"].has(p));
    if (vertical.length === 0 || vertical.length === all.length) {
      ctx.addIssue({
        code: "custom",
        path: ["placements"],
        message: "Select at least one feed placement (1:1) and one Stories/Reels placement (9:16).",
      });
    }
    if (c.ageMin > c.ageMax) ctx.addIssue({ code: "custom", path: ["ageMax"], message: "Max age must be ≥ min age." });
  });

export type TemplateConfig = z.infer<typeof templateConfigSchema>;

export const DEFAULT_TEMPLATE_CONFIG: Omit<TemplateConfig, "pixelId"> = {
  objective: "OUTCOME_SALES",
  conversionEvent: "PURCHASE",
  budgetLevel: "campaign",
  budgetSchedule: "daily",
  defaultBudget: 100,
  attribution: { clickDays: 7, viewDays: 1, engagedViewDays: 0 },
  placements: {
    facebook: ["feed", "profile_feed", "story", "facebook_reels"],
    instagram: ["stream", "profile_feed", "explore", "story", "reels"],
  },
  devicePlatforms: ["mobile", "desktop"],
  exclusionAudiences: [],
  countries: ["US"],
  ageMin: 18,
  ageMax: 65,
  advantageAudience: false,
  creativeFeaturesOptIn: [],
  cta: "SHOP_NOW",
};


/** Ads Manager names for the Advantage+ creative enhancements, grouped the way the builder lists them. */
export const CREATIVE_FEATURE_GROUPS: { label: string; features: { key: CreativeFeature; label: string }[] }[] = [
  {
    label: "Image",
    features: [
      { key: "image_touchups", label: "Visual touch-ups" },
      { key: "image_templates", label: "Add overlays" },
      { key: "image_animation", label: "Image animation" },
      { key: "image_background_gen", label: "Expand image / generate background" },
      { key: "add_text_overlay", label: "Add text overlays" },
      { key: "replace_media_text", label: "Replace text in media" },
      { key: "multi_photo_to_video", label: "Turn photos into a video" },
    ],
  },
  {
    label: "Video",
    features: [
      { key: "video_highlights", label: "Video highlights" },
      { key: "video_to_image", label: "Show a still image from the video" },
      { key: "music_generation", label: "Add music" },
      { key: "translate_voiceover", label: "Translate voice-over" },
    ],
  },
  {
    label: "Text",
    features: [
      { key: "text_optimizations", label: "Text improvements" },
      { key: "text_translation", label: "Translate text" },
      { key: "text_overlay_translation", label: "Translate text overlays" },
      { key: "description_automation", label: "Add descriptions" },
      { key: "text_extraction_for_headline", label: "Use media text as headline" },
      { key: "text_extraction_for_tap_target", label: "Use media text for the tap target" },
      { key: "generate_cta", label: "Generate call to action" },
    ],
  },
  {
    label: "Destination & format",
    features: [
      { key: "adapt_to_placement", label: "Adapt to placement" },
      { key: "media_type_automation", label: "Dynamic media" },
      { key: "reveal_details_over_time", label: "Reveal details over time" },
      { key: "site_extensions", label: "Site links" },
      { key: "product_extensions", label: "Add catalog items" },
      { key: "show_summary", label: "Show summaries" },
      { key: "show_destination_blurbs", label: "Show destination details" },
      { key: "inline_comment", label: "Relevant comments" },
      { key: "creative_stickers", label: "Add stickers" },
      { key: "profile_card", label: "Profile card" },
    ],
  },
];

// ── Launch input (what the campaign builder submits) ─────────────────────────

const money = z.number().positive().max(10_000_000);
const httpsUrl = z.url({ protocol: /^https?$/, message: "Enter a full https:// URL" });
const country = z.string().regex(/^[A-Z]{2}$/);

export const attributionSchema = z.object({
  clickDays: z.union([z.literal(1), z.literal(7)]),
  viewDays: z.union([z.literal(0), z.literal(1)]),
  engagedViewDays: z.union([z.literal(0), z.literal(1)]),
});

const GOALS = [
  "OFFSITE_CONVERSIONS",
  "VALUE",
  "LANDING_PAGE_VIEWS",
  "LINK_CLICKS",
  "IMPRESSIONS",
  "REACH",
  "AD_RECALL_LIFT",
  "THRUPLAY",
  "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS",
  "POST_ENGAGEMENT",
  "CONVERSATIONS",
  "APP_INSTALLS",
] as const;

export const adsetInputSchema = z.object({
  name: z.string().trim().min(1).max(400),
  budget: money.optional(),
  destination: z.enum(DESTINATIONS),
  messagingApps: z.array(z.enum(MESSAGING_APPS)).max(3).default([]),
  optimizationGoal: z.enum(GOALS),
  pixelId: metaId.optional(),
  conversionEvent: z.enum(CONVERSION_EVENTS).optional(),
  app: z.object({ id: metaId, storeUrl: httpsUrl }).optional(),
  attribution: attributionSchema,
  bidAmount: money.optional(),
  roasFloor: z.number().min(0.01).max(1000).optional(),
  audience: audienceSchema,
  placements: placementsSchema,
});

export const adInputSchema = z.object({
  name: z.string().trim().min(1).max(400),
  creativeId: z.string().min(1).max(64),
  primaryTexts: z.array(z.string().trim().min(1, "Primary text can't be empty").max(2200)).min(1).max(5),
  headlines: z.array(z.string().trim().min(1, "Headline can't be empty").max(255)).min(1).max(5),
  description: z.string().trim().max(255).optional(),
  url: httpsUrl.optional(),
  displayLink: z.string().trim().max(100).optional(),
  /** URL parameters appended to the website link; defaults to the client's UTM rule. */
  urlTags: z.string().trim().max(1000).optional(),
  cta: z.string().regex(/^[A-Z_]{2,40}$/),
  /** Advantage+ creative enhancements to keep ON; everything else in CREATIVE_FEATURES is opted out. */
  creativeFeaturesOptIn: z.array(z.enum(CREATIVE_FEATURES)).default([]),
  /** Flexible format: library files after the creative's own, for up to MAX_FLEXIBLE_FILES in all. */
  moreAssetIds: z.array(z.string().regex(/^[A-Za-z0-9-]{1,64}$/)).max(9).optional(),
});

const assetId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);

/** Files in one Flexible-format ad: Meta allows 10 images and 10 videos; Ads Manager offers 10 files in all. */
export const MAX_FLEXIBLE_FILES = 10;

/**
 * The files an ad uses, as picked in the builder: a feed file with an optional Stories & Reels file, or
 * (Flexible format) a first file plus `moreAssetIds`. Resolved to a library creative when the launch is created.
 */
export const mediaPickSchema = z.object({
  feedAssetId: assetId,
  verticalAssetId: assetId.optional(),
  moreAssetIds: z.array(assetId).min(1).max(MAX_FLEXIBLE_FILES - 1).optional(),
});
export type MediaPick = z.infer<typeof mediaPickSchema>;

/** Creatives one launch may create (one per ad for each kind of ad set); keeps a build inside Meta's rate limits. */
export const MAX_LAUNCH_CREATIVES = 250;

/** An ad as the builder submits it: media files instead of a library creative. */
export const adDraftInputSchema = adInputSchema.omit({ creativeId: true }).extend({ media: mediaPickSchema });

export const launchInputSchema = z.object({
  idempotencyKey: z.uuid(),
  draftId: z.string().max(64).optional(),
  clientId: z.string().min(1),
  adAccountId: z.string().regex(/^act_\d+$/),
  templateId: z.string().min(1).optional(),
  pageId: metaId,
  instagramUserId: metaId.optional(),
  campaign: z.object({
    name: z.string().trim().min(1).max(400),
    objective: z.enum(LAUNCH_OBJECTIVES),
    budgetLevel: z.enum(["campaign", "adset"]),
    budgetSchedule: z.enum(["daily", "lifetime"]),
    budget: money.optional(),
    bidStrategy: z.enum(BID_STRATEGIES),
    spendCap: money.optional(),
    specialAdCategories: z.array(z.enum(SPECIAL_AD_CATEGORIES)).max(5).default([]),
    specialAdCountries: z.array(country).max(50).default([]),
    startTime: z.iso.datetime({ offset: true }).optional(),
    endTime: z.iso.datetime({ offset: true }).optional(),
  }),
  adsets: z.array(adsetInputSchema).min(1).max(20),
  ads: z.array(adDraftInputSchema).min(1).max(50),
});

export type LaunchInput = z.infer<typeof launchInputSchema>;
export type AdsetInput = z.infer<typeof adsetInputSchema>;
export type AdInput = z.infer<typeof adInputSchema>;

/** Stored on the launch row: the submitted input with each ad's library creative, plus the client's default URL parameters. */
export type LaunchSpec = Omit<LaunchInput, "idempotencyKey" | "draftId" | "ads"> & { version: 2; urlTags: string; ads: AdInput[] };

/** Special ad categories that restrict age, gender and ZIP targeting. */
const RESTRICTED_CATEGORIES = new Set(["HOUSING", "EMPLOYMENT", "CREDIT", "FINANCIAL_PRODUCTS_SERVICES"]);

/** Cross-field checks zod can't express. Each issue points at the builder step it belongs to. */
export function validateLaunch(
  input: Pick<LaunchInput, "campaign" | "adsets" | "instagramUserId"> & {
    ads: { url?: string; primaryTexts?: string[]; headlines?: string[]; moreAssetIds?: string[]; media?: { verticalAssetId?: string; moreAssetIds?: string[] } }[];
  },
): LaunchIssue[] {
  const issues: LaunchIssue[] = [];
  const c = input.campaign;
  const cbo = c.budgetLevel === "campaign";
  const add = (step: LaunchIssue["step"], where: string, message: string) => issues.push({ step, where, message });

  if (cbo && !c.budget) add("campaign", "Campaign", "Enter a campaign budget (Advantage campaign budget is on).");
  if (c.budgetSchedule === "lifetime" && !c.endTime) add("campaign", "Campaign", "Lifetime budgets need an end date.");
  if (c.startTime && c.endTime && c.endTime <= c.startTime) add("campaign", "Campaign", "The end date must be after the start date.");
  if (c.bidStrategy === "LOWEST_COST_WITH_MIN_ROAS" && c.objective !== "OUTCOME_SALES") add("campaign", "Campaign", "A ROAS goal is only available for Sales campaigns.");

  input.adsets.forEach((s, j) => {
    const where = `Ad set ${j + 1}`;
    if (!cbo && !s.budget) add("adsets", where, "Enter a budget (ad set budgets are on).");
    if (!OBJECTIVE_DESTINATIONS[c.objective].includes(s.destination))
      add("adsets", where, `${DESTINATION_LABELS[s.destination]} isn't available for ${OBJECTIVE_LABEL[c.objective]} campaigns.`);
    else if (!goalsFor(c.objective, s.destination, s.messagingApps).includes(s.optimizationGoal))
      add("adsets", where, "Choose a performance goal available for this conversion location.");
    if (s.destination === "messaging") {
      if (s.messagingApps.length === 0) add("adsets", where, "Choose at least one messaging app.");
      if (s.messagingApps.length > 1 && c.specialAdCategories.length) add("adsets", where, "Several messaging apps can't be combined with special ad categories.");
      if (s.messagingApps.includes("INSTAGRAM_DIRECT") && !input.instagramUserId) add("adsets", where, "Instagram messaging needs an Instagram account (set it on the Campaign step).");
    }
    if (s.destination === "app" && !s.app) add("adsets", where, "Choose the app to promote.");
    if (c.specialAdCategories.some((x) => RESTRICTED_CATEGORIES.has(x))) {
      const a = s.audience;
      if (a.ageMin !== 18 || a.ageMax !== 65) add("adsets", where, "Special ad categories need the full 18–65+ age range.");
      if (a.genders !== "all") add("adsets", where, "Special ad categories can't target by gender.");
      if (a.locations.some((l) => l.kind === "zip")) add("adsets", where, "Special ad categories can't target ZIP codes.");
    }
    const pixel = pixelUse(c.objective, s.destination, s.optimizationGoal, s.messagingApps);
    if (pixel === "required" && (!s.pixelId || !s.conversionEvent)) add("adsets", where, "Choose a pixel and conversion event.");
    if ((c.bidStrategy === "COST_CAP" || c.bidStrategy === "LOWEST_COST_WITH_BID_CAP") && !s.bidAmount)
      add("adsets", where, c.bidStrategy === "COST_CAP" ? "Enter a cost per result goal." : "Enter a bid cap.");
    if (c.bidStrategy === "LOWEST_COST_WITH_MIN_ROAS" && (s.optimizationGoal !== "VALUE" || !s.roasFloor))
      add("adsets", where, "A ROAS goal needs the “Conversion value” performance goal and a minimum ROAS.");
    const p = s.placements;
    if (!p.automatic && ![p.facebook, p.instagram, p.audienceNetwork, p.messenger].some((l, k) => l.length > 0 && p.platforms.includes(PLATFORMS[k])))
      add("adsets", where, "Choose at least one placement.");
  });

  const websiteNeeded = input.adsets.some((s) => needsWebsite(s.destination));
  const websiteOnly = input.adsets.every((s) => s.destination === "website");
  input.ads.forEach((a, i) => {
    if (websiteNeeded && !a.url) add("ads", `Ad ${i + 1}`, "Enter the website URL.");
    if (!websiteOnly && (a.moreAssetIds?.length || a.media?.moreAssetIds?.length))
      add("ads", `Ad ${i + 1}`, "Flexible format runs only in ad sets that send people to a website. Use Single image or video here.");
    // Meta rejects several text options on a creative customized per placement (error 1885878).
    if (a.media?.verticalAssetId && ((a.primaryTexts?.length ?? 0) > 1 || (a.headlines?.length ?? 0) > 1))
      add("ads", `Ad ${i + 1}`, "With a separate Stories & Reels file Meta allows one primary text and one headline. Remove the extra texts or the Stories & Reels file, or use Flexible.");
  });
  return issues;
}

export type LaunchIssue = { step: "campaign" | "adsets" | "ads"; where: string; message: string };

const PLATFORMS = ["facebook", "instagram", "audience_network", "messenger"] as const;
const OBJECTIVE_LABEL: Record<LaunchObjective, string> = {
  OUTCOME_AWARENESS: "Awareness",
  OUTCOME_TRAFFIC: "Traffic",
  OUTCOME_ENGAGEMENT: "Engagement",
  OUTCOME_LEADS: "Leads",
  OUTCOME_APP_PROMOTION: "App promotion",
  OUTCOME_SALES: "Sales",
};

/** Zod issues as builder-step issues ("Ad set 2 › budget: …"). */
export function zodIssues(err: z.ZodError, limit = 8): LaunchIssue[] {
  return err.issues.slice(0, limit).map((i) => {
    const [head, index, ...rest] = i.path;
    const step: LaunchIssue["step"] = head === "adsets" ? "adsets" : head === "ads" ? "ads" : "campaign";
    const where =
      head === "adsets" && typeof index === "number"
        ? `Ad set ${index + 1}`
        : head === "ads" && typeof index === "number"
          ? `Ad ${index + 1}`
          : "Campaign";
    const field = (step === "campaign" ? i.path.slice(head === "campaign" ? 1 : 0) : rest).map(String).join(" › ");
    return { step, where, message: field ? `${field}: ${i.message}` : i.message };
  });
}

// ── Launches created before the builder (v1 specs) ───────────────────────────

type LegacySpec = {
  clientId: string;
  adAccountId: string;
  templateId?: string;
  pageId: string;
  instagramUserId?: string;
  campaign: { name: string; budget?: number; startTime?: string; endTime?: string };
  adsets: { name: string; budget?: number; countries: string[]; ageMin: number; ageMax: number }[];
  ads: { name: string; creativeId: string; primaryText: string; headline: string; description?: string; url: string; cta: string }[];
  config: TemplateConfig;
  urlTags: string;
};

/** Reads a stored launch spec, upgrading v1 (template-driven) specs to the builder's v2 shape. */
export function normalizeSpec(raw: unknown): LaunchSpec {
  const s = raw as LaunchSpec | LegacySpec;
  if ("version" in s && s.version === 2) return s;
  const v1 = s as LegacySpec;
  // Older snapshots may predate template fields; fill them with today's defaults.
  const c: TemplateConfig = { ...DEFAULT_TEMPLATE_CONFIG, ...v1.config };
  return {
    version: 2,
    clientId: v1.clientId,
    adAccountId: v1.adAccountId,
    templateId: v1.templateId,
    pageId: v1.pageId,
    instagramUserId: v1.instagramUserId,
    urlTags: v1.urlTags,
    campaign: {
      name: v1.campaign.name,
      objective: c.objective,
      budgetLevel: c.budgetLevel,
      budgetSchedule: c.budgetSchedule,
      budget: v1.campaign.budget,
      bidStrategy: "LOWEST_COST_WITHOUT_CAP",
      specialAdCategories: [],
      specialAdCountries: [],
      startTime: v1.campaign.startTime,
      endTime: v1.campaign.endTime,
    },
    adsets: v1.adsets.map((a) => ({
      name: a.name,
      budget: a.budget,
      destination: "website",
      messagingApps: [],
      optimizationGoal: "OFFSITE_CONVERSIONS",
      pixelId: c.pixelId,
      conversionEvent: c.conversionEvent,
      attribution: c.attribution,
      audience: {
        locations: a.countries.map((cc) => ({ kind: "country" as const, key: cc, name: cc })),
        excludedLocations: [],
        ageMin: a.ageMin,
        ageMax: a.ageMax,
        genders: "all",
        detailed: [],
        detailedExcluded: [],
        customAudiences: [],
        excludedCustomAudiences: c.exclusionAudiences,
        advantageAudience: c.advantageAudience,
      },
      placements: templatePlacements(c),
    })),
    ads: v1.ads.map((a) => ({
      name: a.name,
      creativeId: a.creativeId,
      primaryTexts: [a.primaryText],
      headlines: [a.headline],
      description: a.description,
      url: a.url,
      cta: a.cta,
      creativeFeaturesOptIn: c.creativeFeaturesOptIn,
    })),
  };
}

/** A template's manual FB + IG placements in the editor's placements shape. */
export function templatePlacements(c: Pick<TemplateConfig, "placements" | "devicePlatforms">): Placements {
  return {
    automatic: false,
    platforms: [...(c.placements.facebook.length ? ["facebook" as const] : []), ...(c.placements.instagram.length ? ["instagram" as const] : [])],
    facebook: [...c.placements.facebook],
    instagram: [...c.placements.instagram],
    audienceNetwork: [],
    messenger: [],
    devices: [...c.devicePlatforms],
  };
}
