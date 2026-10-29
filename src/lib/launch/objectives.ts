/**
 * Which conversion locations ("destinations") and performance goals each campaign objective allows
 * in the builder, and how they map to ad set fields. Pure, client + server safe.
 * Source: Marketing API ad set destination_type + Outcome-Driven Ads mapping table.
 */

export const LAUNCH_OBJECTIVES = [
  "OUTCOME_AWARENESS",
  "OUTCOME_TRAFFIC",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_LEADS",
  "OUTCOME_APP_PROMOTION",
  "OUTCOME_SALES",
] as const;
export type LaunchObjective = (typeof LAUNCH_OBJECTIVES)[number];

export const DESTINATIONS = ["website", "messaging", "app", "on_ad"] as const;
export type Destination = (typeof DESTINATIONS)[number];

export const MESSAGING_APPS = ["MESSENGER", "INSTAGRAM_DIRECT", "WHATSAPP"] as const;
export type MessagingApp = (typeof MESSAGING_APPS)[number];

export const DESTINATION_LABELS: Record<Destination, string> = {
  website: "Website",
  messaging: "Messaging apps",
  app: "App",
  on_ad: "On your ad",
};

export const MESSAGING_APP_LABELS: Record<MessagingApp, string> = { MESSENGER: "Messenger", INSTAGRAM_DIRECT: "Instagram", WHATSAPP: "WhatsApp" };

/** Conversion locations each objective offers (first = default). */
export const OBJECTIVE_DESTINATIONS: Record<LaunchObjective, Destination[]> = {
  OUTCOME_AWARENESS: ["website"],
  OUTCOME_TRAFFIC: ["website", "messaging"],
  OUTCOME_ENGAGEMENT: ["messaging", "on_ad", "website"],
  OUTCOME_LEADS: ["website"],
  OUTCOME_APP_PROMOTION: ["app"],
  OUTCOME_SALES: ["website", "messaging"],
};

/** Performance goals for an objective + destination (first = default). */
export function goalsFor(objective: LaunchObjective, destination: Destination, apps: readonly MessagingApp[]): string[] {
  if (objective === "OUTCOME_AWARENESS") return ["REACH", "IMPRESSIONS", "AD_RECALL_LIFT", "THRUPLAY"];
  if (objective === "OUTCOME_APP_PROMOTION") return ["APP_INSTALLS", "LINK_CLICKS"];
  if (destination === "messaging") {
    // Several apps in one ad set only optimize for conversations; one app can also buy link clicks.
    if (objective === "OUTCOME_TRAFFIC") return apps.length > 1 ? ["CONVERSATIONS"] : ["LINK_CLICKS", "REACH", "IMPRESSIONS"];
    return objective === "OUTCOME_ENGAGEMENT" && apps.length === 1 ? ["CONVERSATIONS", "LINK_CLICKS"] : ["CONVERSATIONS"];
  }
  if (destination === "on_ad") return ["POST_ENGAGEMENT", "THRUPLAY", "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS", "REACH", "IMPRESSIONS"];
  switch (objective) {
    case "OUTCOME_SALES":
      return ["OFFSITE_CONVERSIONS", "VALUE", "LANDING_PAGE_VIEWS", "LINK_CLICKS", "IMPRESSIONS", "REACH"];
    case "OUTCOME_LEADS":
      return ["OFFSITE_CONVERSIONS", "LANDING_PAGE_VIEWS", "LINK_CLICKS", "IMPRESSIONS", "REACH"];
    case "OUTCOME_ENGAGEMENT":
      return ["OFFSITE_CONVERSIONS", "LANDING_PAGE_VIEWS", "LINK_CLICKS", "IMPRESSIONS", "REACH"];
    default:
      return ["LANDING_PAGE_VIEWS", "LINK_CLICKS", "IMPRESSIONS", "REACH"];
  }
}

export const isConversionGoal = (goal: string) => goal === "OFFSITE_CONVERSIONS" || goal === "VALUE";

/** Whether the ad set needs a pixel + conversion event ("required"), may carry one ("optional"), or never does. */
export function pixelUse(objective: LaunchObjective, destination: Destination, goal: string, apps: readonly MessagingApp[] = []): "required" | "optional" | "none" {
  if (destination === "website") {
    if (objective === "OUTCOME_SALES" || objective === "OUTCOME_LEADS") return "required";
    if (objective === "OUTCOME_ENGAGEMENT" && isConversionGoal(goal)) return "required";
    return "none";
  }
  // Only Sales → Messenger conversations is documented with a pixel event in promoted_object.
  if (destination === "messaging" && objective === "OUTCOME_SALES" && apps.length === 1 && apps[0] === "MESSENGER") return "optional";
  return "none";
}

/** Goals that only make sense for video ads. */
export const VIDEO_GOALS = new Set(["THRUPLAY", "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS"]);

/** Ad set destination_type; undefined = leave unset (Meta's "UNDEFINED"). */
export function destinationType(objective: LaunchObjective, destination: Destination, apps: readonly MessagingApp[], goal = ""): string | undefined {
  if (destination === "website") return objective === "OUTCOME_AWARENESS" ? undefined : "WEBSITE";
  if (destination === "on_ad") return VIDEO_GOALS.has(goal) ? "ON_VIDEO" : "ON_POST";
  if (destination !== "messaging") return undefined;
  const has = new Set(apps);
  const m = has.has("MESSENGER");
  const i = has.has("INSTAGRAM_DIRECT");
  const w = has.has("WHATSAPP");
  if (m && i && w) return "MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP";
  if (m && i) return "MESSAGING_INSTAGRAM_DIRECT_MESSENGER";
  if (m && w) return "MESSAGING_MESSENGER_WHATSAPP";
  if (i && w) return "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP";
  if (w) return "WHATSAPP";
  if (i) return "INSTAGRAM_DIRECT";
  return "MESSENGER";
}

/** Where an existing ad set sends clicks, read back from its destination_type / promoted_object. */
export function destinationFromAdset(destinationType: string | null | undefined, promoted: Record<string, unknown> | null | undefined): { kind: Destination; apps: MessagingApp[]; storeUrl?: string } {
  const dt = destinationType ?? "";
  if (dt === "MESSENGER" || dt === "WHATSAPP" || dt === "INSTAGRAM_DIRECT" || dt.startsWith("MESSAGING_")) {
    const apps = MESSAGING_APPS.filter((a) => (a === "INSTAGRAM_DIRECT" ? dt.includes("INSTAGRAM_DIRECT") : dt.includes(a)));
    return { kind: "messaging", apps };
  }
  if (promoted?.application_id && typeof promoted.object_store_url === "string") return { kind: "app", apps: [], storeUrl: promoted.object_store_url };
  return { kind: dt.startsWith("ON_") ? "on_ad" : "website", apps: [] };
}

/** Call-to-action and deep link Meta expects for each messaging app (click-to-message ads). */
export const MESSAGING_CTA: Record<MessagingApp, { type: string; link: string }> = {
  MESSENGER: { type: "MESSAGE_PAGE", link: "https://fb.com/messenger_doc/" },
  INSTAGRAM_DIRECT: { type: "INSTAGRAM_MESSAGE", link: "https://www.instagram.com" },
  WHATSAPP: { type: "WHATSAPP_MESSAGE", link: "https://api.whatsapp.com/send" },
};

/** Ads in website, "on your ad" and Awareness ad sets link to a website; messaging and app ads don't need one. */
export const needsWebsite = (destination: Destination) => destination === "website" || destination === "on_ad";

/** Calls to action offered per destination (first = default). */
export const WEBSITE_CTAS = [
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
  "DOWNLOAD",
  "WATCH_MORE",
  "SEE_MORE",
] as const;
export const APP_CTAS = ["INSTALL_MOBILE_APP", "USE_APP", "DOWNLOAD", "PLAY_GAME", "SHOP_NOW", "LEARN_MORE", "SIGN_UP", "BOOK_NOW"] as const;
