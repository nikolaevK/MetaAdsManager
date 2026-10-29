"use client";

import { Play, RotateCcw } from "lucide-react";
import { useSettingsAction } from "@/components/settings-ui";
import { Button } from "@/components/ui";
import { retryJob, runWorkerNow } from "./actions";

export function RunWorkerButton() {
  const { pending, run } = useSettingsAction();
  return (
    <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => runWorkerNow())}>
      <Play /> {pending ? "Running…" : "Run worker now"}
    </Button>
  );
}

export function RetryJobButton({ id }: { id: string }) {
  const { pending, run } = useSettingsAction();
  return (
    <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => retryJob({ id }))} className="h-7 px-2.5 [&_svg]:size-3.5">
      <RotateCcw /> Retry
    </Button>
  );
}
