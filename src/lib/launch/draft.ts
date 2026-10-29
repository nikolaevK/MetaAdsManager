/**
 * Campaign builder form state: defaults, template prefill, naming, and conversion to the launch input
 * the server validates. Pure and client-safe; the same state is autosaved as a draft.
 */
import { zonedLocalToIso } from "@/lib/dates";
import { DEFAULT_AUDIENCE, DEFAULT_PLACEMENTS, type Audience, type BidStrategy, type Placements } from "@/lib/meta/editor-types";
import { OBJECTIVE_LABELS, OPTIMIZATION_LABELS } from "@/lib/meta/labels";
import { countryName } from "@/lib/meta/targeting";
import { SQUARE_ASPECTS, VERTICAL_ASPECTS } from "@/app/(app)/library/pairing";
import { ageToken, renderName } from "./naming";
import { creativeGroups } from "./payloads";
import {
  APP_CTAS,
  goalsFor,
  needsWebsite,
  OBJECTIVE_DESTINATIONS,
  pixelUse,
  VIDEO_GOALS,
  type Destination,
  type LaunchObjective,
  type MessagingApp,
} from "./objectives";
import {
  isCreativeFeature,
  launchInputSchema,
  MAX_LAUNCH_CREATIVES,
  templatePlacements,
  validateLaunch,
  zodIssues,
  type CreativeFeature,
  type LaunchInput,
  type LaunchIssue,
  type MediaPick,
  type TemplateConfig,
} from "./spec";

export type Attribution = TemplateConfig["attribution"];

export type CampaignDraft = {
  name: string;
  nameEdited: boolean;
  objective: LaunchObjective;
  /** "campaign" = Advantage campaign budget (CBO), "adset" = ad set budgets (ABO). */
  budgetLevel: "campaign" | "adset";
  budgetSchedule: "daily" | "lifetime";
  budget: string;
  bidStrategy: BidStrategy;
  spendCap: string;
  specialAdCategories: string[];
  specialAdCountries: string;
  /** datetime-local values, wall-clock time in the ad account's timezone. */
  start: string;
  end: string;
};

export type AdsetDraft = {
  key: string;
  name: string;
  nameEdited: boolean;
  budget: string;
  destination: Destination;
  messagingApps: MessagingApp[];
  goal: string;
  pixelId: string;
  conversionEvent: string;
  appId: string;
  appStoreUrl: string;
  attribution: Attribution;
  bidAmount: string;
  roasFloor: string;
  audience: Audience;
  placements: Placements;
};

export type AdDraft = {
  key: string;
  name: string;
  nameEdited: boolean;
  /** "single": one file, or a feed + Stories & Reels pair. "flexible": up to 10 files Meta mixes per person. */
  format: "single" | "flexible";
  /**
   * Media slots: the feed file (1:1 / 4:5) and the Stories & Reels file (9:16). One file alone runs everywhere.
   * The server turns them into a library creative when the launch is created.
   */
  feedAssetId: string;
  verticalAssetId: string;
  /** Flexible-format files, in order. Kept apart from the slots so switching format loses nothing. */
  files: string[];
  primaryTexts: string[];
  headlines: string[];
  description: string;
  url: string;
  displayLink: string;
  urlTags: string;
  cta: string;
  /** Advantage+ creative enhancements switched on. */
  features: CreativeFeature[];
};

export type BuilderState = {
  v: 1;
  step: number;
  templateId: string;
  label: string;
  pageId: string;
  igId: string;
  campaign: CampaignDraft;
  adsets: AdsetDraft[];
  ads: AdDraft[];
};

export const STEPS = [
  { id: "campaign", label: "Campaign" },
  { id: "adsets", label: "Ad sets" },
  { id: "ads", label: "Ads" },
  { id: "review", label: "Review" },
] as const;

export const MAX_TEXTS = 5;
export const MAX_ADSETS = 20;
export const MAX_ADS = 50;

export const newKey = () => crypto.randomUUID();
export const positiveNumber = (v: string) => (v.trim() && Number(v) > 0 ? Number(v) : undefined);
export const titleCase = (s: string) => s.toLowerCase().replace(/(^|_)([a-z])/g, (_, sep: string, c: string) => (sep ? " " : "") + c.toUpperCase());

const defaultEvent = (objective: LaunchObjective) => (objective === "OUTCOME_LEADS" ? "LEAD" : "PURCHASE");

export function blankAdset(objective: LaunchObjective, template?: TemplateConfig): AdsetDraft {
  const destination = OBJECTIVE_DESTINATIONS[objective][0];
  return {
    key: newKey(),
    name: "",
    nameEdited: false,
    budget: String(template?.defaultBudget ?? 50),
    destination,
    messagingApps: ["WHATSAPP"],
    goal: goalsFor(objective, destination, ["WHATSAPP"])[0],
    pixelId: template?.pixelId ?? "",
    conversionEvent: template?.conversionEvent ?? defaultEvent(objective),
    appId: "",
    appStoreUrl: "",
    attribution: template?.attribution ?? { clickDays: 7, viewDays: 1, engagedViewDays: 0 },
    bidAmount: "",
    roasFloor: "",
    audience: template ? templateAudience(template) : DEFAULT_AUDIENCE,
    placements: template ? templatePlacements(template) : DEFAULT_PLACEMENTS,
  };
}

function templateAudience(c: TemplateConfig): Audience {
  return {
    ...DEFAULT_AUDIENCE,
    locations: c.countries.map((cc) => ({ kind: "country", key: cc, name: countryName(cc) })),
    ageMin: c.ageMin,
    ageMax: c.ageMax,
    excludedCustomAudiences: c.exclusionAudiences,
    advantageAudience: c.advantageAudience,
  };
}

export function blankAd(from?: AdDraft, template?: TemplateConfig): AdDraft {
  return {
    key: newKey(),
    name: "",
    nameEdited: false,
    format: "single",
    feedAssetId: "",
    verticalAssetId: "",
    files: [],
    primaryTexts: from ? [...from.primaryTexts] : [""],
    headlines: from ? [...from.headlines] : [""],
    description: from?.description ?? "",
    url: from?.url ?? "",
    displayLink: from?.displayLink ?? "",
    urlTags: from?.urlTags ?? "",
    cta: from?.cta ?? template?.cta ?? "SHOP_NOW",
    features: from ? [...from.features] : [...(template?.creativeFeaturesOptIn ?? [])],
  };
}

export function blankState(ctx: { pageId: string; igId: string; urlTags: string; template?: { id: string; config: TemplateConfig } }): BuilderState {
  const t = ctx.template?.config;
  const objective = t?.objective ?? "OUTCOME_SALES";
  return {
    v: 1,
    step: 0,
    templateId: ctx.template?.id ?? "",
    label: "",
    pageId: ctx.pageId,
    igId: ctx.igId,
    campaign: {
      name: "",
      nameEdited: false,
      objective,
      budgetLevel: t?.budgetLevel ?? "campaign",
      budgetSchedule: t?.budgetSchedule ?? "daily",
      budget: String(t?.defaultBudget ?? 100),
      bidStrategy: "LOWEST_COST_WITHOUT_CAP",
      spendCap: "",
      specialAdCategories: [],
      specialAdCountries: "US",
      start: "",
      end: "",
    },
    adsets: [blankAdset(objective, t)],
    ads: [{ ...blankAd(undefined, t), urlTags: ctx.urlTags }],
  };
}

/** Prefills campaign, ad set and ad settings from a launch template. Names, media and copy are kept. */
export function applyTemplate(state: BuilderState, template: { id: string; config: TemplateConfig }): BuilderState {
  const t = template.config;
  const budget = String(t.defaultBudget);
  // A ROAS goal only exists for Sales; don't leave it selected (and hidden) after switching objective.
  const bidStrategy = t.objective !== "OUTCOME_SALES" && state.campaign.bidStrategy === "LOWEST_COST_WITH_MIN_ROAS" ? "LOWEST_COST_WITHOUT_CAP" : state.campaign.bidStrategy;
  return {
    ...state,
    templateId: template.id,
    campaign: { ...state.campaign, objective: t.objective, budgetLevel: t.budgetLevel, budgetSchedule: t.budgetSchedule, budget, bidStrategy },
    adsets: state.adsets.map((s) => {
      const fresh = blankAdset(t.objective, t);
      return { ...fresh, key: s.key, name: s.name, nameEdited: s.nameEdited, audience: { ...s.audience, ...templateAudience(t), detailed: s.audience.detailed } };
    }),
    ads: state.ads.map((a) => ({ ...a, cta: t.cta, features: [...t.creativeFeaturesOptIn] })),
  };
}

/** Reads a saved draft defensively: fields added since it was saved fall back to defaults. */
export function hydrate(raw: unknown, fallback: BuilderState): BuilderState {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<BuilderState>;
  const adsets = Array.isArray(s.adsets) && s.adsets.length ? s.adsets : fallback.adsets;
  const ads = Array.isArray(s.ads) && s.ads.length ? s.ads : fallback.ads;
  const objective = s.campaign?.objective ?? fallback.campaign.objective;
  return {
    ...fallback,
    ...s,
    v: 1,
    campaign: { ...fallback.campaign, ...s.campaign },
    adsets: adsets.map((x) => ({ ...blankAdset(objective), ...x, key: x.key || newKey() })),
    ads: ads.map((x) => ({ ...blankAd(), ...x, key: x.key || newKey() })),
  };
}

/** Destination and goal valid for the campaign objective (the stored values may predate an objective change). */
export function resolveAdset(objective: LaunchObjective, s: AdsetDraft) {
  const destinations = OBJECTIVE_DESTINATIONS[objective];
  const destination = destinations.includes(s.destination) ? s.destination : destinations[0];
  const goals = goalsFor(objective, destination, s.messagingApps);
  const goal = goals.includes(s.goal) ? s.goal : goals[0];
  return { destinations, destination, goals, goal, pixel: pixelUse(objective, destination, goal, s.messagingApps) };
}

// ── Naming ───────────────────────────────────────────────────────────────────

export type NamingContext = {
  client: string;
  account: string;
  template?: string;
  dateToken: string;
  patterns: { campaignPattern: string; adsetPattern: string; adPattern: string };
  /** Name / angle / kind for an ad's media (from a matching library creative, else the file). */
  creative: (media: MediaPick) => { name: string; angle: string | null; kind: "image" | "video" } | undefined;
};

/** An ad's media as the pick the server resolves: one file alone, feed + Stories & Reels, or Flexible files. */
export function mediaPick(a: Pick<AdDraft, "feedAssetId" | "verticalAssetId"> & Partial<Pick<AdDraft, "format" | "files">>): MediaPick | undefined {
  if (a.format === "flexible") {
    const [first, ...more] = a.files ?? [];
    if (!first) return undefined;
    return more.length ? { feedAssetId: first, moreAssetIds: more } : { feedAssetId: first };
  }
  const primary = a.feedAssetId || a.verticalAssetId;
  if (!primary) return undefined;
  return a.feedAssetId && a.verticalAssetId && a.verticalAssetId !== a.feedAssetId ? { feedAssetId: a.feedAssetId, verticalAssetId: a.verticalAssetId } : { feedAssetId: primary };
}

export function computeNames(state: BuilderState, ctx: NamingContext) {
  const c = state.campaign;
  const first = state.adsets[0];
  const firstResolved = first ? resolveAdset(c.objective, first) : undefined;
  const common = {
    client: ctx.client,
    account: ctx.account,
    template: ctx.template,
    objective: OBJECTIVE_LABELS[c.objective],
    event: firstResolved
      ? firstResolved.pixel !== "none" && first.conversionEvent
        ? titleCase(first.conversionEvent)
        : (OPTIMIZATION_LABELS[firstResolved.goal] ?? titleCase(firstResolved.goal))
      : undefined,
    budget: c.budgetLevel === "campaign" ? "CBO" : "ABO",
    label: state.label.trim(),
    date: ctx.dateToken,
  };
  const campaign = c.nameEdited ? c.name : renderName(ctx.patterns.campaignPattern, common);
  const adsets = state.adsets.map((s, j) =>
    s.nameEdited
      ? s.name
      : renderName(ctx.patterns.adsetPattern, {
          ...common,
          geo: s.audience.locations.map((l) => (l.kind === "country" ? l.key : l.name)).join("+"),
          age: ageToken(s.audience.ageMin, s.audience.ageMax),
          audience: s.audience.advantageAudience ? "Adv+" : s.audience.customAudiences.length ? "Custom" : s.audience.detailed.length ? "Detailed" : "Broad",
          index: j + 1,
        }),
  );
  const ads = state.ads.map((a, i) => {
    if (a.nameEdited) return a.name;
    const pick = mediaPick(a);
    const cr = pick ? ctx.creative(pick) : undefined;
    return renderName(ctx.patterns.adPattern, {
      ...common,
      creative: cr?.name,
      angle: cr?.angle ?? "",
      format: cr ? (cr.kind === "image" ? "IMG" : "VID") : "",
      index: i + 1,
    });
  });
  return { campaign, adsets, ads };
}

// ── Submit ───────────────────────────────────────────────────────────────────

const toIso = (local: string, timeZone: string) => {
  if (!local) return undefined;
  try {
    return zonedLocalToIso(local, timeZone);
  } catch {
    // e.g. a 5-digit year typed into datetime-local: let validation report it instead of crashing the builder.
    return local;
  }
};
const optional = (v: string) => (v.trim() ? v.trim() : undefined);

/** Builder state → the launch input posted to the server (validated there with the same schema). */
export function toLaunchInput(
  state: BuilderState,
  names: ReturnType<typeof computeNames>,
  ctx: { idempotencyKey: string; draftId?: string; clientId: string; adAccountId: string; timeZone: string },
) {
  const c = state.campaign;
  const cbo = c.budgetLevel === "campaign";
  const app = c.objective === "OUTCOME_APP_PROMOTION";
  return {
    idempotencyKey: ctx.idempotencyKey,
    draftId: ctx.draftId,
    clientId: ctx.clientId,
    adAccountId: ctx.adAccountId,
    templateId: state.templateId || undefined,
    pageId: state.pageId,
    instagramUserId: state.igId || undefined,
    campaign: {
      name: names.campaign,
      objective: c.objective,
      budgetLevel: c.budgetLevel,
      budgetSchedule: c.budgetSchedule,
      budget: cbo ? positiveNumber(c.budget) : undefined,
      bidStrategy: c.bidStrategy,
      spendCap: positiveNumber(c.spendCap),
      specialAdCategories: c.specialAdCategories,
      specialAdCountries: c.specialAdCategories.length ? [...new Set(c.specialAdCountries.toUpperCase().split(/[\s,;]+/).filter((x) => /^[A-Z]{2}$/.test(x)))] : [],
      startTime: toIso(c.start, ctx.timeZone),
      endTime: toIso(c.end, ctx.timeZone),
    },
    adsets: state.adsets.map((s, j) => {
      const r = resolveAdset(c.objective, s);
      return {
        name: names.adsets[j],
        budget: cbo ? undefined : positiveNumber(s.budget),
        destination: r.destination,
        messagingApps: r.destination === "messaging" ? s.messagingApps : [],
        optimizationGoal: r.goal,
        pixelId: r.pixel !== "none" ? optional(s.pixelId) : undefined,
        conversionEvent: r.pixel !== "none" && s.pixelId ? optional(s.conversionEvent) : undefined,
        app: r.destination === "app" && s.appId ? { id: s.appId, storeUrl: s.appStoreUrl } : undefined,
        attribution: s.attribution,
        bidAmount: positiveNumber(s.bidAmount),
        roasFloor: positiveNumber(s.roasFloor),
        audience: s.audience,
        placements: s.placements,
      };
    }),
    ads: state.ads.map((a, i) => ({
      name: names.ads[i],
      media: mediaPick(a) as MediaPick,
      primaryTexts: a.primaryTexts.map((t) => t.trim()).filter(Boolean),
      headlines: a.headlines.map((t) => t.trim()).filter(Boolean),
      description: optional(a.description),
      url: optional(a.url),
      displayLink: optional(a.displayLink),
      urlTags: a.urlTags.trim(),
      cta: app && !(APP_CTAS as readonly string[]).includes(a.cta) ? "INSTALL_MOBILE_APP" : a.cta,
      creativeFeaturesOptIn: a.features.filter(isCreativeFeature),
    })),
  };
}

export type AssetInfo = { kind: "image" | "video"; aspect: string };

/** Everything that blocks publishing, grouped by step. Mirrors the server's checks. */
export function launchIssues(input: ReturnType<typeof toLaunchInput>, asset: (id: string) => AssetInfo | undefined = () => undefined): { data?: LaunchInput; issues: LaunchIssue[] } {
  const issues: LaunchIssue[] = [];
  if (!input.pageId) issues.push({ step: "campaign", where: "Campaign", message: "Choose the Facebook Page the ads run as." });
  const videoGoal = input.adsets.some((s) => VIDEO_GOALS.has(s.optimizationGoal));
  const website = input.adsets.some((s) => needsWebsite(s.destination));
  input.ads.forEach((a, i) => {
    const where = `Ad ${i + 1}`;
    if (website && !a.url) issues.push({ step: "ads", where, message: "Enter the website URL." });
    if (!a.media) issues.push({ step: "ads", where, message: "Add an image or video." });
    else {
      const feed = asset(a.media.feedAssetId);
      const vertical = a.media.verticalAssetId ? asset(a.media.verticalAssetId) : undefined;
      if (feed && vertical) {
        if (feed.kind !== vertical.kind) issues.push({ step: "ads", where, message: "Use two images or two videos, not one of each." });
        else if (!SQUARE_ASPECTS.has(feed.aspect)) issues.push({ step: "ads", where, message: "The feed file must be 1:1 or 4:5. Crop it, or remove the Stories & Reels file." });
        else if (!VERTICAL_ASPECTS.has(vertical.aspect)) issues.push({ step: "ads", where, message: "The Stories & Reels file must be 9:16." });
      }
      if (videoGoal && feed?.kind === "image") issues.push({ step: "ads", where, message: "An ad set optimizes for video views, so this ad needs a video." });
    }
    if (!a.primaryTexts.length) issues.push({ step: "ads", where: `Ad ${i + 1}`, message: "Add a primary text." });
    if (!a.headlines.length) issues.push({ step: "ads", where: `Ad ${i + 1}`, message: "Add a headline." });
  });
  const parsed = launchInputSchema.safeParse(input);
  if (!parsed.success) {
    // The checks above already explain empty fields more plainly than zod would.
    const known = new Set(issues.map((x) => x.where));
    const extra = zodIssues(parsed.error, 20).filter((z) => !(known.has(z.where) && /^(media|primaryTexts|headlines)\b/.test(z.message)) && !(z.message.startsWith("pageId") && !input.pageId));
    return { issues: [...issues, ...extra] };
  }
  const more = validateLaunch(parsed.data);
  if (parsed.data.ads.length * creativeGroups(parsed.data, DEFAULT_PLACEMENTS).count > MAX_LAUNCH_CREATIVES)
    more.push({ step: "ads", where: "Ads", message: `This would create more than ${MAX_LAUNCH_CREATIVES} creatives. Use fewer ads, or fewer ad sets with different destinations or placements.` });
  // The early checks above can repeat what validateLaunch says (e.g. a missing URL).
  const seen = new Set(issues.map((x) => `${x.where}|${x.message}`));
  return { data: parsed.data, issues: [...issues, ...more.filter((x) => !seen.has(`${x.where}|${x.message}`))] };
}
