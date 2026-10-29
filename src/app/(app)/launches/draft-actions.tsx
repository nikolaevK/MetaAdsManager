"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { deleteDraftAction } from "./actions";

export function DeleteDraftButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label={`Delete draft ${name}`}
      title="Delete draft"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Delete the draft “${name}”? This can't be undone.`)) return;
        start(async () => {
          const res = await deleteDraftAction(id);
          toast(res?.ok ? (res.message ?? "Draft deleted") : (res?.error ?? "Couldn't delete the draft"), res?.ok ? "success" : "error");
        });
      }}
      className={buttonClass("ghost", "icon", "relative z-10 hover:bg-danger-soft hover:text-danger-ink")}
    >
      <Trash2 />
    </button>
  );
}
