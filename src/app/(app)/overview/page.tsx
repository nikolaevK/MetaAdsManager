import { ArrowRight, ChartColumn, ChevronRight, CircleCheck, Filter, Hourglass, ImageIcon, Megaphone, OctagonAlert, PieChart, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DateRangePicker } from "@/components/date-range-picker";
import { NoAccount } from "@/components/no-account";
import { buttonClass, Card, CardHeader, cn, EmptyState, PageHeader, PageSkeleton, StatusDot } from "@/components/ui";
import { pageDateRange } from "@/lib/date-range";
import { delivery, formatMoney, formatNumber, formatRelative } from "@/lib/format";
import { formatMetric, METRIC_BY_KEY } from "@/lib/metrics";
import { getOverviewPrefs } from "@/lib/preferences";
import { getOverview } from "@/lib/queries/overview";
import { getWorkspace } from "@/lib/workspace";
import { Funnel, SpendMix } from "./breakdowns";
import { OverviewDashboard } from "./dashboard";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage(props: PageProps<"/overview">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Overview searchParams={props.searchParams} />
    </Suspense>
  );
}

const roas = METRIC_BY_KEY.get("roas")!;
const cpr = METRIC_BY_KEY.get("cpr")!;
const ctr = METRIC_BY_KEY.get("ctr")!;

async function Overview({ searchParams }: { searchParams: PageProps<"/overview">["searchParams"] }) {
  const sp = await searchParams;
  const { user, account } = await getWorkspace();
  if (!account) return <NoAccount />;

  const range = await pageDateRange(sp, account.timezoneName);
  const [data, prefs] = await Promise.all([getOverview(account.id, range), getOverviewPrefs(user.id)]);
  const money = (n: number) => formatMoney(n, account.currency);

  const hasData = data.current.impressions > 0 || data.current.spend > 0;
  const syncing = !account.insightsBackfilledAt;
  const dateQuery = range.preset === "custom" ? `since=${range.since}&until=${range.until}` : `preset=${range.preset}`;
  const campaignHref = (id: string) => `/campaigns?level=adsets&campaigns=${id}&${dateQuery}`;
  const empty = (
    <EmptyState icon={ChartColumn} title={syncing ? "Insights are syncing…" : "No delivery in this date range"}>
      {syncing
        ? "The first 90 days of insights are being pulled from Meta in the background. This page fills in automatically."
        : "Try a wider date range, or check that campaigns are turned on."}
    </EmptyState>
  );

  const statusTiles: StatusTileProps[] = [
    { label: "Active ads", value: data.ads.active, tone: "success", icon: CircleCheck, caption: "Delivering now", href: "/campaigns?level=ads&status=active" },
    { label: "In review", value: data.ads.inReview, tone: "warning", icon: Hourglass, caption: data.ads.inReview ? "Waiting on Meta" : "Nothing pending", href: "/review" },
    { label: "Rejected or with issues", value: data.ads.problems, tone: "danger", icon: OctagonAlert, caption: data.ads.problems ? "Needs attention" : "All clear", href: "/review" },
  ];

  return (
    <div>
      <PageHeader
        title="Overview"
        description={`${account.name} · insights updated ${formatRelative(account.lastInsightsSyncAt)}`}
        actions={<DateRangePicker since={range.since} until={range.until} preset={range.preset} today={range.today} />}
      />

      <div className="flex flex-col gap-5">
        <OverviewDashboard
          current={data.current}
          previous={data.previous}
          series={data.series}
          previousSeries={data.previousSeries}
          previousRange={data.previousRange}
          prefs={prefs}
          currency={account.currency}
          hasData={hasData}
          empty={empty}
        />

        <section aria-labelledby="status-heading" className="flex flex-col gap-3">
          <h2 id="status-heading" className="text-[11px] font-medium uppercase tracking-wider text-faint">
            Ad status
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {statusTiles.map((t) => (
              <li key={t.label}>
                <StatusTile {...t} />
              </li>
            ))}
          </ul>
        </section>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader icon={PieChart} title="Spend mix" description="Where the budget went in this period" />
            <div className="p-4 sm:p-5">
              {data.top.length ? <SpendMix items={data.top} total={data.current.spend} currency={account.currency} dateQuery={dateQuery} /> : empty}
            </div>
          </Card>
          <Card>
            <CardHeader icon={Filter} title="Conversion funnel" description="How people move from seeing an ad to converting" />
            <div className="p-4 sm:p-5">{hasData ? <Funnel sums={data.current} currency={account.currency} /> : empty}</div>
          </Card>
        </div>

        {data.topAds.length > 0 && (
          <Card className="overflow-hidden">
            <CardHeader
              icon={ImageIcon}
              title="Top ads by spend"
              description="The creatives carrying the account right now"
              actions={
                <Link href={`/campaigns?level=ads&${dateQuery}`} className={buttonClass("ghost", "sm")}>
                  All ads <ArrowRight aria-hidden />
                </Link>
              }
            />
            <ul className="grid grid-cols-1 gap-px bg-line-soft sm:grid-cols-2 xl:grid-cols-3">
              {data.topAds.map((a) => {
                const d = delivery(a.status);
                return (
                  <li key={a.id} className="flex gap-3 bg-surface p-4">
                    {a.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- Meta CDN thumbnail
                      <img src={a.thumbnailUrl} alt="" className="size-16 shrink-0 rounded-lg border border-line-soft object-cover" />
                    ) : (
                      <span className="grid size-16 shrink-0 place-items-center rounded-lg border border-line-soft bg-surface-2 text-faint">
                        <ImageIcon className="size-5" aria-hidden />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium" title={a.name}>
                        {a.name}
                      </p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        <StatusDot tone={d.tone} label={d.label} />
                      </p>
                      <dl className="tabular mt-2 grid grid-cols-3 gap-2 text-[12px]">
                        {[
                          ["Spent", money(a.spend)],
                          ["ROAS", formatMetric(roas, roas.value(a), account.currency)],
                          [a.purchases > 0 ? "CPA" : "CTR", a.purchases > 0 ? formatMetric(cpr, a.spend / a.purchases, account.currency) : formatMetric(ctr, ctr.value(a), account.currency)],
                        ].map(([k, v]) => (
                          <div key={k}>
                            <dt className="text-faint">{k}</dt>
                            <dd className="font-medium text-ink">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <Card className="overflow-hidden">
          <CardHeader
            icon={Megaphone}
            title="Top campaigns by spend"
            description="Share of account spend in this period"
            actions={
              <Link href={`/campaigns?${dateQuery}`} className={buttonClass("ghost", "sm")}>
                View all <ArrowRight aria-hidden />
              </Link>
            }
          />
          {data.top.length === 0 ? (
            <EmptyState icon={Megaphone} title={syncing ? "Insights are syncing…" : "No campaign spend in this date range"}>
              {syncing ? "Campaigns appear here as soon as their insights arrive." : "Pick a wider date range to compare campaigns."}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="tabular w-full border-separate border-spacing-0 text-[13px]">
                <thead>
                  <tr className="text-left text-[12px] text-muted">
                    <th scope="col" className="h-10 whitespace-nowrap border-b border-line bg-surface-2 pl-5 pr-3 font-medium">Campaign</th>
                    <th scope="col" className="h-10 whitespace-nowrap border-b border-line bg-surface-2 px-3 font-medium">Delivery</th>
                    <th scope="col" className="h-10 whitespace-nowrap border-b border-line bg-surface-2 px-3 text-right font-medium">Amount spent</th>
                    <th scope="col" className="h-10 whitespace-nowrap border-b border-line bg-surface-2 px-3 font-medium">Share of spend</th>
                    <th scope="col" className="h-10 whitespace-nowrap border-b border-line bg-surface-2 px-3 text-right font-medium">Results</th>
                    <th scope="col" className="h-10 whitespace-nowrap border-b border-line bg-surface-2 px-3 text-right font-medium">Cost per result</th>
                    <th scope="col" className="h-10 whitespace-nowrap border-b border-line bg-surface-2 pl-3 pr-5 text-right font-medium">Purchase ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top.map((c, i) => {
                    const d = delivery(c.status);
                    const share = data.current.spend > 0 ? (c.spend / data.current.spend) * 100 : 0;
                    const td = cn("border-line-soft py-3", i < data.top.length - 1 && "border-b");
                    return (
                      <tr key={c.id} className="group transition-colors hover:bg-hover/60">
                        <td className={cn(td, "pl-5 pr-3")}>
                          <Link href={campaignHref(c.id)} className="flex min-w-48 max-w-80 items-center gap-2.5 font-medium text-ink transition-colors hover:text-primary-ink" title={c.name}>
                            <span className="tabular grid size-6 shrink-0 place-items-center rounded-md border border-line-soft bg-surface-2 text-[11px] font-medium text-muted">{i + 1}</span>
                            <span className="truncate">{c.name}</span>
                            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-faint transition-opacity can-hover:opacity-0 can-hover:group-hover:opacity-100" />
                          </Link>
                        </td>
                        <td className={cn(td, "whitespace-nowrap px-3 text-ink")}>
                          <StatusDot tone={d.tone} label={d.label} />
                        </td>
                        <td className={cn(td, "whitespace-nowrap px-3 text-right text-ink")}>{money(c.spend)}</td>
                        <td className={cn(td, "px-3")}>
                          <div className="flex items-center gap-2.5">
                            <div role="meter" aria-label={`Share of spend for ${c.name}`} aria-valuenow={Math.round(share)} aria-valuemin={0} aria-valuemax={100} className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-hover">
                              <div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.min(100, share)}%` }} />
                            </div>
                            <span className="w-10 text-right text-[12px] text-muted">{share < 1 && share > 0 ? "<1" : Math.round(share)}%</span>
                          </div>
                        </td>
                        <td className={cn(td, "whitespace-nowrap px-3 text-right text-ink")}>{c.results ? formatNumber(c.results) : "—"}</td>
                        <td className={cn(td, "whitespace-nowrap px-3 text-right text-ink")}>{formatMetric(cpr, cpr.value(c), account.currency)}</td>
                        <td className={cn(td, "whitespace-nowrap pl-3 pr-5 text-right text-ink")}>{formatMetric(roas, roas.value(c), account.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

type StatusTileProps = {
  label: string;
  value: number;
  tone: "success" | "warning" | "danger";
  icon: LucideIcon;
  caption: string;
  href: string;
};

const TINT: Record<StatusTileProps["tone"], string> = {
  success: "bg-success-soft text-success-ink",
  warning: "bg-warning-soft text-warning-ink",
  danger: "bg-danger-soft text-danger-ink",
};

function StatusTile({ label, value, tone, icon: Icon, caption, href }: StatusTileProps) {
  // Problems at zero read as calm, not alarming.
  const quiet = value === 0 && tone !== "success";
  return (
    <Link
      href={href}
      className="group flex h-full items-center gap-3 rounded-xl border border-line bg-surface p-4 shadow-card transition-colors hover:bg-hover/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
    >
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", quiet ? "bg-hover text-faint" : TINT[tone])}>
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium text-muted">{label}</p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="tabular text-xl font-semibold leading-none tracking-tight">{formatNumber(value)}</span>
          <span className="truncate text-xs text-faint">{caption}</span>
        </p>
      </div>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-faint transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-ink" />
    </Link>
  );
}
