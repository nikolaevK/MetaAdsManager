"use client";

import { CornerDownRight, Layers, Megaphone, Plus, RectangleHorizontal, Trash2, Type } from "lucide-react";
import { useRef, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { FormFooter, useSettingsAction } from "@/components/settings-ui";
import { Button, Card, CardHeader, Field, Input } from "@/components/ui";
import { ageToken, DEFAULT_NAMING, formatDateToken, NAMING_TOKENS, renderName } from "@/lib/launch/naming";
import { deleteNamingConvention, saveNamingConvention } from "./actions";
import { InsertChip, PreviewPanel, UsedBy } from "./parts";

type Convention = { id?: string; name: string; campaignPattern: string; adsetPattern: string; adPattern: string };
type Level = keyof typeof NAMING_TOKENS;
const FIELD: Record<Level, "campaignPattern" | "adsetPattern" | "adPattern"> = {
  campaign: "campaignPattern",
  adset: "adsetPattern",
  ad: "adPattern",
};
const LABEL: Record<Level, string> = { campaign: "Campaign", adset: "Ad set", ad: "Ad" };
const ICON = { campaign: Megaphone, adset: Layers, ad: RectangleHorizontal } as const;
const INDENT = ["", "pl-2", "pl-5"];

function sampleValues() {
  return {
    client: "Acme",
    account: "Acme US",
    template: "Standard Launch",
    objective: "Sales",
    event: "PURCHASE",
    budget: "CBO",
    label: "Spring Promo",
    date: formatDateToken(),
    geo: "US",
    age: ageToken(25, 65),
    audience: "Broad",
    index: 1,
    creative: "Hook-A",
    angle: "Testimonial",
    format: "VID",
  };
}

export function NamingForm({ convention, canEdit, usedBy }: { convention?: Convention; canEdit: boolean; usedBy?: string[] }) {
  const empty: Convention = { name: "", ...DEFAULT_NAMING };
  const [value, setValue] = useState<Convention>(convention ?? empty);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const refs = useRef<Partial<Record<Level, HTMLInputElement | null>>>({});
  const { pending, run, error } = useSettingsAction({ inlineErrors: true });
  const confirm = useConfirm();
  const samples = sampleValues();
  const levels = Object.keys(FIELD) as Level[];
  const idBase = convention?.id ?? "new";

  const insertToken = (level: Level, token: string) => {
    const field = FIELD[level];
    const el = refs.current[level];
    const text = value[field];
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const insert = `{${token}}`;
    setValue((v) => ({ ...v, [field]: text.slice(0, start) + insert + text.slice(end) }));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + insert.length, start + insert.length);
    });
  };

  return (
    <Card className="overflow-clip">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setErrors({});
          run(() => saveNamingConvention(value), {
            onOk: () => !convention && setValue(empty),
            onError: (s) => setErrors(s?.fieldErrors ?? {}),
          });
        }}
      >
        <CardHeader
          icon={convention ? Type : Plus}
          title={convention ? convention.name : "New naming convention"}
          description={convention ? "Campaign, ad set and ad name patterns." : "Starts from the built-in default patterns."}
          actions={usedBy && <UsedBy names={usedBy} />}
        />
        <fieldset disabled={!canEdit} className="contents">
          <div className="flex flex-col gap-5 p-5">
            <div className="@2xl:max-w-sm">
              <Field label="Name" htmlFor={`nc-${idBase}-name`} error={errors.name}>
                <Input
                  id={`nc-${idBase}-name`}
                  value={value.name}
                  onChange={(e) => setValue((v) => ({ ...v, name: e.target.value }))}
                  placeholder="e.g. Agency standard"
                  maxLength={120}
                />
              </Field>
            </div>
            {levels.map((level) => {
              const field = FIELD[level];
              const Icon = ICON[level];
              return (
                <div key={level} className="flex flex-col gap-2">
                  <Field
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        <Icon className="size-3.5 text-faint" aria-hidden /> {LABEL[level]} name pattern
                      </span>
                    }
                    htmlFor={`nc-${idBase}-${level}`}
                    error={errors[field]}
                  >
                    <Input
                      id={`nc-${idBase}-${level}`}
                      ref={(el) => {
                        refs.current[level] = el;
                      }}
                      value={value[field]}
                      onChange={(e) => setValue((v) => ({ ...v, [field]: e.target.value }))}
                      className="font-mono text-[13px]"
                      maxLength={300}
                    />
                  </Field>
                  {canEdit && (
                    <div role="group" className="flex flex-wrap items-center gap-1 pointer-coarse:gap-1.5" aria-label={`Insert a token into the ${LABEL[level].toLowerCase()} pattern`}>
                      {NAMING_TOKENS[level].map((t) => (
                        <InsertChip key={t} onClick={() => insertToken(level, t)}>
                          {`{${t}}`}
                        </InsertChip>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <PreviewPanel title="Live preview" aside="Sample values">
              <ol className="flex flex-col gap-2 text-[12.5px]">
                {levels.map((level, i) => {
                  const rendered = renderName(value[FIELD[level]], samples);
                  return (
                    <li key={level} className="flex items-start gap-3">
                      <span className={`flex w-[5.25rem] shrink-0 items-center gap-1 text-muted @md:w-[6.5rem] ${INDENT[i]}`}>
                        {i > 0 && <CornerDownRight className="size-3.5 shrink-0 text-faint" aria-hidden />}
                        {LABEL[level]}
                      </span>
                      <span className={rendered ? "min-w-0 wrap-anywhere font-mono text-ink" : "text-faint"}>{rendered || "—"}</span>
                    </li>
                  );
                })}
              </ol>
            </PreviewPanel>
          </div>
        </fieldset>
        {canEdit && (
          <FormFooter sticky error={error}>
            {convention?.id && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                className="mr-auto hover:bg-danger-soft hover:text-danger-ink"
                onClick={async () => {
                  const ok = await confirm({
                    title: `Delete “${convention.name}”?`,
                    body: "Clients using this naming convention switch to the built-in default.",
                    confirmLabel: "Delete convention",
                    tone: "danger",
                  });
                  if (ok) run(() => deleteNamingConvention({ id: convention.id! }));
                }}
              >
                <Trash2 /> Delete
              </Button>
            )}
            <Button type="submit" variant="primary" disabled={pending}>
              {convention ? "Save changes" : "Add convention"}
            </Button>
          </FormFooter>
        )}
      </form>
    </Card>
  );
}
