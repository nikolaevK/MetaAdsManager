import { Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { NoAccount } from "@/components/no-account";
import { Alert, buttonClass, Card, EmptyState, PageHeader, PageSkeleton } from "@/components/ui";
import { hasRole } from "@/lib/auth/session";
import { todayIn } from "@/lib/dates";
import { blankState, hydrate } from "@/lib/launch/draft";
import { formatDateToken } from "@/lib/launch/naming";
import { buildUrlTags } from "@/lib/launch/utm";
import { PREVIEW_FORMATS } from "@/lib/meta/previews";
import { getBuilderData, getDraft } from "@/lib/queries/launches";
import { getWorkspace } from "@/lib/workspace";
import { LaunchBuilder } from "./builder";

export const metadata: Metadata = { title: "Campaign builder" };

export default function NewLaunchPage(props: PageProps<"/launches/new">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewLaunch searchParams={props.searchParams} />
    </Suspense>
  );
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
  const initialState = draftHere ? hydrate(draftHere.state, blank) : blank;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Campaign builder"
        description="Build the campaign, its ad sets and ads step by step. Your draft saves as you go; everything is created paused, previewed, then approved."
        actions={
          <Link href="/launches" className={buttonClass("secondary", "sm")}>
            Close
          </Link>
        }
      />
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
      />
    </div>
  );
}
