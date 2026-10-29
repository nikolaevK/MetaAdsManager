import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { insightsDaily } from "@/lib/db/schema";
import { EVENT_ACTION_TYPES, VIDEO_ACTION_KEYS } from "@/lib/meta/actions";
import type { SumKey } from "@/lib/metrics";

/** First action type present in the row's actions JSON, like pickAction() at ingest time. */
function action(types: readonly string[]): SQL {
  const parts = types.map((t) => sql`json_extract(${insightsDaily.actions}, ${`$."${t}"`})`);
  return sql`coalesce(${sql.join(parts, sql`, `)}, 0)`;
}

const EXPRESSIONS: Record<SumKey, SQL> = {
  spend: sql`${insightsDaily.spend}`,
  impressions: sql`${insightsDaily.impressions}`,
  clicks: sql`${insightsDaily.clicks}`,
  linkClicks: sql`${insightsDaily.linkClicks}`,
  results: sql`${insightsDaily.results}`,
  purchases: sql`${insightsDaily.purchases}`,
  purchaseValue: sql`${insightsDaily.purchaseValue}`,
  leads: sql`${insightsDaily.leads}`,
  landingPageViews: action(["omni_landing_page_view", "landing_page_view"]),
  addToCart: action(EVENT_ACTION_TYPES.ADD_TO_CART),
  initiateCheckout: action(EVENT_ACTION_TYPES.INITIATED_CHECKOUT),
  postEngagement: action(["post_engagement"]),
  videoViews: action(["video_view"]),
  thruplays: action([VIDEO_ACTION_KEYS.thruplays]),
  videoP25: action([VIDEO_ACTION_KEYS.videoP25]),
  videoP50: action([VIDEO_ACTION_KEYS.videoP50]),
  videoP75: action([VIDEO_ACTION_KEYS.videoP75]),
  videoP100: action([VIDEO_ACTION_KEYS.videoP100]),
};

/** SELECT fragment: one summed column per MetricSums key (0 when no insight rows matched). */
export const metricSums = Object.fromEntries(
  Object.entries(EXPRESSIONS).map(([k, expr]) => [k, sql<number>`coalesce(sum(${expr}), 0)`.mapWith(Number)]),
) as Record<SumKey, SQL<number>>;
