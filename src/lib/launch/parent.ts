import "server-only";
import { and, eq } from "drizzle-orm";
import { UserError } from "@/lib/action-result";
import { db } from "@/lib/db";
import { adsets, campaigns, type adAccounts } from "@/lib/db/schema";
import { graph } from "@/lib/meta/client";
import { BID_STRATEGIES, DEFAULT_PLACEMENTS, SPECIAL_AD_CATEGORIES, type BidStrategy } from "@/lib/meta/editor-types";
import { label, OBJECTIVE_LABELS, OPTIMIZATION_LABELS } from "@/lib/meta/labels";
import { audienceFromTargeting, placementsFromTargeting } from "@/lib/meta/targeting";
import { assertNotAwaitingApproval } from "@/lib/queries/ownership";
import { destinationFromAdset, goalsFor, LAUNCH_OBJECTIVES, type LaunchObjective } from "./objectives";
import { fromMinorUnits } from "./payloads";
import { CONVERSION_EVENTS, type AdsetInput, type ConversionEvent, type LaunchInput, type LaunchTarget } from "./spec";

type Obj = Record<string, unknown>;
type Account = typeof adAccounts.$inferSelect;

const CAMPAIGN_FIELDS = "id,name,objective,daily_budget,lifetime_budget,bid_strategy,special_ad_categories,special_ad_category_country,effective_status";
const ADSET_FIELDS = `id,name,campaign_id,effective_status,destination_type,promoted_object,optimization_goal,targeting,campaign{${CAMPAIGN_FIELDS}}`;

/** An existing campaign (and ad set) a launch adds to, read live from Meta and mapped to launch terms. */
export type LaunchParent = {
  campaign: LaunchInput["campaign"];
  campaignStatus: string;
  /** Campaign budget in major units (CBO), for display. */
  campaignBudget?: number;
  adset?: AdsetInput;
  adsetStatus?: string;
};

/** Ad set kinds the builder can't build ads for yet; adding to them stays in Meta Ads Manager. */
function unsupported(s: Obj): string | null {
  const goal = String(s.optimization_goal ?? "");
  const dt = String(s.destination_type ?? "");
  if (dt === "PHONE_CALL" || goal === "QUALITY_CALL") return "gets phone calls";
  if (["ON_PAGE", "ON_EVENT", "FACEBOOK", "INSTAGRAM_PROFILE", "SHOP_AUTOMATIC", "APPLINKS_AUTOMATIC", "FACEBOOK_LIVE", "FACEBOOK_PAGE"].includes(dt)) return `uses the ${dt.toLowerCase().replaceAll("_", " ")} conversion location`;
  if (["PAGE_LIKES", "EVENT_RESPONSES", "VISIT_INSTAGRAM_PROFILE", "PROFILE_VISIT", "APP_INSTALLS_AND_OFFSITE_CONVERSIONS"].includes(goal)) return `optimizes for ${label(OPTIMIZATION_LABELS, goal).toLowerCase()}`;
  return null;
}

function campaignFrom(c: Obj, currency: string, user?: LaunchInput["campaign"]): Pick<LaunchParent, "campaign" | "campaignBudget"> {
  const objective = String(c.objective ?? "");
  if (!(LAUNCH_OBJECTIVES as readonly string[]).includes(objective))
    throw new UserError(`“${String(c.name)}” uses the older ${label(OBJECTIVE_LABELS, objective)} objective. Add to it in Meta Ads Manager, or build a new campaign here.`);
  const daily = Number(c.daily_budget ?? 0);
  const lifetime = Number(c.lifetime_budget ?? 0);
  const cbo = daily > 0 || lifetime > 0;
  const liveBid = (BID_STRATEGIES as readonly string[]).includes(String(c.bid_strategy)) ? (c.bid_strategy as BidStrategy) : "LOWEST_COST_WITHOUT_CAP";
  return {
    campaignBudget: cbo ? fromMinorUnits(lifetime || daily, currency) : undefined,
    campaign: {
      name: String(c.name ?? ""),
      objective: objective as LaunchObjective,
      budgetLevel: cbo ? "campaign" : "adset",
      // With CBO the campaign decides; with ad set budgets each new ad set follows what the builder chose.
      budgetSchedule: cbo ? (lifetime > 0 ? "lifetime" : "daily") : (user?.budgetSchedule ?? "daily"),
      budget: undefined,
      bidStrategy: cbo ? liveBid : (user?.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP"),
      spendCap: undefined,
      // Budget sharing is a setting of the existing campaign; nothing to send for new ad sets.
      budgetSharing: false,
      specialAdCategories: (Array.isArray(c.special_ad_categories) ? (c.special_ad_categories as string[]) : []).filter((x): x is (typeof SPECIAL_AD_CATEGORIES)[number] =>
        (SPECIAL_AD_CATEGORIES as readonly string[]).includes(x),
      ),
      specialAdCountries: Array.isArray(c.special_ad_category_country) ? (c.special_ad_category_country as string[]) : [],
      // The schedule applies to the new ad sets.
      startTime: user?.startTime,
      endTime: user?.endTime,
    },
  };
}

function adsetFrom(s: Obj, objective: LaunchObjective): AdsetInput {
  const why = unsupported(s);
  if (why) throw new UserError(`“${String(s.name)}” ${why}, which the builder can't create ads for yet. Add ads to it in Meta Ads Manager.`);
  const promoted = (s.promoted_object ?? {}) as Obj;
  const dest = destinationFromAdset(s.destination_type as string | undefined, promoted, s.optimization_goal as string | undefined);
  const goal = String(s.optimization_goal ?? "");
  const known = goalsFor(objective, dest.kind, dest.apps);
  const event = String(promoted.custom_event_type ?? "");
  return {
    name: String(s.name ?? ""),
    destination: dest.kind,
    messagingApps: dest.apps,
    // Used only to describe the ad set; it already exists in Meta exactly as it is.
    optimizationGoal: (known.includes(goal) ? goal : known[0]) as AdsetInput["optimizationGoal"],
    pixelId: promoted.pixel_id ? String(promoted.pixel_id) : undefined,
    conversionEvent: (CONVERSION_EVENTS as readonly string[]).includes(event) ? (event as ConversionEvent) : undefined,
    app: dest.kind === "app" && dest.storeUrl && promoted.application_id ? { id: String(promoted.application_id), storeUrl: dest.storeUrl } : undefined,
    attribution: { clickDays: 7, viewDays: 1, engagedViewDays: 0 },
    audience: audienceFromTargeting(s.targeting),
    placements: placementsFromTargeting(s.targeting, DEFAULT_PLACEMENTS),
  };
}

/**
 * Loads the campaign (and ad set) a launch adds to. Only objects mirrored for this ad account qualify, so a
 * crafted request can't attach ads to something else the token can reach. `user` carries the builder's own
 * choices that still apply (schedule and, without a campaign budget, bid strategy and budget schedule).
 */
export async function loadLaunchParent(account: Account, target: Exclude<LaunchTarget, { mode: "new" }>, user?: LaunchInput["campaign"]): Promise<LaunchParent> {
  const [known] = await db()
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.id, target.campaignId), eq(campaigns.adAccountId, account.id)))
    .limit(1);
  if (!known) throw new UserError("That campaign isn't in this ad account (or hasn't synced yet). Refresh and try again.");
  // Adding to objects of a launch that isn't approved yet would change what the approver sees.
  await assertNotAwaitingApproval(target.mode === "adset" ? "adset" : "campaign", [target.mode === "adset" ? target.adsetId : target.campaignId]);

  if (target.mode === "campaign") {
    const c = await graph<Obj>(target.campaignId, { params: { fields: CAMPAIGN_FIELDS }, accountId: account.id });
    return { ...campaignFrom(c, account.currency, user), campaignStatus: String(c.effective_status ?? "") };
  }

  const [mirrored] = await db()
    .select({ id: adsets.id })
    .from(adsets)
    .where(and(eq(adsets.id, target.adsetId), eq(adsets.adAccountId, account.id), eq(adsets.campaignId, target.campaignId)))
    .limit(1);
  if (!mirrored) throw new UserError("That ad set isn't in this campaign (or hasn't synced yet). Refresh and try again.");
  const s = await graph<Obj>(target.adsetId, { params: { fields: ADSET_FIELDS }, accountId: account.id });
  const c = (s.campaign ?? {}) as Obj;
  const parent = campaignFrom(c, account.currency, user);
  return { ...parent, campaignStatus: String(c.effective_status ?? ""), adset: adsetFrom(s, parent.campaign.objective), adsetStatus: String(s.effective_status ?? "") };
}

/** The launch input with the parent's real settings in place of what the browser sent. */
export async function withLaunchParent(account: Account, input: LaunchInput): Promise<{ input: LaunchInput; parent?: LaunchParent }> {
  if (input.target.mode === "new") return { input };
  const parent = await loadLaunchParent(account, input.target, input.campaign);
  return { parent, input: { ...input, campaign: parent.campaign, adsets: parent.adset ? [parent.adset] : input.adsets } };
}
