"use client";

import { ArrowRight, Type, Wallet, X } from "lucide-react";
import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { toast } from "@/components/toast";
import { Alert, Button, cn, focusRing, Input, Segmented, segmentClass, Select } from "@/components/ui";
import { applyBudgetOp, applyNameOp, type BudgetOp, type NameOp } from "@/lib/bulk";
import { formatMoney } from "@/lib/format";
import { fromMinorUnits } from "@/lib/money";
import type { Level } from "@/lib/meta/mutations";
import type { TableRow } from "@/lib/queries/manage";
import { bulkUpdateAction } from "./actions";

type Props = { level: Level; rows: TableRow[]; currency: string; onClose: () => void; onDone: () => void };

export function BulkEditDialog({ level, rows, currency, onClose, onDone }: Props) {
  const hasBudgets = level !== "ad";
  const [tab, setTab] = useState<"budget" | "name">(hasBudgets ? "budget" : "name");
  const [budget, setBudget] = useState<{ mode: BudgetOp["mode"]; unit: BudgetOp["unit"]; value: string }>({ mode: "increase", unit: "percent", value: "20" });
  const [name, setName] = useState<{ mode: NameOp["mode"]; text: string; find: string }>({ mode: "prefix", text: "", find: "" });
  const [pending, start] = useTransition();

  const money = (n: number) => formatMoney(n, currency);
  const preview = rows.map((r) => {
    if (tab === "name") {
      const next = applyNameOp(r.name, { mode: name.mode, text: name.text, find: name.find });
      return { row: r, from: r.name, to: next, skip: null as string | null };
    }
    const minor = r.dailyBudget ?? r.lifetimeBudget;
    if (minor === null) return { row: r, from: "—", to: null, skip: r.usesCampaignBudget ? "Uses campaign budget" : "Budget is on the ad sets" };
    const current = fromMinorUnits(minor, currency);
    const next = applyBudgetOp(current, { mode: budget.mode, unit: budget.unit, value: Number(budget.value) });
    return { row: r, from: money(current), to: next === null ? null : money(next), next, kind: r.lifetimeBudget !== null ? ("lifetime" as const) : ("daily" as const), skip: null };
  });
  const changes = preview.filter((p) => p.to !== null && !p.skip);

  const apply = () =>
    start(async () => {
      const items = changes.map((p) =>
        tab === "name"
          ? { id: p.row.id, name: p.to! }
          : { id: p.row.id, budget: { kind: (p as { kind: "daily" | "lifetime" }).kind, amount: (p as { next: number }).next } },
      );
      const res = await bulkUpdateAction({ level, items });
      if (res?.ok) {
        toast(`${res.message ?? "Updated"} · undo from History`);
        onDone();
      } else toast(res?.error ?? "Bulk edit failed", "error");
    });

  return (
    <Modal
      onClose={onClose}
      aria-labelledby="bulk-title"
      className="flex max-h-[min(40rem,calc(100dvh-1.5rem))] w-full max-w-2xl animate-pop-in flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
        <div>
          <h2 id="bulk-title" className="text-[15px] font-semibold tracking-tight">
            Bulk edit {rows.length} {level === "adset" ? "ad set" : level}
            {rows.length === 1 ? "" : "s"}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">Preview every change before applying. Everything here can be undone from History.</p>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className={cn("grid size-8 shrink-0 place-items-center rounded-lg text-faint hover:bg-hover hover:text-ink pointer-coarse:size-10", focusRing)}>
          <X className="size-4" />
        </button>
      </div>

      <div className="flex flex-col gap-4 border-b border-line-soft px-5 py-4">
        <Segmented>
          {hasBudgets && (
            <button type="button" role="tab" aria-selected={tab === "budget"} onClick={() => setTab("budget")} className={segmentClass(tab === "budget")}>
              <Wallet className={tab === "budget" ? "text-primary" : "text-faint"} aria-hidden /> Budget
            </button>
          )}
          <button type="button" role="tab" aria-selected={tab === "name"} onClick={() => setTab("name")} className={segmentClass(tab === "name")}>
            <Type className={tab === "name" ? "text-primary" : "text-faint"} aria-hidden /> Name
          </button>
        </Segmented>

        {tab === "budget" ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,10rem)]">
            <Select aria-label="Budget change" value={budget.mode} onChange={(e) => setBudget((b) => ({ ...b, mode: e.target.value as BudgetOp["mode"] }))}>
              <option value="increase">Increase by</option>
              <option value="decrease">Decrease by</option>
              <option value="set">Set to</option>
            </Select>
            <Input aria-label="Amount" type="number" min="0" step="0.01" className="tabular" value={budget.value} onChange={(e) => setBudget((b) => ({ ...b, value: e.target.value }))} />
            <Select aria-label="Unit" value={budget.unit} onChange={(e) => setBudget((b) => ({ ...b, unit: e.target.value as BudgetOp["unit"] }))}>
              <option value="percent">{budget.mode === "set" ? "% of current" : "%"}</option>
              <option value="amount">{currency}</option>
            </Select>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)]">
            <Select aria-label="Rename mode" value={name.mode} onChange={(e) => setName((n) => ({ ...n, mode: e.target.value as NameOp["mode"] }))}>
              <option value="prefix">Add prefix</option>
              <option value="suffix">Add suffix</option>
              <option value="replace">Find & replace</option>
            </Select>
            {name.mode === "replace" && <Input aria-label="Find" placeholder="Find" value={name.find} onChange={(e) => setName((n) => ({ ...n, find: e.target.value }))} />}
            <Input
              aria-label={name.mode === "replace" ? "Replace with" : "Text"}
              placeholder={name.mode === "replace" ? "Replace with" : name.mode === "prefix" ? "e.g. [TEST] " : "e.g.  — v2"}
              className={name.mode === "replace" ? undefined : "sm:col-span-2"}
              value={name.text}
              onChange={(e) => setName((n) => ({ ...n, text: e.target.value }))}
            />
          </div>
        )}
      </div>

      <ul className="min-h-0 flex-1 divide-y divide-line-soft overflow-y-auto text-[13px]">
        {preview.map((p) => (
          <li key={p.row.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5", (p.skip || p.to === null) && "opacity-60")}>
            <span className="truncate font-medium" title={p.row.name}>
              {p.row.name}
            </span>
            <span className="tabular flex items-center gap-2 whitespace-nowrap text-[12.5px]">
              {p.skip ? (
                <span className="text-muted">{p.skip}</span>
              ) : (
                <>
                  {tab === "budget" && <span className={cn("max-w-48 truncate", p.to !== null && "text-muted line-through decoration-faint")}>{p.from}</span>}
                  {p.to !== null && (
                    <>
                      {tab === "budget" && <ArrowRight className="size-3.5 text-faint" aria-hidden />}
                      <span className="max-w-64 truncate font-medium text-primary-ink" title={p.to}>
                        {p.to}
                      </span>
                    </>
                  )}
                  {p.to === null && <span className="text-faint">No change</span>}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-5 py-3">
        {tab === "budget" && changes.length > 0 && budget.mode !== "set" && Number(budget.value) >= 50 && budget.unit === "percent" && (
          <Alert tone="warning">Budget jumps over ~20–30% can restart Meta&apos;s learning phase.</Alert>
        )}
        <p className="text-[12.5px] text-muted">
          {changes.length} of {rows.length} will change
        </p>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={changes.length === 0 || pending} onClick={apply}>
            {pending ? "Applying…" : `Apply to ${changes.length}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
