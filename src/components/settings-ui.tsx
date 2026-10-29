"use client";

import { Lock } from "lucide-react";
import { useTransition } from "react";
import type { ActionState } from "@/lib/action-result";
import { toast } from "./toast";

/**
 * Runs a server action in a transition and toasts its ActionState.
 * A null/undefined result (e.g. the action redirected) shows nothing.
 */
export function useSettingsAction() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionState | void>, opts: { onOk?: () => void; onError?: (s: ActionState) => void } = {}) =>
    start(async () => {
      const res = await fn();
      if (!res) return;
      if (res.ok) {
        toast(res.message ?? "Saved");
        opts.onOk?.();
      } else {
        toast(res.error ?? "Something went wrong", "error");
        opts.onError?.(res);
      }
    });
  return { pending, run };
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
