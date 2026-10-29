"use client";

import { Eye, Hourglass, LoaderCircle, RefreshCw, RotateCcw, Rocket, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useState, useTransition } from "react";
import { useConfirm, type ConfirmOptions } from "@/components/confirm-dialog";
import { toast } from "@/components/toast";
import { Button } from "@/components/ui";
import type { LaunchStatus } from "@/lib/db/schema";
import { approveLaunchAction, discardLaunchAction, previewLaunchAdAction, retryActivationAction, retryBuildAction } from "../actions";
import { PreviewDialog, type FormatOption } from "../preview-dialog";

const FAST_MS = 3_000;
const SLOW_MS = 10_000;
const SLOW_AFTER_MS = 60_000;
const STOP_AFTER_MS = 10 * 60_000;

/**
 * Refreshes the server component while background work runs: every 3 s, every 10 s after the first minute, never
 * while the tab is hidden, and not past 10 minutes of watching (with no worker running it would poll forever).
 * Shows "Updating automatically" while it polls, and a Refresh button once it stops.
 */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  const [stopped, setStopped] = useState(false);
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    setStopped(false);
  }

  useEffect(() => {
    if (!active || stopped) return;
    let watched = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (document.hidden) return;
      const delay = watched < SLOW_AFTER_MS ? FAST_MS : SLOW_MS;
      timer = setTimeout(() => {
        watched += delay;
        if (watched >= STOP_AFTER_MS) return setStopped(true);
        router.refresh();
        schedule();
      }, delay);
    };
    const onVisibility = () => {
      if (!document.hidden) router.refresh();
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, stopped, router]);

  if (!active) return null;
  if (!stopped)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-faint">
        <LoaderCircle className="size-3 animate-spin" aria-hidden /> Updating automatically
      </span>
    );
  return (
    <div role="status" className="flex basis-full flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-[13px] text-muted">
      <span>Stopped checking for updates after 10 minutes. The launch may still be running in the background.</span>
      <Button
        size="sm"
        onClick={() => {
          router.refresh();
          setStopped(false);
        }}
      >
        <RefreshCw /> Refresh
      </Button>
    </div>
  );
}

type Result = { ok: boolean; message?: string; error?: string } | null;

export function LaunchActions({ launchId, status, canEdit, canApprove }: { launchId: string; status: LaunchStatus; canEdit: boolean; canApprove: boolean }) {
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const run = async (fn: () => Promise<Result>, ask?: ConfirmOptions) => {
    if (ask && !(await confirm(ask))) return;
    start(async () => {
      const res = await fn();
      if (res?.ok) toast(res.message ?? "Done");
      else toast(res?.error ?? "Something went wrong", "error");
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "ready_for_review" && canApprove && (
        <Button
          variant="primary"
          disabled={pending}
          onClick={() =>
            run(() => approveLaunchAction(launchId), {
              title: "Approve and activate?",
              body: "Ads, ad sets and then the campaign will be turned on and start spending.",
              confirmLabel: "Approve & activate",
            })
          }
        >
          <Rocket /> Approve & activate
        </Button>
      )}
      {status === "ready_for_review" && !canApprove && (
        <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-line px-3 text-[13px] text-muted">
          <Hourglass className="size-3.5 text-warning" aria-hidden /> Waiting for an admin to approve
        </span>
      )}
      {status === "activation_failed" && canApprove && (
        <Button variant="primary" disabled={pending} onClick={() => run(() => retryActivationAction(launchId))}>
          <RotateCcw /> Retry activation
        </Button>
      )}
      {status === "failed" && canEdit && (
        <Button variant="primary" disabled={pending} onClick={() => run(() => retryBuildAction(launchId))}>
          <RotateCcw /> Retry build
        </Button>
      )}
      {canEdit && ["ready_for_review", "activation_failed", "failed"].includes(status) && (
        <Button
          variant="danger"
          disabled={pending}
          onClick={() =>
            run(() => discardLaunchAction(launchId), {
              title: "Discard this launch?",
              body: status === "failed" ? undefined : "All paused objects it created will be deleted from Meta.",
              confirmLabel: "Discard launch",
              tone: "danger",
            })
          }
        >
          <Trash2 /> Discard
        </Button>
      )}
    </div>
  );
}

export function AdPreviewButton({ launchId, adIndex, title, formats }: { launchId: string; adIndex: number; title: string; formats: readonly FormatOption[] }) {
  const [open, setOpen] = useState(false);
  // Cache Components keeps hidden pages mounted: don't leave the (portalled) preview open over another page.
  useLayoutEffect(() => () => setOpen(false), []);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Eye className="size-4" /> Preview
      </Button>
      {open && (
        <PreviewDialog
          title={`Preview · ${title}`}
          formats={formats}
          onClose={() => setOpen(false)}
          load={(format) => previewLaunchAdAction(launchId, adIndex, format)}
        />
      )}
    </>
  );
}
