"use client";

import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { cn, focusRing } from "@/components/ui";
import { selectAccount } from "@/app/(app)/actions";

export type AccountOption = { id: string; name: string; clientName: string };

function Monogram({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-[12px] font-semibold text-muted",
        className,
      )}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Typing fields pop the on-screen keyboard, so only focus the search on mouse/trackpad devices. */
function focusOnFinePointer(el: HTMLInputElement | null) {
  if (el && matchMedia("(pointer: fine)").matches) el.focus();
}

export function AccountSwitcher({ accounts, currentId }: { accounts: AccountOption[]; currentId: string | null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = accounts.find((a) => a.id === currentId);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Capture phase + preventDefault: the mobile drawer around the switcher stays open. Focus returns to the trigger.
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = accounts.filter(
    (a) => !q || a.name.toLowerCase().includes(q) || a.clientName.toLowerCase().includes(q) || a.id.includes(q),
  );
  const groups = new Map<string, AccountOption[]>();
  for (const a of filtered) groups.set(a.clientName, [...(groups.get(a.clientName) ?? []), a]);

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg border border-line bg-surface p-1.5 pr-2 text-left shadow-xs transition-colors hover:bg-hover",
          focusRing,
          pending && "opacity-60",
        )}
      >
        <Monogram name={current?.clientName ?? "?"} />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-medium">{current?.name ?? "No ad account"}</span>
          <span className="truncate text-[11.5px] text-faint">
            {current ? `${current.clientName} · ${current.id.replace("act_", "")}` : "Connect one in Settings"}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-faint" />
      </button>
      {open && (
        // Below md the switcher only lives in the 18rem drawer, so the menu matches the trigger instead of spilling out.
        <div className="absolute left-0 top-full z-50 mt-1.5 w-full animate-pop-in rounded-xl border border-line bg-surface p-1.5 shadow-pop md:w-80">
          <div className="relative mb-1.5">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
            <input
              ref={focusOnFinePointer}
              aria-label="Find an ad account"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find an ad account"
              className="h-9 w-full rounded-lg border border-line bg-surface-2 pl-8 pr-2 text-[13px] focus:border-primary focus:outline-none focus:ring-4 focus:ring-[var(--ring)]"
            />
          </div>
          <div role="listbox" className="max-h-80 overflow-y-auto">
            {[...groups.entries()].map(([clientName, list]) => (
              <div key={clientName} className="mb-1">
                <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">{clientName}</p>
                {list.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="option"
                    aria-selected={a.id === currentId}
                    onClick={() => {
                      setOpen(false);
                      start(() => selectAccount(a.id));
                    }}
                    className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-hover pointer-coarse:py-2.5", focusRing)}
                  >
                    <Monogram name={a.clientName} className="size-6 text-[11px]" />
                    <span className="min-w-0 flex-1 truncate">
                      {a.name} <span className="text-faint">· {a.id.replace("act_", "")}</span>
                    </span>
                    {a.id === currentId && <Check className="size-4 text-primary" />}
                  </button>
                ))}
              </div>
            ))}
            {filtered.length === 0 && <p className="px-2 py-3 text-[13px] text-muted">No matching accounts.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
