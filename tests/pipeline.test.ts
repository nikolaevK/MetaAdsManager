import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeGraph } from "./fake-graph";

// Environment must be set before any app module reads env().
const dir = mkdtempSync(path.join(tmpdir(), "mam-test-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.META_ACCESS_TOKEN = "test-token";
process.env.META_APP_SECRET = "test-secret";

const graph = new FakeGraph();
vi.stubGlobal("fetch", graph.fetch);

// Library files: an in-memory stand-in for the Blob store.
const files = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  readObject: async (key: string) => files.get(key) ?? null,
  readRange: async (key: string, start: number, end: number) => files.get(key)?.subarray(start, end) ?? null,
  deleteObjects: async (keys: string[]) => keys.forEach((k) => files.delete(k)),
}));

type Mods = {
  db: typeof import("@/lib/db");
  schema: typeof import("@/lib/db/schema");
  pipeline: typeof import("@/lib/launch/pipeline");
  queue: typeof import("@/lib/jobs/queue");
  worker: typeof import("@/lib/jobs/worker");
  spec: typeof import("@/lib/launch/spec");
  orm: typeof import("drizzle-orm");
};
let m: Mods;
let launchId: string;
const CLIENT = "11111111-1111-4111-8111-111111111111";

async function seedLaunch() {
  const { db, schema, spec } = m;
  const [asset1, asset2] = ["sq", "vt"].map((n) => {
    const key = `${CLIENT}/${n}-${crypto.randomUUID()}.jpg`;
    files.set(key, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    return { id: crypto.randomUUID(), key };
  });
  await db.db().insert(schema.creativeAssets).values([
    { id: asset1.id, clientId: CLIENT, kind: "image", fileName: "a_1x1.jpg", storageKey: asset1.key, mimeType: "image/jpeg", sizeBytes: 7, width: 1080, height: 1080, aspect: "1:1", sha256: crypto.randomUUID() },
    { id: asset2.id, clientId: CLIENT, kind: "image", fileName: "a_9x16.jpg", storageKey: asset2.key, mimeType: "image/jpeg", sizeBytes: 7, width: 1080, height: 1920, aspect: "9:16", sha256: crypto.randomUUID() },
  ]);
  const creativeId = crypto.randomUUID();
  await db.db().insert(schema.creatives).values({ id: creativeId, clientId: CLIENT, name: "Hero", kind: "image", squareAssetId: asset1.id, verticalAssetId: asset2.id });

  const ad = (name: string) => ({ name, creativeId, primaryText: "Body", headline: "Head", url: "https://example.com", cta: "SHOP_NOW" as const });
  const launchSpec = {
    clientId: CLIENT,
    adAccountId: "act_1",
    templateId: "t",
    pageId: "111",
    campaign: { name: "Launch Campaign", budget: 100 },
    adsets: [
      { name: "US 25-65", countries: ["US"], ageMin: 25, ageMax: 65 },
      { name: "CA 25-65", countries: ["CA"], ageMin: 25, ageMax: 65 },
    ],
    ads: [ad("Ad A"), ad("Ad B")],
    config: { ...spec.DEFAULT_TEMPLATE_CONFIG, pixelId: "999" },
    urlTags: "utm_source=fb",
  };
  const [row] = await db.db()
    .insert(schema.launches)
    .values({ idempotencyKey: crypto.randomUUID(), clientId: CLIENT, adAccountId: "act_1", name: "Test", spec: launchSpec })
    .returning();
  return row.id;
}

async function getLaunch() {
  const [row] = await m.db.db().select().from(m.schema.launches).where(m.orm.eq(m.schema.launches.id, launchId));
  return row;
}

/** Runs the builder the way the worker would, following retry instructions. */
async function build() {
  for (let i = 0; i < 10; i++) {
    const res = await m.pipeline.buildLaunch(launchId);
    if (!res) return;
  }
  throw new Error("build did not finish");
}

beforeAll(async () => {
  m = {
    db: await import("@/lib/db"),
    schema: await import("@/lib/db/schema"),
    pipeline: await import("@/lib/launch/pipeline"),
    queue: await import("@/lib/jobs/queue"),
    worker: await import("@/lib/jobs/worker"),
    spec: await import("@/lib/launch/spec"),
    orm: await import("drizzle-orm"),
  };
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  await migrate(m.db.db(), { migrationsFolder: "drizzle" });
  const [client] = await m.db.db().insert(m.schema.clients).values({ id: CLIENT, name: "Acme" }).returning();
  await m.db.db().insert(m.schema.adAccounts).values({ id: "act_1", clientId: client.id, name: "Acme US", currency: "USD", timezoneName: "UTC" });
});

beforeEach(async () => {
  graph.objects.clear();
  graph.calls = [];
  graph.failOn = () => null;
  launchId = await seedLaunch();
});

afterAll(() => vi.unstubAllGlobals());

describe("launch pipeline", () => {
  it("creates media → creatives → campaign → ad sets → ads, all paused, then waits for approval", async () => {
    await build();
    const launch = await getLaunch();
    expect(launch.status).toBe("ready_for_review");
    expect(graph.byType("creative")).toHaveLength(2);
    expect(graph.byType("campaign")).toHaveLength(1);
    expect(graph.byType("adset")).toHaveLength(2);
    expect(graph.byType("ad")).toHaveLength(4);
    for (const t of ["campaign", "adset", "ad"]) expect(graph.byType(t).every((o) => o.status === "PAUSED")).toBe(true);

    const creative = graph.byType("creative")[0].params;
    const afs = JSON.parse(creative.asset_feed_spec);
    expect(afs.asset_customization_rules).toHaveLength(2);
    expect(JSON.parse(creative.degrees_of_freedom_spec).creative_features_spec.image_touchups).toEqual({ enroll_status: "OPT_OUT" });

    // Ads are created through the batch endpoint and point at the created creative/ad set ids.
    const ad = graph.byType("ad")[0].params;
    expect(graph.objects.get(JSON.parse(ad.creative).creative_id)?.type).toBe("creative");
    expect(graph.objects.get(ad.adset_id)?.type).toBe("adset");
    expect(launch.metaCampaignId).toBe(graph.byType("campaign")[0].id);
  });

  it("is idempotent: re-running a finished build creates nothing new", async () => {
    await build();
    const before = graph.objects.size;
    await m.db.db().update(m.schema.launches).set({ status: "building" }).where(m.orm.eq(m.schema.launches.id, launchId));
    await build();
    expect(graph.objects.size).toBe(before);
  });

  it("reconciles an object Meta created before we could record its id (no duplicate campaign)", async () => {
    // Simulate a crash: campaign exists in Meta, ledger only has a pending row.
    const existing = graph.create("campaign", { name: "Launch Campaign", status: "PAUSED" });
    await m.db.db().insert(m.schema.launchObjects).values({ launchId, ref: "campaign", kind: "campaign", name: "Launch Campaign", status: "pending" });
    await build();
    expect(graph.byType("campaign").map((c) => c.id)).toEqual([existing.id]);
    expect((await getLaunch()).metaCampaignId).toBe(existing.id);
  });

  it("rolls back everything when a step fails permanently, so nothing half-built remains", async () => {
    graph.failOn = (method, p, params) =>
      method === "POST" && p === "act_1/ads" && params.name === "Ad B" ? { code: 100, message: "Invalid creative" } : null;
    const err = await build().catch((e) => e);
    expect(err?.message).toMatch(/Invalid creative/);

    // What the worker does after a permanent failure:
    await m.pipeline.failBuild(launchId, err);
    expect((await getLaunch()).status).toBe("rolling_back");
    const typeOf = new Map([...graph.objects.values()].map((o) => [o.id, o.type]));
    await m.pipeline.rollbackLaunch(launchId, "failed");

    expect(graph.byType("campaign")).toHaveLength(0);
    expect(graph.byType("adset")).toHaveLength(0);
    expect(graph.byType("ad")).toHaveLength(0);
    expect(graph.byType("creative")).toHaveLength(0);
    const launch = await getLaunch();
    expect(launch.status).toBe("failed");
    expect(launch.error).toMatch(/Invalid creative/);
    // Deletion order: ads before ad sets before the campaign.
    const deleted = graph.calls.filter((c) => c.method === "DELETE").map((c) => typeOf.get(c.path));
    expect(deleted).toEqual(["ad", "ad", "adset", "adset", "campaign", "creative", "creative"]);
  });

  it("activates ads, then ad sets, then the campaign last", async () => {
    await build();
    await m.db.db().update(m.schema.launches).set({ status: "activating" }).where(m.orm.eq(m.schema.launches.id, launchId));
    graph.calls = [];
    await m.pipeline.activateLaunch(launchId);
    const order = graph.calls.filter((c) => c.params.status === "ACTIVE").map((c) => graph.objects.get(c.path)?.type);
    expect(order).toEqual(["ad", "ad", "ad", "ad", "adset", "adset", "campaign"]);
    expect((await getLaunch()).status).toBe("active");
  });

  it("builds a builder (v2) launch with one creative per ad for each kind of ad set", async () => {
    const [old] = await m.db.db().select().from(m.schema.launches).where(m.orm.eq(m.schema.launches.id, launchId));
    const v1 = m.spec.normalizeSpec(old.spec);
    const website = v1.adsets[0];
    const messaging = { ...website, name: "WA chats", destination: "messaging" as const, messagingApps: ["WHATSAPP" as const], optimizationGoal: "CONVERSATIONS" as const };
    const v2 = {
      ...v1,
      campaign: { ...v1.campaign, objective: "OUTCOME_SALES" as const, budgetLevel: "adset" as const },
      adsets: [{ ...website, budget: 30 }, { ...messaging, budget: 20 }],
      ads: v1.ads.map((a) => ({ ...a, creativeFeaturesOptIn: ["inline_comment" as const] })),
    };
    await m.db.db().update(m.schema.launches).set({ spec: v2 }).where(m.orm.eq(m.schema.launches.id, launchId));
    await build();

    expect((await getLaunch()).status).toBe("ready_for_review");
    const creatives = graph.byType("creative");
    expect(creatives).toHaveLength(4); // 2 ads × (website, messaging)
    const adsets = graph.byType("adset");
    const wa = adsets.find((a) => a.params.name === "WA chats")!;
    expect(wa.params.destination_type).toBe("WHATSAPP");
    // Sales → WhatsApp conversations: the Page only (a pixel event is only documented for Messenger alone).
    expect(JSON.parse(wa.params.promoted_object)).toEqual({ page_id: "111" });
    expect(wa.params.daily_budget).toBe("2000");

    // Each ad points at the creative built for its own ad set's destination.
    for (const ad of graph.byType("ad")) {
      const creative = graph.objects.get(JSON.parse(ad.params.creative).creative_id)!;
      const story = JSON.parse(creative.params.object_story_spec);
      if (ad.params.adset_id === wa.id) expect(story.link_data.call_to_action.type).toBe("WHATSAPP_MESSAGE");
      else expect(JSON.parse(creative.params.asset_feed_spec).optimization_type).toBe("PLACEMENT");
    }
  });

  it("uploads every Flexible-format file and puts them all in the ad's creative", async () => {
    const [old] = await m.db.db().select().from(m.schema.launches).where(m.orm.eq(m.schema.launches.id, launchId));
    const v1 = m.spec.normalizeSpec(old.spec);
    const [lib] = await m.db.db().select().from(m.schema.creatives).where(m.orm.eq(m.schema.creatives.id, v1.ads[0].creativeId));
    const key = `${CLIENT}/extra-${crypto.randomUUID()}.jpg`;
    files.set(key, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]));
    const extra = crypto.randomUUID();
    await m.db.db().insert(m.schema.creativeAssets).values({ id: extra, clientId: CLIENT, kind: "image", fileName: "c_4x5.jpg", storageKey: key, mimeType: "image/jpeg", sizeBytes: 7, width: 1080, height: 1350, aspect: "4:5", sha256: crypto.randomUUID() });
    const v2 = { ...v1, ads: [{ ...v1.ads[0], moreAssetIds: [lib.verticalAssetId, extra] }] };
    await m.db.db().update(m.schema.launches).set({ spec: v2 }).where(m.orm.eq(m.schema.launches.id, launchId));
    await build();

    expect((await getLaunch()).status).toBe("ready_for_review");
    const [creative] = graph.byType("creative");
    const feed = JSON.parse(creative.params.asset_feed_spec);
    expect(feed).toMatchObject({ ad_formats: ["AUTOMATIC_FORMAT"], optimization_type: "REGULAR" });
    expect(new Set(feed.images.map((i: { hash: string }) => i.hash)).size).toBe(3);
  });

  it("re-pauses everything if activation fails part-way", async () => {
    await build();
    await m.db.db().update(m.schema.launches).set({ status: "activating" }).where(m.orm.eq(m.schema.launches.id, launchId));
    const campaignId = graph.byType("campaign")[0].id;
    graph.failOn = (method, p, params) => (p === campaignId && params.status === "ACTIVE" ? { code: 100, message: "Billing issue" } : null);
    await expect(m.pipeline.activateLaunch(launchId)).rejects.toThrow(/Billing issue/);
    for (const t of ["campaign", "adset", "ad"]) expect(graph.byType(t).every((o) => o.status === "PAUSED")).toBe(true);
  });
});

describe("audit regressions", () => {
  it("a stale rollback job never touches a launch that has moved on", async () => {
    await build();
    await m.db.db().update(m.schema.launches).set({ status: "active" }).where(m.orm.eq(m.schema.launches.id, launchId));
    const before = graph.objects.size;
    await m.pipeline.rollbackLaunch(launchId, "failed");
    expect(graph.objects.size).toBe(before);
    expect((await getLaunch()).status).toBe("active");
  });

  it("rollback also deletes objects whose create response was lost (pending rows)", async () => {
    await build();
    // Simulate: Meta created ad set 0 but we never recorded its id.
    await m.db.db()
      .update(m.schema.launchObjects)
      .set({ status: "pending", metaId: null })
      .where(m.orm.and(m.orm.eq(m.schema.launchObjects.launchId, launchId), m.orm.eq(m.schema.launchObjects.ref, "adset:0")));
    await m.db.db().update(m.schema.launches).set({ status: "rolling_back" }).where(m.orm.eq(m.schema.launches.id, launchId));
    await m.pipeline.rollbackLaunch(launchId, "discarded");
    expect(graph.byType("adset")).toHaveLength(0);
    expect(graph.byType("campaign")).toHaveLength(0);
    expect((await getLaunch()).status).toBe("discarded");
  });

  it("records a rejection once even when two syncs see it at the same time", async () => {
    const { recordTransitions } = await import("@/lib/sync/review");
    const adId = String(Date.now());
    const before = new Map([[adId, "PENDING_REVIEW"]]);
    const after = [{ id: adId, name: "Ad", status: "ACTIVE", effective_status: "DISAPPROVED" }];
    await Promise.all([recordTransitions("act_1", before, after), recordTransitions("act_1", before, after)]);
    const rows = await m.db.db().select().from(m.schema.reviewEvents).where(m.orm.eq(m.schema.reviewEvents.adId, adId));
    expect(rows).toHaveLength(1);
  });
});

describe("account discovery", () => {
  it("imports every ad account the token can access, grouped into clients by Meta Business", async () => {
    const { discoverAccounts } = await import("@/lib/sync/accounts");
    const acct = (id: string, name: string, business?: { id: string; name: string }) => ({
      id, name, account_status: 1, currency: "USD", timezone_name: "America/New_York", ...(business ? { business } : {}),
    });
    const ot = { id: "b1", name: "Orange Trail" };
    graph.remoteAccounts = [acct("act_200", "OT peptides", ot), acct("act_201", "OT glow", ot), acct("act_202", "Solo")];

    const first = await discoverAccounts();
    expect(first.added.sort()).toEqual(["act_200", "act_201", "act_202"]);
    const rows = await m.db.db().select().from(m.schema.adAccounts).where(m.orm.inArray(m.schema.adAccounts.id, ["act_200", "act_201", "act_202"]));
    const clientNames = new Map(
      (await m.db.db().select().from(m.schema.clients)).map((c) => [c.id, c.name]),
    );
    expect(rows.map((r) => [r.id, clientNames.get(r.clientId)]).sort()).toEqual([
      ["act_200", "Orange Trail"],
      ["act_201", "Orange Trail"],
      ["act_202", "Unassigned"],
    ]);
    const queued = await m.db.db().select({ key: m.schema.jobs.dedupeKey }).from(m.schema.jobs).where(m.orm.eq(m.schema.jobs.status, "queued"));
    for (const key of ["structure:act_200", "review:act_201", "insights:act_202:backfill"]) {
      expect(queued.map((q) => q.key)).toContain(key);
    }

    // A person moves an account to another client; a rename in Meta must not move it back.
    const [other] = await m.db.db().insert(m.schema.clients).values({ name: "Moved here" }).returning();
    await m.db.db().update(m.schema.adAccounts).set({ clientId: other.id }).where(m.orm.eq(m.schema.adAccounts.id, "act_201"));
    graph.remoteAccounts[1] = acct("act_201", "OT glow (renamed)", ot);
    const second = await discoverAccounts();
    expect(second).toEqual({ added: [], updated: 1 });
    const [moved] = await m.db.db().select().from(m.schema.adAccounts).where(m.orm.eq(m.schema.adAccounts.id, "act_201"));
    expect(moved.name).toBe("OT glow (renamed)");
    expect(moved.clientId).toBe(other.id);
    graph.remoteAccounts = [];
  });
});

describe("review sync baseline", () => {
  it("does not flood the inbox with historical rejections before the first structure sync", async () => {
    const { syncReview } = await import("@/lib/sync/review");
    await m.db.db().insert(m.schema.clients).values({ id: "c-review", name: "Review Co" }).onConflictDoNothing();
    await m.db.db().insert(m.schema.adAccounts).values({ id: "act_300", clientId: "c-review", name: "Fresh" }).onConflictDoNothing();
    graph.calls = [];
    await syncReview("act_300");
    expect(graph.calls).toHaveLength(0); // skipped entirely, no Meta call
    const events = await m.db.db().select().from(m.schema.reviewEvents).where(m.orm.eq(m.schema.reviewEvents.adAccountId, "act_300"));
    expect(events).toHaveLength(0);
  });

  it("re-fetches ads that left review one by one, without the removed ?ids= lookup", async () => {
    const { syncReview } = await import("@/lib/sync/review");
    await m.db.db().insert(m.schema.clients).values({ id: "c-review", name: "Review Co" }).onConflictDoNothing();
    await m.db.db().insert(m.schema.adAccounts).values({ id: "act_301", clientId: "c-review", name: "Synced", lastStructureSyncAt: Date.now() });
    const rejected = graph.create("ad", { name: "Rejected", status: "DISAPPROVED" });
    const row = (id: string, name: string) => ({ id, adAccountId: "act_301", campaignId: "c", adsetId: "s", name, status: "ACTIVE", effectiveStatus: "PENDING_REVIEW", syncedAt: 0 });
    // The second ad was deleted in Meta: its lookup fails alone and must not hide the first one's outcome.
    await m.db.db().insert(m.schema.ads).values([row(rejected.id, "Rejected"), row("999999", "Deleted")]);
    graph.calls = [];
    await syncReview("act_301");

    expect(graph.calls.some((c) => c.params.ids !== undefined)).toBe(false);
    const events = await m.db.db().select().from(m.schema.reviewEvents).where(m.orm.eq(m.schema.reviewEvents.adAccountId, "act_301"));
    expect(events.map((e) => [e.adId, e.fromStatus, e.toStatus])).toEqual([[rejected.id, "PENDING_REVIEW", "DISAPPROVED"]]);
    const [ad] = await m.db.db().select().from(m.schema.ads).where(m.orm.eq(m.schema.ads.id, rejected.id));
    expect(ad.effectiveStatus).toBe("DISAPPROVED");
  });
});

describe("duplicate", () => {
  const creative = (id: string) => JSON.stringify({ creative_id: id });
  const creativeOf = (o: { params: Record<string, string> }) => (JSON.parse(o.params.creative) as { creative_id: string }).creative_id;

  it("copies a campaign one object at a time, since Meta refuses large synchronous deep copies", async () => {
    const { duplicate } = await import("@/lib/meta/mutations");
    const campaign = graph.create("campaign", { name: "Spring" });
    const sourceAds: string[] = [];
    for (const s of ["US", "CA"]) {
      const adset = graph.create("adset", { name: s, campaign_id: campaign.id });
      for (const a of ["A", "B"]) sourceAds.push(graph.create("ad", { name: `${s} ${a}`, campaign_id: campaign.id, adset_id: adset.id, creative: creative(`cr-${s}${a}`) }).id);
    }
    graph.calls = [];
    expect(await duplicate("campaign", campaign.id, "act_1")).toEqual([]);

    expect(graph.calls.some((c) => c.params.deep_copy !== undefined)).toBe(false);
    const copy = graph.byType("campaign").find((c) => c.name === "Spring - Copy")!;
    const adsets = graph.byType("adset").filter((s) => s.params.campaign_id === copy.id);
    expect(adsets.map((s) => s.name).sort()).toEqual(["CA - Copy", "US - Copy"]);
    const ads = graph.byType("ad").filter((a) => adsets.some((s) => s.id === a.params.adset_id));
    // Ads are new ads on the same creative (Meta's /copies fails on Advantage+ creatives).
    expect(ads.map((a) => [a.name, creativeOf(a)]).sort()).toEqual([
      ["CA A - Copy", "cr-CAA"],
      ["CA B - Copy", "cr-CAB"],
      ["US A - Copy", "cr-USA"],
      ["US B - Copy", "cr-USB"],
    ]);
    expect(graph.calls.some((c) => sourceAds.some((id) => c.path === `${id}/copies`))).toBe(false);
    expect([copy, ...adsets, ...ads].every((o) => o.status === "PAUSED")).toBe(true);
  });

  it("duplicates a single ad into its own ad set on the same creative", async () => {
    const { duplicate } = await import("@/lib/meta/mutations");
    const ad = graph.create("ad", { name: "Lone", adset_id: "55", creative: creative("cr-lone") });
    expect(await duplicate("ad", ad.id, "act_1")).toEqual([]);
    const copy = graph.byType("ad").find((a) => a.name === "Lone - Copy")!;
    expect([copy.params.adset_id, creativeOf(copy), copy.status]).toEqual(["55", "cr-lone", "PAUSED"]);
  });

  it("reports what it couldn't copy instead of failing the whole duplicate", async () => {
    const { duplicate } = await import("@/lib/meta/mutations");
    const adset = graph.create("adset", { name: "Solo", campaign_id: "1" });
    graph.create("ad", { name: "Good", adset_id: adset.id, creative: creative("cr-good") });
    graph.create("ad", { name: "Bad", adset_id: adset.id, creative: creative("cr-bad") });
    graph.failOn = (method, path, params) =>
      method === "POST" && path === "act_1/ads" && params.name === "Bad - Copy" ? { code: 100, message: "Creative is no longer valid" } : null;
    const failed = await duplicate("adset", adset.id, "act_1");
    graph.failOn = () => null;

    expect(failed).toEqual([expect.stringContaining('Ad "Bad": Creative is no longer valid')]);
    const copy = graph.byType("adset").find((s) => s.name === "Solo - Copy")!;
    expect(copy.params.campaign_id).toBe("1");
    expect(graph.byType("ad").filter((a) => a.params.adset_id === copy.id).map((a) => a.name)).toEqual(["Good - Copy"]);
  });

  it("retries Meta's temporary errors (code 2)", async () => {
    const { duplicate } = await import("@/lib/meta/mutations");
    const adset = graph.create("adset", { name: "Flaky", campaign_id: "1" });
    graph.create("ad", { name: "Once", adset_id: adset.id, creative: creative("cr-once") });
    let fails = 1;
    graph.failOn = (method, path) =>
      method === "POST" && path === "act_1/ads" && fails-- > 0 ? { code: 2, message: "An unexpected error has occurred. Please retry your request later." } : null;
    graph.calls = [];
    const failed = await duplicate("adset", adset.id, "act_1");
    graph.failOn = () => null;

    expect(failed).toEqual([]);
    expect(graph.calls.filter((c) => c.method === "POST" && c.path === "act_1/ads")).toHaveLength(2);
    const copy = graph.byType("adset").find((s) => s.name === "Flaky - Copy")!;
    expect(graph.byType("ad").filter((a) => a.params.adset_id === copy.id).map((a) => a.name)).toEqual(["Once - Copy"]);
  });
});

describe("job queue", () => {
  it("dedupes active jobs and runs launch builds through the worker", async () => {
    await m.queue.enqueue("launch.build", { launchId }, { dedupeKey: `launch:${launchId}`, priority: 1 });
    await m.queue.enqueue("launch.build", { launchId }, { dedupeKey: `launch:${launchId}`, priority: 1 });
    const queued = await m.db.db().select().from(m.schema.jobs).where(m.orm.eq(m.schema.jobs.dedupeKey, `launch:${launchId}`));
    expect(queued).toHaveLength(1);

    await m.worker.runWorker({ budgetMs: 10_000, concurrency: 1 });
    expect((await getLaunch()).status).toBe("ready_for_review");
  });

  it("defers jobs while the account's rate-limit bucket is blocked, without spending an attempt", async () => {
    await m.db.db().insert(m.schema.rateLimitState).values({ key: "account:act_1", usagePct: 100, blockedUntil: Date.now() + 60_000, updatedAt: Date.now() })
      .onConflictDoUpdate({ target: m.schema.rateLimitState.key, set: { usagePct: 100, blockedUntil: Date.now() + 60_000, updatedAt: Date.now() } });
    (globalThis as { __metaUsage?: Map<string, unknown> }).__metaUsage?.clear();
    await m.queue.enqueue("launch.build", { launchId }, { dedupeKey: `launch:${launchId}` });
    await m.worker.runWorker({ budgetMs: 2_000, concurrency: 1 });
    const [job] = await m.db.db().select().from(m.schema.jobs).where(m.orm.eq(m.schema.jobs.dedupeKey, `launch:${launchId}`));
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(0);
    expect(job.runAt).toBeGreaterThan(Date.now() + 30_000);
    await m.db.db().delete(m.schema.rateLimitState);
    (globalThis as { __metaUsage?: Map<string, unknown> }).__metaUsage?.clear();
  });
});

describe("launches that add to existing campaigns and ad sets", () => {
  async function retarget(target: Record<string, string>, over: (s: ReturnType<typeof m.spec.normalizeSpec>) => object = () => ({})) {
    const [old] = await m.db.db().select().from(m.schema.launches).where(m.orm.eq(m.schema.launches.id, launchId));
    const spec = m.spec.normalizeSpec(old.spec);
    await m.db.db().update(m.schema.launches).set({ spec: { ...spec, target, ...over(spec) } }).where(m.orm.eq(m.schema.launches.id, launchId));
  }

  it("adds ads to an existing ad set: nothing else is created, and only the new ads are switched on or deleted", async () => {
    const campaign = graph.create("campaign", { name: "Live campaign", status: "ACTIVE" });
    const adset = graph.create("adset", { name: "Live ad set", status: "ACTIVE", campaign_id: campaign.id });
    await retarget({ mode: "adset", campaignId: campaign.id, adsetId: adset.id }, (s) => ({ adsets: [s.adsets[0]] }));
    await build();

    expect((await getLaunch()).status).toBe("ready_for_review");
    expect(graph.byType("campaign").map((c) => c.id)).toEqual([campaign.id]);
    expect(graph.byType("adset").map((s) => s.id)).toEqual([adset.id]);
    const ads = graph.byType("ad");
    expect(ads).toHaveLength(2);
    expect(ads.every((a) => a.params.adset_id === adset.id && a.status === "PAUSED")).toBe(true);

    await m.db.db().update(m.schema.launches).set({ status: "activating" }).where(m.orm.eq(m.schema.launches.id, launchId));
    graph.calls = [];
    await m.pipeline.activateLaunch(launchId);
    const switched = graph.calls.filter((c) => c.params.status === "ACTIVE").map((c) => c.path);
    expect(switched.sort()).toEqual(ads.map((a) => a.id).sort());
    expect((await getLaunch()).status).toBe("active");

    // Discarding later removes only what the launch created.
    await m.db.db().update(m.schema.launches).set({ status: "rolling_back" }).where(m.orm.eq(m.schema.launches.id, launchId));
    await m.pipeline.rollbackLaunch(launchId, "discarded");
    expect(graph.byType("ad")).toHaveLength(0);
    expect(graph.objects.has(campaign.id) && graph.objects.has(adset.id)).toBe(true);
  });

  it("adds ad sets (with their ads) to an existing campaign without creating a new one", async () => {
    const campaign = graph.create("campaign", { name: "Live campaign", status: "ACTIVE" });
    await retarget({ mode: "campaign", campaignId: campaign.id }, (s) => ({
      campaign: { ...s.campaign, budgetLevel: "adset" },
      adsets: s.adsets.map((a) => ({ ...a, budget: 25 })),
    }));
    await build();

    expect(graph.byType("campaign").map((c) => c.id)).toEqual([campaign.id]);
    const adsets = graph.byType("adset");
    expect(adsets).toHaveLength(2);
    expect(adsets.every((s) => s.params.campaign_id === campaign.id && s.params.daily_budget === "2500")).toBe(true);
    expect(graph.byType("ad")).toHaveLength(4);

    await m.db.db().update(m.schema.launches).set({ status: "activating" }).where(m.orm.eq(m.schema.launches.id, launchId));
    graph.calls = [];
    await m.pipeline.activateLaunch(launchId);
    expect(graph.calls.some((c) => c.path === campaign.id)).toBe(false);
  });
});

describe("approval lock", () => {
  it("blocks edits to a pending launch's objects and to anything inside them, and lifts once approved", async () => {
    const ownership = await import("@/lib/queries/ownership");
    await build();
    const campaignId = graph.byType("campaign")[0].id;
    const adsetId = graph.byType("adset")[0].id;
    // An ad someone created inside the launch's ad set outside the launch (e.g. a duplicate): not in the ledger.
    const outsider = "999000111";
    await m.db.db().insert(m.schema.campaigns).values({ id: campaignId, adAccountId: "act_1", name: "c", status: "PAUSED", effectiveStatus: "PAUSED", syncedAt: Date.now() }).onConflictDoNothing();
    await m.db.db().insert(m.schema.adsets).values({ id: adsetId, adAccountId: "act_1", campaignId, name: "s", status: "PAUSED", effectiveStatus: "PAUSED", syncedAt: Date.now() }).onConflictDoNothing();
    await m.db.db().insert(m.schema.ads).values({ id: outsider, adAccountId: "act_1", campaignId, adsetId, name: "a", status: "PAUSED", effectiveStatus: "PAUSED", syncedAt: Date.now() }).onConflictDoNothing();

    await expect(ownership.assertNotAwaitingApproval("campaign", [campaignId])).rejects.toThrow(/waiting for approval/);
    await expect(ownership.assertNotAwaitingApproval("ad", [outsider])).rejects.toThrow(/waiting for approval/);

    await m.db.db().update(m.schema.launches).set({ status: "active" }).where(m.orm.eq(m.schema.launches.id, launchId));
    await expect(ownership.assertNotAwaitingApproval("ad", [outsider])).resolves.toBeUndefined();
  });
});

describe("sign-in throttle", () => {
  it("counts attempts atomically, so a burst of parallel guesses can't all get through", async () => {
    const { reserveAttempt } = await import("@/lib/auth/throttle");
    const key = `email:burst-${crypto.randomUUID()}@example.com`;
    const waits = await Promise.all(Array.from({ length: 12 }, () => reserveAttempt([{ key, max: 5 }])));
    expect(waits.filter((w) => w === 0)).toHaveLength(5);
    expect(await reserveAttempt([{ key, max: 5 }])).toBeGreaterThan(0);
  });
});

describe("campaigns table totals", () => {
  it("sums every matching object in the database and counts only spenders for “had spend”", async () => {
    const { getTableTotals } = await import("@/lib/queries/manage");
    const { db, schema } = m;
    await db.db().insert(schema.adAccounts).values({ id: "act_tot", clientId: CLIENT, name: "Totals", currency: "USD", timezoneName: "UTC" });
    const now = Date.now();
    const camp = (id: string, name: string, status = "ACTIVE") => ({ id, adAccountId: "act_tot", name, status, effectiveStatus: status, syncedAt: now });
    await db.db().insert(schema.campaigns).values([camp("t1", "Alpha"), camp("t2", "Beta"), camp("t3", "Gamma", "PAUSED")]);
    const day = (adId: string, campaignId: string, date: string, spend: number, impressions: number) => ({
      adId, date, adAccountId: "act_tot", campaignId, adsetId: `${campaignId}-s`, spend, impressions, syncedAt: now,
    });
    await db.db().insert(schema.insightsDaily).values([
      day("ta1", "t1", "2026-10-01", 10, 1000),
      day("ta1", "t1", "2026-10-02", 5, 500),
      day("ta2", "t2", "2026-10-01", 0, 40),
      day("ta1", "t1", "2026-09-01", 99, 9999), // outside the range
    ]);
    const range = { since: "2026-10-01", until: "2026-10-31", preset: "custom" as const };

    const all = await getTableTotals("act_tot", "campaigns", range, {});
    expect(all).toMatchObject({ spend: 15, impressions: 1540, objects: 3 });
    expect(await getTableTotals("act_tot", "campaigns", range, { status: "spent" })).toMatchObject({ spend: 15, objects: 1 });
    expect(await getTableTotals("act_tot", "campaigns", range, { status: "off" })).toMatchObject({ spend: 0, objects: 1 });
    expect(await getTableTotals("act_tot", "campaigns", range, { q: "BET" })).toMatchObject({ spend: 0, impressions: 40, objects: 1 });
    expect(await getTableTotals("act_tot", "campaigns", range, { campaignIds: ["t1"] })).toMatchObject({ spend: 15, objects: 1 });
  });
});
