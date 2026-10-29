"use client";

import { Check, Link2, RectangleVertical, Square, Trash2, TriangleAlert, type LucideIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "@/components/toast";
import { Badge, Button, cn, Field, focusRing, Input } from "@/components/ui";
import { createCreativeAction, deleteAssetAction } from "./actions";
import { formatBytes, MediaThumb } from "./media-thumb";
import { baseName, SQUARE_ASPECTS, VERTICAL_ASPECTS } from "./pairing";

export type UnpairedAsset = {
  id: string;
  kind: "image" | "video";
  fileName: string;
  aspect: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
};

const role = (a: UnpairedAsset) => (SQUARE_ASPECTS.has(a.aspect) ? "square" : VERTICAL_ASPECTS.has(a.aspect) ? "vertical" : null);

export function UnpairedAssets({ assets, canEdit }: { assets: UnpairedAsset[]; canEdit: boolean }) {
  const [square, setSquare] = useState<string | null>(null);
  const [vertical, setVertical] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [angle, setAngle] = useState("");
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  const sq = assets.find((a) => a.id === square);
  const vt = assets.find((a) => a.id === vertical);
  const kindMismatch = sq && vt && sq.kind !== vt.kind;

  const pick = (a: UnpairedAsset) => {
    const r = role(a);
    if (r === "square") setSquare((cur) => (cur === a.id ? null : a.id));
    if (r === "vertical") setVertical((cur) => (cur === a.id ? null : a.id));
    if (r && !name) setName(baseName(a.fileName));
  };

  const run = (fn: () => ReturnType<typeof deleteAssetAction>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res?.ok) {
        toast(res.message ?? "Done");
        after?.();
      } else toast(res?.error ?? "Something went wrong", "error");
    });

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <form
          className="overflow-hidden rounded-xl border border-line bg-surface shadow-card"
          onSubmit={(e) => {
            e.preventDefault();
            if (!sq || !vt) return;
            run(
              () => createCreativeAction({ name, squareAssetId: sq.id, verticalAssetId: vt.id, angle: angle || undefined }),
              () => {
                setSquare(null);
                setVertical(null);
                setName("");
                setAngle("");
              },
            );
          }}
        >
          <div className="flex items-start gap-3 border-b border-line-soft px-4 py-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-muted">
              <Link2 className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold tracking-tight">Create a creative</p>
              <p className="text-[13px] text-muted">
                Pick one 1:1 or 4:5 file and one 9:16 file below to name a placement-optimized pair, or use any single file on its own with{" "}
                <span className="font-medium text-ink">Use alone</span>.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-4 p-4 xl:flex-row xl:items-end">
            <div className="grid grid-cols-1 min-w-0 gap-2 sm:grid-cols-2 xl:w-[30rem] xl:shrink-0">
              <Slot icon={Square} label="Feed · 1:1 or 4:5" asset={sq} />
              <Slot icon={RectangleVertical} label="Stories · 9:16" asset={vt} />
            </div>
            <div className="grid grid-cols-1 min-w-0 flex-1 gap-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
              <Field label="Name" htmlFor="pair-name">
                <Input id="pair-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
              </Field>
              <Field label="Angle (optional)" htmlFor="pair-angle">
                <Input id="pair-angle" value={angle} onChange={(e) => setAngle(e.target.value)} maxLength={100} placeholder="e.g. UGC" />
              </Field>
              <Button type="submit" variant="primary" disabled={pending || !sq || !vt || !!kindMismatch || !name.trim()}>
                Create creative
              </Button>
            </div>
          </div>
          {kindMismatch && (
            <p className="flex items-center gap-1.5 border-t border-line-soft bg-danger-soft px-4 py-2 text-xs text-danger-ink">
              <TriangleAlert className="size-3.5" aria-hidden /> Both files must be images, or both videos.
            </p>
          )}
        </form>
      )}

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3">
        {assets.map((a) => {
          const r = role(a);
          const selected = a.id === square || a.id === vertical;
          return (
            <li
              key={a.id}
              className={cn(
                "group flex flex-col overflow-hidden rounded-xl border bg-surface shadow-xs transition-[border-color,box-shadow]",
                selected ? "border-primary ring-2 ring-primary/25" : r && canEdit ? "border-line hover:border-primary/50 hover:shadow-card" : "border-line",
              )}
            >
              <button
                type="button"
                disabled={!canEdit || !r}
                onClick={() => pick(a)}
                aria-pressed={selected}
                aria-label={r ? `Use ${a.fileName} as the ${r === "square" ? "feed" : "Stories/Reels"} file` : a.fileName}
                className="relative flex h-40 items-center justify-center bg-surface-2 p-3 outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[var(--ring)] disabled:cursor-default"
              >
                <MediaThumb id={a.id} kind={a.kind} alt={a.fileName} className={cn("max-h-full max-w-full rounded-md object-contain shadow-card", !r && "opacity-60")} />
                <span
                  className={cn(
                    "absolute left-2 top-2 rounded-md px-1.5 py-px text-[10.5px] font-medium shadow-xs ring-1 backdrop-blur",
                    !r ? "bg-surface/90 text-muted ring-line" : selected ? "bg-surface text-primary-ink ring-primary/40" : "bg-surface/90 text-muted ring-line",
                  )}
                >
                  {r === "square" ? "Feed" : r === "vertical" ? "Stories" : "Single only"}
                </span>
                {selected && (
                  <span className="absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-surface text-primary-ink shadow-card ring-1 ring-primary/40">
                    <Check className="size-3" strokeWidth={3} aria-hidden />
                  </span>
                )}
              </button>
              <div className="flex flex-col gap-1.5 border-t border-line-soft p-2.5">
                <p className="truncate text-[12.5px] font-medium" title={a.fileName}>
                  {a.fileName}
                </p>
                <div className="flex items-center justify-between gap-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Badge tone="muted" className="tabular">
                      {a.aspect === "other" && a.width && a.height ? `${a.width}×${a.height}` : a.aspect}
                    </Badge>
                    <span className="tabular truncate text-[11px] text-faint">{formatBytes(a.sizeBytes)}</span>
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={`Delete ${a.fileName}`}
                      title="Delete file"
                      disabled={pending}
                      onClick={async () => {
                        const ok = await confirm({ title: `Delete ${a.fileName}?`, body: "This removes the file from the library.", confirmLabel: "Delete file", tone: "danger" });
                        if (ok)
                          run(() => deleteAssetAction({ id: a.id }), () => {
                            if (square === a.id) setSquare(null);
                            if (vertical === a.id) setVertical(null);
                          });
                      }}
                      className={cn("grid size-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-danger-soft hover:text-danger-ink disabled:opacity-50 pointer-coarse:size-10", focusRing)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
                {canEdit && (
                  <Button
                    type="button"
                    size="sm"
                    variant="subtle"
                    disabled={pending}
                    title="Create a creative from just this file; it runs in every placement"
                    onClick={() => run(() => createCreativeAction({ name: baseName(a.fileName), squareAssetId: a.id }))}
                  >
                    Use alone
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One side of the pair being built: shows the picked file or an empty dashed slot. */
function Slot({ icon: Icon, label, asset }: { icon: LucideIcon; label: string; asset: UnpairedAsset | undefined }) {
  return (
    <div
      className={cn(
        "flex h-14 min-w-0 items-center gap-2.5 rounded-lg border px-2.5 transition-colors",
        asset ? "border-primary/40 bg-primary-soft" : "border-dashed border-line bg-surface-2",
      )}
    >
      {asset ? (
        <MediaThumb id={asset.id} kind={asset.kind} alt="" className="size-9 shrink-0 rounded-md object-cover ring-1 ring-line" />
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-md border border-dashed border-line text-faint">
          <Icon className="size-4" aria-hidden />
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-[11px] font-medium uppercase tracking-wider text-faint">{label}</span>
        <span className={cn("block truncate text-[13px]", asset ? "font-medium text-ink" : "text-muted")}>{asset ? asset.fileName : "Not selected"}</span>
      </span>
    </div>
  );
}
