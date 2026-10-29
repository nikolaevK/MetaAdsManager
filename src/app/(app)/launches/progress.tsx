import { cn } from "@/components/ui";
import type { LaunchStatus } from "@/lib/db/schema";
import { PIPELINE_STEPS, type StepState } from "./status";

/** Compact 7-segment pipeline bar for list rows. Purely presentational. */
export function MiniProgress({ states, status, className }: { states: StepState[]; status: LaunchStatus; className?: string }) {
  const done = states.filter((s) => s === "done").length;
  const pendingTone = status === "failed" ? "bg-danger/20" : status === "rolling_back" ? "bg-warning/30" : "bg-line";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex w-24 shrink-0 items-center gap-[3px]" role="img" aria-label={`${done} of ${states.length} pipeline steps complete`}>
        {states.map((s, i) => (
          <span
            key={PIPELINE_STEPS[i]}
            title={PIPELINE_STEPS[i]}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              s === "done" && (status === "active" ? "bg-success" : "bg-primary"),
              s === "current" && (status === "ready_for_review" ? "bg-warning" : "animate-pulse bg-primary/50"),
              s === "error" && "bg-danger",
              s === "pending" && pendingTone,
            )}
          />
        ))}
      </div>
      <span className="tabular text-[11.5px] text-faint">
        {done}/{states.length}
      </span>
    </div>
  );
}
