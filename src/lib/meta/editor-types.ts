/** Client-safe shapes exchanged between the editor sheet and its server actions. Money is in major units. */

export type Level = "campaign" | "adset" | "ad";

export type EditorTarget =
  | { mode: "edit"; level: Level; id: string; name: string; tab?: "settings" | "performance" }
  | { mode: "create"; level: Level; parentId?: string; parentHint?: ParentOptions["campaigns"][number] };

export type ParentOptions = {
  campaigns: { id: string; name: string; objective: string | null; hasBudget: boolean; bidStrategy: string | null }[];
  adsets: { id: string; name: string; campaignId: string }[];
};

export const CREATE_OBJECTIVES = ["OUTCOME_SALES", "OUTCOME_LEADS", "OUTCOME_TRAFFIC", "OUTCOME_AWARENESS"] as const;
export type CreateObjective = (typeof CREATE_OBJECTIVES)[number];

export const SPECIAL_AD_CATEGORIES = ["CREDIT", "EMPLOYMENT", "HOUSING", "ISSUES_ELECTIONS_POLITICS", "FINANCIAL_PRODUCTS_SERVICES"] as const;

export const BID_STRATEGIES = ["LOWEST_COST_WITHOUT_CAP", "COST_CAP", "LOWEST_COST_WITH_BID_CAP", "LOWEST_COST_WITH_MIN_ROAS"] as const;
export type BidStrategy = (typeof BID_STRATEGIES)[number];
export const needsBidAmount = (s: string | null | undefined) => s === "COST_CAP" || s === "LOWEST_COST_WITH_BID_CAP";

/** Optimization goals the create form offers per objective (first = default). */
export const OPTIMIZATION_BY_OBJECTIVE: Record<CreateObjective, string[]> = {
  OUTCOME_SALES: ["OFFSITE_CONVERSIONS", "VALUE", "LANDING_PAGE_VIEWS", "LINK_CLICKS"],
  OUTCOME_LEADS: ["OFFSITE_CONVERSIONS", "LANDING_PAGE_VIEWS", "LINK_CLICKS"],
  OUTCOME_TRAFFIC: ["LANDING_PAGE_VIEWS", "LINK_CLICKS", "REACH", "IMPRESSIONS"],
  OUTCOME_AWARENESS: ["REACH", "IMPRESSIONS", "AD_RECALL_LIFT", "THRUPLAY"],
};
export const usesPixel = (goal: string) => goal === "OFFSITE_CONVERSIONS" || goal === "VALUE";

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
};

export const FB_POSITIONS = ["feed", "profile_feed", "marketplace", "video_feeds", "right_hand_column", "search", "instream_video", "story", "facebook_reels", "facebook_reels_overlay"] as const;
export const IG_POSITIONS = ["stream", "profile_feed", "explore", "explore_home", "ig_search", "story", "reels"] as const;
export const AN_POSITIONS = ["classic", "rewarded_video"] as const;
export const MESSENGER_POSITIONS = ["messenger_home", "story"] as const;

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

export type AdCopy = { primaryText: string; headline: string; description: string; url: string; cta: string; urlTags: string };

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
  format: "image" | "video" | "flexible" | "post" | "unknown";
  pageId: string | null;
  instagramUserId: string | null;
  copy: AdCopy;
  /** False for ads built from an existing post or a format we can't safely rebuild. */
  copyEditable: boolean;
  review: string[];
  issues: Issue[];
  createdTime: string | null;
};

export type LoadResult<T> = { ok: true; data: T } | { ok: false; error: string };

// ── Create inputs ────────────────────────────────────────────────────────────

export type AdsetInput = {
  campaignId: string;
  name: string;
  optimizationGoal: string;
  pixelId?: string;
  conversionEvent?: string;
  budgetType: "daily" | "lifetime";
  budget?: number;
  bidStrategy: BidStrategy;
  bidAmount?: number;
  roasFloor?: number;
  startTime?: string;
  endTime?: string;
  attribution: "7d_click_1d_view" | "7d_click" | "1d_click" | "1d_click_1d_view";
  audience: Audience;
  placements: Placements;
};

export type AdInput = {
  adsetId: string;
  name: string;
  pageId: string;
  instagramUserId?: string;
  libraryCreativeId: string;
  copy: AdCopy;
};

export type LibraryAsset = { id: string; kind: "image" | "video"; fileName: string; width: number | null; height: number | null; aspect: string };

export type LibraryCreative = { id: string; name: string; kind: "image" | "video"; single: boolean; assetId: string; verticalAssetId: string };

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
  facebook: ["feed", "profile_feed", "video_feeds", "story", "facebook_reels", "marketplace", "search"],
  instagram: ["stream", "profile_feed", "explore", "explore_home", "story", "reels"],
  audienceNetwork: [],
  messenger: [],
  devices: ["mobile", "desktop"],
};
