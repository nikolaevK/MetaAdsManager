"use client";

import { TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Modal } from "./modal";
import { Button } from "./ui";

export type ConfirmOptions = {
  title: ReactNode;
  body?: ReactNode;
  /** Label of the confirming button (default "Confirm"). */
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" styles the action as destructive and focuses Cancel first. */
  tone?: "default" | "danger";
};

type Request = ConfirmOptions & { id: number; owner: string; resolve: (ok: boolean) => void };

// One dialog at a time, rendered by a small root of its own so callers don't have to mount anything.
let current: Request | null = null;
let seq = 0;
let root: Root | null = null;
const listeners = new Set<() => void>();

function show(next: Request | null) {
  current = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

function ConfirmHost() {
  const req = useSyncExternalStore(subscribe, () => current, () => null);
  if (!req) return null;
  const answer = (ok: boolean) => {
    req.resolve(ok);
    if (current === req) show(null);
  };
  return <ConfirmDialog key={req.id} {...req} onAnswer={answer} />;
}

function ConfirmDialog({ title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "default", onAnswer }: ConfirmOptions & { onAnswer: (ok: boolean) => void }) {
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const danger = tone === "danger";
  return (
    <Modal
      onClose={() => onAnswer(false)}
      initialFocus={danger ? cancel : confirm}
      aria-labelledby={`${id}-title`}
      aria-describedby={body ? `${id}-body` : undefined}
      overlayClassName="z-[95] grid place-items-center p-3"
      className="w-full max-w-md animate-pop-in overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
    >
      <div className="flex gap-3.5 px-5 pb-5 pt-5">
        {danger && (
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-danger-soft text-danger-ink">
            <TriangleAlert className="size-[18px]" aria-hidden />
          </span>
        )}
        <div className="min-w-0 pt-0.5">
          <h2 id={`${id}-title`} className="text-[15px] font-semibold tracking-tight">
            {title}
          </h2>
          {body && (
            <div id={`${id}-body`} className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
              {body}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-line-soft bg-surface-2 px-5 py-3 sm:flex-row sm:justify-end">
        <Button ref={cancel} variant="secondary" className="pointer-coarse:h-10" onClick={() => onAnswer(false)}>
          {cancelLabel}
        </Button>
        <Button ref={confirm} variant={danger ? "danger" : "primary"} className="pointer-coarse:h-10" onClick={() => onAnswer(true)}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Themed replacement for `window.confirm`:
 * `const confirm = useConfirm(); if (!(await confirm({ title, body, confirmLabel, tone: "danger" }))) return;`
 * Resolves false on Cancel, Escape, a backdrop click, or when the calling component unmounts.
 */
export function useConfirm() {
  const owner = useId();
  useEffect(
    () => () => {
      if (current?.owner !== owner) return;
      current.resolve(false);
      show(null);
    },
    [owner],
  );
  return useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        if (!root) {
          const el = document.createElement("div");
          document.body.append(el);
          root = createRoot(el);
          root.render(<ConfirmHost />);
        }
        current?.resolve(false);
        show({ ...options, id: ++seq, owner, resolve });
      }),
    [owner],
  );
}
