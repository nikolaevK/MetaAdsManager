"use client";

import { ChevronDown, Table2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/components/ui";
import { shortDate } from "@/lib/dates";

/**
 * Area/line trend for one metric, optionally overlaid with the previous period (dashed). One honest
 * y-scale; the tooltip pairs each day with its counterpart in the comparison period.
 */

export type TrendPoint = { date: string; value: number | null; previous?: number | null; previousDate?: string };

type Props = {
  points: TrendPoint[];
  label: string;
  format: (n: number) => string;
  /** Compact axis labels ($1.2K). Defaults to `format`. */
  formatAxis?: (n: number) => string;
  color?: string;
  showPrevious?: boolean;
  /** "up" / "down" = which direction of change is good, for the tooltip delta colour. */
  good?: "up" | "down" | "neutral";
  height?: number;
  className?: string;
};

const M = { top: 12, right: 12, bottom: 28, left: 56 };

function niceScale(min: number, max: number): { lo: number; hi: number; ticks: number[] } {
  if (!(max > min)) {
    const hi = max > 0 ? max * 1.2 : 1;
    return { lo: 0, hi, ticks: [0, hi / 2, hi] };
  }
  const lo = Math.min(0, min);
  const raw = (max - lo) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return { lo, hi, ticks };
}

/** Monotone cubic (Fritsch–Carlson) path: smooth without overshooting the data. */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  const n = pts.length;
  const dx = pts.slice(1).map((p, i) => p.x - pts[i].x);
  const slope = pts.slice(1).map((p, i) => (p.y - pts[i].y) / (dx[i] || 1));
  const m = [slope[0], ...slope.slice(1).map((s, i) => (s * slope[i] <= 0 ? 0 : (s + slope[i]) / 2)), slope[n - 2]];
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${(pts[i].x + h).toFixed(2)},${(pts[i].y + m[i] * h).toFixed(2)} ${(pts[i + 1].x - h).toFixed(2)},${(pts[i + 1].y - m[i + 1] * h).toFixed(2)} ${pts[i + 1].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`;
  }
  return d;
}

/** Splits a series at nulls so missing days break the line instead of dropping to zero. */
function runs(values: (number | null | undefined)[]): { i: number; v: number }[][] {
  const out: { i: number; v: number }[][] = [[]];
  values.forEach((v, i) => {
    if (v === null || v === undefined || !Number.isFinite(v)) {
      if (out[out.length - 1].length) out.push([]);
    } else out[out.length - 1].push({ i, v });
  });
  return out.filter((r) => r.length);
}

const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function TrendChart({ points, label, format, formatAxis = format, color = "var(--chart-1)", showPrevious = true, good = "neutral", height = 280, className }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const gradientId = useId().replace(/:/g, "");
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  const innerW = width - M.left - M.right;
  const innerH = height - M.top - M.bottom;
  const values = points.map((p) => p.value);
  const prevValues = showPrevious ? points.map((p) => p.previous ?? null) : [];
  const finite = [...values, ...prevValues].filter((v): v is number => v !== null && Number.isFinite(v));
  const scale = niceScale(finite.length ? Math.min(...finite) : 0, finite.length ? Math.max(...finite) : 0);
  const x = (i: number) => M.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => M.top + innerH - ((v - scale.lo) / (scale.hi - scale.lo || 1)) * innerH;
  const base = y(Math.max(0, scale.lo));

  const mainRuns = runs(values);
  const line = mainRuns.map((r) => smoothPath(r.map((p) => ({ x: x(p.i), y: y(p.v) })))).join("");
  const area = mainRuns
    .filter((r) => r.length > 1)
    .map((r) => `${smoothPath(r.map((p) => ({ x: x(p.i), y: y(p.v) })))}L${x(r[r.length - 1].i).toFixed(2)},${base}L${x(r[0].i).toFixed(2)},${base}Z`)
    .join("");
  const prevLine = showPrevious ? runs(prevValues).map((r) => smoothPath(r.map((p) => ({ x: x(p.i), y: y(p.v) })))).join("") : "";
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 76))));

  const indexAt = (clientX: number, rect: DOMRect) => {
    if (n <= 1) return 0;
    const rel = (clientX - rect.left - M.left) / innerW;
    return Math.min(n - 1, Math.max(0, Math.round(rel * (n - 1))));
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => setActive(indexAt(e.clientX, e.currentTarget.getBoundingClientRect()));
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setActive((a) => Math.min(n - 1, Math.max(0, (a ?? n - 1) + (e.key === "ArrowRight" ? 1 : -1))));
  };

  const point = active !== null ? points[active] : null;
  const TOOLTIP_W = 216;
  const tipLeft = active === null ? 0 : x(active) + 14 + TOOLTIP_W > width ? Math.max(0, x(active) - 14 - TOOLTIP_W) : x(active) + 14;
  const delta =
    point && point.value !== null && point.previous !== null && point.previous !== undefined && point.previous > 0
      ? ((point.value - point.previous) / point.previous) * 100
      : null;
  const deltaTone = delta === null || good === "neutral" || Math.abs(delta) < 0.05 ? "text-muted" : (delta > 0) === (good === "up") ? "text-success-ink" : "text-danger-ink";

  return (
    <div ref={wrap} className={cn("relative w-full", className)}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${label} by day. Use left and right arrow keys to read values.`}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((a) => a ?? n - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
        className="block h-auto w-full touch-pan-y select-none rounded-lg focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.26} />
            <stop offset="70%" stopColor={color} stopOpacity={0.05} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>

        {scale.ticks.map((t, i) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={width - M.right}
              y1={y(t)}
              y2={y(t)}
              stroke={i === 0 ? "var(--line)" : "var(--chart-grid)"}
              strokeDasharray={i === 0 ? undefined : "2 4"}
              shapeRendering="crispEdges"
            />
            <text x={M.left - 10} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--faint)" className="tabular">
              {formatAxis(t)}
            </text>
          </g>
        ))}

        {area && <path d={area} fill={`url(#${gradientId})`} className="animate-fade-in" />}
        {prevLine && <path d={prevLine} fill="none" stroke="var(--faint)" strokeWidth={1.5} strokeDasharray="4 4" strokeLinecap="round" opacity={0.8} />}
        <path d={line} fill="none" stroke={color} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
        {/* Lone points (single day, or isolated between gaps) get a dot so they don't vanish. */}
        {mainRuns.filter((r) => r.length === 1).map((r) => <circle key={r[0].i} cx={x(r[0].i)} cy={y(r[0].v)} r={3} fill={color} />)}

        {active !== null && (
          <g pointerEvents="none">
            <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + innerH} stroke="var(--line)" strokeWidth={1} />
            {showPrevious && point?.previous !== null && point?.previous !== undefined && (
              <circle cx={x(active)} cy={y(point.previous)} r={3.5} fill="var(--surface)" stroke="var(--faint)" strokeWidth={1.5} />
            )}
            {point?.value !== null && point?.value !== undefined && (
              <circle cx={x(active)} cy={y(point.value)} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
            )}
          </g>
        )}

        {points.map((p, i) =>
          i % labelEvery === 0 || (i === n - 1 && n > 1 && (n - 1) % labelEvery > labelEvery / 2) ? (
            <text key={p.date} x={x(i)} y={height - 8} textAnchor={i === 0 && n > 1 ? "start" : i === n - 1 && n > 1 ? "end" : "middle"} fontSize={11} fill={active === i ? "var(--muted)" : "var(--faint)"}>
              {shortDate(p.date)}
            </text>
          ) : null,
        )}
      </svg>

      {point && (
        <div role="status" className="pointer-events-none absolute top-2 z-10 rounded-xl border border-line bg-surface/95 p-3 text-[12px] shadow-pop backdrop-blur" style={{ left: tipLeft, width: TOOLTIP_W }}>
          <p className="text-[11.5px] font-medium text-muted">{longDate(point.date)}</p>
          <p className="mt-1 flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
              {label}
            </span>
            <span className="tabular text-[14px] font-semibold text-ink">{point.value === null ? "—" : format(point.value)}</span>
          </p>
          {showPrevious && point.previousDate && (
            <p className="mt-1.5 flex items-baseline justify-between gap-2 border-t border-line-soft pt-1.5">
              <span className="flex items-center gap-1.5 text-faint">
                <span className="h-0.5 w-2 rounded bg-faint" aria-hidden />
                {shortDate(point.previousDate)}
              </span>
              <span className="tabular text-muted">
                {point.previous === null || point.previous === undefined ? "—" : format(point.previous)}
                {delta !== null && <span className={cn("ml-1.5 font-medium", deltaTone)}>{`${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta).toFixed(1)}%`}</span>}
              </span>
            </p>
          )}
        </div>
      )}

      <details className="group mt-2 text-[13px]">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-medium text-muted transition-colors hover:bg-hover hover:text-ink [&::-webkit-details-marker]:hidden">
          <Table2 className="size-3.5" aria-hidden />
          View as table
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line">
          <table className="tabular w-full border-separate border-spacing-0">
            <thead className="sticky top-0">
              <tr className="text-left text-[12px] text-muted">
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-3 font-medium">Date</th>
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-3 text-right font-medium">{label}</th>
                {showPrevious && <th scope="col" className="h-9 border-b border-line bg-surface-2 px-3 text-right font-medium">Previous period</th>}
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => {
                const td = i < n - 1 ? "border-b border-line-soft" : "";
                return (
                  <tr key={p.date} className="hover:bg-hover/60">
                    <td className={`${td} px-3 py-1.5 text-muted`}>{shortDate(p.date)}</td>
                    <td className={`${td} px-3 py-1.5 text-right`}>{p.value === null ? "—" : format(p.value)}</td>
                    {showPrevious && <td className={`${td} px-3 py-1.5 text-right text-muted`}>{p.previous === null || p.previous === undefined ? "—" : format(p.previous)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
