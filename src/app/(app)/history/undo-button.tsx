"use client";

import { Undo2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "@/components/toast";
import { Button } from "@/components/ui";
import { undoChangeAction } from "./actions";

export function UndoButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await undoChangeAction(id);
          if (res?.ok) toast(res.message ?? "Undone");
          else toast(res?.error ?? "Couldn't undo", "error");
        })
      }
    >
      <Undo2 /> {pending ? "Undoing…" : "Undo"}
    </Button>
  );
}
