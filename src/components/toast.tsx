"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/components/ui";

type Tone = "info" | "success" | "error";
type Item = { id: number; message: string; tone: Tone };

const listeners = new Set<(item: Item) => void>();
let nextId = 1;

/** Fire-and-forget notification, callable from any client component. */
export function toast(message: string, tone: Tone = "success") {
  const item = { id: nextId++, message, tone };
  listeners.forEach((l) => l(item));
}

const ICON = { info: Info, success: CircleCheck, error: CircleAlert };
const ICON_COLOR = { info: "text-primary", success: "text-success", error: "text-danger" };

export function Toaster() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    const add = (item: Item) => {
      setItems((prev) => [...prev.slice(-3), item]);
      setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== item.id)), item.tone === "error" ? 8000 : 4000);
    };
    listeners.add(add);
    return () => void listeners.delete(add);
  }, []);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-[100] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:items-end"
    >
      {items.map((t) => {
        const Icon = ICON[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-sm animate-pop-in items-start gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 text-[13px] shadow-pop"
          >
            <Icon className={cn("mt-px size-4 shrink-0", ICON_COLOR[t.tone])} />
            <span className="flex-1 text-ink">{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setItems((p) => p.filter((i) => i.id !== t.id))}
              className="text-faint hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
