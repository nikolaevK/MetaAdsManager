"use client";

import { Check, CheckCheck } from "lucide-react";
import { useTransition } from "react";
import { toast } from "@/components/toast";
import { Button } from "@/components/ui";
import { acknowledgeAction, acknowledgeAllAction } from "./actions";

type Result = Awaited<ReturnType<typeof acknowledgeAction>>;

function useRun() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      const res = await fn();
      if (res?.ok) toast(res.message ?? "Done");
      else toast(res?.error ?? "Something went wrong", "error");
    });
  return [pending, run] as const;
}

export function AcknowledgeButton({ id }: { id: string }) {
  const [pending, run] = useRun();
  return (
    <Button size="sm" disabled={pending} onClick={() => run(() => acknowledgeAction({ ids: [id] }))}>
      <Check className="size-4" /> Acknowledge
    </Button>
  );
}

export function AcknowledgeAllButton({ accountId, count }: { accountId: string | null; count: number }) {
  const [pending, run] = useRun();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending || count === 0}
      onClick={() => {
        if (confirm(`Acknowledge all ${count} open item${count === 1 ? "" : "s"}?`)) run(() => acknowledgeAllAction({ accountId }));
      }}
    >
      <CheckCheck className="size-4" /> Acknowledge all
    </Button>
  );
}
