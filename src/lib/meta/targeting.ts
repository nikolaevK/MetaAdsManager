/**
 * Pure translation between Meta's raw `targeting` / creative objects and the editor's form state.
 * Edits are applied onto a clone of what Meta returned, so keys the editor doesn't manage (locales,
 * extra "narrow further" groups, brand safety, …) survive a save untouched.
 */
import type { AdCopy, Audience, DetailedItem, GeoItem, GeoKind, Placements } from "./editor-types";

type Obj = Record<string, unknown>;
const arr = <T = Obj>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

const regionNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
export const countryName = (code: string) => {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
};

// ── Locations ────────────────────────────────────────────────────────────────

const GEO_KEYS: [GeoKind, string][] = [
  ["region", "regions"],
  ["city", "cities"],
  ["zip", "zips"],
  ["geo_market", "geo_markets"],
];

function geoFrom(raw: unknown): GeoItem[] {
  const g = obj(raw);
  const out: GeoItem[] = arr<string>(g.countries).map((c) => ({ kind: "country", key: c, name: countryName(c) }));
  for (const [kind, field] of GEO_KEYS) {
    for (const item of arr(g[field])) {
      const detail = [item.region, item.country_name ?? item.country].filter(Boolean).join(", ");
      out.push({
        kind,
        key: String(item.key),
        name: String(item.name ?? item.key),
        detail: detail || undefined,
        ...(kind === "city" && item.radius ? { radius: Number(item.radius), distanceUnit: item.distance_unit === "kilometer" ? "kilometer" : "mile" } : {}),
      });
    }
  }
  return out;
}

function geoTo(items: GeoItem[], base: unknown): Obj | null {
  const g: Obj = { ...obj(base) };
  for (const k of ["countries", ...GEO_KEYS.map(([, f]) => f)]) delete g[k];
  const countries = items.filter((i) => i.kind === "country").map((i) => i.key);
  if (countries.length) g.countries = countries;
  for (const [kind, field] of GEO_KEYS) {
    const list = items.filter((i) => i.kind === kind);
    if (!list.length) continue;
    g[field] = list.map((i) =>
      kind === "city" && i.radius ? { key: i.key, radius: i.radius, distance_unit: i.distanceUnit ?? "mile" } : { key: i.key },
    );
  }
  const hasPlaces = countries.length > 0 || GEO_KEYS.some(([, f]) => f in g);
  return hasPlaces ? g : null;
}

// ── Detailed targeting ───────────────────────────────────────────────────────

/** flexible_spec / exclusions keys that hold {id, name} lists. */
const DETAILED_KEYS = new Set([
  "interests",
  "behaviors",
  "life_events",
  "industries",
  "income",
  "family_statuses",
  "user_adclusters",
  "work_positions",
  "work_employers",
  "education_schools",
  "education_majors",
  "relationship_statuses",
  "education_statuses",
  "college_years",
]);

function detailedFrom(group: unknown): DetailedItem[] {
  const out: DetailedItem[] = [];
  for (const [type, list] of Object.entries(obj(group))) {
    if (!DETAILED_KEYS.has(type)) continue;
    for (const i of arr(list)) out.push({ id: String(i.id), name: String(i.name ?? i.id), type });
  }
  return out;
}

function detailedTo(items: DetailedItem[], base: unknown): Obj {
  const g: Obj = {};
  // Keep non-list keys of the original group (rare, but don't drop what we don't understand).
  for (const [k, v] of Object.entries(obj(base))) if (!DETAILED_KEYS.has(k)) g[k] = v;
  for (const i of items) {
    const key = DETAILED_KEYS.has(i.type) ? i.type : "interests";
    g[key] = [...arr(g[key]), { id: i.id, name: i.name }];
  }
  return g;
}

// ── Audience ─────────────────────────────────────────────────────────────────

export function audienceFromTargeting(raw: unknown): Audience {
  const t = obj(raw);
  const genders = arr<number>(t.genders);
  return {
    locations: geoFrom(t.geo_locations),
    excludedLocations: geoFrom(t.excluded_geo_locations),
    ageMin: Number(t.age_min ?? 18),
    ageMax: Number(t.age_max ?? 65),
    genders: genders.length === 1 ? (genders[0] === 1 ? "men" : "women") : "all",
    detailed: detailedFrom(arr(t.flexible_spec)[0]),
    detailedExcluded: detailedFrom(t.exclusions),
    customAudiences: arr(t.custom_audiences).map((a) => ({ id: String(a.id), name: String(a.name ?? a.id) })),
    excludedCustomAudiences: arr(t.excluded_custom_audiences).map((a) => ({ id: String(a.id), name: String(a.name ?? a.id) })),
    advantageAudience: Number(obj(t.targeting_automation).advantage_audience ?? 0) === 1,
  };
}

/** Extra "narrow further" groups beyond the first, which the editor leaves as they are. */
export const extraFlexibleGroups = (raw: unknown) => Math.max(0, arr(obj(raw).flexible_spec).length - 1);

export function applyAudience(raw: unknown, a: Audience): Obj {
  const t = clone(obj(raw));
  const geo = geoTo(a.locations, t.geo_locations);
  if (geo) t.geo_locations = geo;
  else delete t.geo_locations;
  const excluded = geoTo(a.excludedLocations, t.excluded_geo_locations);
  if (excluded) t.excluded_geo_locations = excluded;
  else delete t.excluded_geo_locations;

  t.age_min = a.ageMin;
  t.age_max = a.ageMax;
  if (a.genders === "all") delete t.genders;
  else t.genders = [a.genders === "men" ? 1 : 2];

  const groups = arr(t.flexible_spec);
  const first = a.detailed.length ? [detailedTo(a.detailed, groups[0])] : [];
  const rest = groups.slice(1);
  if (first.length || rest.length) t.flexible_spec = [...first, ...rest];
  else delete t.flexible_spec;

  if (a.detailedExcluded.length) t.exclusions = detailedTo(a.detailedExcluded, t.exclusions);
  else delete t.exclusions;

  if (a.customAudiences.length) t.custom_audiences = a.customAudiences.map((x) => ({ id: x.id, name: x.name }));
  else delete t.custom_audiences;
  if (a.excludedCustomAudiences.length) t.excluded_custom_audiences = a.excludedCustomAudiences.map((x) => ({ id: x.id, name: x.name }));
  else delete t.excluded_custom_audiences;

  t.targeting_automation = { ...obj(t.targeting_automation), advantage_audience: a.advantageAudience ? 1 : 0 };
  return t;
}

// ── Placements ───────────────────────────────────────────────────────────────

const POSITION_FIELDS = {
  facebook: "facebook_positions",
  instagram: "instagram_positions",
  audience_network: "audience_network_positions",
  messenger: "messenger_positions",
} as const;

export function placementsFromTargeting(raw: unknown, defaults: Placements): Placements {
  const t = obj(raw);
  const platforms = arr<string>(t.publisher_platforms) as Placements["platforms"];
  const devices = arr<string>(t.device_platforms) as Placements["devices"];
  if (!platforms.length) return { ...defaults, automatic: true, devices: devices.length ? devices : defaults.devices };
  return {
    automatic: false,
    platforms,
    facebook: arr<string>(t.facebook_positions),
    instagram: arr<string>(t.instagram_positions),
    audienceNetwork: arr<string>(t.audience_network_positions),
    messenger: arr<string>(t.messenger_positions),
    devices: devices.length ? devices : ["mobile", "desktop"],
  };
}

export function applyPlacements(raw: unknown, p: Placements): Obj {
  const t = clone(obj(raw));
  for (const f of ["publisher_platforms", ...Object.values(POSITION_FIELDS)]) delete t[f];
  t.device_platforms = p.devices.length ? p.devices : ["mobile", "desktop"];
  if (p.automatic) return t; // Advantage+ placements: Meta picks platforms and positions.
  const positions: Record<Placements["platforms"][number], string[]> = {
    facebook: p.facebook,
    instagram: p.instagram,
    audience_network: p.audienceNetwork,
    messenger: p.messenger,
  };
  const platforms = p.platforms.filter((pl) => positions[pl].length > 0);
  t.publisher_platforms = platforms;
  for (const pl of platforms) t[POSITION_FIELDS[pl]] = positions[pl];
  return t;
}

// ── Creative copy ────────────────────────────────────────────────────────────

export type CreativeInfo = {
  format: "image" | "video" | "flexible" | "post" | "unknown";
  copy: AdCopy;
  editable: boolean;
  pageId: string | null;
  instagramUserId: string | null;
};

const text = (list: unknown) => String(obj(arr(list)[0]).text ?? "");
const isMessagingFeed = (feed: Obj) => feed.optimization_type === "DOF_MESSAGING_DESTINATION";

export function creativeInfo(raw: unknown): CreativeInfo {
  const c = obj(raw);
  const story = obj(c.object_story_spec);
  const link = obj(story.link_data);
  const video = obj(story.video_data);
  const feed = obj(c.asset_feed_spec);
  const base = {
    pageId: story.page_id ? String(story.page_id) : null,
    instagramUserId: story.instagram_user_id ? String(story.instagram_user_id) : story.instagram_actor_id ? String(story.instagram_actor_id) : null,
  };
  const urlTags = String(c.url_tags ?? "");
  // Click-to-message creatives for several apps carry an asset_feed_spec with only the apps' calls to action;
  // their copy lives in link_data / video_data like a single-app ad.
  if (Object.keys(feed).length && !isMessagingFeed(feed)) {
    return {
      ...base,
      format: "flexible",
      editable: true,
      copy: {
        primaryText: text(feed.bodies),
        headline: text(feed.titles),
        description: text(feed.descriptions),
        url: String(obj(arr(feed.link_urls)[0]).website_url ?? ""),
        cta: String(arr<string>(feed.call_to_action_types)[0] ?? "LEARN_MORE"),
        urlTags,
      },
    };
  }
  if (Object.keys(link).length) {
    const cta = obj(link.call_to_action);
    return {
      ...base,
      format: "image",
      // Carousel cards carry their own headlines/links; rebuilding them from one set of fields would be wrong.
      editable: !Array.isArray(link.child_attachments),
      copy: {
        primaryText: String(link.message ?? ""),
        headline: String(link.name ?? ""),
        description: String(link.description ?? ""),
        url: String(link.link ?? obj(cta.value).link ?? ""),
        cta: String(cta.type ?? "LEARN_MORE"),
        urlTags,
      },
    };
  }
  if (Object.keys(video).length) {
    const cta = obj(video.call_to_action);
    return {
      ...base,
      format: "video",
      editable: true,
      copy: {
        primaryText: String(video.message ?? ""),
        headline: String(video.title ?? ""),
        description: String(video.link_description ?? ""),
        url: String(obj(cta.value).link ?? ""),
        cta: String(cta.type ?? "LEARN_MORE"),
        urlTags,
      },
    };
  }
  const isPost = !!(c.object_story_id || c.effective_object_story_id);
  return { ...base, format: isPost ? "post" : "unknown", editable: false, copy: { primaryText: "", headline: "", description: "", url: "", cta: "LEARN_MORE", urlTags } };
}

/**
 * New creative payload with edited copy. Creatives are immutable in Meta, so "editing" an ad means
 * creating a creative from the old spec and pointing the ad at it.
 */
export function rebuildCreative(raw: unknown, copy: AdCopy, featuresSpec: Obj): Obj {
  const c = obj(raw);
  const story = clone(obj(c.object_story_spec));
  if (story.instagram_actor_id && !story.instagram_user_id) story.instagram_user_id = story.instagram_actor_id;
  delete story.instagram_actor_id;
  const out: Obj = {
    name: `${String(c.name ?? "Creative").replace(/ · edited.*$/, "")} · edited ${new Date().toISOString().slice(0, 10)}`.slice(0, 400),
    object_story_spec: story,
    degrees_of_freedom_spec: { creative_features_spec: featuresSpec },
  };
  if (copy.urlTags.trim()) out.url_tags = copy.urlTags.trim();

  const feed = obj(c.asset_feed_spec);
  if (isMessagingFeed(feed)) out.asset_feed_spec = clone(feed);
  else if (Object.keys(feed).length) {
    const f = clone(feed);
    const setFirst = (key: string, value: string) => {
      const list = arr(f[key]);
      if (value) f[key] = [{ ...obj(list[0]), text: value }, ...list.slice(1)];
      else if (key === "descriptions") delete f[key];
    };
    setFirst("bodies", copy.primaryText);
    setFirst("titles", copy.headline);
    setFirst("descriptions", copy.description);
    const links = arr(f.link_urls);
    f.link_urls = [{ ...obj(links[0]), website_url: copy.url }, ...links.slice(1)];
    f.call_to_action_types = [copy.cta];
    out.asset_feed_spec = f;
    return out;
  }
  const cta = (old: unknown) => ({ ...obj(old), type: copy.cta, value: { ...obj(obj(old).value), link: copy.url } });
  if (story.link_data) {
    const l = obj(story.link_data);
    if (l.image_hash) delete l.picture;
    l.message = copy.primaryText;
    l.name = copy.headline;
    if (copy.description) l.description = copy.description;
    else delete l.description;
    l.link = copy.url;
    l.call_to_action = cta(l.call_to_action);
  } else if (story.video_data) {
    const v = obj(story.video_data);
    if (v.image_hash) delete v.image_url;
    v.message = copy.primaryText;
    v.title = copy.headline;
    if (copy.description) v.link_description = copy.description;
    else delete v.link_description;
    v.call_to_action = cta(v.call_to_action);
  }
  return out;
}
