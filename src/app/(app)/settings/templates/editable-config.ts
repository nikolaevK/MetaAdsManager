import { DEFAULT_TEMPLATE_CONFIG, type TemplateConfig } from "@/lib/launch/spec";

const arr = <T,>(v: unknown, fallback: T[]): T[] => (Array.isArray(v) ? (v as T[]) : fallback);

/**
 * Stored configs may be incomplete (e.g. the seeded template has no pixel yet), so the editor
 * starts from defaults and overlays whatever is stored. Saving still requires a full parse.
 */
export function editableConfig(stored: unknown): TemplateConfig {
  const s = (stored && typeof stored === "object" ? stored : {}) as Partial<TemplateConfig>;
  const d = DEFAULT_TEMPLATE_CONFIG;
  return {
    ...d,
    pixelId: "",
    ...s,
    attribution: { ...d.attribution, ...(s.attribution && typeof s.attribution === "object" ? s.attribution : {}) },
    placements: {
      facebook: arr(s.placements?.facebook, d.placements.facebook),
      instagram: arr(s.placements?.instagram, d.placements.instagram),
    },
    devicePlatforms: arr(s.devicePlatforms, d.devicePlatforms),
    exclusionAudiences: arr(s.exclusionAudiences, d.exclusionAudiences),
    countries: arr(s.countries, d.countries),
    creativeFeaturesOptIn: arr(s.creativeFeaturesOptIn, d.creativeFeaturesOptIn),
  };
}
