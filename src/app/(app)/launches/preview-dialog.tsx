"use client";

import { LoaderCircle, RectangleHorizontal, RotateCcw, Smartphone, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, buttonClass, cn, Kbd, Segmented, segmentClass } from "@/components/ui";
import type { PreviewFormat } from "@/lib/meta/previews";

export type FormatOption = { id: PreviewFormat; label: string; vertical: boolean };
type Result = { ok: true; src: string } | { ok: false; error: string; processing?: boolean };

/** Modal with one tab per placement; each tab renders Meta's real preview iframe. */
export function PreviewDialog({
  title,
  formats,
  load,
  onClose,
}: {
  title: string;
  formats: readonly FormatOption[];
  load: (format: PreviewFormat) => Promise<Result>;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<PreviewFormat>(formats[0].id);
  const [results, setResults] = useState<Partial<Record<PreviewFormat, Result>>>({});
  const current = results[format];
  const active = formats.find((f) => f.id === format);
  const vertical = active?.vertical ?? false;
  const size = { width: vertical ? 340 : 380, height: vertical ? 680 : 560 };

  // Parents often pass an inline loader; keep the latest without re-triggering requests.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const inflight = useRef(new Set<PreviewFormat>());

  useEffect(() => {
    if (results[format] || inflight.current.has(format)) return;
    inflight.current.add(format);
    loadRef
      .current(format)
      .then(
        (res) => setResults((r) => ({ ...r, [format]: res })),
        () => setResults((r) => ({ ...r, [format]: { ok: false, error: "Preview failed" } })),
      )
      .finally(() => inflight.current.delete(format));
  }, [format, results]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/40 p-3 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-full w-full max-w-[50rem] animate-pop-in flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold tracking-tight">{title}</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted">
              {vertical ? <Smartphone className="size-3.5 shrink-0 text-faint" aria-hidden /> : <RectangleHorizontal className="size-3.5 shrink-0 text-faint" aria-hidden />}
              <span className="truncate">
                {active?.label} · uses the {vertical ? "9:16 Stories/Reels" : "1:1 feed"} file
              </span>
            </p>
          </div>
          <button type="button" aria-label="Close preview" onClick={onClose} className={buttonClass("ghost", "icon", "-mr-1.5 shrink-0")}>
            <X />
          </button>
        </div>

        <div className="overflow-x-auto px-5 pb-4">
          <Segmented className="min-w-max">
            {formats.map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={f.id === format} onClick={() => setFormat(f.id)} className={segmentClass(f.id === format)}>
                {f.label}
              </button>
            ))}
          </Segmented>
        </div>

        <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto border-t border-line-soft bg-canvas p-4 sm:p-6">
          {!current && (
            <Frame vertical={vertical}>
              <div className="flex flex-col items-center justify-center gap-3 bg-surface-2 text-center" style={size}>
                <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden />
                <p className="max-w-48 text-[13px] text-muted">Rendering placement preview from Meta…</p>
              </div>
            </Frame>
          )}
          {current && !current.ok && (
            <div className="flex w-full max-w-md flex-col items-start gap-3 py-10">
              <Alert tone={current.processing ? "warning" : "danger"} title={current.processing ? "Still processing" : "Preview unavailable"}>
                <span className="whitespace-pre-line">{current.error}</span>
              </Alert>
              <button
                type="button"
                className={buttonClass("secondary", "sm")}
                onClick={() =>
                  setResults((r) => {
                    const next = { ...r };
                    delete next[format];
                    return next;
                  })
                }
              >
                <RotateCcw /> Try again
              </button>
            </div>
          )}
          {current?.ok && (
            <Frame vertical={vertical}>
              <iframe
                key={current.src}
                src={current.src}
                title={`${title}: ${active?.label}`}
                sandbox="allow-scripts allow-same-origin allow-popups"
                className="block bg-surface"
                style={size}
              />
            </Frame>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line-soft px-5 py-2.5 text-xs text-faint">
          <span>Rendered live by Meta with this ad&apos;s real settings.</span>
          <span className="flex shrink-0 items-center gap-1.5 max-sm:hidden">
            <Kbd>Esc</Kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}

/** Device-style bezel around the preview so placements read like a phone screen. */
function Frame({ vertical, children }: { vertical: boolean; children: ReactNode }) {
  return (
    <div className={cn("shrink-0 border border-line bg-surface p-1.5 shadow-card", vertical ? "rounded-[28px]" : "rounded-2xl")}>
      <div className={cn("overflow-hidden", vertical ? "rounded-[22px]" : "rounded-xl")}>{children}</div>
    </div>
  );
}
