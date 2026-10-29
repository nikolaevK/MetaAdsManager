"use client";

import { Lock } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import type { ActionState } from "@/lib/action-result";
import { toast } from "./toast";
import { Alert, cn } from "./ui";

/**
 * Runs a server action in a transition: success is toasted; a failure is toasted too, or with
 * `inlineErrors` kept in `error` (until the next run) for a persistent Alert, e.g. in a FormFooter.
 * A null/undefined result (e.g. the action redirected) shows nothing.
 */
export function useSettingsAction({ inlineErrors = false }: { inlineErrors?: boolean } = {}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionState | void>, opts: { onOk?: () => void; onError?: (s: ActionState) => void } = {}) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res) return;
      if (res.ok) {
        toast(res.message ?? "Saved");
        opts.onOk?.();
      } else {
        const message = res.error ?? "Something went wrong";
        if (inlineErrors) setError(message);
        else toast(message, "error");
        opts.onError?.(res);
      }
    });
  return { pending, run, error };
}

/**
 * Footer of a settings form card: a destructive action goes first (it sits on the left), the primary action last.
 * `error` shows above the buttons until the next attempt; `sticky` keeps the bar in view on long forms
 * (the card must clip with `overflow-clip`, not `overflow-hidden`, or sticky has nothing to stick to).
 */
export function FormFooter({ children, error, sticky }: { children: ReactNode; error?: string | null; sticky?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-3 border-t border-line-soft bg-surface-2 px-5 py-3", sticky && "sticky bottom-0 z-10 bg-surface-2/95 backdrop-blur")}>
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}

export function ReadOnlyNote() {
  return (
    <div role="status" className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[13px]">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-surface text-faint shadow-xs">
        <Lock className="size-3.5" aria-hidden />
      </span>
      <p className="min-w-0 text-muted">
        <span className="font-medium text-ink">Read-only access.</span> Only admins can change settings.
      </p>
    </div>
  );
}
