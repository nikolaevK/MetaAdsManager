"use client";

import { CheckCircle2, Loader2, UploadCloud, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "@/components/toast";
import { cn } from "@/components/ui";
import { autoPairAction } from "./actions";
import { ACCEPT, accepted as isAccepted, uploadAsset } from "./upload";

type Item = { key: string; name: string; state: "waiting" | "uploading" | "done" | "failed"; error?: string };

export function Uploader({ clientId }: { clientId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const patch = (key: string, next: Partial<Item>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...next } : i)));

  async function upload(files: File[]) {
    const accepted = files.filter(isAccepted);
    if (accepted.length < files.length) toast("Skipped files that aren't JPG, PNG, MP4 or MOV.", "error");
    if (!accepted.length) return;
    const queue = accepted.map((f, i) => ({ file: f, item: { key: `${Date.now()}-${i}-${f.name}`, name: f.name, state: "waiting" as const } }));
    setItems((list) => [...queue.map((q) => q.item), ...list].slice(0, 50));
    setBusy(true);

    const uploaded: string[] = [];
    for (const { file, item } of queue) {
      patch(item.key, { state: "uploading" });
      try {
        const { asset, duplicate } = await uploadAsset(file, clientId);
        uploaded.push(asset.id);
        patch(item.key, { state: "done", error: duplicate ? "Already in library" : undefined });
      } catch (err) {
        patch(item.key, { state: "failed", error: err instanceof Error ? err.message : "Upload failed" });
      }
    }

    if (uploaded.length) {
      const res = await autoPairAction(uploaded);
      toast(res?.ok ? (res.message ?? "Uploaded") : (res?.error ?? "Pairing failed"), res?.ok ? "success" : "error");
    }
    setBusy(false);
  }

  const finished = items.filter((i) => i.state === "done" || i.state === "failed").length;
  const failed = items.filter((i) => i.state === "failed").length;

  return (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload creative files"
        aria-busy={busy}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload([...e.dataTransfer.files]);
        }}
        className={cn(
          "group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-[1.5px] border-dashed px-6 py-8 text-center outline-none",
          "transition-[border-color,background-color,box-shadow] duration-150 focus-visible:ring-4 focus-visible:ring-[var(--ring)]",
          dragging ? "border-primary bg-primary-soft ring-4 ring-[var(--ring)]" : "border-line bg-surface hover:border-primary/50 hover:bg-surface-2",
        )}
      >
        {/* Children ignore pointer events so dragging across them doesn't flicker the highlight. */}
        <span
          className={cn(
            "pointer-events-none grid size-11 place-items-center rounded-xl border shadow-card transition-colors",
            dragging ? "border-primary/30 bg-surface text-primary" : "border-line bg-gradient-to-b from-surface to-surface-2 text-muted group-hover:text-primary",
          )}
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : <UploadCloud className="size-5" />}
        </span>
        <div className="pointer-events-none">
          <p className="text-[13.5px] font-medium">
            {dragging ? (
              "Drop to upload"
            ) : busy ? (
              "Uploading…"
            ) : (
              <>
                {/* Drag and drop needs a mouse; touch screens just tap. */}
                <span className="pointer-coarse:hidden">
                  Drop images or videos here, or <span className="text-primary-ink">browse files</span>
                </span>
                <span className="hidden pointer-coarse:inline">
                  Tap to choose <span className="text-primary-ink">images or videos</span>
                </span>
              </>
            )}
          </p>
          <p className="mt-1 text-xs text-muted">JPG/PNG up to 30 MB · MP4/MOV up to 4 GB</p>
        </div>
        <p className="pointer-events-none max-w-md text-xs leading-relaxed text-faint">
          Name pairs like <FileName>offer_1x1.jpg</FileName> + <FileName>offer_9x16.jpg</FileName> to auto-create creatives.
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            void upload([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>
      {items.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
            <p className="font-medium">Uploads</p>
            <p className="tabular text-xs text-faint">
              {finished}/{items.length} finished{failed ? ` · ${failed} failed` : ""}
            </p>
          </div>
          <div className="h-0.5 bg-line-soft" aria-hidden>
            <div
              className={cn("h-full transition-[width] duration-300", failed ? "bg-warning" : "bg-primary")}
              style={{ width: `${(finished / items.length) * 100}%` }}
            />
          </div>
          <ul className="max-h-64 divide-y divide-line-soft overflow-y-auto text-[13px]">
            {items.map((i) => (
              <li key={i.key} className="flex items-center gap-3 px-4 py-2">
                {i.state === "uploading" || i.state === "waiting" ? (
                  <Loader2 className={cn("size-4 shrink-0 text-faint", i.state === "uploading" && "animate-spin text-primary")} />
                ) : i.state === "done" ? (
                  <CheckCircle2 className="size-4 shrink-0 text-success" />
                ) : (
                  <XCircle className="size-4 shrink-0 text-danger" />
                )}
                <span className="min-w-0 flex-1 truncate">{i.name}</span>
                <span className={cn("max-w-[45%] shrink-0 truncate text-xs", i.state === "failed" ? "text-danger-ink" : "text-muted")} title={i.error}>
                  {i.state === "waiting" ? "Waiting" : i.state === "uploading" ? "Uploading…" : i.state === "done" ? (i.error ?? "Done") : i.error}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FileName({ children }: { children: string }) {
  return <code className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted ring-1 ring-inset ring-line">{children}</code>;
}
