"use client";

import { useEffect, useState } from "react";
import { TrendChart } from "@/components/charts/trend-chart";
import { Alert, cn, Segmented, segmentClass, Skeleton } from "@/components/ui";
import { addDays, daysBetween, formatSpan, previousPeriod } from "@/lib/dates";
import { addSums, change, emptySums, formatMetric, METRIC_BY_KEY, verdict, type MetricSums } from "@/lib/metrics";
import { objectSeriesAction } from "./actions";

const TILES = ["spend", "results", "cpr", "roas", "ctr", "cpm", "linkClicks", "purchases"];
const SPANS = [7, 14, 30, 90];

type Series = { date: string; sums: MetricSums }[];

export function ObjectPerformance({ level, id, currency, initialRange }: { level: "campaign" | "adset" | "ad"; id: string; currency: string; initialRange: { since: string; until: string } }) {
  const [range, setRange] = useState(initialRange);
  const [metric, setMetric] = useState("spend");
  const [data, setData] = useState<{ current: Series; previous: Series } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const prev = previousPeriod(range);
    Promise.all([objectSeriesAction(level, id, range.since, range.until), objectSeriesAction(level, id, prev.since, prev.until)]).then(([cur, old]) => {
      if (!live) return;
      if (cur.ok && old.ok) {
        setData({ current: cur.data, previous: old.data });
        setError(null);
      } else setError(!cur.ok ? cur.error : !old.ok ? old.error : "Couldn't load");
    });
    return () => {
      live = false;
    };
  }, [level, id, range]);

  const span = daysBetween(range.since, range.until);
  const def = METRIC_BY_KEY.get(metric)!;
  const total = data ? data.current.reduce((t, d) => addSums(t, d.sums), emptySums()) : null;
  const prevTotal = data ? data.previous.reduce((t, d) => addSums(t, d.sums), emptySums()) : null;

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-muted">
          {formatSpan(range.since, range.until)} <span className="text-faint">vs. {formatSpan(previousPeriod(range).since, previousPeriod(range).until)}</span>
        </p>
        <Segmented>
          {SPANS.map((n) => (
            <button
              key={n}
              type="button"
              role="tab"
              aria-selected={span === n}
              onClick={() => setRange({ since: addDays(initialRange.until, -(n - 1)), until: initialRange.until })}
              className={segmentClass(span === n)}
            >
              {n}d
            </button>
          ))}
        </Segmented>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TILES.map((key) => {
          const m = METRIC_BY_KEY.get(key)!;
          const value = total ? m.value(total) : null;
          const pct = total && prevTotal ? change(value, m.value(prevTotal)) : null;
          const tone = verdict(m, pct);
          return (
            <li key={key}>
              <button
                type="button"
                aria-pressed={metric === key}
                onClick={() => setMetric(key)}
                className={cn(
                  "flex w-full flex-col gap-1 rounded-xl border bg-surface p-3 text-left transition",
                  metric === key ? "border-primary ring-4 ring-[var(--ring)]" : "border-line hover:border-faint",
                )}
              >
                <span className="truncate text-[12px] font-medium text-muted">{m.label}</span>
                {total ? (
                  <span className="tabular text-[17px] font-semibold tracking-tight">{formatMetric(m, value, currency)}</span>
                ) : (
                  <Skeleton className="h-5 w-16" />
                )}
                <span className={cn("tabular text-[11.5px]", tone === "good" ? "text-success-ink" : tone === "bad" ? "text-danger-ink" : "text-faint")}>
                  {pct === null ? "—" : `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(1)}%`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="rounded-xl border border-line bg-surface p-3 sm:p-4">
        {data ? (
          <TrendChart
            label={def.label}
            good={def.good}
            format={(n) => formatMetric(def, n, currency)}
            formatAxis={(n) => formatMetric(def, n, currency, { compact: true })}
            points={data.current.map((d, i) => ({
              date: d.date,
              value: def.value(d.sums),
              previous: data.previous[i] ? def.value(data.previous[i].sums) : null,
              previousDate: data.previous[i]?.date,
            }))}
            height={240}
          />
        ) : (
          <Skeleton className="h-60 w-full rounded-lg" />
        )}
      </div>
    </div>
  );
}
