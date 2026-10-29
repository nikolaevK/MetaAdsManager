import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DateRangePicker } from "@/components/date-range-picker";
import { NoAccount } from "@/components/no-account";
import { Badge, buttonClass, PageHeader, PageSkeleton, Stat } from "@/components/ui";
import { ParamSelect, SearchInput } from "@/components/url-filters";
import { hasRole } from "@/lib/auth/session";
import { pageDateRange } from "@/lib/date-range";
import { formatSpan, previousPeriod } from "@/lib/dates";
import { formatNumber } from "@/lib/format";
import { change, formatMetric, METRIC_BY_KEY, verdict } from "@/lib/metrics";
import { getColumnPrefs } from "@/lib/preferences";
import { getParentOptions, getTableRows, isSortKey, sortRows, STATUS_FILTERS, totals, type SortKey, type StatusFilter, type TableLevel } from "@/lib/queries/manage";
import { getWorkspace } from "@/lib/workspace";
import { AdsTable } from "./ads-table";

export const metadata: Metadata = { title: "Campaigns" };

export default function CampaignsPage(props: PageProps<"/campaigns">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Manage searchParams={props.searchParams} />
    </Suspense>
  );
}

const LEVELS: TableLevel[] = ["campaigns", "adsets", "ads"];
const NOUN: Record<TableLevel, [string, string]> = { campaigns: ["campaign", "campaigns"], adsets: ["ad set", "ad sets"], ads: ["ad", "ads"] };
const KPIS = ["spend", "results", "cpr", "roas", "ctr"];

async function Manage({ searchParams }: { searchParams: PageProps<"/campaigns">["searchParams"] }) {
  const sp = await searchParams;
  const { user, account, client } = await getWorkspace();
  if (!account) return <NoAccount />;

  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const ids = (k: string) => (str(k)?.split(",").filter((x) => /^\d+$/.test(x)) ?? []).slice(0, 100);

  const level = LEVELS.find((l) => l === str("level")) ?? "campaigns";
  const status = STATUS_FILTERS.find((s) => s === str("status")) ?? "all";
  const sortParam = str("sort");
  const sortKey: SortKey = isSortKey(sortParam) ? sortParam : "spend";
  const dir = str("dir") === "asc" ? "asc" : "desc";
  const range = await pageDateRange(sp, account.timezoneName);
  const prev = previousPeriod(range);
  const filter = { campaigns: ids("campaigns"), adsets: ids("adsets") };
  const query = { campaignIds: filter.campaigns, adsetIds: filter.adsets, q: str("q"), status: status as StatusFilter };

  const [current, previousRows, columnPrefs, parents] = await Promise.all([
    getTableRows(account.id, level, range, query),
    getTableRows(account.id, level, { ...prev, preset: "custom" }, { ...query, status: status === "spent" ? "all" : query.status }),
    getColumnPrefs(user.id),
    getParentOptions(account.id),
  ]);
  const rows = sortRows(current, sortKey, dir);

  const baseQuery: Record<string, string> = {};
  for (const k of ["preset", "since", "until", "q", "status"]) {
    const v = str(k);
    if (v) baseQuery[k] = v;
  }

  const canEdit = hasRole(user, "buyer");
  const sum = totals(rows);
  // Compare the same set of objects across both periods.
  const shown = new Set(rows.map((r) => r.id));
  const prevSum = totals(previousRows.filter((r) => shown.has(r.id)));
  const labels = new Set(rows.filter((r) => r.results > 0).map((r) => r.resultLabel));
  const [one, many] = NOUN[level];

  return (
    <div className="min-w-0">
      <PageHeader
        title="Campaigns"
        description="Create, edit and compare campaigns, ad sets and ads. Turn delivery on or off, change budgets and targeting, and bulk edit in one place."
        actions={
          // The top bar carries the global "New campaign" CTA from sm up.
          canEdit && (
            <Link href="/launches/new" className={buttonClass("secondary", "md", "sm:hidden")}>
              <Plus /> New campaign
            </Link>
          )
        }
      />

      <div className="flex min-w-0 flex-col gap-5">
        {/* KPI strip: swipeable row on phones, grid from sm up. */}
        <ul
          aria-label="Totals for the rows below"
          className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-5"
        >
          {KPIS.map((key) => {
            const m = METRIC_BY_KEY.get(key)!;
            const value = m.value(sum);
            const pct = change(value, m.value(prevSum));
            const tone = verdict(m, pct);
            const footer =
              key === "spend"
                ? `Across ${formatNumber(rows.length)} ${rows.length === 1 ? one : many}`
                : key === "results"
                  ? labels.size === 1
                    ? [...labels][0]
                    : labels.size > 1
                      ? "Multiple conversions"
                      : "No results yet"
                  : `Prev. ${formatMetric(m, m.value(prevSum), account.currency)}`;
            return (
              <li key={key} className="w-[44%] min-w-40 shrink-0 snap-start sm:w-auto sm:min-w-0">
                <Stat
                  label={m.label}
                  value={formatMetric(m, value, account.currency)}
                  delta={pct === null ? undefined : { text: `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(1)}%`, tone: tone === "good" ? "success" : tone === "bad" ? "danger" : "muted" }}
                  footer={<span className="block truncate">{footer}</span>}
                  className="h-full"
                />
              </li>
            );
          })}
        </ul>

        <AdsTable
          key={`${level}:${filter.campaigns.join()}:${filter.adsets.join()}`}
          level={level}
          rows={rows}
          totals={sum}
          currency={account.currency}
          timeZone={account.timezoneName}
          canEdit={canEdit}
          baseQuery={baseQuery}
          filter={filter}
          sort={{ key: sortKey, dir }}
          columnPrefs={columnPrefs}
          range={{ since: range.since, until: range.until }}
          accountId={account.id}
          clientId={client?.id ?? null}
          parents={parents}
          toolbar={
            <div key="toolbar" className="flex flex-wrap items-center gap-2">
              <div key="search" className="w-full sm:w-72">
                <SearchInput placeholder="Search by name" />
              </div>
              <ParamSelect
                key="status"
                name="status"
                label="Delivery filter"
                options={[
                  { value: "all", label: "All delivery" },
                  { value: "active", label: "Active" },
                  { value: "off", label: "Off" },
                  { value: "spent", label: "Had spend in range" },
                  { value: "issues", label: "Needs attention" },
                  { value: "rejected", label: "Rejected / errors" },
                ]}
              />
              <Badge key="compare" tone="muted" className="max-sm:hidden">
                vs. {formatSpan(prev.since, prev.until)}
              </Badge>
              <div key="dates" className="ml-auto">
                <DateRangePicker since={range.since} until={range.until} preset={range.preset} today={range.today} />
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
}
