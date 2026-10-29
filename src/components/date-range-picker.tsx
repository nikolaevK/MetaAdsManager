"use client";

import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { addDays, DATE_PRESETS, encodeRangeCookie, formatSpan, isIsoDate, MAX_RANGE_DAYS, daysBetween, previousPeriod, RANGE_COOKIE, shortDate } from "@/lib/dates";
import { Modal, useModal } from "./modal";
import { Button, cn, focusRing } from "./ui";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const addMonths = (ym: string, n: number) => {
  const d = new Date(`${ym}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

/** Day cells for a month grid, Monday-first, padded with nulls. */
function monthDays(ym: string): (string | null)[] {
  const first = `${ym}-01`;
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const days: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = first; d.startsWith(ym); d = addDays(d, 1)) days.push(d);
  return days;
}

function remember(value: string) {
  document.cookie = `${RANGE_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export function DateRangePicker({ since, until, preset, today }: { since: string; until: string; preset: string; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  // Phones get a bottom sheet over a backdrop; wider screens a popover under the trigger. Decided on open.
  const [sheet, setSheet] = useState(false);
  // Draft selection inside the calendar. `end === null` while picking the second date.
  const [draft, setDraft] = useState<{ start: string; end: string | null }>({ start: since, end: until });
  const [hover, setHover] = useState<string | null>(null);
  const [month, setMonth] = useState(() => addMonths(until.slice(0, 7), -1));
  const ref = useRef<HTMLDivElement>(null);
  const activePreset = useRef<HTMLButtonElement>(null);

  // Re-seed the draft from the applied range every time the popover opens (props change after navigation).
  const openPicker = () => {
    setDraft({ start: since, end: until });
    setMonth(addMonths(until.slice(0, 7), -1));
    setHover(null);
    setSheet(matchMedia("(max-width: 639.98px)").matches);
    setOpen(true);
  };
  const close = () => setOpen(false);

  // The popover closes on a click outside it; the sheet's backdrop handles that itself.
  useEffect(() => {
    if (!open || sheet) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, sheet]);
  // Cache Components keeps hidden pages mounted; close the popover when this page is hidden.
  useLayoutEffect(() => () => setOpen(false), []);

  const apply = (next: { preset: string } | { since: string; until: string }) => {
    const p = new URLSearchParams(params);
    for (const k of ["preset", "since", "until"]) p.delete(k);
    if ("preset" in next) {
      p.set("preset", next.preset);
      remember(encodeRangeCookie({ preset: next.preset }));
    } else {
      p.set("since", next.since);
      p.set("until", next.until);
      remember(encodeRangeCookie({ preset: "custom", ...next }));
    }
    router.push(`${pathname}?${p}`, { scroll: false });
    setOpen(false);
  };

  const pick = (day: string) => {
    if (draft.end !== null || day < draft.start) setDraft({ start: day, end: null });
    else setDraft({ start: draft.start, end: day });
  };

  const rangeEnd = draft.end ?? (hover && hover >= draft.start ? hover : draft.start);
  const valid = draft.end !== null && daysBetween(draft.start, draft.end) <= MAX_RANGE_DAYS;
  const prev = previousPeriod({ since, until });
  const label = DATE_PRESETS.find((p) => p.id === preset)?.label ?? "Custom";

  const body = (
    <>
      <ul className="flex shrink-0 gap-1 overflow-x-auto border-line-soft p-2 [scrollbar-width:none] max-sm:border-b sm:w-40 sm:flex-col sm:gap-0 sm:border-r">
        {DATE_PRESETS.map((p) => (
          <li key={p.id} className="shrink-0">
            <button
              ref={p.id === preset ? activePreset : undefined}
              type="button"
              onClick={() => apply({ preset: p.id })}
              className={cn(
                "w-full whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-hover pointer-coarse:py-2.5",
                focusRing,
                p.id === preset ? "bg-primary-soft font-medium text-primary-ink" : "text-ink",
              )}
            >
              {p.label}
            </button>
          </li>
        ))}
      </ul>

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {[month, addMonths(month, 1)].map((ym, i) => (
            <MonthGrid
              key={ym}
              ym={ym}
              className={i === 0 ? "max-sm:hidden" : undefined}
              // Desktop: arrows on the outer edges. Phones show only the second month, so it gets both.
              prev={i === 0 ? "show" : "mobile"}
              next={i === 1 ? "show" : "hide"}
              canNext={addMonths(month, 1) < today.slice(0, 7)}
              onMonth={(n) => setMonth((m) => addMonths(m, n))}
              today={today}
              start={draft.start}
              end={rangeEnd}
              onPick={pick}
              onHover={setHover}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t border-line-soft pt-3">
          <DateInput label="Start" value={draft.start} max={today} onChange={(v) => setDraft((d) => ({ start: v, end: d.end && d.end >= v ? d.end : null }))} />
          <span className="pb-2 text-faint" aria-hidden>
            →
          </span>
          <DateInput label="End" value={draft.end ?? ""} min={draft.start} max={today} onChange={(v) => setDraft((d) => ({ ...d, end: v >= d.start ? v : null }))} />
          <div className="ml-auto flex gap-2 max-sm:w-full max-sm:justify-end">
            <Button size="sm" variant="ghost" className="pointer-coarse:h-10" onClick={close}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" className="pointer-coarse:h-10" disabled={!valid} onClick={() => draft.end && apply({ since: draft.start, until: draft.end })}>
              Update
            </Button>
          </div>
        </div>
        <p className="text-[12px] text-faint">
          {draft.end
            ? `${daysBetween(draft.start, draft.end)} days · compared with ${formatSpan(previousPeriod({ since: draft.start, until: draft.end }).since, previousPeriod({ since: draft.start, until: draft.end }).until)}`
            : `Pick an end date · currently compared with ${formatSpan(prev.since, prev.until)}`}
          {draft.end && !valid && ` · ranges are limited to ${MAX_RANGE_DAYS} days`}
        </p>
      </div>
    </>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn("flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] shadow-xs transition-colors hover:bg-hover", focusRing)}
      >
        <Calendar className="size-4 text-faint" aria-hidden />
        <span className="font-medium">
          {label}
          <span className="hidden sm:inline">:</span>
        </span>
        <span className="tabular hidden text-muted sm:inline">{formatSpan(since, until)}</span>
        <ChevronDown className={cn("size-4 text-faint transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open &&
        (sheet ? (
          <Modal
            onClose={close}
            initialFocus={activePreset}
            aria-label="Choose a date range"
            overlayClassName="z-50 flex items-end"
            className="flex max-h-[calc(100dvh-1rem)] w-full animate-sheet-up flex-col overflow-y-auto overscroll-contain rounded-t-2xl border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-pop"
          >
            <span aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line" />
            {body}
          </Modal>
        ) : (
          <Popover onClose={close} initialFocus={activePreset}>
            {body}
          </Popover>
        ))}
    </div>
  );
}

/** Desktop popover under the trigger: same focus handling as a dialog (focus in, Tab kept inside, Escape, focus back). */
function Popover({ onClose, initialFocus, children }: { onClose: () => void; initialFocus: RefObject<HTMLElement | null>; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useModal(panel, { onClose, initialFocus });
  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Choose a date range"
      tabIndex={-1}
      className="absolute right-0 top-11 z-50 flex w-[min(44rem,calc(100vw-2rem))] animate-pop-in flex-row overflow-hidden rounded-2xl border border-line bg-surface shadow-pop outline-none"
    >
      {children}
    </div>
  );
}

const NAV = cn("grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-30 pointer-coarse:size-10", focusRing);

function MonthGrid({
  ym,
  today,
  start,
  end,
  onPick,
  onHover,
  prev,
  next,
  canNext,
  onMonth,
  className,
}: {
  ym: string;
  today: string;
  start: string;
  end: string;
  onPick: (d: string) => void;
  onHover: (d: string | null) => void;
  prev: "show" | "mobile";
  next: "show" | "hide";
  canNext: boolean;
  onMonth: (delta: number) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-2 flex h-8 items-center justify-between gap-2 pointer-coarse:h-10">
        <button type="button" aria-label="Previous month" onClick={() => onMonth(-1)} className={cn(NAV, prev === "mobile" && "sm:invisible")}>
          <ChevronLeft className="size-4" />
        </button>
        <p className="text-[13px] font-semibold">{monthLabel(ym)}</p>
        <button type="button" aria-label="Next month" disabled={!canNext} onClick={() => onMonth(1)} className={cn(NAV, next === "hide" && "invisible")}>
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-medium text-faint">
        {WEEKDAYS.map((d) => (
          <span key={d} className="pb-1">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => onHover(null)}>
        {monthDays(ym).map((d, i) => {
          if (!d) return <span key={`pad-${i}`} />;
          const inRange = d >= start && d <= end;
          const isEdge = d === start || d === end;
          const future = d > today;
          return (
            <button
              key={d}
              type="button"
              disabled={future}
              aria-pressed={isEdge}
              aria-label={shortDate(d, true)}
              onClick={() => onPick(d)}
              onMouseEnter={() => onHover(d)}
              className={cn(
                "tabular relative h-8 text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:text-faint/50 pointer-coarse:h-10 pointer-coarse:text-[13.5px]",
                focusRing,
                inRange && !isEdge && "bg-primary-soft text-primary-ink",
                d === start && "rounded-l-lg",
                d === end && "rounded-r-lg",
                !inRange && "rounded-lg hover:bg-hover",
                isEdge && "bg-primary font-semibold text-on-primary",
                d === today && !isEdge && "font-semibold underline decoration-primary decoration-2 underline-offset-4",
              )}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DateInput({ label, value, min, max, onChange }: { label: string; value: string; min?: string; max?: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-[11.5px] font-medium text-muted">
      {label}
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => isIsoDate(e.target.value) && onChange(e.target.value)}
        className="tabular h-8 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-[var(--ring)] pointer-coarse:h-10"
      />
    </label>
  );
}
