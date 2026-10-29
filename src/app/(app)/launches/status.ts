import type { LaunchStatus } from "@/lib/db/schema";

type Tone = "success" | "muted" | "warning" | "danger" | "info";

export const LAUNCH_STATUS: Record<LaunchStatus, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "info" },
  building: { label: "Building", tone: "info" },
  ready_for_review: { label: "Awaiting approval", tone: "warning" },
  activating: { label: "Activating", tone: "info" },
  active: { label: "Live", tone: "success" },
  activation_failed: { label: "Activation failed", tone: "danger" },
  rolling_back: { label: "Rolling back", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  discarded: { label: "Discarded", tone: "muted" },
};

/** Statuses where background work is still running and the page should poll. */
export const IN_FLIGHT: LaunchStatus[] = ["queued", "building", "activating", "rolling_back"];

// ── Display-only pipeline helpers ────────────────────────────────────────────

export const PIPELINE_STEPS = ["Upload media", "Creatives", "Campaign", "Ad sets", "Ads", "Approval", "Live"] as const;

export type StepState = "done" | "current" | "error" | "pending";

/** Maps the builder's step text ("Creating ad sets", …) to a pipeline index. Unknown text → media upload. */
function buildIndex(step: string | null): number {
  if (!step) return 0;
  if (/creative/i.test(step)) return 1;
  if (/campaign/i.test(step)) return 2;
  if (/ad sets?/i.test(step)) return 3;
  if (/\bads\b/i.test(step)) return 4;
  return 0;
}

/**
 * Coarse pipeline position for the launches list, which only has status + step text (no ledger).
 * Failed / discarded / rolling-back launches have no reliable position, so every step stays pending.
 */
export function listProgress(status: LaunchStatus, step: string | null): StepState[] {
  const n = PIPELINE_STEPS.length;
  const upTo = (doneCount: number, at: StepState) =>
    Array.from({ length: n }, (_, i): StepState => (i < doneCount ? "done" : i === doneCount ? at : "pending"));
  switch (status) {
    case "queued":
      return upTo(0, "current");
    case "building":
      return upTo(buildIndex(step), "current");
    case "ready_for_review":
      return upTo(5, "current");
    case "activating":
      return upTo(6, "current");
    case "activation_failed":
      return upTo(6, "error");
    case "active":
      return upTo(n, "pending");
    default:
      return upTo(-1, "pending");
  }
}
