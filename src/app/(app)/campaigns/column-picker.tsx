"use client";

import { ArrowDown, ArrowUp, Check, ChevronDown, Columns3, GripVertical, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, cn } from "@/components/ui";
import { COLUMN_BY_KEY, COLUMN_GROUPS, COLUMNS, DEFAULT_PRESET, PRESETS, type TableLevelKey } from "@/lib/columns";
import type { ColumnPrefs } from "@/lib/preferences";

type Props = {
  prefs: ColumnPrefs;
  level: TableLevelKey;
  onChange: (next: ColumnPrefs) => void;
};

const same = (a: string[], b: string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

/** "Columns: Performance ▾" menu (presets + saved sets) with a full customize dialog, like Ads Manager. */
export function ColumnPicker({ prefs, level, onChange }: Props) {
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);
  useLayoutEffect(() => () => setMenu(false), []);

  const activeName =
    PRESETS.find((p) => same(p.columns, prefs.columns))?.name ?? prefs.sets.find((s) => same(s.columns, prefs.columns))?.name ?? "Custom";

  const item = "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-hover";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((m) => !m)}
        className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] shadow-xs transition-colors hover:bg-hover"
      >
        <Columns3 className="size-4 text-faint" aria-hidden />
        <span className="max-sm:sr-only">Columns:</span>
        <span className="max-w-32 truncate font-medium">{activeName}</span>
        <ChevronDown className="size-4 text-faint" aria-hidden />
      </button>
      {menu && (
        <div role="menu" className="absolute right-0 top-11 z-40 w-72 animate-pop-in rounded-xl border border-line bg-surface p-1.5 shadow-pop">
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">Presets</p>
          {PRESETS.map((p) => (
            <button key={p.id} type="button" role="menuitem" className={item} onClick={() => (onChange({ ...prefs, columns: p.columns }), setMenu(false))}>
              <span className="grid size-4 place-items-center text-primary">{same(p.columns, prefs.columns) && <Check className="size-4" />}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{p.name}</span>
                <span className="block truncate text-[12px] text-muted">{p.description}</span>
              </span>
            </button>
          ))}
          {prefs.sets.length > 0 && (
            <>
              <div className="my-1 h-px bg-line-soft" />
              <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">Saved</p>
              {prefs.sets.map((s) => (
                <div key={s.id} className="group/set flex items-center">
                  <button type="button" role="menuitem" className={cn(item, "flex-1")} onClick={() => (onChange({ ...prefs, columns: s.columns }), setMenu(false))}>
                    <span className="grid size-4 place-items-center text-primary">{same(s.columns, prefs.columns) && <Check className="size-4" />}</span>
                    <span className="truncate">{s.name}</span>
                    <span className="ml-auto text-[11.5px] text-faint">{s.columns.length}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete column set ${s.name}`}
                    title="Delete set"
                    onClick={() => onChange({ ...prefs, sets: prefs.sets.filter((x) => x.id !== s.id) })}
                    className="grid size-7 shrink-0 place-items-center rounded-md text-faint opacity-0 transition hover:bg-danger-soft hover:text-danger-ink focus-visible:opacity-100 group-hover/set:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </>
          )}
          <div className="my-1 h-px bg-line-soft" />
          <button type="button" role="menuitem" className={cn(item, "font-medium text-primary-ink")} onClick={() => (setDialog(true), setMenu(false))}>
            <Plus className="size-4" aria-hidden /> Customize columns…
          </button>
        </div>
      )}
      {dialog && <CustomizeDialog prefs={prefs} level={level} onClose={() => setDialog(false)} onApply={(next) => (onChange(next), setDialog(false))} />}
    </div>
  );
}

function CustomizeDialog({ prefs, level, onClose, onApply }: { prefs: ColumnPrefs; level: TableLevelKey; onClose: () => void; onApply: (p: ColumnPrefs) => void }) {
  const [selected, setSelected] = useState<string[]>(prefs.columns);
  const [q, setQ] = useState("");
  const [setName, setSetName] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const query = q.trim().toLowerCase();
  const visible = COLUMNS.filter((c) => !query || c.label.toLowerCase().includes(query) || c.description.toLowerCase().includes(query));
  const toggle = (key: string) => setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  const move = (key: string, delta: number) =>
    setSelected((s) => {
      const i = s.indexOf(key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const dropOn = (target: string) =>
    setSelected((s) => {
      if (!dragging || dragging === target) return s;
      const next = s.filter((k) => k !== dragging);
      next.splice(next.indexOf(target), 0, dragging);
      return next;
    });

  const apply = (withSet: boolean) => {
    const sets = withSet && setName.trim() ? [...prefs.sets.filter((s) => s.name !== setName.trim()), { id: crypto.randomUUID().slice(0, 12), name: setName.trim(), columns: selected }] : prefs.sets;
    onApply({ columns: selected, sets: sets.slice(-20) });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-3 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="columns-title" className="flex max-h-[min(44rem,calc(100dvh-1.5rem))] w-full max-w-3xl animate-pop-in flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
        <div className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
          <div>
            <h2 id="columns-title" className="text-[15px] font-semibold tracking-tight">
              Customize columns
            </h2>
            <p className="mt-0.5 text-[13px] text-muted">Pick metrics, drag to reorder, and save the layout as a set you can switch to any time.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-faint hover:bg-hover hover:text-ink">
            <X className="size-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 sm:grid-cols-[1fr_17rem]">
          <div className="flex min-h-0 flex-col border-line-soft max-sm:max-h-[45dvh] sm:border-r">
            <div className="relative border-b border-line-soft p-3">
              <Search className="pointer-events-none absolute left-5.5 top-5.5 size-4 text-faint" aria-hidden />
              <input
                autoFocus
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search metrics"
                aria-label="Search metrics"
                className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-2 text-[13px] focus:border-primary focus:outline-none focus:ring-4 focus:ring-[var(--ring)]"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {COLUMN_GROUPS.map((g) => {
                const list = visible.filter((c) => c.group === g);
                if (!list.length) return null;
                return (
                  <fieldset key={g} className="mb-4 last:mb-0">
                    <legend className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">{g}</legend>
                    <div className="grid gap-0.5 sm:grid-cols-2">
                      {list.map((c) => {
                        const on = selected.includes(c.key);
                        const na = c.levels && !c.levels.includes(level);
                        return (
                          <label key={c.key} title={c.description} className={cn("flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-[13px] transition-colors hover:bg-hover", on && "bg-primary-soft/50")}>
                            <input type="checkbox" checked={on} onChange={() => toggle(c.key)} className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary" />
                            <span className="min-w-0">
                              <span className="block leading-tight">{c.label}</span>
                              {na && <span className="block text-[11.5px] text-faint">Not shown at this level</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
              {visible.length === 0 && <p className="py-8 text-center text-[13px] text-muted">No metrics match “{q}”.</p>}
            </div>
          </div>

          <div className="flex min-h-0 flex-col bg-surface-2/60 max-sm:border-t max-sm:border-line-soft">
            <p className="flex items-center justify-between px-4 pb-2 pt-3 text-[12px] font-medium text-muted">
              <span>{selected.length} columns selected</span>
              <button type="button" onClick={() => setSelected(DEFAULT_PRESET.columns)} className="inline-flex items-center gap-1 text-faint hover:text-ink">
                <RotateCcw className="size-3.5" aria-hidden /> Reset
              </button>
            </p>
            <ol className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {selected.map((key, i) => {
                const c = COLUMN_BY_KEY.get(key);
                if (!c) return null;
                return (
                  <li
                    key={key}
                    draggable
                    onDragStart={(e) => {
                      setDragging(key);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      dropOn(key);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={cn(
                      "group/col flex items-center gap-1.5 rounded-lg border border-transparent bg-surface px-1.5 py-1 text-[13px] shadow-xs",
                      "mb-1 cursor-grab active:cursor-grabbing",
                      dragging === key && "border-primary/40 opacity-60",
                    )}
                  >
                    <GripVertical className="size-4 shrink-0 text-faint" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    <button type="button" aria-label={`Move ${c.label} up`} disabled={i === 0} onClick={() => move(key, -1)} className="grid size-6 place-items-center rounded text-faint hover:bg-hover hover:text-ink disabled:opacity-30">
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button type="button" aria-label={`Move ${c.label} down`} disabled={i === selected.length - 1} onClick={() => move(key, 1)} className="grid size-6 place-items-center rounded text-faint hover:bg-hover hover:text-ink disabled:opacity-30">
                      <ArrowDown className="size-3.5" />
                    </button>
                    <button type="button" aria-label={`Remove ${c.label}`} onClick={() => toggle(key)} className="grid size-6 place-items-center rounded text-faint hover:bg-danger-soft hover:text-danger-ink">
                      <X className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-5 py-3">
          <input
            value={setName}
            onChange={(e) => setSetName(e.target.value)}
            maxLength={60}
            placeholder="Name this set to save it (optional)"
            aria-label="Column set name"
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-[13px] focus:border-primary focus:outline-none focus:ring-4 focus:ring-[var(--ring)] sm:max-w-72"
          />
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={selected.length === 0} onClick={() => apply(true)}>
              {setName.trim() ? "Save set & apply" : "Apply"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
