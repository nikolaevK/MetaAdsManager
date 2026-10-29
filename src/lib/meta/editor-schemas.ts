/** Zod schemas for the audience / placements form state, shared by the editor and the campaign builder. */
import { z } from "zod";

const metaId = z.string().regex(/^\d+$/);

const geoItem = z.object({
  kind: z.enum(["country", "region", "city", "zip", "geo_market"]),
  key: z.string().min(1).max(64),
  name: z.string().max(200),
  detail: z.string().max(200).optional(),
  radius: z.number().min(1).max(80).optional(),
  distanceUnit: z.enum(["mile", "kilometer"]).optional(),
});
const detailedItem = z.object({ id: z.string().min(1).max(64), name: z.string().max(300), type: z.string().max(40), path: z.array(z.string()).optional(), size: z.number().optional() });
const audienceRef = z.object({ id: metaId, name: z.string().max(300) });

export const audienceSchema = z
  .object({
    locations: z.array(geoItem).max(250),
    excludedLocations: z.array(geoItem).max(250),
    ageMin: z.number().int().min(13).max(65),
    ageMax: z.number().int().min(13).max(65),
    genders: z.enum(["all", "men", "women"]),
    detailed: z.array(detailedItem).max(200),
    detailedExcluded: z.array(detailedItem).max(200),
    customAudiences: z.array(audienceRef).max(100),
    excludedCustomAudiences: z.array(audienceRef).max(100),
    advantageAudience: z.boolean(),
  })
  .refine((a) => a.ageMin <= a.ageMax, { message: "Max age must be at least the min age", path: ["ageMax"] })
  .refine((a) => a.locations.length > 0, { message: "Add at least one location", path: ["locations"] });

export const placementsSchema = z.object({
  automatic: z.boolean(),
  platforms: z.array(z.enum(["facebook", "instagram", "audience_network", "messenger"])),
  facebook: z.array(z.string().max(40)),
  instagram: z.array(z.string().max(40)),
  audienceNetwork: z.array(z.string().max(40)),
  messenger: z.array(z.string().max(40)),
  devices: z.array(z.enum(["mobile", "desktop"])).min(1),
});
