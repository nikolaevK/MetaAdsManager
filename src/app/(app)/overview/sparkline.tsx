import { cn } from "@/components/ui";

/**
 * Decorative trend line for KPI tiles (aria-hidden: the chart below has the readable data and a
 * table fallback). Stretches to its box; gaps (null days, e.g. no results → no cost per result) break the line.
 */
export function Sparkline({ values, className, color = "var(--chart-1)", id }: { values: (number | null)[]; className?: string; color?: string; id: string }) {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (values.length < 2 || nums.length < 2) return null;

  const W = 100;
  const H = 32;
  const PAD = 3;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => (max === min ? H / 2 : PAD + (1 - (v - min) / (max - min)) * (H - PAD * 2));

  // Contiguous runs of non-null points.
  const runs: { i: number; v: number }[][] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) return runs.push([]);
    if (runs.length === 0) runs.push([]);
    runs[runs.length - 1].push({ i, v });
  });
  const segments = runs.filter((r) => r.length > 0);
  const line = segments.map((r) => r.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(2)},${y(p.v).toFixed(2)}`).join("")).join("");
  const area = segments
    .filter((r) => r.length > 1)
    .map((r) => `M${x(r[0].i).toFixed(2)},${H}${r.map((p) => `L${x(p.i).toFixed(2)},${y(p.v).toFixed(2)}`).join("")}L${x(r[r.length - 1].i).toFixed(2)},${H}Z`)
    .join("");
  const last = segments[segments.length - 1].at(-1)!;
  const gid = `spark-${id}`;

  return (
    <span aria-hidden className={cn("relative block", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.24} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* End marker in HTML so it stays round while the SVG stretches. */}
      <span
        className="absolute size-[6px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
        style={{ left: `${(x(last.i) / W) * 100}%`, top: `${(y(last.v) / H) * 100}%`, background: color }}
      />
    </span>
  );
}
