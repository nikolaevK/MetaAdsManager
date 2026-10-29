"use client";

import { CalendarClock, Megaphone, Wallet } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { Alert, Badge, Button, Field, Input, Select } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { isoToZonedLocal } from "@/lib/dates";
import { BID_STRATEGIES, type BidStrategy, type CampaignData } from "@/lib/meta/editor-types";
import { BID_STRATEGY_LABELS, label, OBJECTIVE_LABELS } from "@/lib/meta/labels";
import { saveCampaignAction } from "./actions";
import { MoneyInput, ReadOnly, Section } from "./fields";
import { SaveBar, type FormProps } from "./sheet";

const BID_HELP: Record<string, string> = {
  LOWEST_COST_WITHOUT_CAP: "Get the most results for your budget.",
  COST_CAP: "Keep the average cost per result around a goal you set on each ad set.",
  LOWEST_COST_WITH_BID_CAP: "Cap the bid in every auction (set on each ad set).",
  LOWEST_COST_WITH_MIN_ROAS: "Aim for at least a minimum return on ad spend (value optimization only).",
};

const CATEGORY_LABEL: Record<string, string> = {
  CREDIT: "Credit",
  EMPLOYMENT: "Employment",
  HOUSING: "Housing",
  ISSUES_ELECTIONS_POLITICS: "Social issues, elections or politics",
  FINANCIAL_PRODUCTS_SERVICES: "Financial products and services",
};

export function CampaignForm({ data, currency, timeZone, canEdit, setDirty, onSaved }: FormProps & { data: CampaignData }) {
  const initial = {
    name: data.name,
    budget: data.budget !== null ? String(data.budget) : "",
    bidStrategy: data.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP",
    spendCap: data.spendCap !== null ? String(data.spendCap) : "",
    startTime: data.startTime ? isoToZonedLocal(data.startTime, timeZone) : "",
    stopTime: data.stopTime ? isoToZonedLocal(data.stopTime, timeZone) : "",
  };
  const [f, setF] = useState(initial);
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const patch: Parameters<typeof saveCampaignAction>[1] = {};
  if (f.name.trim() && f.name !== initial.name) patch.name = f.name.trim();
  if (data.budgetType && f.budget !== initial.budget && Number(f.budget) > 0) {
    patch.budget = Number(f.budget);
    patch.budgetType = data.budgetType;
  }
  if (data.budgetType && f.bidStrategy !== initial.bidStrategy) patch.bidStrategy = f.bidStrategy as BidStrategy;
  if (f.spendCap !== initial.spendCap) patch.spendCap = f.spendCap ? Number(f.spendCap) : null;
  if (f.startTime && f.startTime !== initial.startTime) patch.startTime = f.startTime;
  if (f.stopTime !== initial.stopTime) patch.stopTime = f.stopTime || null;
  const dirty = Object.keys(patch).length > 0;
  useEffect(() => setDirty(dirty), [dirty, setDirty]);

  const save = () =>
    start(async () => {
      const res = await saveCampaignAction(data.id, patch);
      if (res?.ok) {
        toast(res.message ?? "Saved");
        setDirty(false);
        onSaved();
      } else toast(res?.error ?? "Couldn't save", "error");
    });

  const ro = !canEdit;
  return (
    <>
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        {data.issues.length > 0 && (
          <Alert tone="danger" title="Delivery issues">
            <ul className="list-disc pl-4">
              {data.issues.map((i, k) => (
                <li key={k}>{i.message}</li>
              ))}
            </ul>
          </Alert>
        )}
        <Section title="Campaign" icon={Megaphone}>
          <Field label="Campaign name" htmlFor="c-name">
            <Input id="c-name" value={f.name} disabled={ro} maxLength={400} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ReadOnly label="Objective">{label(OBJECTIVE_LABELS, data.objective)}</ReadOnly>
            <ReadOnly label="Special ad categories">
              {data.specialAdCategories.length ? (
                <span className="flex flex-wrap gap-1">
                  {data.specialAdCategories.map((c) => (
                    <Badge key={c} tone="warning">
                      {CATEGORY_LABEL[c] ?? c}
                    </Badge>
                  ))}
                </span>
              ) : (
                "None"
              )}
            </ReadOnly>
          </div>
        </Section>

        <Section
          title="Budget & bidding"
          icon={Wallet}
          description={data.budgetType ? "Advantage campaign budget: Meta distributes this budget across ad sets." : "Budgets are set on each ad set in this campaign."}
        >
          {data.budgetType ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={`${data.budgetType === "daily" ? "Daily" : "Lifetime"} budget`} hint={data.budgetRemaining !== null ? `${formatMoney(data.budgetRemaining, currency)} remaining` : undefined} htmlFor="c-budget">
                  <MoneyInput id="c-budget" currency={currency} value={f.budget} disabled={ro} onChange={(v) => set("budget", v)} />
                </Field>
                <Field label="Bid strategy" hint={BID_HELP[f.bidStrategy]} htmlFor="c-bid">
                  <Select id="c-bid" value={f.bidStrategy} disabled={ro} onChange={(e) => set("bidStrategy", e.target.value)}>
                    {BID_STRATEGIES.map((b) => (
                      <option key={b} value={b}>
                        {BID_STRATEGY_LABELS[b]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {f.bidStrategy !== initial.bidStrategy && f.bidStrategy !== "LOWEST_COST_WITHOUT_CAP" && (
                <Alert tone="warning">Each ad set needs a cost or bid amount for this strategy. Set it on the ad sets after saving.</Alert>
              )}
            </>
          ) : (
            <p className="text-[13px] text-muted">Open an ad set to change its budget or bid strategy.</p>
          )}
          <Field label="Campaign spending limit" hint="Optional. The campaign stops once it has spent this much in total. Leave empty for no limit." htmlFor="c-cap">
            <div className="flex gap-2">
              <div className="flex-1">
                <MoneyInput id="c-cap" currency={currency} value={f.spendCap} disabled={ro} placeholder="No limit" onChange={(v) => set("spendCap", v)} />
              </div>
              {f.spendCap && !ro && (
                <Button variant="ghost" onClick={() => set("spendCap", "")}>
                  Remove
                </Button>
              )}
            </div>
          </Field>
        </Section>

        <Section title="Schedule" icon={CalendarClock} description={`Times are in the ad account's timezone (${timeZone}).`}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Start" htmlFor="c-start">
              <Input id="c-start" type="datetime-local" value={f.startTime} disabled={ro} onChange={(e) => set("startTime", e.target.value)} />
            </Field>
            <Field label="End" hint={data.budgetType === "lifetime" ? "Required for lifetime budgets." : "Optional."} htmlFor="c-stop">
              <div className="flex gap-2">
                <Input id="c-stop" type="datetime-local" value={f.stopTime} min={f.startTime || undefined} disabled={ro} onChange={(e) => set("stopTime", e.target.value)} />
                {f.stopTime && !ro && data.budgetType !== "lifetime" && (
                  <Button variant="ghost" onClick={() => set("stopTime", "")}>
                    Clear
                  </Button>
                )}
              </div>
            </Field>
          </div>
        </Section>
      </div>
      {canEdit && (
        <SaveBar note={dirty ? "Unsaved changes" : "All changes saved"}>
          <Button variant="ghost" disabled={!dirty || pending} onClick={() => setF(initial)}>
            Discard
          </Button>
          <Button variant="primary" disabled={!dirty || pending} onClick={save}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </SaveBar>
      )}
    </>
  );
}
