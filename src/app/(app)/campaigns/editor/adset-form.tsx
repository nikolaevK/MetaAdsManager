"use client";

import { Crosshair, Wallet } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { Alert, Badge, Button, Field, Input, Select } from "@/components/ui";
import { isoToZonedLocal } from "@/lib/dates";
import { learningStage } from "@/lib/format";
import { RESULT_LABELS } from "@/lib/meta/actions";
import {
  BID_STRATEGIES,
  needsBidAmount,
  type AdsetData,
  type BidStrategy,
} from "@/lib/meta/editor-types";
import { BID_STRATEGY_LABELS, label, OPTIMIZATION_LABELS } from "@/lib/meta/labels";
import { saveAdsetAction } from "./actions";
import { AudienceEditor, PlacementsEditor, placementsValid } from "./audience";
import { MoneyInput, ReadOnly, Section } from "./fields";
import { SaveBar, type FormProps } from "./sheet";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function BidFields({
  strategy,
  bidAmount,
  roasFloor,
  onBid,
  onRoas,
  currency,
  disabled,
}: {
  strategy: string | null;
  bidAmount: string;
  roasFloor: string;
  onBid: (v: string) => void;
  onRoas: (v: string) => void;
  currency: string;
  disabled?: boolean;
}) {
  if (needsBidAmount(strategy))
    return (
      <Field label={strategy === "COST_CAP" ? "Cost per result goal" : "Bid cap"} hint={strategy === "COST_CAP" ? "The average cost per result you want to stay around." : "The most you'll bid in any auction."} htmlFor="s-bid">
        <MoneyInput id="s-bid" currency={currency} value={bidAmount} disabled={disabled} onChange={onBid} />
      </Field>
    );
  if (strategy === "LOWEST_COST_WITH_MIN_ROAS")
    return (
      <Field label="Minimum ROAS" hint="e.g. 2.5 = $2.50 of purchase value per $1 spent.">
        <Input type="number" min="0.01" step="0.01" value={roasFloor} disabled={disabled} onChange={(e) => onRoas(e.target.value)} />
      </Field>
    );
  return null;
}

export function AdsetForm({ data, accountId, currency, timeZone, canEdit, setDirty, onSaved }: FormProps & { data: AdsetData }) {
  const initial = {
    name: data.name,
    budget: data.budget !== null ? String(data.budget) : "",
    bidStrategy: data.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP",
    bidAmount: data.bidAmount !== null ? String(data.bidAmount) : "",
    roasFloor: data.roasFloor !== null ? String(data.roasFloor) : "",
    startTime: data.startTime ? isoToZonedLocal(data.startTime, timeZone) : "",
    endTime: data.endTime ? isoToZonedLocal(data.endTime, timeZone) : "",
    audience: data.audience,
    placements: data.placements,
  };
  const [f, setF] = useState(initial);
  const learning = data.learning ? learningStage(data.learning) : null;
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const patch: Parameters<typeof saveAdsetAction>[1] = {};
  if (f.name.trim() && f.name !== initial.name) patch.name = f.name.trim();
  if (!data.campaignBudget && data.budgetType && f.budget !== initial.budget && Number(f.budget) > 0) {
    patch.budget = Number(f.budget);
    patch.budgetType = data.budgetType;
  }
  if (!data.campaignBudget && f.bidStrategy !== initial.bidStrategy) patch.bidStrategy = f.bidStrategy as BidStrategy;
  if (f.bidAmount !== initial.bidAmount && Number(f.bidAmount) > 0) patch.bidAmount = Number(f.bidAmount);
  if (f.roasFloor !== initial.roasFloor && Number(f.roasFloor) > 0) patch.roasFloor = Number(f.roasFloor);
  if (f.startTime && f.startTime !== initial.startTime) patch.startTime = f.startTime;
  if (f.endTime !== initial.endTime) patch.endTime = f.endTime || null;
  if (!same(f.audience, initial.audience)) patch.audience = f.audience;
  if (!same(f.placements, initial.placements)) patch.placements = f.placements;
  const dirty = Object.keys(patch).length > 0;
  useEffect(() => setDirty(dirty), [dirty, setDirty]);

  const valid = f.audience.locations.length > 0 && f.audience.ageMin <= f.audience.ageMax && placementsValid(f.placements);
  const save = () =>
    start(async () => {
      const res = await saveAdsetAction(data.id, patch);
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
        <Section title="Ad set" icon={Crosshair}>
          <Field label="Ad set name" htmlFor="s-name">
            <Input id="s-name" value={f.name} disabled={ro} maxLength={400} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <ReadOnly label="Campaign">{data.campaignName || data.campaignId}</ReadOnly>
            <ReadOnly label="Optimization">{label(OPTIMIZATION_LABELS, data.optimizationGoal)}</ReadOnly>
            <ReadOnly label="Conversion event">{data.conversionEvent ? (RESULT_LABELS[data.conversionEvent] ?? data.conversionEvent) : "—"}</ReadOnly>
            <ReadOnly label="Pixel">{data.pixelId ?? "—"}</ReadOnly>
            <ReadOnly label="Attribution">{data.attribution}</ReadOnly>
            <ReadOnly label="Learning">{learning ? <Badge tone={learning.tone}>{learning.label}</Badge> : "—"}</ReadOnly>
          </div>
        </Section>

        <Section title="Budget & schedule" icon={Wallet} description={data.campaignBudget ? "This ad set uses the campaign's Advantage budget." : undefined}>
          {!data.campaignBudget && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={`${data.budgetType === "lifetime" ? "Lifetime" : "Daily"} budget`} htmlFor="s-budget">
                <MoneyInput id="s-budget" currency={currency} value={f.budget} disabled={ro} onChange={(v) => set("budget", v)} />
              </Field>
              <Field label="Bid strategy">
                <Select value={f.bidStrategy} disabled={ro} onChange={(e) => set("bidStrategy", e.target.value)}>
                  {BID_STRATEGIES.filter((b) => b !== "LOWEST_COST_WITH_MIN_ROAS" || data.optimizationGoal === "VALUE").map((b) => (
                    <option key={b} value={b}>
                      {BID_STRATEGY_LABELS[b]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          <BidFields
            strategy={f.bidStrategy}
            bidAmount={f.bidAmount}
            roasFloor={f.roasFloor}
            onBid={(v) => set("bidAmount", v)}
            onRoas={(v) => set("roasFloor", v)}
            currency={currency}
            disabled={ro}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Start" hint={`Times in ${timeZone}`}>
              <Input type="datetime-local" value={f.startTime} disabled={ro} onChange={(e) => set("startTime", e.target.value)} />
            </Field>
            <Field label="End" hint={data.budgetType === "lifetime" ? "Required for lifetime budgets." : "Optional."} htmlFor="s-end">
              <div className="flex gap-2">
                <Input id="s-end" type="datetime-local" value={f.endTime} min={f.startTime || undefined} disabled={ro} onChange={(e) => set("endTime", e.target.value)} />
                {f.endTime && !ro && data.budgetType !== "lifetime" && (
                  <Button variant="ghost" onClick={() => set("endTime", "")}>
                    Clear
                  </Button>
                )}
              </div>
            </Field>
          </div>
        </Section>

        <AudienceEditor accountId={accountId} value={f.audience} onChange={(a) => set("audience", a)} disabled={ro} />
        <PlacementsEditor value={f.placements} onChange={(p) => set("placements", p)} disabled={ro} />
      </div>
      {canEdit && (
        <SaveBar note={dirty ? (patch.audience || patch.placements ? "Audience changes can restart the learning phase" : "Unsaved changes") : "All changes saved"}>
          <Button variant="ghost" disabled={!dirty || pending} onClick={() => setF(initial)}>
            Discard
          </Button>
          <Button variant="primary" disabled={!dirty || !valid || pending} onClick={save}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </SaveBar>
      )}
    </>
  );
}
