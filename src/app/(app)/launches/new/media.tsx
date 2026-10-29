"use client";

import { Check, Crop, FolderOpen, ImageIcon, LoaderCircle, RectangleVertical, Square, TriangleAlert, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MediaThumb } from "@/app/(app)/library/media-thumb";
import { SQUARE_ASPECTS, VERTICAL_ASPECTS } from "@/app/(app)/library/pairing";
import { ACCEPT, accepted, uploadAsset, type UploadedAsset } from "@/app/(app)/library/upload";
import { Alert, Button, buttonClass, cn, Kbd } from "@/components/ui";
import { MAX_FLEXIBLE_FILES } from "@/lib/launch/spec";

export type Asset = UploadedAsset;
export type Slot = "feed" | "vertical";

/** The two files an ad can carry, matched to placements the way Ads Manager's "customize per placement" does. */
const SLOTS: Record<Slot, { title: string; ratios: string; detail: string; icon: typeof Square; fits: Set<string>; frame: string }> = {
  feed: {
    title: "Feeds",
    ratios: "1:1 or 4:5",
    detail: "Facebook & Instagram feeds, Explore, Marketplace, search results",
    icon: Square,
    fits: SQUARE_ASPECTS,
    frame: "aspect-square",
  },
  vertical: {
    title: "Stories & Reels",
    ratios: "9:16",
    detail: "Stories, Reels and Status. Optional: without it the feed file runs everywhere and Meta crops it.",
    icon: RectangleVertical,
    fits: VERTICAL_ASPECTS,
    frame: "aspect-[9/16]",
  },
};

const RATIOS: Record<Slot, { label: string; w: number; h: number }[]> = {
  feed: [
    { label: "1:1", w: 1, h: 1 },
    { label: "4:5", w: 4, h: 5 },
  ],
  vertical: [{ label: "9:16", w: 9, h: 16 }],
};

const dims = (a: Asset) => (a.width && a.height ? `${a.width}×${a.height}` : null);
const aspectText = (a: Asset) => (a.aspect === "other" ? "custom ratio" : a.aspect);

/**
 * Media for one ad: a feed slot and a Stories & Reels slot. Files are uploaded or cropped right here
 * and land in the client's library, so the builder never has to be left. Each slot reports on its own
 * (`onSlot`), so two uploads finishing at the same time can't overwrite each other.
 */
export function MediaSlots({
  clientId,
  assets,
  feedAssetId,
  verticalAssetId,
  onAssetsAdded,
  onSlot,
}: {
  clientId: string;
  assets: Asset[];
  feedAssetId: string;
  verticalAssetId: string;
  onAssetsAdded: (a: Asset[]) => void;
  onSlot: (slot: Slot, assetId: string) => void;
}) {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const feed = byId.get(feedAssetId);
  const vertical = byId.get(verticalAssetId);
  const [picker, setPicker] = useState<Slot | null>(null);
  const [crop, setCrop] = useState<{ slot: Slot; source: Asset } | null>(null);

  const added = (slot: Slot, a: Asset) => {
    onAssetsAdded([a]);
    onSlot(slot, a.id);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {(["feed", "vertical"] as const).map((slot) => {
          const asset = slot === "feed" ? feed : vertical;
          const other = slot === "feed" ? vertical : feed;
          // Crop the other slot's image into this slot's ratio (e.g. a 9:16 cut of the feed image).
          const cropSource = asset?.kind === "image" ? asset : other?.kind === "image" ? other : undefined;
          return (
            <SlotCard
              key={slot}
              slot={slot}
              asset={asset}
              mismatch={asset && (slot === "vertical" || vertical) ? !SLOTS[slot].fits.has(asset.aspect) : false}
              kindClash={!!(asset && other && asset.kind !== other.kind)}
              clientId={clientId}
              onUploaded={(a) => added(slot, a)}
              onPick={() => setPicker(slot)}
              onCrop={cropSource ? () => setCrop({ slot, source: cropSource }) : undefined}
              onClear={() => onSlot(slot, "")}
            />
          );
        })}
      </div>

      {picker && (
        <AssetPicker
          slot={picker}
          assets={assets}
          kind={(picker === "feed" ? vertical : feed)?.kind}
          onPick={(a) => {
            onSlot(picker, a.id);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {crop && (
        <CropDialog
          clientId={clientId}
          source={crop.source}
          ratios={RATIOS[crop.slot]}
          onDone={(a) => {
            added(crop.slot, a);
            setCrop(null);
          }}
          onClose={() => setCrop(null)}
        />
      )}
    </div>
  );
}

const FLEX_RATIOS = [...RATIOS.feed, ...RATIOS.vertical];

/**
 * Flexible format: up to MAX_FLEXIBLE_FILES images or videos in one ad. `onChange` gets an updater,
 * so uploads finishing while the list changes can't drop a file.
 */
export function FlexibleMedia({
  clientId,
  assets,
  files,
  onAssetsAdded,
  onChange,
}: {
  clientId: string;
  assets: Asset[];
  files: string[];
  onAssetsAdded: (a: Asset[]) => void;
  onChange: (update: (files: string[]) => string[]) => void;
}) {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const input = useRef<HTMLInputElement>(null);
  const [picker, setPicker] = useState(false);
  const [crop, setCrop] = useState<Asset | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const room = MAX_FLEXIBLE_FILES - files.length;
  const add = (ids: string[]) => onChange((list) => [...list, ...ids.filter((id) => !list.includes(id))].slice(0, MAX_FLEXIBLE_FILES));

  const upload = async (list: File[]) => {
    const usable = list.filter(accepted);
    const batch = usable.slice(0, Math.max(room, 0));
    const notes = [
      usable.length < list.length ? "Only JPG, PNG, MP4 and MOV files are accepted." : "",
      batch.length < usable.length ? `An ad holds up to ${MAX_FLEXIBLE_FILES} files, so ${usable.length - batch.length} weren't added.` : "",
    ].filter(Boolean);
    setError(notes.join(" ") || null);
    if (!batch.length) return;
    setProgress({ done: 0, total: batch.length });
    try {
      // One at a time keeps the files in the order they were chosen.
      for (const [k, file] of batch.entries()) {
        const { asset } = await uploadAsset(file, clientId);
        onAssetsAdded([asset]);
        add([asset.id]);
        setProgress({ done: k + 1, total: batch.length });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setProgress(null);
    }
  };

  const shown = files.map((id) => byId.get(id)).filter((a): a is Asset => !!a);
  const ratios = new Set(shown.map((a) => a.aspect));

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn("flex flex-col gap-3 rounded-xl border bg-surface p-3 transition-colors", dragging ? "border-primary ring-4 ring-[var(--ring)]" : "border-line")}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!progress) void upload([...e.dataTransfer.files]);
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px] text-muted">
            <span className="tabular font-medium text-ink">
              {files.length} of {MAX_FLEXIBLE_FILES}
            </span>{" "}
            files · images and videos, ideally all in one ratio
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" disabled={!!progress || room <= 0} onClick={() => input.current?.click()}>
              {progress ? <LoaderCircle className="animate-spin" /> : <Upload />} {progress ? `Uploading ${progress.done + 1} of ${progress.total}…` : "Upload"}
            </Button>
            <Button size="sm" variant="ghost" disabled={!!progress} onClick={() => setPicker(true)}>
              <FolderOpen /> Library
            </Button>
          </div>
        </div>
        {files.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-muted">
            Drop up to {MAX_FLEXIBLE_FILES} images or videos here, upload them, or pick them from the library.
          </p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2.5">
            {files.map((id, k) => {
              const a = byId.get(id);
              return (
                <li key={id} className="flex flex-col overflow-hidden rounded-lg border border-line">
                  <span className="relative block aspect-square bg-hover">
                    {a ? <MediaThumb id={a.id} kind={a.kind} alt={a.fileName} className="absolute inset-0 size-full object-cover" /> : <span className="absolute inset-0 grid place-items-center text-faint"><ImageIcon className="size-5" /></span>}
                    <span className="absolute left-1.5 top-1.5 rounded-md bg-surface/90 px-1.5 py-px text-[10px] font-medium text-muted ring-1 ring-line backdrop-blur">
                      {k + 1} · {a ? `${a.kind === "image" ? "IMG" : "VID"} · ${aspectText(a)}` : "missing"}
                    </span>
                    <span className="absolute bottom-1.5 right-1.5 flex gap-1">
                      {a?.kind === "image" && (
                        <button type="button" aria-label={`Crop ${a.fileName}`} title="Crop" onClick={() => setCrop(a)} className={buttonClass("secondary", "icon", "size-7 bg-surface/90 backdrop-blur")}>
                          <Crop className="size-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`Remove ${a?.fileName ?? "file"}`}
                        title="Remove"
                        onClick={() => onChange((list) => list.filter((x) => x !== id))}
                        className={buttonClass("secondary", "icon", "size-7 bg-surface/90 backdrop-blur hover:bg-danger-soft hover:text-danger-ink")}
                      >
                        <X className="size-3.5" />
                      </button>
                    </span>
                  </span>
                  <span className="truncate px-2 py-1.5 text-[11.5px]" title={a?.fileName}>
                    {a?.fileName ?? "Not in the library"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {ratios.size > 1 && (
          <p className="flex items-start gap-1 text-[11.5px] text-warning-ink">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden /> These files use different ratios ({[...ratios].map((r) => (r === "other" ? "custom" : r)).join(", ")}). Meta crops them to fit, so one ratio for all looks best.
          </p>
        )}
        {error && <p className="text-[11.5px] text-danger-ink">{error}</p>}
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            void upload([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>

      {picker && (
        <AssetPicker
          slot={null}
          assets={assets}
          selected={files}
          limit={MAX_FLEXIBLE_FILES}
          onPick={(a) => onChange((list) => (list.includes(a.id) ? list.filter((x) => x !== a.id) : [...list, a.id].slice(0, MAX_FLEXIBLE_FILES)))}
          onClose={() => setPicker(false)}
        />
      )}
      {crop && (
        <CropDialog
          clientId={clientId}
          source={crop}
          ratios={FLEX_RATIOS}
          onDone={(a) => {
            onAssetsAdded([a]);
            // The crop takes the original's place in the list.
            onChange((list) => (list.includes(a.id) ? list.filter((x) => x !== crop.id) : list.map((x) => (x === crop.id ? a.id : x))));
            setCrop(null);
          }}
          onClose={() => setCrop(null)}
        />
      )}
    </div>
  );
}

function SlotCard({
  slot,
  asset,
  mismatch,
  kindClash,
  clientId,
  onUploaded,
  onPick,
  onCrop,
  onClear,
}: {
  slot: Slot;
  asset?: Asset;
  mismatch: boolean;
  kindClash: boolean;
  clientId: string;
  onUploaded: (a: Asset) => void;
  onPick: () => void;
  onCrop?: () => void;
  onClear: () => void;
}) {
  const meta = SLOTS[slot];
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!accepted(file)) return setError("Use a JPG, PNG, MP4 or MOV file.");
    setError(null);
    setUploading(true);
    try {
      onUploaded((await uploadAsset(file, clientId)).asset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className={cn("flex flex-col rounded-xl border bg-surface transition-colors", dragging ? "border-primary ring-4 ring-[var(--ring)]" : "border-line")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void upload(e.dataTransfer.files[0]);
      }}
    >
      <div className="flex items-start gap-2.5 border-b border-line-soft px-3 py-2.5">
        <meta.icon className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden />
        <div className="min-w-0">
          <p className="text-[13px] font-medium">
            {meta.title} <span className="font-normal text-muted">· {meta.ratios}</span>
          </p>
          <p className="text-[11.5px] leading-snug text-faint">{meta.detail}</p>
        </div>
      </div>
      <div className="flex flex-1 gap-3 p-3">
        <div className={cn("relative w-24 shrink-0 self-start overflow-hidden rounded-lg border border-line bg-hover", meta.frame)}>
          {asset ? (
            <MediaThumb id={asset.id} kind={asset.kind} alt={asset.fileName} className="absolute inset-0 size-full object-cover" />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-faint">{uploading ? <LoaderCircle className="size-5 animate-spin" /> : <ImageIcon className="size-5" />}</span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {asset ? (
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-medium" title={asset.fileName}>
                {asset.fileName}
              </p>
              <p className="text-[11.5px] text-muted">
                {asset.kind === "image" ? "Image" : "Video"} · {[dims(asset), aspectText(asset)].filter(Boolean).join(" · ")}
              </p>
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">{uploading ? "Uploading…" : "Drop a file here, upload one, or pick from the library."}</p>
          )}
          {asset && mismatch && (
            <p className="flex items-start gap-1 text-[11.5px] text-warning-ink">
              <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden /> Needs {meta.ratios}.{asset.kind === "image" ? " Crop it to fit." : " Upload a video in this ratio."}
            </p>
          )}
          {asset && kindClash && <p className="text-[11.5px] text-warning-ink">Use two images or two videos, not one of each.</p>}
          {error && <p className="text-[11.5px] text-danger-ink">{error}</p>}
          <div className="mt-auto flex flex-wrap gap-1.5">
            <Button size="sm" disabled={uploading} onClick={() => input.current?.click()}>
              <Upload /> {asset ? "Replace" : "Upload"}
            </Button>
            <Button size="sm" variant="ghost" disabled={uploading} onClick={onPick}>
              <FolderOpen /> Library
            </Button>
            {onCrop && (
              <Button size="sm" variant="ghost" disabled={uploading} onClick={onCrop}>
                <Crop /> Crop
              </Button>
            )}
            {asset && (
              <button type="button" aria-label={`Remove ${meta.title} file`} title="Remove" onClick={onClear} className={buttonClass("ghost", "icon", "hover:bg-danger-soft hover:text-danger-ink")}>
                <X />
              </button>
            )}
          </div>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/40 p-3 backdrop-blur-[2px] sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cn("flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop", wide ? "max-w-3xl" : "max-w-xl")}>
        <div className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
          <h2 className="text-[14.5px] font-semibold tracking-tight">{title}</h2>
          <span className="flex items-center gap-2">
            <Kbd className="max-sm:hidden">Esc</Kbd>
            <button type="button" aria-label="Close" onClick={onClose} className={buttonClass("ghost", "icon")}>
              <X />
            </button>
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Library picker. For a slot it lists files of that slot's ratio and picks one; without a slot
 * (Flexible format) it toggles files in and out of `selected`, up to `limit`, and stays open.
 */
function AssetPicker({
  slot,
  assets,
  kind,
  selected,
  limit,
  onPick,
  onClose,
}: {
  slot: Slot | null;
  assets: Asset[];
  kind?: "image" | "video";
  selected?: string[];
  limit?: number;
  onPick: (a: Asset) => void;
  onClose: () => void;
}) {
  const [onlyFits, setOnlyFits] = useState(true);
  const fits = (a: Asset) => (!slot || SLOTS[slot].fits.has(a.aspect)) && (!kind || a.kind === kind);
  const filtered = !!slot && onlyFits;
  const list = filtered ? assets.filter(fits) : assets;
  const full = !!limit && (selected?.length ?? 0) >= limit;
  return (
    <Dialog title={slot ? `Choose a ${SLOTS[slot].title.toLowerCase()} file` : "Add files from the library"} onClose={onClose} wide>
      <div className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-2.5 text-[12.5px]">
        {slot ? (
          <label className="flex cursor-pointer items-center gap-2 text-muted">
            <input type="checkbox" checked={onlyFits} onChange={(e) => setOnlyFits(e.target.checked)} className="size-4 accent-primary" />
            Only {SLOTS[slot].ratios} {kind ? `${kind}s` : "files"}
          </label>
        ) : (
          <span className={cn("tabular", full ? "text-warning-ink" : "text-muted")}>
            {selected?.length ?? 0} of {limit} files in this ad{full ? " (the most Meta allows)" : ""}
          </span>
        )}
        <span className="tabular text-faint">{list.length} files</span>
      </div>
      <div className="min-h-0 overflow-y-auto p-4">
        {list.length === 0 ? (
          <p className="px-2 py-8 text-center text-[13px] text-muted">{filtered && slot ? `No ${SLOTS[slot].ratios} files yet. Upload one, crop an image, or show all files.` : "This client's library is empty."}</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3">
            {list.map((a) => {
              const on = !!selected?.includes(a.id);
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    aria-pressed={selected ? on : undefined}
                    disabled={full && !on}
                    onClick={() => onPick(a)}
                    className={cn(
                      "group block w-full overflow-hidden rounded-xl border text-left transition hover:border-primary/50 hover:shadow-card focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50",
                      on ? "border-primary ring-2 ring-primary/30" : "border-line",
                    )}
                  >
                    <span className="relative block">
                      <MediaThumb id={a.id} kind={a.kind} alt={a.fileName} className="aspect-square w-full" />
                      <span className={cn("absolute left-1.5 top-1.5 rounded-md bg-surface/90 px-1.5 py-px text-[10px] font-medium ring-1 ring-line backdrop-blur", fits(a) ? "text-muted" : "text-warning-ink")}>
                        {a.kind === "image" ? "IMG" : "VID"} · {aspectText(a)}
                      </span>
                      {on && (
                        <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-primary text-white">
                          <Check className="size-3.5" aria-hidden />
                        </span>
                      )}
                    </span>
                    <span className="block truncate px-2 py-1.5 text-[12px] group-hover:text-primary-ink">{a.fileName}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {selected && (
        <div className="flex justify-end border-t border-line-soft px-5 py-3">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      )}
    </Dialog>
  );
}

/** Crops an image to a placement ratio in the browser and uploads the result as a new library file. */
function CropDialog({ clientId, source, ratios, onDone, onClose }: { clientId: string; source: Asset; ratios: { label: string; w: number; h: number }[]; onDone: (a: Asset) => void; onClose: () => void }) {
  const [ratio, setRatio] = useState(ratios[0]);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 0.5, y: 0.5 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  // Crop box in natural pixels: the largest box of this ratio, shrunk by zoom, kept inside the image.
  const box = (() => {
    if (!natural) return null;
    const r = ratio.w / ratio.h;
    let w = natural.w / natural.h > r ? natural.h * r : natural.w;
    let h = w / r;
    w /= zoom;
    h /= zoom;
    const x = Math.min(Math.max(center.x * natural.w - w / 2, 0), natural.w - w);
    const y = Math.min(Math.max(center.y * natural.h - h / 2, 0), natural.h - h);
    return { x, y, w, h };
  })();

  const onPointerDown = (e: ReactPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, cx: center.x, cy: center.y };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    const el = img.current;
    if (!d || !el) return;
    const rect = el.getBoundingClientRect();
    setCenter({ x: Math.min(1, Math.max(0, d.cx + (e.clientX - d.x) / rect.width)), y: Math.min(1, Math.max(0, d.cy + (e.clientY - d.y) / rect.height)) });
  };

  const save = async () => {
    if (!box || !img.current) return;
    setSaving(true);
    setError(null);
    try {
      // Long side capped at 1920px: Meta's recommended sizes (1080×1080, 1080×1350, 1080×1920) fit with room to spare.
      const scale = Math.min(1, 1920 / Math.max(box.w, box.h));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(box.w * scale);
      canvas.height = Math.round(box.h * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Your browser can't crop images");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img.current, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) throw new Error("Couldn't create the cropped image");
      const base = source.fileName.replace(/\.[A-Za-z0-9]{2,5}$/, "").replace(/[\s._-]*(1x1|4x5|9x16)$/i, "");
      const file = new File([blob], `${base}_${ratio.label.replace(":", "x")}.jpg`, { type: "image/jpeg" });
      onDone((await uploadAsset(file, clientId)).asset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Crop failed");
      setSaving(false);
    }
  };

  return (
    <Dialog title={`Crop to ${ratio.label}`} onClose={onClose}>
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl border border-line bg-surface-2 p-0.5">
            {ratios.map((r) => (
              <button
                key={r.label}
                type="button"
                aria-pressed={r.label === ratio.label}
                onClick={() => setRatio(r)}
                className={cn("h-8 rounded-[10px] px-3 text-[13px] font-medium", r.label === ratio.label ? "bg-surface text-ink shadow-card ring-1 ring-line" : "text-muted hover:text-ink")}
              >
                {r.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-muted">
            Zoom
            <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-32 accent-primary" />
          </label>
        </div>
        <div className="grid place-items-center rounded-xl bg-surface-2 p-3">
          <div className="relative max-h-[55vh] touch-none select-none overflow-hidden" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- same-origin library file, drawn to a canvas */}
            <img
              ref={img}
              src={`/api/media/${source.id}`}
              alt={source.fileName}
              draggable={false}
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              className="block max-h-[55vh] w-auto max-w-full cursor-move"
            />
            {box && natural && (
              <span
                aria-hidden
                className="pointer-events-none absolute rounded-sm outline outline-2 outline-white [box-shadow:0_0_0_9999px_rgb(0_0_0/0.55)]"
                style={{ left: `${(box.x / natural.w) * 100}%`, top: `${(box.y / natural.h) * 100}%`, width: `${(box.w / natural.w) * 100}%`, height: `${(box.h / natural.h) * 100}%` }}
              />
            )}
          </div>
        </div>
        <p className="text-[12.5px] text-muted">
          Drag to move the frame. The crop is saved as a new file in the library{box ? ` (${Math.round(box.w * Math.min(1, 1920 / Math.max(box.w, box.h)))}×${Math.round(box.h * Math.min(1, 1920 / Math.max(box.w, box.h)))})` : ""}.
        </p>
        {error && <Alert>{error}</Alert>}
      </div>
      <div className="flex justify-end gap-2 border-t border-line-soft px-5 py-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!box || saving} onClick={save}>
          {saving ? "Saving…" : `Use ${ratio.label} crop`}
        </Button>
      </div>
    </Dialog>
  );
}
