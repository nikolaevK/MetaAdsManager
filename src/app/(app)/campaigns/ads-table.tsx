"use client";

import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChartLine,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  Download,
  Ellipsis,
  ImageIcon,
  Layers,
  ListFilter,
  LoaderCircle,
  Megaphone,
  Pencil,
  Plus,
  Power,
  PowerOff,
  SearchX,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useOptimistic, useRef, useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "@/components/toast";
import { buttonClass, Card, cn, EmptyState, focusRing, Segmented, segmentClass, StatusDot } from "@/components/ui";
import { COLUMN_BY_KEY, type TableLevelKey } from "@/lib/columns";
import { shortDate } from "@/lib/dates";
import { delivery, formatMoney, formatNumber } from "@/lib/format";
import { fromMinorUnits } from "@/lib/money";
import { BID_STRATEGY_LABELS, label, OBJECTIVE_LABELS, OPTIMIZATION_LABELS } from "@/lib/meta/labels";
import type { Level } from "@/lib/meta/mutations";
import { formatMetric, METRIC_BY_KEY, type MetricSums } from "@/lib/metrics";
import type { ColumnPrefs } from "@/lib/preferences";
import type { SortKey, TableRow } from "@/lib/queries/manage";
import { saveColumnPrefsAction } from "../preferences";
import { duplicateAction, setStatusAction, updateBudgetAction } from "./actions";
import { ColumnPicker } from "./column-picker";
import { Switch } from "./editor/fields";
import type { EditorTarget } from "./editor/sheet";

// Only needed after a click, so their code loads on demand. `ssr: false` also gives each its own Suspense boundary:
// without one, the first load suspends the whole page, whose hide/cleanup closes the sheet before it ever shows.
const EditorSheet = dynamic(() => import("./editor/sheet").then((m) => m.EditorSheet), { ssr: false });
const BulkEditDialog = dynamic(() => import("./bulk-edit").then((m) => m.BulkEditDialog), { ssr: false });

type TableLevel = TableLevelKey;

const LEVEL: Record<TableLevel, { one: Level; label: string; noun: string; icon: LucideIcon }> = {
  campaigns: { one: "campaign", label: "Campaigns", noun: "campaigns", icon: Megaphone },
  adsets: { one: "adset", label: "Ad sets", noun: "ad sets", icon: Layers },
  ads: { one: "ad", label: "Ads", noun: "ads", icon: ImageIcon },
};

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

// Sticky cells need opaque fills, so tints are mixed into the surface instead of using alpha.
const ROW_IDLE = "bg-surface hover:bg-[color-mix(in_oklab,var(--hover)_70%,var(--surface))]";
const ROW_SELECTED = "bg-[color-mix(in_oklab,var(--primary)_7%,var(--surface))] hover:bg-[color-mix(in_oklab,var(--primary)_10%,var(--surface))]";
const TH = "h-10 whitespace-nowrap border-b border-line bg-surface-2 font-medium";
const TD = "border-b border-line-soft bg-inherit py-2.5";
const TF = "whitespace-nowrap bg-surface-2 py-3 shadow-[0_-1px_0_var(--line)]";
// The name column is frozen only from md up; on phones only checkbox + toggle stay pinned.
const NAME_COL = "border-r px-3 md:sticky md:left-26";

/** Column layout survives level-tab remounts within this browser tab, even before the save round-trips. */
let sessionPrefs: ColumnPrefs | null = null;

type Props = {
  level: TableLevel;
  rows: TableRow[];
  totals: MetricSums;
  currency: string;
  timeZone: string;
  canEdit: boolean;
  /** Date + search params to carry across tabs/sorting. */
  baseQuery: Record<string, string>;
  filter: { campaigns: string[]; adsets: string[] };
  sort: { key: SortKey; dir: "asc" | "desc" };
  columnPrefs: ColumnPrefs;
  range: { since: string; until: string };
  accountId: string;
  clientId: string | null;
  /** Search / filter / date controls, rendered between the level tabs and the table. */
  toolbar?: ReactNode;
};

export function AdsTable(props: Props) {
  const { level, rows, totals, currency, canEdit, baseQuery, filter, sort, toolbar, range } = props;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prefs, setPrefsState] = useState<ColumnPrefs>(() => sessionPrefs ?? props.columnPrefs);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const router = useRouter();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();
  const [statuses, setOptimisticStatus] = useOptimistic(
    new Map(rows.map((r) => [r.id, r.status])),
    (state, change: { ids: string[]; status: string }) => {
      const next = new Map(state);
      for (const id of change.ids) next.set(id, change.status);
      return next;
    },
  );
  const lvl = LEVEL[level];
  // Cache Components keeps hidden routes mounted: don't return to a page with a stale sheet or dialog open.
  useLayoutEffect(
    () => () => {
      setEditor(null);
      setBulkOpen(false);
    },
    [],
  );

  const setPrefs = (next: ColumnPrefs) => {
    sessionPrefs = next;
    setPrefsState(next);
    saveColumnPrefsAction(next).then((res) => {
      if (res && !res.ok) toast(res.error ?? "Couldn't save your columns", "error");
    });
  };

  const href = (q: Record<string, string | undefined>) => {
    const p = new URLSearchParams(baseQuery);
    for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
    return `/campaigns?${p}`;
  };
  const selectedIds = [...selected];
  const tabHref: Record<TableLevel, string> = {
    campaigns: href({ level: "campaigns" }),
    adsets: href({
      level: "adsets",
      campaigns: (level === "campaigns" && selectedIds.length ? selectedIds : filter.campaigns).join(",") || undefined,
    }),
    ads: href({
      level: "ads",
      adsets: (level === "adsets" && selectedIds.length ? selectedIds : filter.adsets).join(",") || undefined,
      campaigns: (level === "campaigns" && selectedIds.length ? selectedIds : filter.campaigns).join(",") || undefined,
    }),
  };
  const sortHref = (key: SortKey) =>
    href({
      level,
      campaigns: filter.campaigns.join(",") || undefined,
      adsets: filter.adsets.join(",") || undefined,
      sort: key,
      dir: sort.key === key && sort.dir === "desc" ? "asc" : "desc",
    });

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string } | null>) =>
    startTransition(async () => {
      const res = await fn();
      if (res?.ok) toast(res.message ?? "Done");
      else toast(res?.error ?? "Something went wrong", "error");
    });

  const changeStatus = (ids: string[], status: "ACTIVE" | "PAUSED" | "ARCHIVED") =>
    run(async () => {
      if (status !== "ARCHIVED") setOptimisticStatus({ ids, status });
      const res = await setStatusAction({ level: lvl.one, ids, status });
      if (res?.ok) setSelected(new Set());
      return res;
    });

  const archive = async () => {
    const ids = selectedIds;
    const ok = await confirm({
      title: `Archive ${plural(ids.length, lvl.noun.replace(/s$/, ""), lvl.noun)}?`,
      body: "Archived items stop delivering and leave this list.",
      confirmLabel: "Archive",
      tone: "danger",
    });
    if (ok) changeStatus(ids, "ARCHIVED");
  };

  const secondary: BulkAction[] = [
    { icon: SlidersHorizontal, label: "Bulk edit", disabled: pending, onClick: () => setBulkOpen(true) },
    {
      icon: Copy,
      label: "Duplicate",
      disabled: pending || selected.size !== 1,
      title: selected.size !== 1 ? "Select exactly one to duplicate" : undefined,
      onClick: () => run(() => duplicateAction({ level: lvl.one, id: selectedIds[0] })),
    },
    { icon: Archive, label: "Archive", danger: true, disabled: pending, onClick: archive },
  ];

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0 && !allSelected;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleOne = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const visible = prefs.columns
    .map((key) => COLUMN_BY_KEY.get(key))
    .filter((c): c is NonNullable<typeof c> => !!c && (!c.levels || c.levels.includes(level)));

  const cell = (key: string, r: TableRow): ReactNode => {
    const metric = METRIC_BY_KEY.get(key);
    if (key === "results")
      return (
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-ink">{r.results ? formatNumber(r.results) : "—"}</span>
          <span className="text-[11.5px] text-muted">{r.resultLabel}</span>
        </div>
      );
    if (metric) return formatMetric(metric, metric.value(r), currency);
    switch (key) {
      case "delivery": {
        const d = delivery(r.effectiveStatus);
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-ink">
              <StatusDot tone={d.tone} label={d.label} />
            </span>
            {r.issue && (
              <span className="max-w-56 truncate pl-3.5 text-[12px] text-danger-ink" title={r.issue}>
                {r.issue}
              </span>
            )}
          </div>
        );
      }
      case "budget":
        return <BudgetCell row={r} level={lvl.one} currency={currency} canEdit={canEdit} onSave={run} />;
      case "objective":
        return label(OBJECTIVE_LABELS, r.objective);
      case "bidStrategy":
        return label(BID_STRATEGY_LABELS, r.bidStrategy);
      case "optimizationGoal":
        return label(OPTIMIZATION_LABELS, r.optimizationGoal);
      case "startTime":
      case "createdTime":
        return r[key] ? shortDate(r[key].slice(0, 10), true) : "—";
      case "endTime":
        return r.endTime ? shortDate(r.endTime.slice(0, 10), true) : <span className="text-muted">Ongoing</span>;
      default:
        return null;
    }
  };
  const footer = (key: string): ReactNode => {
    const metric = METRIC_BY_KEY.get(key);
    return metric ? formatMetric(metric, metric.value(totals), currency) : "";
  };
  const isLeft = (key: string) => !METRIC_BY_KEY.has(key) && key !== "budget";
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined);

  const exportCsv = () => {
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    };
    const raw = (key: string, r: TableRow) => {
      const metric = METRIC_BY_KEY.get(key);
      if (metric) {
        const v = metric.value(r);
        return v === null ? "" : Math.round(v * 100) / 100;
      }
      if (key === "budget") {
        const minor = r.dailyBudget ?? r.lifetimeBudget;
        return minor === null ? "" : fromMinorUnits(minor, currency);
      }
      if (key === "delivery") return delivery(r.effectiveStatus).label;
      if (key === "objective") return label(OBJECTIVE_LABELS, r.objective);
      if (key === "bidStrategy") return label(BID_STRATEGY_LABELS, r.bidStrategy);
      if (key === "optimizationGoal") return label(OPTIMIZATION_LABELS, r.optimizationGoal);
      return (r as Record<string, unknown>)[key] ?? "";
    };
    const head = ["Name", "ID", ...(level === "campaigns" ? [] : ["Parent"]), ...visible.map((c) => (c.key === "budget" ? `Budget (${currency})` : c.label))];
    const lines = rows.map((r) => [r.name, r.id, ...(level === "campaigns" ? [] : [r.parentName ?? ""]), ...visible.map((c) => raw(c.key, r))]);
    const csv = [head, ...lines].map((l) => l.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${level}-${range.since}_${range.until}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const scopeParts = [
    filter.campaigns.length > 0 && plural(filter.campaigns.length, "campaign", "campaigns"),
    filter.adsets.length > 0 && plural(filter.adsets.length, "ad set", "ad sets"),
  ].filter(Boolean);
  const searching = Boolean(baseQuery.q || baseQuery.status);
  const selectedRows = rows.filter((r) => selected.has(r.id));

  // New objects go into the one campaign / ad set in scope (selection first, then the drill-down filter).
  const createParent =
    level === "adsets"
      ? (filter.campaigns.length === 1 ? filter.campaigns[0] : undefined)
      : level === "ads"
        ? (filter.adsets.length === 1 ? filter.adsets[0] : undefined)
        : undefined;
  // Everything is built in the campaign builder: a new campaign, or new ad sets / ads added to an existing one.
  const create = () =>
    router.push(
      lvl.one === "campaign"
        ? "/launches/new"
        : lvl.one === "adset"
          ? createParent
            ? `/launches/new?campaign=${createParent}`
            : "/launches/new?add=adsets"
          : createParent
            ? `/launches/new?adset=${createParent}`
            : "/launches/new?add=ads",
    );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* Tabs scroll sideways on phones when the "for N selected" hints make them wider than the screen. */}
        <div className="-mx-4 min-w-0 max-w-[calc(100%+2rem)] overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:max-w-full sm:px-0">
          <Segmented>
            {(Object.keys(LEVEL) as TableLevel[]).map((l) => {
              const active = l === level;
              const Icon = LEVEL[l].icon;
              const scoped =
                (l === "adsets" && (level === "campaigns" ? selected.size : filter.campaigns.length)) ||
                (l === "ads" && (level === "adsets" ? selected.size : filter.adsets.length || filter.campaigns.length));
              return (
                <Link key={l} href={tabHref[l]} role="tab" aria-selected={active} className={segmentClass(active)}>
                  <Icon className={cn("max-sm:hidden", active ? "text-primary" : "text-faint")} aria-hidden />
                  {LEVEL[l].label}
                  {active ? (
                    <span className="tabular rounded-md bg-hover px-1.5 text-[11px] font-medium leading-[18px] text-muted">{formatNumber(rows.length)}</span>
                  ) : scoped ? (
                    <span className="rounded-md bg-primary-soft px-1.5 text-[11px] font-medium leading-[18px] text-primary-ink">for {scoped} selected</span>
                  ) : null}
                </Link>
              );
            })}
          </Segmented>
        </div>
        {scopeParts.length > 0 && (
          <Link
            href={href({ level })}
            title="Clear selection filter"
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface pl-2.5 pr-1 text-[12px] text-muted shadow-xs transition-colors hover:bg-hover hover:text-ink"
          >
            <ListFilter className="size-3.5 text-faint" aria-hidden />
            <span className="whitespace-nowrap">
              Scoped to <span className="font-medium text-ink">{scopeParts.join(" · ")}</span>
            </span>
            <span className="grid size-5 place-items-center rounded-full text-faint" aria-hidden>
              <X className="size-3.5" />
            </span>
            <span className="sr-only">, clear selection filter</span>
          </Link>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ColumnPicker prefs={prefs} level={level} onChange={setPrefs} />
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            title="Export the rows and columns below as CSV"
            className={buttonClass("secondary", "md", "max-sm:px-2.5")}
          >
            <Download aria-hidden /> <span className="max-sm:sr-only">Export</span>
          </button>
          {canEdit && (
            <button type="button" className={buttonClass("primary", "md")} onClick={create}>
              <Plus aria-hidden /> Create
            </button>
          )}
        </div>
      </div>

      {toolbar}

      <Card className="overflow-hidden">
        <div className="max-h-[calc(100dvh-8rem)] overflow-auto">
          <table className="tabular w-full border-separate border-spacing-0 text-[13px]">
            <thead className="sticky top-0 z-20">
              <tr className="text-left text-[12px] text-muted">
                <th scope="col" className={cn(TH, "sticky left-0 z-30 w-10 px-3")}>
                  <label className={CHECK_HIT}>
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={toggleAll}
                      className="relative z-[1] size-4 cursor-pointer accent-primary"
                    />
                  </label>
                </th>
                <th scope="col" className={cn(TH, "sticky left-10 z-30 w-16 px-2")}>
                  {/* Fixed inner width keeps this column exactly 64px so the md:left-26 name column sits flush. */}
                  <span className="block w-12">Off / On</span>
                </th>
                <th scope="col" aria-sort={ariaSort("name")} className={cn(TH, NAME_COL, "z-30 min-w-56 md:min-w-72")}>
                  <SortLink label={lvl.label.replace(/s$/, "")} active={sort.key === "name"} dir={sort.dir} href={sortHref("name")} />
                </th>
                {visible.map((c) => (
                  <th key={c.key} scope="col" aria-sort={ariaSort(c.key)} title={c.description} className={cn(TH, "px-3", isLeft(c.key) ? "text-left" : "text-right")}>
                    <SortLink label={c.label} active={sort.key === c.key} dir={sort.dir} href={sortHref(c.key)} alignEnd={!isLeft(c.key)} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = statuses.get(r.id) ?? r.status;
                const isSelected = selected.has(r.id);
                return (
                  <tr key={r.id} className={cn("group transition-colors", isSelected ? ROW_SELECTED : ROW_IDLE)}>
                    <td className={cn(TD, "sticky left-0 z-10 px-3", isSelected && "shadow-[inset_2px_0_0_var(--primary)]")}>
                      <label className={CHECK_HIT}>
                        <input type="checkbox" aria-label={`Select ${r.name}`} checked={isSelected} onChange={() => toggleOne(r.id)} className="relative z-[1] size-4 cursor-pointer accent-primary" />
                      </label>
                    </td>
                    <td className={cn(TD, "sticky left-10 z-10 px-2")}>
                      <Switch
                        on={status === "ACTIVE"}
                        disabled={!canEdit || pending}
                        label={`Turn ${status === "ACTIVE" ? "off" : "on"} ${r.name}`}
                        onChange={(on) => changeStatus([r.id], on ? "ACTIVE" : "PAUSED")}
                      />
                    </td>
                    <td className={cn(TD, NAME_COL, "z-10")}>
                      <NameCell
                        row={r}
                        level={level}
                        canEdit={canEdit}
                        href={href}
                        onEdit={(tab) => setEditor({ mode: "edit", level: lvl.one, id: r.id, name: r.name, tab })}
                      />
                    </td>
                    {visible.map((c) => (
                      <td key={c.key} className={cn(TD, "whitespace-nowrap px-3 text-ink", isLeft(c.key) ? "text-left" : "text-right")}>
                        {cell(c.key, r)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="sticky bottom-0 z-20 font-medium text-ink">
                <tr>
                  {/* Shadow instead of a border so it overlaps the last row's divider rather than doubling it. */}
                  <td className={cn(TF, "sticky left-0 z-10")} />
                  <td className={cn(TF, "sticky left-10 z-10")} />
                  <td className={cn(TF, NAME_COL, "z-10 border-line")}>
                    <span className="text-muted">Total ·</span> {plural(rows.length, lvl.noun.replace(/s$/, ""), lvl.noun)}
                  </td>
                  {visible.map((c) => (
                    <td key={c.key} className={cn(TF, "px-3", isLeft(c.key) ? "text-left" : "text-right")}>
                      {footer(c.key)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {rows.length === 0 &&
          (searching ? (
            <EmptyState icon={SearchX} title={`No ${lvl.noun} match these filters`}>
              Try a different search term or delivery filter.
            </EmptyState>
          ) : scopeParts.length > 0 ? (
            <EmptyState
              icon={ListFilter}
              title={`No ${lvl.noun} in this selection`}
              action={
                <div className="flex gap-2">
                  {canEdit && (
                    <button type="button" className={buttonClass("primary", "sm")} onClick={create}>
                      <Plus /> Create {lvl.noun.replace(/s$/, "")}
                    </button>
                  )}
                  <Link href={href({ level })} className={buttonClass("secondary", "sm")}>
                    Clear selection filter
                  </Link>
                </div>
              }
            >
              Clear the selection filter to see every {lvl.noun.replace(/s$/, "")} in the account.
            </EmptyState>
          ) : (
            <EmptyState
              icon={lvl.icon}
              title={`No ${lvl.noun} yet`}
              action={
                canEdit && (
                  <div className="flex gap-2">
                    <button type="button" className={buttonClass("primary", "sm")} onClick={create}>
                      <Plus /> Create {lvl.noun.replace(/s$/, "")}
                    </button>
                    {lvl.one !== "campaign" && (
                      <Link href="/launches/new" className={buttonClass("secondary", "sm")}>
                        Campaign builder
                      </Link>
                    )}
                  </div>
                )
              }
            >
              They appear here after the next sync with Meta. Create one here, or build a full campaign in the campaign builder.
            </EmptyState>
          ))}
      </Card>

      {canEdit && selected.size > 0 && (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="sticky bottom-4 z-40 mx-auto flex w-fit max-w-full animate-pop-in flex-wrap items-center justify-center gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-pop"
        >
          <span className="flex items-center gap-2 whitespace-nowrap py-1 pl-1.5 pr-2 text-[13px] font-medium">
            <span className="tabular grid h-5 min-w-5 place-items-center rounded-md bg-primary-soft px-1.5 text-[11.5px] font-semibold text-primary-ink ring-1 ring-inset ring-primary/20">
              {selected.size}
            </span>
            <span className="max-sm:sr-only">selected</span>
            {pending && <LoaderCircle className="size-3.5 animate-spin text-faint" aria-label="Working" />}
          </span>
          <Divider />
          <BulkButton icon={Power} label="Turn on" disabled={pending} onClick={() => changeStatus(selectedIds, "ACTIVE")} />
          <BulkButton icon={PowerOff} label="Turn off" disabled={pending} onClick={() => changeStatus(selectedIds, "PAUSED")} />
          {/* Phones keep on/off labelled and move the rest into "More". */}
          {secondary.map((a) => (
            <BulkButton key={a.label} {...a} className="max-sm:hidden" />
          ))}
          <BulkMore actions={secondary} />
          <Divider />
          <button type="button" aria-label="Clear selection" title="Clear selection" className={buttonClass("ghost", "icon", "pointer-coarse:size-10")} onClick={() => setSelected(new Set())}>
            <X />
          </button>
        </div>
      )}

      {bulkOpen && (
        <BulkEditDialog
          level={lvl.one}
          rows={selectedRows}
          currency={currency}
          onClose={() => setBulkOpen(false)}
          onDone={() => {
            setBulkOpen(false);
            setSelected(new Set());
          }}
        />
      )}

      {editor && (
        <EditorSheet
          key={`${editor.level}:${editor.id}`}
          target={editor}
          accountId={props.accountId}
          clientId={props.clientId}
          currency={currency}
          timeZone={props.timeZone}
          canEdit={canEdit}
          range={range}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-line" />;
}

type BulkAction = { icon: LucideIcon; label: string; danger?: boolean; disabled?: boolean; title?: string; onClick: () => void };

const bulkButton = (danger?: boolean) =>
  cn(
    "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[13px] font-medium transition-colors max-sm:px-2 pointer-coarse:h-10",
    "disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
    focusRing,
    danger ? "text-danger-ink hover:bg-danger-soft" : "text-ink hover:bg-hover [&_svg]:text-muted",
  );

function BulkButton({ icon: Icon, label, danger, title, className, ...props }: Omit<BulkAction, "onClick"> & ComponentProps<"button">) {
  return (
    <button type="button" title={title ?? label} className={cn(bulkButton(danger), className)} {...props}>
      <Icon aria-hidden />
      {label}
    </button>
  );
}

/** Phone-only overflow menu for the secondary bulk actions; opens upward from the sticky bar. */
function BulkMore({ actions }: { actions: BulkAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative sm:hidden">
      <BulkButton ref={button} icon={Ellipsis} label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div role="menu" aria-label="More bulk actions" className="absolute bottom-full right-0 mb-2 flex w-48 animate-pop-in flex-col rounded-xl border border-line bg-surface p-1 shadow-pop">
          {actions.map(({ icon: Icon, label, danger, disabled, title, onClick }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              disabled={disabled}
              title={title}
              onClick={() => {
                // The item unmounts with the menu; a dialog it opens hands focus back to "More" instead.
                button.current?.focus();
                setOpen(false);
                onClick();
              }}
              className={cn(bulkButton(danger), "w-full justify-start")}
            >
              <Icon aria-hidden />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SortLink({ label, active, dir, href, alignEnd }: { label: string; active: boolean; dir: "asc" | "desc"; href: string; alignEnd?: boolean }) {
  const Icon = !active ? ChevronsUpDown : dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <Link
      href={href}
      scroll={false}
      className={cn(
        "group/sort inline-flex items-center gap-1 rounded-sm transition-colors hover:text-ink pointer-coarse:-my-3 pointer-coarse:py-3",
        focusRing,
        active && "text-ink",
        alignEnd && "flex-row-reverse",
      )}
    >
      {label}
      <Icon
        aria-hidden
        className={cn(
          "size-3.5 shrink-0 transition-opacity",
          active ? "text-primary" : "text-faint can-hover:opacity-0 can-hover:group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100",
        )}
      />
    </Link>
  );
}

type Run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string } | null>) => void;

const inlineInput =
  "h-8 rounded-md border border-primary bg-surface px-2 text-[13px] text-ink ring-4 ring-[var(--ring)] focus:outline-none";

// Row names are one 19px text line: taller on touch screens, with negative margins so the row height doesn't change.
const TAP_Y = "pointer-coarse:-my-3 pointer-coarse:py-3";

// Checkbox inside a 40px hit area (the cell is 40px wide), so rows are easy to select on touch screens.
const CHECK_HIT = "relative flex size-4 cursor-pointer after:absolute after:-inset-3";

// Revealed on row hover with a mouse; always visible (and tap-sized) on touch screens.
const rowAction = cn(
  "grid size-7 shrink-0 place-items-center rounded-md text-faint transition hover:bg-hover hover:text-ink pointer-coarse:size-10",
  "can-hover:opacity-0 can-hover:group-hover:opacity-100 focus-visible:opacity-100",
  focusRing,
);

function NameCell({
  row,
  level,
  canEdit,
  href,
  onEdit,
}: {
  row: TableRow;
  level: TableLevel;
  canEdit: boolean;
  href: (q: Record<string, string | undefined>) => string;
  onEdit: (tab: "settings" | "performance") => void;
}) {
  const drill = level === "campaigns" ? href({ level: "adsets", campaigns: row.id }) : level === "adsets" ? href({ level: "ads", adsets: row.id }) : null;
  return (
    <div className="flex max-w-[24rem] items-center gap-2.5">
      {row.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Meta CDN thumbnails, already sized
        <img src={row.thumbnailUrl} alt="" className="size-9 shrink-0 rounded-md border border-line-soft object-cover" />
      ) : (
        level === "ads" && (
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-md border border-line-soft bg-surface-2 text-faint">
            <ImageIcon className="size-4" />
          </span>
        )
      )}
      <div className="min-w-0 flex-1">
        {drill ? (
          <Link href={drill} className={cn("flex min-w-0 items-center gap-1 rounded-sm font-medium text-ink transition-colors hover:text-primary-ink", TAP_Y, focusRing)} title={row.name}>
            <span className="truncate">{row.name}</span>
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-faint transition-opacity can-hover:opacity-0 can-hover:group-hover:opacity-100" />
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onEdit("settings")}
            className={cn("block max-w-full truncate rounded-sm text-left font-medium text-ink transition-colors hover:text-primary-ink", TAP_Y, focusRing)}
            title={row.name}
          >
            {row.name}
          </button>
        )}
        {row.parentName && <span className="mt-0.5 block truncate text-[12px] text-muted">{row.parentName}</span>}
      </div>
      <button type="button" aria-label={`Charts for ${row.name}`} title="View charts" onClick={() => onEdit("performance")} className={rowAction}>
        <ChartLine className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={`${canEdit ? "Edit" : "View"} ${row.name}`}
        title={canEdit ? "Edit" : "View settings"}
        onClick={() => onEdit("settings")}
        className={rowAction}
      >
        <Pencil className="size-3.5" />
      </button>
    </div>
  );
}

function BudgetCell({ row, level, currency, canEdit, onSave }: { row: TableRow; level: Level; currency: string; canEdit: boolean; onSave: Run }) {
  const [editing, setEditing] = useState(false);
  const kind = row.lifetimeBudget !== null ? "lifetime" : "daily";
  const minor = row.dailyBudget ?? row.lifetimeBudget;
  const [value, setValue] = useState(minor !== null ? String(fromMinorUnits(minor, currency)) : "");

  if (row.usesCampaignBudget) return <span className="text-[12.5px] text-muted">Using campaign budget</span>;
  if (minor === null) return <span className="text-[12.5px] text-muted">Using ad set budget</span>;
  if (editing && (level === "campaign" || level === "adset")) {
    return (
      <form
        className="flex items-center justify-end gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          setEditing(false);
          const amount = Number(value);
          if (amount > 0) onSave(() => updateBudgetAction({ level, id: row.id, amount, kind }));
        }}
      >
        <input
          autoFocus
          aria-label={`${kind === "daily" ? "Daily" : "Lifetime"} budget`}
          type="number"
          min="1"
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          className={cn(inlineInput, "w-24 text-right")}
        />
        <button type="submit" className={buttonClass("primary", "sm", "h-8 px-2.5")}>
          Save
        </button>
      </form>
    );
  }
  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={() => {
        // Re-seed from the latest synced value each time editing starts.
        setValue(String(fromMinorUnits(minor, currency)));
        setEditing(true);
      }}
      title={canEdit ? "Edit budget" : undefined}
      className={cn("group/budget -mr-1.5 ml-auto flex flex-col items-end gap-0.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-hover disabled:hover:bg-transparent", focusRing)}
    >
      <span className="inline-flex items-center gap-1 text-ink">
        {canEdit && (
          <Pencil aria-hidden className="size-3 text-faint transition-opacity can-hover:opacity-0 can-hover:group-hover/budget:opacity-100 group-focus-visible/budget:opacity-100" />
        )}
        {formatMoney(fromMinorUnits(minor, currency), currency)}
      </span>
      <span className="text-[11.5px] capitalize text-muted">{kind}</span>
    </button>
  );
}
