/** Date helpers working on "YYYY-MM-DD" strings in an ad account's timezone. */

export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(since: string, until: string): number {
  return Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000) + 1;
}

/** 0 = Monday … 6 = Sunday. */
const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

export const DATE_PRESETS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last_3d", label: "Last 3 days" },
  { id: "last_7d", label: "Last 7 days" },
  { id: "last_14d", label: "Last 14 days" },
  { id: "last_28d", label: "Last 28 days" },
  { id: "last_30d", label: "Last 30 days" },
  { id: "last_90d", label: "Last 90 days" },
  { id: "this_week", label: "This week" },
  { id: "last_week", label: "Last week" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number]["id"];

export type DateRange = { since: string; until: string; preset: DatePreset | "custom" };

/** Longest custom range we aggregate (Ads Manager allows 37 months; our insights backfill is far shorter). */
export const MAX_RANGE_DAYS = 400;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-31, which Date would otherwise roll over or throw on). */
export function isIsoDate(v: string | undefined): v is string {
  if (!v || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const LAST_N: Partial<Record<DatePreset, number>> = { last_3d: 3, last_7d: 7, last_14d: 14, last_28d: 28, last_30d: 30, last_90d: 90 };

/** Ads Manager semantics: "Last N days" excludes today; weeks start on Monday. */
export function resolveDateRange(
  input: { preset?: string; since?: string; until?: string },
  timeZone: string,
  now = new Date(),
): DateRange {
  const today = todayIn(timeZone, now);
  if (isIsoDate(input.since) && isIsoDate(input.until) && input.since <= input.until && daysBetween(input.since, input.until) <= MAX_RANGE_DAYS) {
    return { since: input.since, until: input.until, preset: "custom" };
  }
  const yesterday = addDays(today, -1);
  const preset = DATE_PRESETS.some((p) => p.id === input.preset) ? (input.preset as DatePreset) : "last_7d";
  const n = LAST_N[preset];
  if (n) return { since: addDays(today, -n), until: yesterday, preset };
  switch (preset) {
    case "today":
      return { since: today, until: today, preset };
    case "yesterday":
      return { since: yesterday, until: yesterday, preset };
    case "this_week":
      return { since: addDays(today, -weekday(today)), until: today, preset };
    case "last_week": {
      const monday = addDays(today, -weekday(today) - 7);
      return { since: monday, until: addDays(monday, 6), preset };
    }
    case "this_month":
      return { since: `${today.slice(0, 8)}01`, until: today, preset };
    case "last_month": {
      const lastPrev = addDays(`${today.slice(0, 8)}01`, -1);
      return { since: `${lastPrev.slice(0, 8)}01`, until: lastPrev, preset };
    }
    default:
      return { since: addDays(today, -7), until: yesterday, preset: "last_7d" };
  }
}

/** The equally long period right before `range` (what the deltas compare against). */
export function previousPeriod(range: { since: string; until: string }): { since: string; until: string } {
  const until = addDays(range.since, -1);
  return { since: addDays(until, -(daysBetween(range.since, range.until) - 1)), until };
}

// ── Remembered selection ─────────────────────────────────────────────────────

/** Cookie that carries the last picked range between pages (the URL wins when it has one). */
export const RANGE_COOKIE = "mam_range";

export function encodeRangeCookie(r: { preset: string; since?: string; until?: string }): string {
  return r.preset === "custom" ? `custom:${r.since}:${r.until}` : r.preset;
}

export function decodeRangeCookie(v: string | undefined): { preset?: string; since?: string; until?: string } {
  if (!v) return {};
  const [kind, since, until] = v.split(":");
  return kind === "custom" ? { since, until } : { preset: kind };
}

/** URL params first; the remembered cookie only fills in when the URL names no range. */
export function rangeInput(
  sp: Record<string, string | string[] | undefined>,
  cookie: string | undefined,
): { preset?: string; since?: string; until?: string } {
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const fromUrl = { preset: str("preset"), since: str("since"), until: str("until") };
  return fromUrl.preset || fromUrl.since || fromUrl.until ? fromUrl : decodeRangeCookie(cookie);
}

// ── Display ──────────────────────────────────────────────────────────────────

export const shortDate = (d: string, year = false) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: year ? "numeric" : undefined, timeZone: "UTC" });

export const formatSpan = (since: string, until: string) =>
  since === until ? shortDate(since, true) : `${shortDate(since, since.slice(0, 4) !== until.slice(0, 4))} – ${shortDate(until, true)}`;

// ── Account-timezone date-times (schedules) ─────────────────────────────────

/** Offset of `timeZone` from UTC at instant `ts`, in ms. */
function tzOffsetMs(ts: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ts));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - ts;
}

/** "2026-10-30T09:00" read as wall-clock time in the ad account's timezone → UTC ISO string. */
export function zonedLocalToIso(local: string, timeZone: string): string {
  const wall = Date.parse(`${local.length === 16 ? `${local}:00` : local}Z`);
  if (Number.isNaN(wall)) throw new RangeError(`Invalid date-time: ${local}`);
  let ts = wall - tzOffsetMs(wall, timeZone);
  // Second pass settles instants next to a DST switch.
  ts = wall - tzOffsetMs(ts, timeZone);
  return new Date(ts).toISOString();
}

/** UTC/offset ISO string → "YYYY-MM-DDTHH:mm" wall-clock time in `timeZone` (for datetime-local inputs). */
export function isoToZonedLocal(iso: string, timeZone: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  return new Date(ts + tzOffsetMs(ts, timeZone)).toISOString().slice(0, 16);
}
