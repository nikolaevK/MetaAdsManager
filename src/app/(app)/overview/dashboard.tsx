"use client";

import { ArrowDown, ArrowUp, ChartSpline, Check, LayoutGrid, Minus, X } from "lucide-react";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { TrendChart } from "@/components/charts/trend-chart";
import { toast } from "@/components/toast";
import { Button, Card, cn } from "@/components/ui";
import { formatSpan } from "@/lib/dates";
import { change, formatMetric, METRIC_BY_KEY, METRIC_GROUPS, METRICS, verdict, type MetricSums } from "@/lib/metrics";
import type { OverviewPrefs } from "@/lib/preferences";
import type { DayPoint } from "@/lib/queries/overview";
import { saveOverviewPrefsAction } from "../preferences";
import { Switch } from "../campaigns/editor/fields";
import { Sparkline } from "./sparkline";

const MAX_TILES = 8;

type Props = {
  current: MetricSums;
  previous: MetricSums;
  series: DayPoint[];
  previousSeries: DayPoint[];
  previousRange: { since: string; until: string };
  prefs: OverviewPrefs;
  currency: string;
  hasData: boolean;
  empty: ReactNode;
};

export function OverviewDashboard({ current, previous, series, previousSeries, previousRange, prefs, currency, hasData, empty }: Props) {
  const [kpis, setKpis] = useState(prefs.kpis);
  const [metric, setMetric] = useState(prefs.chart[0] ?? "spend");
  const [compare, setCompare] = useState(true);
  const [customizing, setCustomizing] = useState(false);
  useLayoutEffect(() => () => setCustomizing(false), []);

  const save = (next: OverviewPrefs) =>
    saveOverviewPrefsAction(next).then((res) => {
      if (res && !res.ok) toast(res.error ?? "Couldn't save your layout", "error");
    });
  const pickMetric = (key: string) => {
    setMetric(key);
    save({ kpis, chart: [key] });
  };

  const def = METRIC_BY_KEY.get(metric) ?? METRIC_BY_KEY.get("spend")!;
  const fmt = (n: number) => formatMetric(def, n, currency);

  return (
    <>
      <section aria-labelledby="kpi-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h2 id="kpi-heading" className="text-[11px] font-medium uppercase tracking-wider text-faint">
            Performance <span className="normal-case tracking-normal">· vs. {formatSpan(previousRange.since, previousRange.until)}</span>
          </h2>
          <Button size="sm" variant="ghost" onClick={() => setCustomizing(true)}>
            <LayoutGrid /> Customize metrics
          </Button>
        </div>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((key) => {
            const m = METRIC_BY_KEY.get(key);
            if (!m) return null;
            const value = m.value(current);
            const prev = m.value(previous);
            const pct = change(value, prev);
            const tone = verdict(m, pct);
            const selected = key === metric;
            return (
              <li key={key}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => pickMetric(key)}
                  title={`${m.description} Click to chart it.`}
                  className={cn(
                    "group relative flex h-full w-full flex-col gap-2 overflow-hidden rounded-xl border bg-surface p-4 text-left shadow-card transition-[border-color,box-shadow]",
                    selected ? "border-primary/60 ring-4 ring-[var(--ring)]" : "border-line hover:border-[color-mix(in_oklab,var(--line)_50%,var(--muted))]",
                  )}
                >
                  {selected && <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand-from to-brand-to" />}
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12.5px] font-medium text-muted">{m.label}</span>
                    {pct !== null && (
                      <span
                        className={cn(
                          "tabular inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                          tone === "good" ? "bg-success-soft text-success-ink ring-success/20" : tone === "bad" ? "bg-danger-soft text-danger-ink ring-danger/20" : "bg-hover text-muted ring-line",
                        )}
                      >
                        {pct > 0.05 ? <ArrowUp className="size-3" aria-hidden /> : pct < -0.05 ? <ArrowDown className="size-3" aria-hidden /> : <Minus className="size-3" aria-hidden />}
                        {Math.abs(pct).toFixed(1)}%
                      </span>
                    )}
                  </span>
                  <span className="flex items-end justify-between gap-3">
                    <span className="tabular text-[24px] font-semibold leading-none tracking-tight">{formatMetric(m, value, currency)}</span>
                    <Sparkline id={key} values={series.map((d) => m.value(d.sums))} color={selected ? "var(--chart-1)" : "var(--faint)"} className="hidden h-9 min-w-0 max-w-28 flex-1 sm:block" />
                  </span>
                  <span className="truncate text-xs text-faint">{prev === null ? "No prior data" : `Prev. ${formatMetric(m, prev, currency)}`}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-muted">
              <ChartSpline className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <label htmlFor="chart-metric" className="sr-only">
                Metric
              </label>
              <select
                id="chart-metric"
                value={metric}
                onChange={(e) => pickMetric(e.target.value)}
                className="-ml-1 max-w-full cursor-pointer truncate rounded-md bg-transparent px-1 text-[14.5px] [field-sizing:content] font-semibold tracking-tight hover:bg-hover focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
              >
                {METRIC_GROUPS.map((g) => (
                  <optgroup key={g} label={g}>
                    {METRICS.filter((m) => m.group === g).map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <p className="mt-0.5 text-[13px] text-muted">
                {formatMetric(def, def.value(current), currency)} this period
                {compare && ` · ${formatMetric(def, def.value(previous), currency)} before`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[12.5px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded bg-chart-1" aria-hidden /> This period
            </span>
            {compare && (
              <span className="flex items-center gap-1.5">
                <span className="w-4 border-t-2 border-dashed border-faint" aria-hidden /> Previous
              </span>
            )}
            <label className="flex items-center gap-2">
              Compare
              <Switch on={compare} onChange={setCompare} label="Compare with previous period" />
            </label>
          </div>
        </div>
        <div className="p-4 sm:p-5">
          {hasData ? (
            <TrendChart
              label={def.label}
              good={def.good}
              format={fmt}
              formatAxis={(n) => formatMetric(def, n, currency, { compact: true })}
              showPrevious={compare}
              points={series.map((d, i) => ({
                date: d.date,
                value: def.value(d.sums),
                previous: previousSeries[i] ? def.value(previousSeries[i].sums) : null,
                previousDate: previousSeries[i]?.date,
              }))}
            />
          ) : (
            empty
          )}
        </div>
      </Card>

      {customizing && (
        <CustomizeKpis
          selected={kpis}
          onClose={() => setCustomizing(false)}
          onApply={(next) => {
            setKpis(next);
            setCustomizing(false);
            save({ kpis: next, chart: [metric] });
          }}
        />
      )}
    </>
  );
}

function CustomizeKpis({ selected, onClose, onApply }: { selected: string[]; onClose: () => void; onApply: (keys: string[]) => void }) {
  const [keys, setKeys] = useState(selected);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const toggle = (k: string) => setKeys((s) => (s.includes(k) ? s.filter((x) => x !== k) : s.length >= MAX_TILES ? s : [...s, k]));
  const move = (k: string, d: number) =>
    setKeys((s) => {
      const i = s.indexOf(k);
      const j = i + d;
      if (j < 0 || j >= s.length) return s;
      const n = [...s];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-3 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="kpi-title" className="flex max-h-[min(42rem,calc(100dvh-1.5rem))] w-full max-w-2xl animate-pop-in flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
        <div className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
          <div>
            <h2 id="kpi-title" className="text-[15px] font-semibold tracking-tight">
              Customize metrics
            </h2>
            <p className="mt-0.5 text-[13px] text-muted">Choose up to {MAX_TILES} tiles for the overview. Saved to your account.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-faint hover:bg-hover hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 sm:grid-cols-[1fr_15rem]">
          <div className="min-h-0 overflow-y-auto p-4 max-sm:max-h-[40dvh]">
            {METRIC_GROUPS.map((g) => (
              <fieldset key={g} className="mb-4 last:mb-0">
                <legend className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">{g}</legend>
                <div className="grid gap-0.5 sm:grid-cols-2">
                  {METRICS.filter((m) => m.group === g).map((m) => {
                    const on = keys.includes(m.key);
                    return (
                      <label key={m.key} title={m.description} className={cn("flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-hover", !on && keys.length >= MAX_TILES && "opacity-50")}>
                        <input type="checkbox" checked={on} disabled={!on && keys.length >= MAX_TILES} onChange={() => toggle(m.key)} className="size-4 accent-primary" />
                        {m.label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
          <ol className="min-h-0 overflow-y-auto border-line-soft bg-surface-2/60 p-3 max-sm:border-t sm:border-l">
            <li className="px-1 pb-2 text-[12px] font-medium text-muted">
              {keys.length}/{MAX_TILES} tiles
            </li>
            {keys.map((k, i) => (
              <li key={k} className="mb-1 flex items-center gap-1 rounded-lg bg-surface px-2 py-1 text-[13px] shadow-xs">
                <span className="tabular w-4 text-[11px] text-faint">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{METRIC_BY_KEY.get(k)?.label}</span>
                <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(k, -1)} className="grid size-6 place-items-center rounded text-faint hover:bg-hover hover:text-ink disabled:opacity-30">
                  <ArrowUp className="size-3.5" />
                </button>
                <button type="button" aria-label="Move down" disabled={i === keys.length - 1} onClick={() => move(k, 1)} className="grid size-6 place-items-center rounded text-faint hover:bg-hover hover:text-ink disabled:opacity-30">
                  <ArrowDown className="size-3.5" />
                </button>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex justify-end gap-2 border-t border-line-soft px-5 py-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={keys.length === 0} onClick={() => onApply(keys)}>
            <Check /> Save layout
          </Button>
        </div>
      </div>
    </div>
  );
}
