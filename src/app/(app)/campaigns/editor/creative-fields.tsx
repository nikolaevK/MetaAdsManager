"use client";

import { Check, ChevronDown, Plus, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Button, buttonClass, cn, Input, Textarea } from "@/components/ui";
import { CREATIVE_FEATURE_GROUPS, CREATIVE_FEATURES, type CreativeFeature } from "@/lib/launch/spec";
import { Counter, Section, Switch } from "./fields";

/** Primary texts or headlines: up to `limit` options Meta rotates per person. With `fixed`, only the wording can change. */
export function TextOptions({
  label,
  values,
  max,
  limit,
  fixed,
  multiline,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  values: string[];
  /** Characters per option. */
  max: number;
  /** Options allowed. */
  limit: number;
  fixed?: boolean;
  multiline?: boolean;
  placeholder: string;
  disabled?: boolean;
  onChange: (v: string[]) => void;
}) {
  const list = values.length ? values : [""];
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1.5 flex w-full items-center justify-between text-[13px] font-medium">
        {label}
        {limit > 1 && (
          <span className="tabular text-xs font-normal text-faint">
            {list.length}/{limit}
          </span>
        )}
      </legend>
      {list.map((v, k) => (
        <div key={k} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {multiline ? (
              <Textarea rows={k === 0 ? 4 : 3} value={v} maxLength={max} placeholder={k === 0 ? placeholder : `${label} option ${k + 1}`} aria-label={`${label} ${k + 1}`} onChange={(e) => onChange(list.map((x, j) => (j === k ? e.target.value : x)))} />
            ) : (
              <Input value={v} maxLength={max} placeholder={k === 0 ? placeholder : `${label} option ${k + 1}`} aria-label={`${label} ${k + 1}`} onChange={(e) => onChange(list.map((x, j) => (j === k ? e.target.value : x)))} />
            )}
            <div className="mt-0.5 flex justify-end">
              <Counter value={v} max={max} />
            </div>
          </div>
          {list.length > 1 && !fixed && !disabled && (
            <button type="button" aria-label={`Remove ${label.toLowerCase()} ${k + 1}`} title="Remove" onClick={() => onChange(list.filter((_, j) => j !== k))} className={buttonClass("ghost", "icon", "mt-0.5 hover:bg-danger-soft hover:text-danger-ink")}>
              <X />
            </button>
          )}
        </div>
      ))}
      {list.length < limit && !fixed && !disabled && (
        <button type="button" onClick={() => onChange([...list, ""])} className="inline-flex min-h-8 w-fit items-center gap-1 text-[12.5px] font-medium text-primary-ink hover:underline">
          <Plus className="size-3.5" aria-hidden /> Add {label.toLowerCase()} option
        </button>
      )}
    </fieldset>
  );
}

/** Advantage+ creative enhancements: Meta turns them on by default; each one here is an explicit on/off. */
export function Enhancements({ value, onChange, disabled }: { value: CreativeFeature[]; onChange: (v: CreativeFeature[]) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const on = new Set(value);
  const toggle = (k: CreativeFeature) => onChange(on.has(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <Section
      title="Advantage+ creative enhancements"
      icon={Sparkles}
      description={`${on.size} of ${CREATIVE_FEATURES.length} on. Anything off is explicitly opted out, so Meta can't switch it on by default.`}
      actions={
        <span className="flex flex-wrap items-center justify-end gap-1">
          {!disabled && (
            <>
              <Button size="sm" variant="ghost" onClick={() => onChange([])} disabled={on.size === 0}>
                All off
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onChange([...CREATIVE_FEATURES])} disabled={on.size === CREATIVE_FEATURES.length}>
                All on
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "Hide" : "Show"} <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
          </Button>
        </span>
      }
    >
      {open ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {CREATIVE_FEATURE_GROUPS.map((g) => (
            <div key={g.label} className="rounded-lg border border-line">
              <p className="border-b border-line-soft px-3 py-2 text-[12px] font-medium uppercase tracking-wider text-faint">{g.label}</p>
              <ul className="divide-y divide-line-soft">
                {g.features.map((f) => (
                  <li key={f.key} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                    <span>{f.label}</span>
                    <Switch on={on.has(f.key)} label={f.label} disabled={disabled} onChange={() => toggle(f.key)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="flex flex-wrap gap-1.5 text-[12.5px] text-muted">
          {on.size === 0
            ? "All enhancements are off."
            : CREATIVE_FEATURE_GROUPS.flatMap((g) => g.features)
                .filter((f) => on.has(f.key))
                .map((f) => (
                  <span key={f.key} className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-1.5 py-0.5 text-primary-ink">
                    <Check className="size-3" aria-hidden /> {f.label}
                  </span>
                ))}
        </p>
      )}
    </Section>
  );
}
