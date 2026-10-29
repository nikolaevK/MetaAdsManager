"use client";

import { Eye, Hourglass, RotateCcw, Rocket, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { Button } from "@/components/ui";
import type { LaunchStatus } from "@/lib/db/schema";
import { approveLaunchAction, discardLaunchAction, previewLaunchAdAction, retryActivationAction, retryBuildAction } from "../actions";
import { PreviewDialog, type FormatOption } from "../preview-dialog";

/** Polls the server component while background work is running. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}

type Result = { ok: boolean; message?: string; error?: string } | null;

export function LaunchActions({ launchId, status, canEdit, canApprove }: { launchId: string; status: LaunchStatus; canEdit: boolean; canApprove: boolean }) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
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
          variant="create"
          disabled={pending}
          onClick={() =>
            run(
              () => approveLaunchAction(launchId),
              "Approve and activate? Ads, ad sets and then the campaign will be turned on and start spending.",
            )
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
            run(
              () => discardLaunchAction(launchId),
              status === "failed" ? "Discard this launch?" : "Discard this launch? All paused objects it created will be deleted from Meta.",
            )
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
