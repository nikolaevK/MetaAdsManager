import type { UtmParam } from "@/lib/db/schema";

/** Meta dynamic URL parameters substituted at click time. */
export const META_URL_MACROS = [
  "{{campaign.id}}",
  "{{campaign.name}}",
  "{{adset.id}}",
  "{{adset.name}}",
  "{{ad.id}}",
  "{{ad.name}}",
  "{{placement}}",
  "{{site_source_name}}",
] as const;

export const DEFAULT_UTM_PARAMS: UtmParam[] = [
  { key: "utm_source", value: "{{site_source_name}}" },
  { key: "utm_medium", value: "paid" },
  { key: "utm_campaign", value: "{{campaign.name}}" },
  { key: "utm_content", value: "{{ad.name}}" },
  { key: "utm_term", value: "{{adset.name}}" },
];

const encodeKeepingMacros = (value: string) =>
  value
    .split(/(\{\{[a-z_.]+\}\})/g)
    .map((part) => (/^\{\{[a-z_.]+\}\}$/.test(part) ? part : encodeURIComponent(part)))
    .join("");

/** Builds the creative's url_tags string ("a=b&c={{ad.name}}"). Meta appends it to the link. */
export function buildUrlTags(params: UtmParam[]): string {
  return params
    .filter((p) => p.key.trim() && p.value.trim())
    .map((p) => `${encodeURIComponent(p.key.trim())}=${encodeKeepingMacros(p.value.trim())}`)
    .join("&");
}

export function validateUtmParams(params: UtmParam[]): string | null {
  const seen = new Set<string>();
  for (const p of params) {
    const key = p.key.trim();
    if (!key) continue;
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) return `Invalid parameter name "${key}"`;
    if (seen.has(key)) return `Duplicate parameter "${key}"`;
    seen.add(key);
    for (const macro of p.value.match(/\{\{[^}]*\}\}/g) ?? []) {
      if (!(META_URL_MACROS as readonly string[]).includes(macro)) return `Unknown dynamic parameter ${macro}`;
    }
  }
  return null;
}
