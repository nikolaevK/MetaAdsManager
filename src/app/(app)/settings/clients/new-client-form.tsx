"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { useSettingsAction } from "@/components/settings-ui";
import { Button, Input } from "@/components/ui";
import { createClient } from "./actions";

export function NewClientForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const { pending, run } = useSettingsAction();

  if (!open) {
    return (
      <Button variant="create" onClick={() => setOpen(true)}>
        <Plus /> New client
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-1.5 shadow-card animate-pop-in"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createClient({ name }), {
          onOk: () => {
            setName("");
            setOpen(false);
          },
        });
      }}
    >
      <Input
        autoFocus
        aria-label="Client name"
        placeholder="Client name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-8 w-44 text-[13px] sm:w-60"
        maxLength={120}
      />
      <Button type="submit" size="sm" variant="primary" disabled={pending || !name.trim()}>
        Create
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}
