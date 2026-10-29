import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer("created_at")
    .notNull()
    .$defaultFn(() => Date.now());
const updatedAt = () =>
  integer("updated_at")
    .notNull()
    .$defaultFn(() => Date.now())
    .$onUpdateFn(() => Date.now());

// ── Auth ──────────────────────────────────────────────────────────────────────

export const ROLES = ["admin", "buyer", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ROLES }).notNull().default("buyer"),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 of the cookie token; the raw token is never stored. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: createdAt(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const loginAttempts = sqliteTable("login_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  firstAt: integer("first_at").notNull(),
  lockedUntil: integer("locked_until"),
});

/** Per-user UI preferences (column sets, overview tiles), so a layout follows the user across devices. */
export const userSettings = sqliteTable(
  "user_settings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value", { mode: "json" }).$type<unknown>().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

// ── Business structure ────────────────────────────────────────────────────────

export const clients = sqliteTable("clients", {
  id: id(),
  name: text("name").notNull(),
  notes: text("notes"),
  namingConventionId: text("naming_convention_id").references(() => namingConventions.id, { onDelete: "set null" }),
  utmRuleId: text("utm_rule_id").references(() => utmRules.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const adAccounts = sqliteTable(
  "ad_accounts",
  {
    /** Meta id including the act_ prefix. */
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    currency: text("currency").notNull().default("USD"),
    timezoneName: text("timezone_name").notNull().default("America/Los_Angeles"),
    accountStatus: integer("account_status"),
    businessId: text("business_id"),
    defaultPageId: text("default_page_id"),
    defaultInstagramUserId: text("default_instagram_user_id"),
    lastStructureSyncAt: integer("last_structure_sync_at"),
    lastInsightsSyncAt: integer("last_insights_sync_at"),
    lastFullInsightsSyncAt: integer("last_full_insights_sync_at"),
    lastReviewSyncAt: integer("last_review_sync_at"),
    insightsBackfilledAt: integer("insights_backfilled_at"),
    createdAt: createdAt(),
  },
  (t) => [index("ad_accounts_client_idx").on(t.clientId)],
);

/** Accounts an admin disconnected (or whose client was deleted): auto-discovery must not re-import them. */
export const ignoredAdAccounts = sqliteTable("ignored_ad_accounts", {
  /** Meta id including the act_ prefix. */
  id: text("id").primaryKey(),
  ignoredBy: text("ignored_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const namingConventions = sqliteTable("naming_conventions", {
  id: id(),
  name: text("name").notNull(),
  campaignPattern: text("campaign_pattern").notNull(),
  adsetPattern: text("adset_pattern").notNull(),
  adPattern: text("ad_pattern").notNull(),
  createdAt: createdAt(),
});

export type UtmParam = { key: string; value: string };

export const utmRules = sqliteTable("utm_rules", {
  id: id(),
  name: text("name").notNull(),
  params: text("params", { mode: "json" }).$type<UtmParam[]>().notNull(),
  createdAt: createdAt(),
});

export const launchTemplates = sqliteTable("launch_templates", {
  id: id(),
  name: text("name").notNull(),
  /** Null = available to every client. */
  clientId: text("client_id").references(() => clients.id, { onDelete: "cascade" }),
  /** TemplateConfig, validated by src/lib/launch/spec.ts. */
  config: text("config", { mode: "json" }).$type<unknown>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── Creative library ─────────────────────────────────────────────────────────

export const ASSET_KINDS = ["image", "video"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const creativeAssets = sqliteTable(
  "creative_assets",
  {
    id: id(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ASSET_KINDS }).notNull(),
    fileName: text("file_name").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    /** "1:1" | "9:16" | "4:5" | "16:9" | "other" */
    aspect: text("aspect").notNull(),
    sha256: text("sha256").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("assets_client_idx").on(t.clientId), uniqueIndex("assets_client_sha_idx").on(t.clientId, t.sha256)],
);

/** A creative = the 1:1 feed asset + 9:16 story/reels asset that run together in one ad. */
export const creatives = sqliteTable(
  "creatives",
  {
    id: id(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ASSET_KINDS }).notNull(),
    squareAssetId: text("square_asset_id")
      .notNull()
      .references(() => creativeAssets.id, { onDelete: "restrict" }),
    verticalAssetId: text("vertical_asset_id")
      .notNull()
      .references(() => creativeAssets.id, { onDelete: "restrict" }),
    angle: text("angle"),
    createdAt: createdAt(),
    archivedAt: integer("archived_at"),
  },
  (t) => [index("creatives_client_idx").on(t.clientId)],
);

/** Per ad-account upload cache: image hashes and video ids are scoped to an ad account. */
export const metaMedia = sqliteTable(
  "meta_media",
  {
    id: id(),
    assetId: text("asset_id")
      .notNull()
      .references(() => creativeAssets.id, { onDelete: "cascade" }),
    adAccountId: text("ad_account_id")
      .notNull()
      .references(() => adAccounts.id, { onDelete: "cascade" }),
    imageHash: text("image_hash"),
    imageUrl: text("image_url"),
    videoId: text("video_id"),
    /** "uploading" | "processing" | "ready" | "error" */
    videoStatus: text("video_status"),
    thumbnailUrl: text("thumbnail_url"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("meta_media_asset_account_idx").on(t.assetId, t.adAccountId)],
);

// ── Mirrored Meta structure (synced; dashboards read only from here) ──────────

export const campaigns = sqliteTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    adAccountId: text("ad_account_id")
      .notNull()
      .references(() => adAccounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status").notNull(),
    effectiveStatus: text("effective_status").notNull(),
    objective: text("objective"),
    /** Minor currency units, as Meta returns them. */
    dailyBudget: integer("daily_budget"),
    lifetimeBudget: integer("lifetime_budget"),
    bidStrategy: text("bid_strategy"),
    startTime: text("start_time"),
    stopTime: text("stop_time"),
    createdTime: text("created_time"),
    updatedTime: text("updated_time"),
    syncedAt: integer("synced_at").notNull(),
  },
  (t) => [index("campaigns_account_idx").on(t.adAccountId)],
);

export const adsets = sqliteTable(
  "adsets",
  {
    id: text("id").primaryKey(),
    adAccountId: text("ad_account_id")
      .notNull()
      .references(() => adAccounts.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    effectiveStatus: text("effective_status").notNull(),
    dailyBudget: integer("daily_budget"),
    lifetimeBudget: integer("lifetime_budget"),
    optimizationGoal: text("optimization_goal"),
    billingEvent: text("billing_event"),
    promotedObject: text("promoted_object", { mode: "json" }).$type<Record<string, unknown> | null>(),
    startTime: text("start_time"),
    endTime: text("end_time"),
    createdTime: text("created_time"),
    updatedTime: text("updated_time"),
    syncedAt: integer("synced_at").notNull(),
  },
  (t) => [index("adsets_account_idx").on(t.adAccountId), index("adsets_campaign_idx").on(t.campaignId)],
);

export type ReviewFeedback = Record<string, Record<string, string>> | null;
export type IssueInfo = { error_code?: number; error_message?: string; error_summary?: string; level?: string }[] | null;

export const ads = sqliteTable(
  "ads",
  {
    id: text("id").primaryKey(),
    adAccountId: text("ad_account_id")
      .notNull()
      .references(() => adAccounts.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id").notNull(),
    adsetId: text("adset_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    effectiveStatus: text("effective_status").notNull(),
    creativeId: text("creative_id"),
    thumbnailUrl: text("thumbnail_url"),
    reviewFeedback: text("review_feedback", { mode: "json" }).$type<ReviewFeedback>(),
    issuesInfo: text("issues_info", { mode: "json" }).$type<IssueInfo>(),
    createdTime: text("created_time"),
    updatedTime: text("updated_time"),
    syncedAt: integer("synced_at").notNull(),
  },
  (t) => [
    index("ads_account_idx").on(t.adAccountId),
    index("ads_adset_idx").on(t.adsetId),
    index("ads_campaign_idx").on(t.campaignId),
    index("ads_status_idx").on(t.adAccountId, t.effectiveStatus),
  ],
);

/** One row per ad per day (account timezone). Higher levels aggregate with SUM. */
export const insightsDaily = sqliteTable(
  "insights_daily",
  {
    adId: text("ad_id").notNull(),
    date: text("date").notNull(),
    adAccountId: text("ad_account_id").notNull(),
    campaignId: text("campaign_id").notNull(),
    adsetId: text("adset_id").notNull(),
    spend: real("spend").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    linkClicks: integer("link_clicks").notNull().default(0),
    results: real("results").notNull().default(0),
    resultType: text("result_type"),
    purchases: real("purchases").notNull().default(0),
    purchaseValue: real("purchase_value").notNull().default(0),
    leads: real("leads").notNull().default(0),
    actions: text("actions", { mode: "json" }).$type<Record<string, number>>(),
    syncedAt: integer("synced_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.adId, t.date] }),
    index("insights_account_date_idx").on(t.adAccountId, t.date),
    index("insights_campaign_date_idx").on(t.campaignId, t.date),
    index("insights_adset_date_idx").on(t.adsetId, t.date),
  ],
);

export const reviewEvents = sqliteTable(
  "review_events",
  {
    id: id(),
    adId: text("ad_id").notNull(),
    adAccountId: text("ad_account_id").notNull(),
    adName: text("ad_name").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    feedback: text("feedback", { mode: "json" }).$type<ReviewFeedback>(),
    issues: text("issues", { mode: "json" }).$type<IssueInfo>(),
    createdAt: createdAt(),
    acknowledgedAt: integer("acknowledged_at"),
    acknowledgedBy: text("acknowledged_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("review_events_account_idx").on(t.adAccountId, t.acknowledgedAt),
    // One open item per ad + outcome; concurrent syncs that see the same change collapse into it.
    uniqueIndex("review_events_open_idx")
      .on(t.adId, t.toStatus)
      .where(sql`${t.acknowledgedAt} is null`),
  ],
);

// ── Launch pipeline ──────────────────────────────────────────────────────────

export const LAUNCH_STATUSES = [
  "queued",
  "building",
  "ready_for_review",
  "activating",
  "active",
  "activation_failed",
  "rolling_back",
  "failed",
  "discarded",
] as const;
export type LaunchStatus = (typeof LAUNCH_STATUSES)[number];

export const launches = sqliteTable(
  "launches",
  {
    id: id(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    adAccountId: text("ad_account_id")
      .notNull()
      .references(() => adAccounts.id, { onDelete: "cascade" }),
    templateId: text("template_id").references(() => launchTemplates.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    status: text("status", { enum: LAUNCH_STATUSES }).notNull().default("queued"),
    step: text("step"),
    /** LaunchSpec snapshot; template edits never change an in-flight launch. */
    spec: text("spec", { mode: "json" }).$type<unknown>().notNull(),
    error: text("error"),
    metaCampaignId: text("meta_campaign_id"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: text("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: integer("approved_at"),
    activatedAt: integer("activated_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("launches_account_idx").on(t.adAccountId, t.createdAt)],
);

export const LAUNCH_OBJECT_KINDS = ["creative", "campaign", "adset", "ad"] as const;
export type LaunchObjectKind = (typeof LAUNCH_OBJECT_KINDS)[number];

/** Ledger of every Meta object a launch creates: drives idempotent retries and rollback. */
export const launchObjects = sqliteTable(
  "launch_objects",
  {
    id: id(),
    launchId: text("launch_id")
      .notNull()
      .references(() => launches.id, { onDelete: "cascade" }),
    /** Stable within a launch: "campaign", "adset:0", "creative:2", "ad:0:2". */
    ref: text("ref").notNull(),
    kind: text("kind", { enum: LAUNCH_OBJECT_KINDS }).notNull(),
    name: text("name").notNull(),
    metaId: text("meta_id"),
    /** "pending" (request may be in flight) | "created" | "deleted" */
    status: text("status").notNull().default("pending"),
    /** Exact payload sent to Meta (creative spec is reused for previews). */
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("launch_objects_ref_idx").on(t.launchId, t.ref)],
);

/** Campaign builder state, autosaved while someone builds a launch so nothing is lost on reload or navigation. */
export const launchDrafts = sqliteTable(
  "launch_drafts",
  {
    id: id(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    adAccountId: text("ad_account_id")
      .notNull()
      .references(() => adAccounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Builder form state (src/lib/launch/draft.ts), stored as-is. */
    state: text("state", { mode: "json" }).$type<unknown>().notNull(),
    /** Latest launch submitted from this draft; null while it's still being built. */
    launchId: text("launch_id").references(() => launches.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("launch_drafts_client_idx").on(t.clientId, t.updatedAt), index("launch_drafts_launch_idx").on(t.launchId)],
);

// ── Infrastructure ───────────────────────────────────────────────────────────

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed"] as const;

export const jobs = sqliteTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("queued"),
    priority: integer("priority").notNull().default(5),
    runAt: integer("run_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(6),
    lastError: text("last_error"),
    lockedAt: integer("locked_at"),
    lockedBy: text("locked_by"),
    dedupeKey: text("dedupe_key"),
    adAccountId: text("ad_account_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: integer("finished_at"),
  },
  (t) => [
    index("jobs_ready_idx").on(t.status, t.runAt, t.priority),
    // Only one queued/running job per dedupe key; finished jobs don't block new ones.
    uniqueIndex("jobs_dedupe_active_idx")
      .on(t.dedupeKey)
      .where(sql`${t.status} in ('queued', 'running') and ${t.dedupeKey} is not null`),
  ],
);

export const rateLimitState = sqliteTable("rate_limit_state", {
  /** "app" | "account:act_123" */
  key: text("key").primaryKey(),
  usagePct: real("usage_pct").notNull().default(0),
  blockedUntil: integer("blocked_until"),
  raw: text("raw"),
  updatedAt: integer("updated_at").notNull(),
});

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: id(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    details: text("details", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);
