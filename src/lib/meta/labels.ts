/** Human labels for Marketing API enums, as Ads Manager words them. Client + server safe. */

export const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_SALES: "Sales",
  OUTCOME_LEADS: "Leads",
  OUTCOME_TRAFFIC: "Traffic",
  OUTCOME_ENGAGEMENT: "Engagement",
  OUTCOME_AWARENESS: "Awareness",
  OUTCOME_APP_PROMOTION: "App promotion",
  // Legacy objectives still returned for old campaigns.
  CONVERSIONS: "Conversions",
  LINK_CLICKS: "Traffic",
  REACH: "Reach",
  BRAND_AWARENESS: "Brand awareness",
  POST_ENGAGEMENT: "Engagement",
  VIDEO_VIEWS: "Video views",
  LEAD_GENERATION: "Lead generation",
  MESSAGES: "Messages",
};

export const BID_STRATEGY_LABELS: Record<string, string> = {
  LOWEST_COST_WITHOUT_CAP: "Highest volume",
  COST_CAP: "Cost per result goal",
  LOWEST_COST_WITH_BID_CAP: "Bid cap",
  LOWEST_COST_WITH_MIN_ROAS: "ROAS goal",
};

export const OPTIMIZATION_LABELS: Record<string, string> = {
  OFFSITE_CONVERSIONS: "Conversions",
  VALUE: "Conversion value",
  LINK_CLICKS: "Link clicks",
  LANDING_PAGE_VIEWS: "Landing page views",
  REACH: "Reach",
  IMPRESSIONS: "Impressions",
  THRUPLAY: "ThruPlay",
  POST_ENGAGEMENT: "Post engagement",
  LEAD_GENERATION: "Leads (instant forms)",
  QUALITY_LEAD: "Conversion leads",
  AD_RECALL_LIFT: "Ad recall lift",
  PAGE_LIKES: "Page likes",
  CONVERSATIONS: "Conversations",
  APP_INSTALLS: "App installs",
};

export const CTA_LABELS: Record<string, string> = {
  SHOP_NOW: "Shop now",
  LEARN_MORE: "Learn more",
  ORDER_NOW: "Order now",
  BUY_NOW: "Buy now",
  GET_OFFER: "Get offer",
  SIGN_UP: "Sign up",
  SUBSCRIBE: "Subscribe",
  APPLY_NOW: "Apply now",
  BOOK_NOW: "Book now",
  CONTACT_US: "Contact us",
  GET_QUOTE: "Get quote",
  DOWNLOAD: "Download",
  WATCH_MORE: "Watch more",
  SEE_MORE: "See more",
  NO_BUTTON: "No button",
};

const humanize = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replaceAll("_", " ");
export const label = (map: Record<string, string>, v: string | null | undefined) => (v ? (map[v] ?? humanize(v)) : "—");
