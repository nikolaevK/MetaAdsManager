import { count, eq } from "drizzle-orm";
import { hashPassword, PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { launchTemplates, namingConventions, users, utmRules } from "@/lib/db/schema";
import { DEFAULT_NAMING } from "@/lib/launch/naming";
import { DEFAULT_TEMPLATE_CONFIG } from "@/lib/launch/spec";
import { DEFAULT_UTM_PARAMS } from "@/lib/launch/utm";

/** Idempotent: only inserts what's missing. */

const [{ n: userCount }] = await db().select({ n: count() }).from(users);
if (userCount === 0) {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.error("No users exist. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD, then re-run.");
    process.exit(1);
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    console.error(`SEED_ADMIN_PASSWORD must be at least ${PASSWORD_MIN_LENGTH} characters.`);
    process.exit(1);
  }
  await db().insert(users).values({ email, name: email.split("@")[0], passwordHash: await hashPassword(password), role: "admin" });
  console.log(`Created admin ${email}`);
}

const [naming] = await db().select().from(namingConventions).where(eq(namingConventions.name, "Standard")).limit(1);
if (!naming) {
  await db().insert(namingConventions).values({ name: "Standard", ...DEFAULT_NAMING });
  console.log("Created naming convention: Standard");
}

const [utm] = await db().select().from(utmRules).where(eq(utmRules.name, "Standard UTMs")).limit(1);
if (!utm) {
  await db().insert(utmRules).values({ name: "Standard UTMs", params: DEFAULT_UTM_PARAMS });
  console.log("Created UTM rule: Standard UTMs");
}

// Template #1: the Peptide Ads launch recipe. The pixel is account-specific, so it is left unset
// on purpose; the template stays "incomplete" until an admin picks the pixel in Settings.
const PEPTIDE = "Peptide Ads — Standard Launch";
const [tpl] = await db().select().from(launchTemplates).where(eq(launchTemplates.name, PEPTIDE)).limit(1);
if (!tpl) {
  await db()
    .insert(launchTemplates)
    .values({
      name: PEPTIDE,
      clientId: null,
      config: {
        ...DEFAULT_TEMPLATE_CONFIG,
        objective: "OUTCOME_SALES",
        conversionEvent: "PURCHASE",
        budgetLevel: "campaign",
        budgetSchedule: "daily",
        defaultBudget: 100,
        attribution: { clickDays: 7, viewDays: 1, engagedViewDays: 0 },
        placements: {
          facebook: ["feed", "profile_feed", "story", "facebook_reels"],
          instagram: ["stream", "profile_feed", "explore", "story", "reels"],
        },
        countries: ["US"],
        ageMin: 25,
        ageMax: 65,
        advantageAudience: false,
        creativeFeaturesOptIn: [],
        cta: "SHOP_NOW",
      },
    });
  console.log(`Created launch template #1: ${PEPTIDE} (set its pixel in Settings → Launch templates)`);
}

console.log("Seed complete.");
