"use client";

import { Link2, Plus, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useSettingsAction } from "@/components/settings-ui";
import { Alert, Badge, Button, Input, Skeleton } from "@/components/ui";
import { connectAccount, listConnectableAccounts, type ConnectableAccount } from "./actions";
import { Monogram } from "./detail-panel";

export function ConnectAccount({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ConnectableAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, startLoading] = useTransition();
  const { pending, run } = useSettingsAction();
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const load = () =>
    startLoading(async () => {
      setError(null);
      const res = await listConnectableAccounts();
      if (res.ok) setItems(res.items);
      else setError(res.error);
    });

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = (items ?? []).filter(
    (a) => !q || a.name.toLowerCase().includes(q) || a.id.includes(q) || a.business?.toLowerCase().includes(q),
  );

  return (
    <>
      <Button
        ref={trigger}
        size="sm"
        variant="secondary"
        onClick={() => {
          setOpen(true);
          load();
        }}
      >
        <Plus /> Connect ad account
      </Button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-start justify-center bg-black/40 p-4 pt-[8vh] backdrop-blur-[2px] animate-fade-in sm:pt-[12vh]"
            onMouseDown={close}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              onMouseDown={(e) => e.stopPropagation()}
              className="flex max-h-[80vh] w-full max-w-lg animate-pop-in flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
            >
              <div className="flex items-start gap-3 border-b border-line-soft px-5 py-4">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-muted">
                  <Link2 className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 id={titleId} className="text-[14.5px] font-semibold tracking-tight">
                    Connect an ad account
                  </h2>
                  <p className="mt-0.5 text-[13px] text-muted">
                    Adds it to <span className="font-medium text-ink">{clientName}</span>. Campaigns, insights and review status start syncing in the
                    background.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={close}
                  className="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-hover hover:text-ink"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="border-b border-line-soft px-5 py-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
                  <Input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name, id or business"
                    aria-label="Search ad accounts"
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {error && (
                  <div className="p-5">
                    <Alert>{error}</Alert>
                  </div>
                )}
                {loading && (
                  <ul role="status" aria-label="Loading ad accounts your Meta token can access…" className="divide-y divide-line-soft">
                    {Array.from({ length: 4 }, (_, i) => (
                      <li key={i} className="flex items-center gap-3 px-5 py-3">
                        <Skeleton className="size-8 rounded-lg" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-3.5 w-40" />
                          <Skeleton className="h-3 w-56 max-w-full" />
                        </div>
                        <Skeleton className="h-8 w-20 rounded-lg" />
                      </li>
                    ))}
                  </ul>
                )}
                {items &&
                  !loading &&
                  (filtered.length === 0 ? (
                    <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
                      <p className="text-[13.5px] font-medium">{items.length === 0 ? "Everything is connected" : "No matching accounts"}</p>
                      <p className="text-[13px] text-muted">
                        {items.length === 0 ? "Every ad account this token can access is already connected." : "Try a different name, id or business."}
                      </p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-line-soft">
                      {filtered.map((a) => (
                        <li key={a.id} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-hover/60">
                          <Monogram name={a.name} />
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-[13.5px] font-medium">{a.name}</span>
                              <Badge tone={a.status === "Active" ? "success" : "warning"} dot className="shrink-0">
                                {a.status}
                              </Badge>
                            </div>
                            <div className="tabular truncate text-[12px] text-muted">
                              {a.id.replace("act_", "")} · {a.currency} · {a.timezone}
                              {a.business ? ` · ${a.business}` : ""}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={pending}
                            onClick={() =>
                              run(() => connectAccount({ clientId, accountId: a.id }), {
                                onOk: () => setItems((prev) => prev?.filter((x) => x.id !== a.id) ?? null),
                              })
                            }
                          >
                            Connect
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ))}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-line-soft bg-surface-2 px-5 py-3">
                <p className="tabular text-xs text-faint">
                  {items ? `${filtered.length} of ${items.length} available` : loading ? "Loading…" : ""}
                </p>
                <Button size="sm" variant="secondary" onClick={close}>
                  Done
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
