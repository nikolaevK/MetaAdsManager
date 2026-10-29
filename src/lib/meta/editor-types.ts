/** Client-safe shapes exchanged between the editor sheet and its server actions. Money is in major units. */

export type Level = "campaign" | "adset" | "ad";

/** What the editor sheet has open. New campaigns, ad sets and ads are made in the campaign builder. */
export type EditorTarget = { mode: "edit"; level: Level; id: string; name: string; tab?: "settings" | "performance" };

// CREDIT was folded into FINANCIAL_PRODUCTS_SERVICES; Meta rejects it since 2025-01-14.
export const SPECIAL_AD_CATEGORIES = ["FINANCIAL_PRODUCTS_SERVICES", "EMPLOYMENT", "HOUSING", "ISSUES_ELECTIONS_POLITICS", "ONLINE_GAMBLING_AND_GAMING"] as const;

export const BID_STRATEGIES = ["LOWEST_COST_WITHOUT_CAP", "COST_CAP", "LOWEST_COST_WITH_BID_CAP", "LOWEST_COST_WITH_MIN_ROAS"] as const;
export type BidStrategy = (typeof BID_STRATEGIES)[number];
export const needsBidAmount = (s: string | null | undefined) => s === "COST_CAP" || s === "LOWEST_COST_WITH_BID_CAP";

// ── Audience ─────────────────────────────────────────────────────────────────

export type GeoKind = "country" | "region" | "city" | "zip" | "geo_market";
export type GeoItem = { kind: GeoKind; key: string; name: string; detail?: string; radius?: number; distanceUnit?: "mile" | "kilometer" };
export type DetailedItem = { id: string; name: string; type: string; path?: string[]; size?: number };
export type AudienceRef = { id: string; name: string };

export type Audience = {
  locations: GeoItem[];
  excludedLocations: GeoItem[];
  ageMin: number;
  ageMax: number;
  genders: "all" | "men" | "women";
  detailed: DetailedItem[];
  detailedExcluded: DetailedItem[];
  customAudiences: AudienceRef[];
  excludedCustomAudiences: AudienceRef[];
  advantageAudience: boolean;
  /** Advantage detailed targeting: reach beyond the detailed targeting when it's likely to improve results. */
  advantageDetailed?: boolean;
};

// Positions Meta still accepts in v26. Gone: Facebook video_feeds (v24), Instagram explore (v26), and Messenger's
// inbox and stories (only stand-alone sponsored messages remain, which can't be combined with other placements).
export const FB_POSITIONS = ["feed", "profile_feed", "marketplace", "right_hand_column", "search", "instream_video", "notification", "story", "facebook_reels", "facebook_reels_overlay"] as const;
export const IG_POSITIONS = ["stream", "profile_feed", "explore_home", "ig_search", "story", "reels", "profile_reels"] as const;
export const AN_POSITIONS = ["classic", "rewarded_video"] as const;
/** Positions an ad set may still carry from before but that Meta now rejects in any create or update. */
export const REMOVED_POSITIONS = { facebook: ["video_feeds"], instagram: ["explore"], messenger: ["messenger_home", "story"] } as const;

export type Placements = {
  automatic: boolean;
  platforms: ("facebook" | "instagram" | "audience_network" | "messenger")[];
  facebook: string[];
  instagram: string[];
  audienceNetwork: string[];
  messenger: string[];
  devices: ("mobile" | "desktop")[];
};

// ── Loaded objects ───────────────────────────────────────────────────────────

export type Issue = { message: string; level?: string };

export type CampaignData = {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  objective: string | null;
  specialAdCategories: string[];
  budgetType: "daily" | "lifetime" | null;
  budget: number | null;
  budgetRemaining: number | null;
  bidStrategy: string | null;
  spendCap: number | null;
  startTime: string | null;
  stopTime: string | null;
  createdTime: string | null;
  issues: Issue[];
};

export type AdsetData = {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  campaignId: string;
  campaignName: string;
  objective: string | null;
  /** CBO: the campaign owns budget + bid strategy. */
  campaignBudget: boolean;
  budgetType: "daily" | "lifetime" | null;
  budget: number | null;
  bidStrategy: string | null;
  bidAmount: number | null;
  roasFloor: number | null;
  optimizationGoal: string | null;
  billingEvent: string | null;
  pixelId: string | null;
  conversionEvent: string | null;
  destinationType: string | null;
  attribution: string;
  startTime: string | null;
  endTime: string | null;
  learning: string | null;
  audience: Audience;
  placements: Placements;
  createdTime: string | null;
  issues: Issue[];
};

/** An existing ad's editable text and link. Each text list holds the ad's text options (Meta shows the best per person). */
export type AdCopy = {
  primaryTexts: string[];
  headlines: string[];
  description: string;
  url: string;
  displayLink: string;
  cta: string;
  urlTags: string;
};

export type AdData = {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  adsetId: string;
  adsetName: string;
  campaignId: string;
  creativeId: string | null;
  creativeName: string | null;
  thumbnailUrl: string | null;
  format: "image" | "video" | "flexible" | "placement" | "carousel" | "post" | "unknown";
  pageId: string | null;
  instagramUserId: string | null;
  copy: AdCopy;
  /** False for ads built from an existing post or a format we can't safely rebuild. */
  copyEditable: boolean;
  /** Text options this creative's format accepts, and whether their number is fixed (texts tied to placements). */
  maxTexts: number;
  fixedTexts: boolean;
  /** Clicks go to a website (not a chat, form, call or app), so URL, display link and call to action are editable. */
  website: boolean;
  /** Advantage+ creative enhancements currently switched on. */
  features: string[];
  review: string[];
  issues: Issue[];
  createdTime: string | null;
};

export type LoadResult<T> = { ok: true; data: T } | { ok: false; error: string };

export const DEFAULT_AUDIENCE: Audience = {
  locations: [{ kind: "country", key: "US", name: "United States" }],
  excludedLocations: [],
  ageMin: 18,
  ageMax: 65,
  genders: "all",
  detailed: [],
  detailedExcluded: [],
  customAudiences: [],
  excludedCustomAudiences: [],
  advantageAudience: false,
};

export const DEFAULT_PLACEMENTS: Placements = {
  automatic: true,
  platforms: ["facebook", "instagram"],
  facebook: ["feed", "profile_feed", "story", "facebook_reels", "marketplace", "search"],
  instagram: ["stream", "profile_feed", "story", "reels", "profile_reels"],
  audienceNetwork: [],
  messenger: [],
  devices: ["mobile", "desktop"],
};
