/**
 * Pure translation between Meta's raw `targeting` / creative objects and the editor's form state.
 * Edits are applied onto a clone of what Meta returned, so keys the editor doesn't manage (locales,
 * extra "narrow further" groups, brand safety, …) survive a save untouched.
 */
import { REMOVED_POSITIONS, type AdCopy, type Audience, type DetailedItem, type GeoItem, type GeoKind, type Placements } from "./editor-types";

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
    advantageDetailed: t.targeting_optimization === "expansion_all",
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
  // With Advantage+ audience the maximum age can't be set (Meta fixes it at 65); only the minimum is a hard limit.
  if (a.advantageAudience) delete t.age_max;
  else t.age_max = a.ageMax;
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
  // Advantage detailed targeting only applies to strict detailed targeting (Advantage+ audience already relaxes it).
  if (a.advantageDetailed && a.detailed.length && !a.advantageAudience) t.targeting_optimization = "expansion_all";
  else delete t.targeting_optimization;
  return withoutRemovedPositions(t);
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
  return withoutRemovedPositions(t);
}

/**
 * Meta rejects any create or update whose targeting still names a removed position (e.g. an older ad set with
 * Facebook video feeds), even when the edit is about something else. Strip them, and any platform left empty.
 */
export function withoutRemovedPositions(t: Obj): Obj {
  const platforms = arr<string>(t.publisher_platforms);
  if (!platforms.length) return t;
  for (const [platform, removed] of Object.entries(REMOVED_POSITIONS)) {
    const field = POSITION_FIELDS[platform as keyof typeof POSITION_FIELDS];
    if (!(field in t)) continue;
    const kept = arr<string>(t[field]).filter((x) => !(removed as readonly string[]).includes(x));
    if (kept.length) t[field] = kept;
    else {
      delete t[field];
      t.publisher_platforms = arr<string>(t.publisher_platforms).filter((x) => x !== platform);
    }
  }
  if (!arr(t.publisher_platforms).length) delete t.publisher_platforms;
  return t;
}

// ── Creative copy ────────────────────────────────────────────────────────────

export type CreativeFormat = "image" | "video" | "flexible" | "placement" | "carousel" | "post" | "unknown";

export type CreativeInfo = {
  format: CreativeFormat;
  copy: AdCopy;
  editable: boolean;
  /** How many primary texts / headlines the creative's format accepts. */
  maxTexts: number;
  /** Texts are tied to placement labels: their wording can change, not how many there are. */
  fixedTexts: boolean;
  /** Clicks go to a website, so the URL, display link and call to action are editable. */
  website: boolean;
  /** Advantage+ creative enhancements currently opted in. */
  features: string[];
  pageId: string | null;
  instagramUserId: string | null;
};

/** Meta's cap on text options per ad (Ads Manager offers 5). */
export const MAX_TEXT_OPTIONS = 5;

const texts = (list: unknown) => arr(list).map((t) => String(t.text ?? ""));
const isMessagingFeed = (feed: Obj) => feed.optimization_type === "DOF_MESSAGING_DESTINATION";
const hasLabels = (list: unknown) => arr(list).some((t) => arr(t.adlabels).length > 0);
/** Calls to action that open a chat, a lead form, a phone call or an app keep their own destination. */
const isWebsiteCta = (cta: Obj) => {
  const v = obj(cta.value);
  return !v.app_destination && !v.lead_gen_form_id && !v.application && !String(v.link ?? "").startsWith("tel:");
};
const optedIn = (spec: unknown) =>
  Object.entries(obj(obj(spec).creative_features_spec))
    .filter(([, v]) => obj(v).enroll_status === "OPT_IN")
    .map(([k]) => k);

export function creativeInfo(raw: unknown): CreativeInfo {
  const c = obj(raw);
  const story = obj(c.object_story_spec);
  const link = obj(story.link_data);
  const video = obj(story.video_data);
  const feed = obj(c.asset_feed_spec);
  const base = {
    pageId: story.page_id ? String(story.page_id) : null,
    instagramUserId: story.instagram_user_id ? String(story.instagram_user_id) : story.instagram_actor_id ? String(story.instagram_actor_id) : null,
    features: optedIn(c.degrees_of_freedom_spec),
    fixedTexts: false,
  };
  const urlTags = String(c.url_tags ?? "");
  const hasFeed = Object.keys(feed).length > 0;
  const single = Object.keys(link).length ? link : Object.keys(video).length ? video : null;

  if (single) {
    const isLink = single === link;
    const cta = obj(single.call_to_action);
    const messaging = isMessagingFeed(feed) || !!obj(cta.value).app_destination;
    // Several text options on one file: Ads Manager keeps the file and link in link_data / video_data and the
    // texts in an asset feed (optimization_type DEGREES_OF_FREEDOM).
    const feedTexts = hasFeed && !isMessagingFeed(feed) && texts(feed.bodies).length > 0;
    const description = texts(feed.descriptions)[0] ?? String((isLink ? single.description : single.link_description) ?? "");
    return {
      ...base,
      format: isLink ? (Array.isArray(link.child_attachments) ? "carousel" : "image") : "video",
      // Carousel cards carry their own headlines/links; rebuilding them from one set of fields would be wrong.
      editable: !(isLink && Array.isArray(link.child_attachments)),
      maxTexts: messaging ? 1 : MAX_TEXT_OPTIONS,
      website: !messaging && isWebsiteCta(cta),
      copy: {
        primaryTexts: feedTexts ? texts(feed.bodies) : [String(single.message ?? "")],
        headlines: feedTexts ? texts(feed.titles) : [String((isLink ? single.name : single.title) ?? "")],
        description,
        url: String((isLink ? single.link : undefined) ?? obj(cta.value).link ?? ""),
        displayLink: String((isLink ? single.caption : obj(cta.value).link_caption) ?? ""),
        cta: String(cta.type ?? "LEARN_MORE"),
        urlTags,
      },
    };
  }

  if (hasFeed) {
    // Files live in the asset feed: placement-customized (feed + Stories/Reels files) or Flexible format.
    const placement = Array.isArray(feed.asset_customization_rules) && feed.asset_customization_rules.length > 0;
    const fixedTexts = hasLabels(feed.bodies) || hasLabels(feed.titles);
    const firstLink = obj(arr(feed.link_urls)[0]);
    const ctaType = String(arr<string>(feed.call_to_action_types)[0] ?? "LEARN_MORE");
    return {
      ...base,
      format: placement ? "placement" : "flexible",
      editable: true,
      fixedTexts,
      // Meta rejects several text options on a creative customized per placement (error 1885878).
      maxTexts: fixedTexts ? texts(feed.bodies).length : placement ? 1 : MAX_TEXT_OPTIONS,
      website: !!firstLink.website_url && !["MESSAGE_PAGE", "WHATSAPP_MESSAGE", "INSTAGRAM_MESSAGE", "CALL_NOW"].includes(ctaType),
      copy: {
        primaryTexts: texts(feed.bodies),
        headlines: texts(feed.titles),
        description: texts(feed.descriptions)[0] ?? "",
        url: String(firstLink.website_url ?? ""),
        displayLink: String(firstLink.display_url ?? ""),
        cta: ctaType,
        urlTags,
      },
    };
  }

  const isPost = !!(c.object_story_id || c.effective_object_story_id);
  return {
    ...base,
    format: isPost ? "post" : "unknown",
    editable: false,
    maxTexts: 1,
    website: false,
    copy: { primaryTexts: [""], headlines: [""], description: "", url: "", displayLink: "", cta: "LEARN_MORE", urlTags },
  };
}

/**
 * Adlabels come back from Meta as {id, name}; new creatives reference them by name (like the builder does), and
 * files come back with both a hash and a CDN url, of which a new creative may only name one.
 */
function cleanFeed(feed: Obj): Obj {
  const walk = (v: unknown, key = ""): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (!v || typeof v !== "object") return v;
    const o = v as Obj;
    if (key === "adlabels" || key.endsWith("_label")) return o.name !== undefined ? { name: o.name } : o;
    const out: Obj = {};
    for (const [k, x] of Object.entries(o)) out[k] = walk(x, k);
    if (key === "images" && out.hash) delete out.url;
    return out;
  };
  return walk(clone(feed)) as Obj;
}

/**
 * New creative payload with edited copy. Creatives are immutable in Meta, so "editing" an ad means
 * creating a creative from the old spec and pointing the ad at it. Each format keeps its own shape;
 * fields the editor doesn't manage are carried over untouched.
 */
export function rebuildCreative(raw: unknown, copy: AdCopy, featuresSpec: Obj, multiAdvertiser?: "OPT_IN" | "OPT_OUT"): Obj {
  const c = obj(raw);
  const info = creativeInfo(raw);
  const story = clone(obj(c.object_story_spec));
  if (story.instagram_actor_id && !story.instagram_user_id) story.instagram_user_id = story.instagram_actor_id;
  delete story.instagram_actor_id;
  const out: Obj = {
    name: `${String(c.name ?? "Creative").replace(/ · edited.*$/, "")} · edited ${new Date().toISOString().slice(0, 10)}`.slice(0, 400),
    object_story_spec: story,
    degrees_of_freedom_spec: { creative_features_spec: featuresSpec },
  };
  // A new creative is opted into multi-advertiser ads unless it says otherwise, so the choice is always restated.
  const keep = obj(c.contextual_multi_ads).enroll_status;
  const multi = multiAdvertiser ?? (keep === "OPT_IN" || keep === "OPT_OUT" ? keep : undefined);
  if (multi) out.contextual_multi_ads = { enroll_status: multi };
  if (copy.urlTags.trim()) out.url_tags = copy.urlTags.trim();
  const bodies = copy.primaryTexts.map((text) => ({ text }));
  const titles = copy.headlines.map((text) => ({ text }));
  const feed = obj(c.asset_feed_spec);

  if (story.link_data || story.video_data) {
    const isLink = !!story.link_data;
    const d = obj(isLink ? story.link_data : story.video_data);
    if (isLink && d.image_hash) delete d.picture;
    if (!isLink && d.image_hash) delete d.image_url;
    const several = copy.primaryTexts.length > 1 || copy.headlines.length > 1;
    if (several) {
      // Ads Manager's shape for several text options on one file: texts only in the asset feed.
      delete d.message;
      delete d[isLink ? "name" : "title"];
      out.asset_feed_spec = { bodies, titles, optimization_type: "DEGREES_OF_FREEDOM" };
    } else {
      d.message = copy.primaryTexts[0];
      d[isLink ? "name" : "title"] = copy.headlines[0];
      // Several messaging apps keep their calls to action in the feed; a feed holding only texts isn't needed any more.
      if (isMessagingFeed(feed)) out.asset_feed_spec = clone(feed);
    }
    const descKey = isLink ? "description" : "link_description";
    if (copy.description) d[descKey] = copy.description;
    else delete d[descKey];
    if (info.website) {
      const cta = obj(d.call_to_action);
      const value: Obj = { ...obj(cta.value), link: copy.url };
      if (isLink) {
        d.link = copy.url;
        if (copy.displayLink) d.caption = copy.displayLink;
        else delete d.caption;
      } else if (copy.displayLink) value.link_caption = copy.displayLink;
      else delete value.link_caption;
      d.call_to_action = { ...cta, type: copy.cta, value };
    }
    return out;
  }

  if (Object.keys(feed).length) {
    const f = cleanFeed(feed);
    if (info.fixedTexts) {
      // Labeled texts are referenced by placement rules: change the wording in place.
      f.bodies = arr(f.bodies).map((b, k) => ({ ...b, text: copy.primaryTexts[k] ?? b.text }));
      f.titles = arr(f.titles).map((t, k) => ({ ...t, text: copy.headlines[k] ?? t.text }));
    } else {
      f.bodies = bodies;
      f.titles = titles;
    }
    if (copy.description) f.descriptions = [{ ...obj(arr(f.descriptions)[0]), text: copy.description }];
    else delete f.descriptions;
    if (info.website) {
      const links = arr(f.link_urls);
      const first: Obj = { ...obj(links[0]), website_url: copy.url };
      if (copy.displayLink) first.display_url = copy.displayLink;
      else delete first.display_url;
      f.link_urls = [first, ...links.slice(1)];
      f.call_to_action_types = [copy.cta];
    }
    out.asset_feed_spec = f;
  }
  return out;
}
