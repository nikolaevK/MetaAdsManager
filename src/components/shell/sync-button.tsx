"use client";

import { RefreshCw } from "lucide-react";
import { useTransition } from "react";
import { syncNow } from "@/app/(app)/actions";
import { cn, focusRing } from "@/components/ui";
import { toast } from "@/components/toast";

export function SyncButton({ accountId }: { accountId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      title="Sync from Meta now"
      aria-label="Sync from Meta now"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await syncNow(accountId);
          toast(res?.ok ? (res.message ?? "Sync started") : (res?.error ?? "Sync failed"), res?.ok ? "info" : "error");
        })
      }
      className={cn("grid size-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink", focusRing)}
    >
      <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
    </button>
  );
}
