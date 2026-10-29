"use client";

import { CircleAlert, Link2, Plus, Trash2, X } from "lucide-react";
import { Fragment, useRef, useState } from "react";
import { useSettingsAction } from "@/components/settings-ui";
import { Button, Card, CardHeader, Field, Input, Label } from "@/components/ui";
import type { UtmParam } from "@/lib/db/schema";
import { buildUrlTags, DEFAULT_UTM_PARAMS, META_URL_MACROS, validateUtmParams } from "@/lib/launch/utm";
import { deleteUtmRule, saveUtmRule } from "./actions";
import { FormFooter, InsertChip, PreviewPanel, UsedBy } from "./parts";

type Rule = { id?: string; name: string; params: UtmParam[] };

const ROW = "grid grid-cols-[minmax(0,2fr)_auto_minmax(0,3fr)_2rem] items-center gap-2";

export function UtmForm({ rule, canEdit, usedBy }: { rule?: Rule; canEdit: boolean; usedBy?: string[] }) {
  const empty: Rule = { name: "", params: DEFAULT_UTM_PARAMS.map((p) => ({ ...p })) };
  const [value, setValue] = useState<Rule>(rule ?? empty);
  const [focused, setFocused] = useState<number | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const valueRefs = useRef<(HTMLInputElement | null)[]>([]);
  const { pending, run } = useSettingsAction();
  const idBase = rule?.id ?? "new";

  const problem = validateUtmParams(value.params);
  const preview = buildUrlTags(value.params);
  const setParam = (i: number, patch: Partial<UtmParam>) =>
    setValue((v) => ({ ...v, params: v.params.map((p, k) => (k === i ? { ...p, ...patch } : p)) }));

  // The focused row may have been removed since; fall back to the last row.
  const targetIndex = focused !== null && focused < value.params.length ? focused : value.params.length - 1;

  const insertMacro = (macro: string) => {
    const i = targetIndex;
    if (i < 0) return;
    const el = valueRefs.current[i];
    const text = value.params[i].value;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setParam(i, { value: text.slice(0, start) + macro + text.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + macro.length, start + macro.length);
    });
  };

  const target = value.params[targetIndex];
  const message = problem ?? serverError;

  return (
    <Card className="overflow-hidden">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setServerError(null);
          setNameError(undefined);
          run(() => saveUtmRule(value), {
            onOk: () => !rule && setValue(empty),
            onError: (s) => {
              setServerError(s?.fieldErrors?.params?.[0] ?? null);
              setNameError(s?.fieldErrors?.name?.[0]);
            },
          });
        }}
      >
        <CardHeader
          icon={rule ? Link2 : Plus}
          title={rule ? rule.name : "New UTM rule"}
          description={rule ? "Query parameters appended to every ad's link." : "Starts from the standard UTM parameters."}
          actions={usedBy && <UsedBy names={usedBy} />}
        />
        <fieldset disabled={!canEdit} className="contents">
          <div className="flex flex-col gap-5 p-5">
            <div className="@2xl:max-w-sm">
              <Field label="Name" htmlFor={`utm-${idBase}-name`} error={nameError}>
                <Input
                  id={`utm-${idBase}-name`}
                  value={value.name}
                  onChange={(e) => setValue((v) => ({ ...v, name: e.target.value }))}
                  placeholder="e.g. Standard UTMs"
                  maxLength={120}
                />
              </Field>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Parameters</Label>
              <div className="overflow-hidden rounded-lg border border-line">
                <div className={`${ROW} border-b border-line bg-surface-2 px-3 py-2 text-[12px] font-medium text-muted`}>
                  <span>Key</span>
                  <span aria-hidden className="w-2" />
                  <span>Value</span>
                  <span />
                </div>
                {value.params.length === 0 && <p className="px-3 py-3 text-[13px] text-faint">No parameters — links are sent without url_tags.</p>}
                {value.params.map((p, i) => (
                  <div key={i} className={`${ROW} border-b border-line-soft px-3 py-2 last:border-b-0`}>
                    <Input
                      aria-label="Parameter name"
                      value={p.key}
                      onChange={(e) => setParam(i, { key: e.target.value })}
                      placeholder="utm_source"
                      className="h-8 font-mono text-[12.5px]"
                    />
                    <span className="w-2 text-center font-mono text-faint" aria-hidden>
                      =
                    </span>
                    <Input
                      aria-label="Parameter value"
                      ref={(el) => {
                        valueRefs.current[i] = el;
                      }}
                      value={p.value}
                      onFocus={() => setFocused(i)}
                      onChange={(e) => setParam(i, { value: e.target.value })}
                      placeholder="value or {{macro}}"
                      className="h-8 font-mono text-[12.5px]"
                    />
                    {canEdit ? (
                      <button
                        type="button"
                        aria-label="Remove parameter"
                        onClick={() => setValue((v) => ({ ...v, params: v.params.filter((_, k) => k !== i) }))}
                        className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-danger-soft hover:text-danger-ink"
                      >
                        <X className="size-4" />
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                ))}
                {canEdit && (
                  <div className="border-t border-line-soft bg-surface-2 px-1.5 py-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setValue((v) => ({ ...v, params: [...v.params, { key: "", value: "" }] }))}
                    >
                      <Plus /> Add parameter
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {canEdit && value.params.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted">
                  Insert a dynamic value into{" "}
                  <span className="font-mono text-ink">{target?.key.trim() || (focused === null ? "the last parameter" : "this parameter")}</span>
                </p>
                <div className="flex flex-wrap gap-1">
                  {META_URL_MACROS.map((m) => (
                    <InsertChip key={m} onMouseDown={(e) => e.preventDefault()} onClick={() => insertMacro(m)}>
                      {m}
                    </InsertChip>
                  ))}
                </div>
              </div>
            )}
          </div>
        </fieldset>

        <div className="flex flex-col gap-3 px-5 pb-5">
          {message && (
            <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-danger-ink">
              <CircleAlert className="size-3.5 shrink-0" aria-hidden /> {message}
            </p>
          )}
          <PreviewPanel title="url_tags preview" aside="Meta fills {{macros}} at click time">
            {preview ? (
              <p className="break-all font-mono text-[12.5px] leading-relaxed">
                {preview.split("&").map((pair, i) => {
                  const eq = pair.indexOf("=");
                  return (
                    <Fragment key={i}>
                      {i > 0 && <span className="text-faint">&amp;</span>}
                      <span className="text-primary-ink">{pair.slice(0, eq)}</span>
                      <span className="text-faint">=</span>
                      <span className="text-ink">{pair.slice(eq + 1)}</span>
                    </Fragment>
                  );
                })}
              </p>
            ) : (
              <p className="font-mono text-[12.5px] text-faint">—</p>
            )}
          </PreviewPanel>
        </div>

        {canEdit && (
          <FormFooter>
            {rule?.id && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                className="mr-auto hover:bg-danger-soft hover:text-danger-ink"
                onClick={() => {
                  if (confirm(`Delete UTM rule "${rule.name}"? Clients using it switch to the default.`)) run(() => deleteUtmRule({ id: rule.id! }));
                }}
              >
                <Trash2 /> Delete
              </Button>
            )}
            <Button type="submit" variant="primary" size="sm" disabled={pending || !!problem}>
              {rule ? "Save changes" : "Add UTM rule"}
            </Button>
          </FormFooter>
        )}
      </form>
    </Card>
  );
}
