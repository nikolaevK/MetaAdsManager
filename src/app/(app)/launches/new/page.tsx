import { and, eq } from "drizzle-orm";
import { Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { NoAccount } from "@/components/no-account";
import { Alert, buttonClass, Card, EmptyState, PageHeader, PageSkeleton } from "@/components/ui";
import { failure } from "@/lib/action-result";
import { hasRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { adsets } from "@/lib/db/schema";
import { todayIn } from "@/lib/dates";
import { blankState, hydrate, withParent, type BuilderState, type ParentView } from "@/lib/launch/draft";
import { formatDateToken } from "@/lib/launch/naming";
import { loadLaunchParent } from "@/lib/launch/parent";
import type { LaunchTarget } from "@/lib/launch/spec";
import { buildUrlTags } from "@/lib/launch/utm";
import { PREVIEW_FORMATS } from "@/lib/meta/previews";
import { getBuilderData, getDraft } from "@/lib/queries/launches";
import { getParentOptions } from "@/lib/queries/manage";
import { getWorkspace, type Account } from "@/lib/workspace";
import { AddTargetPicker } from "./add-target-picker";
import { LaunchBuilder } from "./builder";

export const metadata: Metadata = { title: "Campaign builder" };

export default function NewLaunchPage(props: PageProps<"/launches/new">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewLaunch searchParams={props.searchParams} />
    </Suspense>
  );
}

const metaIdParam = (v: unknown) => (typeof v === "string" && /^\d{1,32}$/.test(v) ? v : null);

const TITLES: Record<LaunchTarget["mode"], { title: string; description: string }> = {
  new: {
    title: "Campaign builder",
    description: "Build the campaign, its ad sets and ads step by step. Your draft saves as you go; everything is created paused, previewed, then approved.",
  },
  campaign: {
    title: "Add ad sets",
    description: "Add new ad sets and their ads to an existing campaign. They're created paused, previewed, then approved; the campaign itself doesn't change.",
  },
  adset: {
    title: "Add ads",
    description: "Add new ads to an existing ad set. They're created paused, previewed, then approved; the ad set itself doesn't change.",
  },
};

/** The existing campaign / ad set named in the URL (?campaign= or ?adset=), if any. */
async function targetFromParams(sp: Record<string, string | string[] | undefined>, account: Account): Promise<LaunchTarget> {
  const adsetId = metaIdParam(sp.adset);
  if (adsetId) {
    const [row] = await db()
      .select({ campaignId: adsets.campaignId })
      .from(adsets)
      .where(and(eq(adsets.id, adsetId), eq(adsets.adAccountId, account.id)))
      .limit(1);
    // Unknown ids fall through to loadLaunchParent, which explains the problem.
    return { mode: "adset", adsetId, campaignId: row?.campaignId ?? "0" };
  }
  const campaignId = metaIdParam(sp.campaign);
  return campaignId ? { mode: "campaign", campaignId } : { mode: "new" };
}

function parentView(target: Exclude<LaunchTarget, { mode: "new" }>, p: Awaited<ReturnType<typeof loadLaunchParent>>): ParentView {
  const c = p.campaign;
  const s = p.adset;
  return {
    target,
    campaign: {
      name: c.name,
      objective: c.objective,
      budgetLevel: c.budgetLevel,
      budgetSchedule: c.budgetSchedule,
      bidStrategy: c.bidStrategy,
      specialAdCategories: c.specialAdCategories,
      budget: p.campaignBudget,
      status: p.campaignStatus,
    },
    adset: s && {
      name: s.name,
      destination: s.destination,
      messagingApps: s.messagingApps,
      goal: s.optimizationGoal,
      pixelId: s.pixelId ?? "",
      conversionEvent: s.conversionEvent ?? "",
      appId: s.app?.id ?? "",
      appStoreUrl: s.app?.storeUrl ?? "",
      attribution: s.attribution,
      audience: s.audience,
      placements: s.placements,
      status: p.adsetStatus ?? "",
    },
  };
}

async function NewLaunch({ searchParams }: { searchParams: PageProps<"/launches/new">["searchParams"] }) {
  const sp = await searchParams;
  const { user, account } = await getWorkspace();
  if (!hasRole(user, "buyer")) {
    return (
      <Card>
        <EmptyState icon={Lock} title="You don't have permission to create launches">Ask an admin for the buyer role.</EmptyState>
      </Card>
    );
  }
  if (!account) return <NoAccount />;

  const data = await getBuilderData(account.clientId);
  if (!data) return <NoAccount />;

  // Date token in the ad account's timezone so names match the account's reporting day.
  const dateToken = formatDateToken(new Date(`${todayIn(account.timezoneName)}T12:00:00`));
  const urlTags = buildUrlTags(data.utmParams);

  const draftParam = typeof sp.draft === "string" && /^[A-Za-z0-9-]{1,64}$/.test(sp.draft) ? sp.draft : null;
  const draft = draftParam ? await getDraft(draftParam) : null;
  // A draft belongs to one ad account; it only opens while that account is selected.
  const draftHere = draft && draft.clientId === account.clientId && draft.adAccountId === account.id ? draft : null;
  const blank = blankState({ pageId: account.defaultPageId ?? "", igId: account.defaultInstagramUserId ?? "", urlTags, template: data.templates[0] });
  let initialState: BuilderState = draftHere ? hydrate(draftHere.state, blank) : blank;

  // Adding to an existing campaign / ad set: from the draft, or from the URL for a fresh builder.
  const target = draftHere ? initialState.target : await targetFromParams(sp, account);
  const add = sp.add === "adsets" || sp.add === "ads" ? sp.add : null;
  const { title, description } = TITLES[target.mode !== "new" ? target.mode : add === "ads" ? "adset" : add === "adsets" ? "campaign" : "new"];
  const header = (
    <PageHeader
      title={title}
      description={description}
      actions={
        <Link href="/launches" className={buttonClass("secondary", "sm")}>
          Close
        </Link>
      }
    />
  );

  if (target.mode === "new" && add && !draftHere) {
    return (
      <div className="mx-auto max-w-6xl">
        {header}
        <AddTargetPicker level={add} options={await getParentOptions(account.id)} />
      </div>
    );
  }

  let parent: ParentView | null = null;
  if (target.mode !== "new") {
    try {
      parent = parentView(target, await loadLaunchParent(account, target));
    } catch (err) {
      return (
        <div className="mx-auto max-w-6xl">
          {header}
          <Alert tone="danger" title={target.mode === "campaign" ? "Can't add ad sets to that campaign" : "Can't add ads to that ad set"}>
            {failure(err)?.error ?? "It couldn't be loaded from Meta."}
            <div className="mt-2 flex flex-wrap gap-2">
              <Link href="/launches/new" className={buttonClass("secondary", "sm")}>
                Build a new campaign instead
              </Link>
              {draftHere && (
                <Link href="/launches" className={buttonClass("ghost", "sm")}>
                  Back to launches (the draft is kept)
                </Link>
              )}
            </div>
          </Alert>
        </div>
      );
    }
    initialState = withParent(initialState, parent);
    // A fresh builder opens on the first step there is something to fill in.
    if (!draftHere) initialState = { ...initialState, step: target.mode === "adset" ? 2 : 1 };
  }

  return (
    <div className="mx-auto max-w-6xl">
      {header}
      {draftParam && !draftHere && (
        <div className="mb-5">
          <Alert tone="warning" title="Draft not available here">
            {draft ? "That draft belongs to another ad account. Switch to it in the account switcher to keep editing it." : "That draft no longer exists."} You&apos;re starting a new campaign.
          </Alert>
        </div>
      )}
      {draftHere?.launchId && (
        <div className="mb-5">
          <Alert tone="info" title="This draft was already launched">
            Publishing again creates a new, separate launch. <Link href={`/launches/${draftHere.launchId}`} className="font-semibold underline">View the earlier launch</Link>
          </Alert>
        </div>
      )}
      <LaunchBuilder
        client={{ id: data.client.id, name: data.client.name }}
        account={{ id: account.id, name: account.name, currency: account.currency, timezoneName: account.timezoneName }}
        templates={data.templates}
        invalidTemplates={data.invalidTemplates}
        creatives={data.creatives}
        assets={data.assets}
        naming={data.naming}
        urlTags={urlTags}
        dateToken={dateToken}
        formats={PREVIEW_FORMATS}
        initialState={initialState}
        draftId={draftHere?.id ?? null}
        parent={parent}
      />
    </div>
  );
}
