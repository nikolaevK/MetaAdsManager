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
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useOptimistic, useState, useTransition, type ReactNode } from "react";
import { toast } from "@/components/toast";
import { buttonClass, Card, cn, EmptyState, Segmented, segmentClass, StatusDot } from "@/components/ui";
import { COLUMN_BY_KEY, type TableLevelKey } from "@/lib/columns";
import { shortDate } from "@/lib/dates";
import { delivery, formatMoney, formatNumber } from "@/lib/format";
import { fromMinorUnits } from "@/lib/launch/payloads";
import { BID_STRATEGY_LABELS, label, OBJECTIVE_LABELS, OPTIMIZATION_LABELS } from "@/lib/meta/labels";
import type { Level } from "@/lib/meta/mutations";
import { formatMetric, METRIC_BY_KEY, type MetricSums } from "@/lib/metrics";
import type { ColumnPrefs } from "@/lib/preferences";
import type { SortKey, TableRow } from "@/lib/queries/manage";
import { saveColumnPrefsAction } from "../preferences";
import { duplicateAction, setStatusAction, updateBudgetAction } from "./actions";
import { BulkEditDialog } from "./bulk-edit";
import { ColumnPicker } from "./column-picker";
import { EditorSheet, type EditorTarget, type ParentOptions } from "./editor/sheet";

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
  parents: ParentOptions;
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
  // New campaigns are built in the campaign builder; ad sets and ads in the side sheet.
  const create = () => (lvl.one === "campaign" ? router.push("/launches/new") : setEditor({ mode: "create", level: lvl.one, parentId: createParent }));

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
            <button
              type="button"
              className={buttonClass("create", "md")}
              onClick={create}
            >
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
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={toggleAll}
                    className="size-4 cursor-pointer align-middle accent-primary"
                  />
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
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.name}`}
                        checked={isSelected}
                        onChange={() => toggleOne(r.id)}
                        className="size-4 cursor-pointer align-middle accent-primary"
                      />
                    </td>
                    <td className={cn(TD, "sticky left-10 z-10 px-2")}>
                      <Toggle
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
          className="sticky bottom-4 z-40 mx-auto flex w-fit max-w-full animate-pop-in items-center gap-0.5 overflow-x-auto rounded-xl border border-line bg-surface p-1 shadow-pop"
        >
          <span className="flex items-center gap-2 whitespace-nowrap py-1 pl-1.5 pr-2 text-[13px] font-medium">
            <span className="tabular grid h-5 min-w-5 place-items-center rounded-md bg-primary-soft px-1.5 text-[11.5px] font-semibold text-primary-ink ring-1 ring-inset ring-primary/20">
              {selected.size}
            </span>
            selected
            {pending && <LoaderCircle className="size-3.5 animate-spin text-faint" aria-label="Working" />}
          </span>
          <Divider />
          <BulkButton icon={Power} label="Turn on" disabled={pending} onClick={() => changeStatus(selectedIds, "ACTIVE")} />
          <BulkButton icon={PowerOff} label="Turn off" disabled={pending} onClick={() => changeStatus(selectedIds, "PAUSED")} />
          <BulkButton icon={SlidersHorizontal} label="Bulk edit" disabled={pending} onClick={() => setBulkOpen(true)} />
          <BulkButton
            icon={Copy}
            label="Duplicate"
            disabled={pending || selected.size !== 1}
            title={selected.size !== 1 ? "Select exactly one to duplicate" : undefined}
            onClick={() => run(() => duplicateAction({ level: lvl.one, id: selectedIds[0] }))}
          />
          <BulkButton
            icon={Archive}
            label="Archive"
            danger
            disabled={pending}
            onClick={() => {
              if (confirm(`Archive ${selected.size} ${lvl.noun}? Archived items stop delivering and leave this list.`))
                changeStatus(selectedIds, "ARCHIVED");
            }}
          />
          <Divider />
          <button type="button" aria-label="Clear selection" title="Clear selection" className={buttonClass("ghost", "icon")} onClick={() => setSelected(new Set())}>
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
          key={editor.mode === "edit" ? `${editor.level}:${editor.id}` : `new:${editor.level}`}
          target={editor}
          accountId={props.accountId}
          clientId={props.clientId}
          currency={currency}
          timeZone={props.timeZone}
          canEdit={canEdit}
          range={range}
          parents={props.parents}
          onClose={() => setEditor(null)}
          onNavigate={setEditor}
        />
      )}
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-line" />;
}

function BulkButton({
  icon: Icon,
  label,
  danger,
  title,
  ...props
}: { icon: LucideIcon; label: string; danger?: boolean; disabled?: boolean; title?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title ?? label}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[13px] font-medium transition-colors max-sm:px-2",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
        danger ? "text-danger-ink hover:bg-danger-soft" : "text-ink hover:bg-hover [&_svg]:text-muted",
      )}
      {...props}
    >
      <Icon aria-hidden />
      <span className="max-sm:sr-only">{label}</span>
    </button>
  );
}

function SortLink({ label, active, dir, href, alignEnd }: { label: string; active: boolean; dir: "asc" | "desc"; href: string; alignEnd?: boolean }) {
  const Icon = !active ? ChevronsUpDown : dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <Link
      href={href}
      scroll={false}
      className={cn("group/sort inline-flex items-center gap-1 transition-colors hover:text-ink", active && "text-ink", alignEnd && "flex-row-reverse")}
    >
      {label}
      <Icon
        aria-hidden
        className={cn("size-3.5 shrink-0 transition-opacity", active ? "text-primary" : "text-faint opacity-0 group-hover/sort:opacity-100")}
      />
    </Link>
  );
}

function Toggle({ on, disabled, label, onChange }: { on: boolean; disabled?: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        "relative flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60",
        on ? "bg-primary" : "bg-[color-mix(in_oklab,var(--faint)_45%,var(--line))]",
      )}
    >
      {/* The knob stays light in both themes, like a physical switch. */}
      <span className={cn("size-4 rounded-full bg-surface shadow-card transition-transform duration-150 dark:bg-ink", on && "translate-x-4")} />
    </button>
  );
}

type Run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string } | null>) => void;

const inlineInput =
  "h-8 rounded-md border border-primary bg-surface px-2 text-[13px] text-ink ring-4 ring-[var(--ring)] focus:outline-none";

const rowAction =
  "grid size-7 shrink-0 place-items-center rounded-md text-faint transition hover:bg-hover hover:text-ink focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100";

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
          <Link href={drill} className="flex min-w-0 items-center gap-1 font-medium text-ink transition-colors hover:text-primary" title={row.name}>
            <span className="truncate">{row.name}</span>
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
        ) : (
          <button type="button" onClick={() => onEdit("settings")} className="block max-w-full truncate text-left font-medium text-ink transition-colors hover:text-primary" title={row.name}>
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
      className="group/budget -mr-1.5 ml-auto flex flex-col items-end gap-0.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-hover disabled:hover:bg-transparent"
    >
      <span className="inline-flex items-center gap-1 text-ink">
        {canEdit && <Pencil aria-hidden className="size-3 text-faint opacity-0 transition-opacity group-hover/budget:opacity-100" />}
        {formatMoney(fromMinorUnits(minor, currency), currency)}
      </span>
      <span className="text-[11.5px] capitalize text-muted">{kind}</span>
    </button>
  );
}
