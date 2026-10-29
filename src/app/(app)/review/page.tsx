import { ArrowRight, ChevronDown, CircleCheck, History, Hourglass, Inbox, ListChecks, ShieldCheck, ShieldX, TriangleAlert, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { NoAccount } from "@/components/no-account";
import { Badge, Card, CardHeader, cn, EmptyState, PageHeader, PageSkeleton, Segmented, segmentClass, Stat, StatusDot, type Tone } from "@/components/ui";
import { hasRole } from "@/lib/auth/session";
import { delivery, formatDateTime, formatRelative } from "@/lib/format";
import { getReviewData, reasonsOf, type Reason } from "@/lib/queries/review";
import { getWorkspace } from "@/lib/workspace";
import { AcknowledgeAllButton, AcknowledgeButton } from "./ack-buttons";

export const metadata: Metadata = { title: "Ad review" };

export default function ReviewPage(props: PageProps<"/review">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Review searchParams={props.searchParams} />
    </Suspense>
  );
}

const adsHref = (name: string) => `/campaigns?level=ads&q=${encodeURIComponent(name)}`;

/** Left accent per severity: rejected / errors = danger, in review = warning. */
const ACCENT: Record<Tone, string> = {
  danger: "bg-danger",
  warning: "bg-warning",
  info: "bg-primary",
  success: "bg-success",
  muted: "bg-line",
};

async function Review({ searchParams }: { searchParams: PageProps<"/review">["searchParams"] }) {
  const sp = await searchParams;
  const { user, account, accounts } = await getWorkspace();
  if (!account && accounts.length === 0) return <NoAccount />;
  const allAccounts = sp.scope === "all" || !account;
  const canEdit = hasRole(user, "buyer");
  const { open, history, snapshot } = await getReviewData(account?.id ?? null, allAccounts);

  const countStatus = (...statuses: string[]) => snapshot.filter((a) => statuses.includes(a.effectiveStatus)).length;
  const stats: { label: string; value: number; footer: string; icon: LucideIcon; tint: string }[] = [
    { label: "Needs attention", value: open.length, footer: "Unacknowledged events", icon: Inbox, tint: "bg-primary-soft text-primary-ink" },
    { label: "Rejected", value: countStatus("DISAPPROVED"), footer: "Disapproved by Meta", icon: ShieldX, tint: "bg-danger-soft text-danger-ink" },
    { label: "With issues", value: countStatus("WITH_ISSUES"), footer: "Delivery errors", icon: TriangleAlert, tint: "bg-danger-soft text-danger-ink" },
    { label: "In review", value: countStatus("PENDING_REVIEW", "IN_PROCESS"), footer: "Pending Meta's review", icon: Hourglass, tint: "bg-warning-soft text-warning-ink" },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Ad review"
        description={
          <>
            Rejections and delivery issues from Meta&apos;s ad review.{" "}
            {account && <>Checked {formatRelative(account.lastReviewSyncAt)} for {account.name}.</>}
          </>
        }
        actions={
          <>
            {account && (
              <Segmented className="max-w-full">
                <ScopeLink href="/review" active={!allAccounts} label={account.name} />
                <ScopeLink href="/review?scope=all" active={allAccounts} label="All accounts" />
              </Segmented>
            )}
            {canEdit && <AcknowledgeAllButton accountId={allAccounts ? null : (account?.id ?? null)} count={open.length} />}
          </>
        }
      />

      {account && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map(({ label, value, footer, icon: Icon, tint }) => (
            <Stat
              key={label}
              label={label}
              value={value}
              footer={<span className="max-sm:hidden">{footer}</span>}
              visual={
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", value === 0 ? "bg-hover text-faint" : tint)}>
                  <Icon className="size-4" aria-hidden />
                </span>
              }
            />
          ))}
        </div>
      )}

      {/* Inbox */}
      <section className="flex flex-col gap-3" aria-labelledby="review-inbox">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="review-inbox" className="flex items-center gap-2 text-[14.5px] font-semibold tracking-tight">
            Needs attention
            <span className="tabular rounded-full bg-hover px-1.5 text-[11.5px] font-medium leading-5 text-muted ring-1 ring-inset ring-line">{open.length}</span>
          </h2>
          <p className="text-xs text-faint">Rejected or flagged since you last checked. Acknowledge once handled.</p>
        </div>
        {open.length === 0 ? (
          <Card>
            <EmptyState icon={ShieldCheck} title="Nothing needs attention">
              New rejections and delivery issues will show up here automatically.
            </EmptyState>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {open.map((e) => {
              const t = delivery(e.toStatus);
              return (
                <li key={e.id} className="relative overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                  <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", ACCENT[t.tone])} />
                  <div className="flex flex-col gap-4 py-4 pl-5 pr-4 sm:flex-row sm:items-start sm:pr-5">
                    <div className="flex min-w-0 flex-1 gap-4">
                      <Thumb url={e.thumbnailUrl} />
                      <div className="min-w-0 flex-1">
                        <Link href={adsHref(e.adName)} className="block truncate text-[14px] font-semibold tracking-tight text-ink transition-colors hover:text-primary-ink" title={e.adName}>
                          {e.adName}
                        </Link>
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {e.accountName ?? e.adAccountId} · <time title={formatDateTime(e.createdAt)}>{formatRelative(e.createdAt)}</time>
                        </p>
                        <Transition from={e.fromStatus} to={e.toStatus} />
                      </div>
                    </div>
                    {canEdit && (
                      <div className="shrink-0 max-sm:pl-[4.5rem]">
                        <AcknowledgeButton id={e.id} />
                      </div>
                    )}
                  </div>
                  <Reasons reasons={reasonsOf(e.feedback, e.issues)} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Live snapshot */}
      {account && (
        <Card className="overflow-hidden">
          <CardHeader
            icon={ListChecks}
            title={
              <span className="inline-flex items-center gap-2">
                Current status in {account.name}
                <span className="tabular rounded-full bg-hover px-1.5 text-[11.5px] font-medium leading-5 text-muted ring-1 ring-inset ring-line">{snapshot.length}</span>
              </span>
            }
            description="Ads that are rejected, have issues, or are still in review right now."
          />
          {snapshot.length === 0 ? (
            <EmptyState icon={CircleCheck} title="All clear">
              No ads are in review or rejected in this account.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-left text-[12px] text-muted">
                    <th className="px-5 py-2.5 font-medium">Ad</th>
                    <th className="px-3 py-2.5 font-medium">Delivery</th>
                    <th className="px-5 py-2.5 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.map((a) => {
                    const d = delivery(a.effectiveStatus);
                    const reason = reasonsOf(a.reviewFeedback, a.issuesInfo)[0];
                    return (
                      <tr key={a.id} className="border-b border-line-soft transition-colors last:border-0 hover:bg-hover/60">
                        <td className="max-w-xs px-5 py-2.5">
                          <div className="flex min-w-0 items-center gap-3">
                            <Thumb url={a.thumbnailUrl} small />
                            <Link href={adsHref(a.name)} className="truncate font-medium text-ink transition-colors hover:text-primary-ink" title={a.name}>
                              {a.name}
                            </Link>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <StatusDot tone={d.tone} label={d.label} />
                        </td>
                        <td className="min-w-64 max-w-md px-5 py-2.5 text-muted">
                          {reason ? (
                            <span className="line-clamp-2" title={reason.detail}>
                              <span className="font-medium capitalize text-ink">{reason.title}</span>
                              {reason.detail ? ` · ${reason.detail}` : ""}
                            </span>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Handled */}
      {history.length > 0 && (
        <details className="group overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 transition-colors hover:bg-hover/50 [&::-webkit-details-marker]:hidden">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-muted">
              <History className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14.5px] font-semibold tracking-tight">Acknowledged history</span>
              <span className="block text-[13px] text-muted">Last {history.length} handled item{history.length === 1 ? "" : "s"}</span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-faint transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="divide-y divide-line-soft border-t border-line-soft">
            {history.map((e) => {
              const reason = reasonsOf(e.feedback, e.issues)[0];
              return (
                <li key={e.id} className="flex flex-col gap-1.5 px-5 py-3 text-[13px] sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium" title={e.adName}>
                      {e.adName}
                    </p>
                    {reason && <p className="truncate text-xs capitalize text-muted">{reason.title}</p>}
                  </div>
                  <Transition from={e.fromStatus} to={e.toStatus} inline />
                  <span className="shrink-0 text-xs text-faint sm:w-48 sm:text-right">
                    {e.accountName ?? e.adAccountId} · <time title={formatDateTime(e.createdAt)}>{formatRelative(e.createdAt)}</time>
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}

function ScopeLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} role="tab" aria-selected={active} className={cn(segmentClass(active), "min-w-0")}>
      <span className="max-w-40 truncate">{label}</span>
    </Link>
  );
}

function Transition({ from, to, inline }: { from: string | null; to: string; inline?: boolean }) {
  const t = delivery(to);
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 text-[13px]", !inline && "mt-2.5")}>
      {from && (
        <>
          <Badge tone="muted">{delivery(from).label}</Badge>
          <ArrowRight className="size-3.5 text-faint" aria-label="changed to" />
        </>
      )}
      <Badge tone={t.tone} dot>
        {t.label}
      </Badge>
    </div>
  );
}

function Reasons({ reasons }: { reasons: Reason[] }) {
  if (reasons.length === 0) return null;
  return (
    <dl className="divide-y divide-line-soft border-t border-line-soft bg-surface-2 text-[13px]">
      {reasons.map((r, i) => (
        <div key={i} className="grid grid-cols-1 gap-1 py-2.5 pl-5 pr-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4 sm:pr-5">
          <dt className="text-[11px] font-medium uppercase tracking-wider text-faint sm:pt-0.5">{r.scope}</dt>
          <dd className="min-w-0">
            <p className="font-medium capitalize">{r.title}</p>
            {r.detail && <p className="mt-0.5 break-words text-muted">{r.detail}</p>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Thumb({ url, small }: { url: string | null; small?: boolean }) {
  const size = small ? "size-8 rounded-md" : "size-14 rounded-lg";
  if (!url)
    return (
      <div className={cn(size, "grid shrink-0 place-items-center border border-line-soft bg-hover text-faint")} aria-hidden>
        {!small && <ShieldX className="size-4" />}
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element -- Meta CDN thumbnails, already sized
  return <img src={url} alt="" className={cn(size, "shrink-0 border border-line-soft object-cover")} />;
}
