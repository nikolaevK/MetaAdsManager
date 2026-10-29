/** Maps a pixel conversion event to the insights action_types that count it, in priority order. */
export const EVENT_ACTION_TYPES: Record<string, string[]> = {
  PURCHASE: ["omni_purchase", "offsite_conversion.fb_pixel_purchase", "purchase"],
  INITIATED_CHECKOUT: [
    "omni_initiated_checkout",
    "offsite_conversion.fb_pixel_initiate_checkout",
    "initiate_checkout",
  ],
  ADD_TO_CART: ["omni_add_to_cart", "offsite_conversion.fb_pixel_add_to_cart", "add_to_cart"],
  ADD_PAYMENT_INFO: ["add_payment_info", "offsite_conversion.fb_pixel_add_payment_info"],
  LEAD: ["lead", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped"],
  COMPLETE_REGISTRATION: [
    "omni_complete_registration",
    "offsite_conversion.fb_pixel_complete_registration",
    "complete_registration",
  ],
  CONTACT: ["contact_total", "offsite_conversion.fb_pixel_contact"],
  SUBSCRIBE: ["subscribe_total", "offsite_conversion.fb_pixel_subscribe"],
  START_TRIAL: ["start_trial_total", "offsite_conversion.fb_pixel_start_trial"],
  // The *_total types come from the insights `conversions` field, which the sync merges into actions.
  SCHEDULE: ["schedule_total", "schedule_website"],
  CONTENT_VIEW: ["omni_view_content", "offsite_conversion.fb_pixel_view_content", "view_content"],
  SEARCH: ["omni_search", "offsite_conversion.fb_pixel_search", "search"],
  ADD_TO_WISHLIST: ["omni_add_to_wishlist", "offsite_conversion.fb_pixel_add_to_wishlist", "add_to_wishlist"],
  SUBMIT_APPLICATION: ["submit_application_total", "submit_application_website"],
  CUSTOMIZE_PRODUCT: ["customize_product_total", "customize_product_website"],
  DONATE: ["donate_total", "donate_website"],
  FIND_LOCATION: ["find_location_total", "find_location_website"],
};

export const RESULT_LABELS: Record<string, string> = {
  PURCHASE: "Purchases",
  INITIATED_CHECKOUT: "Checkouts initiated",
  ADD_TO_CART: "Adds to cart",
  ADD_PAYMENT_INFO: "Adds of payment info",
  LEAD: "Leads",
  COMPLETE_REGISTRATION: "Registrations completed",
  CONTACT: "Contacts",
  SUBSCRIBE: "Subscriptions",
  START_TRIAL: "Trials started",
  SCHEDULE: "Schedules",
  CONTENT_VIEW: "Content views",
  SEARCH: "Searches",
  ADD_TO_WISHLIST: "Adds to wishlist",
  SUBMIT_APPLICATION: "Applications submitted",
  CUSTOMIZE_PRODUCT: "Products customized",
  DONATE: "Donations",
  FIND_LOCATION: "Location searches",
  LINK_CLICKS: "Link clicks",
};

/**
 * Synthetic action keys the insights sync writes for the video_*_watched_actions fields, which Meta
 * returns outside `actions`. Keyed by the MetricSums field they feed.
 */
export const VIDEO_ACTION_KEYS = {
  thruplays: "video_thruplay_watched",
  videoP25: "video_p25_watched",
  videoP50: "video_p50_watched",
  videoP75: "video_p75_watched",
  videoP100: "video_p100_watched",
} as const;

export const VIDEO_FIELDS: Record<keyof typeof VIDEO_ACTION_KEYS, string> = {
  thruplays: "video_thruplay_watched_actions",
  videoP25: "video_p25_watched_actions",
  videoP50: "video_p50_watched_actions",
  videoP75: "video_p75_watched_actions",
  videoP100: "video_p100_watched_actions",
};

export type ActionList = { action_type: string; value: string }[] | undefined;

export function toActionMap(list: ActionList): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of list ?? []) out[a.action_type] = Number(a.value) || 0;
  return out;
}

export function pickAction(actions: Record<string, number>, types: string[] | undefined): number {
  for (const t of types ?? []) if (t in actions) return actions[t];
  return 0;
}

/** Total of every entry in an action list (video fields report one row per action type). */
export function sumActions(list: ActionList): number {
  return (list ?? []).reduce((total, a) => total + (Number(a.value) || 0), 0);
}
