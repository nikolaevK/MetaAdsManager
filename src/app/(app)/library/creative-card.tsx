"use client";

import { Archive, ArchiveRestore, Film, Image as ImageIcon, Pencil } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { Badge, Button, cn, Input } from "@/components/ui";
import { archiveCreativeAction, updateCreativeAction } from "./actions";
import { MediaThumb } from "./media-thumb";

type Props = {
  creative: { id: string; name: string; kind: "image" | "video"; angle: string | null; createdAt: number; archivedAt: number | null };
  square: { id: string; aspect: string } | null;
  vertical: { id: string; aspect: string } | null;
  canEdit: boolean;
};

export function CreativeCard({ creative, square, vertical, canEdit }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(creative.name);
  const [angle, setAngle] = useState(creative.angle ?? "");
  const [pending, start] = useTransition();

  const run = (fn: () => ReturnType<typeof updateCreativeAction>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res?.ok) {
        toast(res.message ?? "Saved");
        after?.();
      } else toast(res?.error ?? "Something went wrong", "error");
    });

  return (
    <article
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card",
        "transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-pop",
        !!creative.archivedAt && "opacity-80 hover:opacity-100",
      )}
    >
      {square && vertical && square.id === vertical.id ? (
        // Single-file creative: the same media runs in every placement.
        <div className="border-b border-line-soft bg-surface-2 p-3">
          <figure className="flex flex-col gap-1.5">
            <div className="relative">
              <MediaThumb id={square.id} kind={creative.kind} alt={`${creative.name} (${square.aspect})`} className="h-auto max-h-56 w-full rounded-lg ring-1 ring-line" />
              <AspectChip>{square.aspect === "other" ? "Any ratio" : square.aspect}</AspectChip>
            </div>
            <figcaption className="text-[11px] text-faint">Single file · all placements</figcaption>
          </figure>
        </div>
      ) : (
      <div className="flex items-end gap-2.5 border-b border-line-soft bg-surface-2 p-3">
          <figure className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="relative">
              {square ? (
                <MediaThumb id={square.id} kind={creative.kind} alt={`${creative.name} feed (${square.aspect})`} className="aspect-square w-full rounded-lg ring-1 ring-line" />
              ) : (
                <div className="aspect-square w-full rounded-lg border border-dashed border-line" />
              )}
              <AspectChip>{square?.aspect ?? "1:1"}</AspectChip>
            </div>
            <figcaption className="text-[11px] text-faint">Feed</figcaption>
          </figure>
          <figure className="flex w-[36%] flex-col gap-1.5">
            <div className="relative">
              {vertical ? (
                <MediaThumb id={vertical.id} kind={creative.kind} alt={`${creative.name} stories/reels (9:16)`} className="aspect-[9/16] w-full rounded-lg ring-1 ring-line" />
              ) : (
                <div className="aspect-[9/16] w-full rounded-lg border border-dashed border-line" />
              )}
              <AspectChip>9:16</AspectChip>
            </div>
            <figcaption className="truncate text-[11px] text-faint">Stories · Reels</figcaption>
          </figure>
        </div>
      )}
      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        {editing ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => updateCreativeAction({ id: creative.id, name, angle }), () => setEditing(false));
            }}
          >
            <Input aria-label="Creative name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
            <Input aria-label="Angle" placeholder="Angle (e.g. Testimonial)" value={angle} onChange={(e) => setAngle(e.target.value)} maxLength={100} />
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="primary" disabled={pending}>
                Save
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <h3 className="min-w-0 truncate text-[13.5px] font-semibold tracking-tight" title={creative.name}>
                {creative.name}
              </h3>
              <Badge tone={creative.kind === "video" ? "info" : "muted"}>
                {creative.kind === "video" ? <Film className="size-3" aria-hidden /> : <ImageIcon className="size-3" aria-hidden />}
                {creative.kind === "video" ? "Video" : "Image"}
              </Badge>
            </div>
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              {creative.angle && (
                <span className="max-w-full truncate rounded-md bg-primary-soft px-1.5 py-px font-medium text-primary-ink">{creative.angle}</span>
              )}
              <span>Added {new Date(creative.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
              {creative.archivedAt && <Badge>Archived</Badge>}
            </p>
          </>
        )}
      </div>
      {canEdit && !editing && (
        <div className="flex items-center gap-1 border-t border-line-soft px-2 py-1.5">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={pending}>
            <Pencil className="size-3.5" /> Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={pending}
            onClick={() => run(() => archiveCreativeAction({ id: creative.id, archived: !creative.archivedAt }))}
          >
            {creative.archivedAt ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
            {creative.archivedAt ? "Restore" : "Archive"}
          </Button>
        </div>
      )}
    </article>
  );
}

function AspectChip({ children }: { children: string }) {
  return (
    <span className="tabular absolute bottom-1.5 left-1.5 rounded-md bg-surface/90 px-1.5 py-px text-[10.5px] font-medium text-ink shadow-xs ring-1 ring-line backdrop-blur">
      {children}
    </span>
  );
}
