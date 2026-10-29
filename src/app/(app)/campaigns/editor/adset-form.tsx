"use client";

import { CalendarClock, Crosshair, Wallet } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { lookupPixels } from "@/app/(app)/lookups";
import { toast } from "@/components/toast";
import Link from "next/link";
import { Alert, Badge, Button, buttonClass, Field, Input, Select } from "@/components/ui";
import { isoToZonedLocal } from "@/lib/dates";
import { CONVERSION_EVENTS } from "@/lib/launch/spec";
import { RESULT_LABELS } from "@/lib/meta/actions";
import {
  BID_STRATEGIES,
  DEFAULT_AUDIENCE,
  DEFAULT_PLACEMENTS,
  needsBidAmount,
  OPTIMIZATION_BY_OBJECTIVE,
  usesPixel,
  type AdsetData,
  type AdsetInput,
  type BidStrategy,
  type CreateObjective,
} from "@/lib/meta/editor-types";
import { BID_STRATEGY_LABELS, label, OBJECTIVE_LABELS, OPTIMIZATION_LABELS } from "@/lib/meta/labels";
import { createAdsetAction, saveAdsetAction } from "./actions";
import { AudienceEditor, PlacementsEditor, placementsValid } from "./audience";
import { ConversionEventSelect } from "./conversion-event";
import { Choice, MoneyInput, ReadOnly, Section } from "./fields";
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
      <Field label={strategy === "COST_CAP" ? "Cost per result goal" : "Bid cap"} hint={strategy === "COST_CAP" ? "The average cost per result you want to stay around." : "The most you'll bid in any auction."}>
        <MoneyInput currency={currency} value={bidAmount} disabled={disabled} onChange={onBid} />
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
          <div className="grid gap-4 sm:grid-cols-3">
            <ReadOnly label="Campaign">{data.campaignName || data.campaignId}</ReadOnly>
            <ReadOnly label="Optimization">{label(OPTIMIZATION_LABELS, data.optimizationGoal)}</ReadOnly>
            <ReadOnly label="Conversion event">{data.conversionEvent ? (RESULT_LABELS[data.conversionEvent] ?? data.conversionEvent) : "—"}</ReadOnly>
            <ReadOnly label="Pixel">{data.pixelId ?? "—"}</ReadOnly>
            <ReadOnly label="Attribution">{data.attribution}</ReadOnly>
            <ReadOnly label="Learning">{data.learning ? <Badge tone={data.learning === "SUCCESS" ? "success" : data.learning === "FAIL" ? "danger" : "warning"}>{data.learning.toLowerCase()}</Badge> : "—"}</ReadOnly>
          </div>
        </Section>

        <Section title="Budget & schedule" icon={Wallet} description={data.campaignBudget ? "This ad set uses the campaign's Advantage budget." : undefined}>
          {!data.campaignBudget && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`${data.budgetType === "lifetime" ? "Lifetime" : "Daily"} budget`}>
                <MoneyInput currency={currency} value={f.budget} disabled={ro} onChange={(v) => set("budget", v)} />
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start" hint={`Times in ${timeZone}`}>
              <Input type="datetime-local" value={f.startTime} disabled={ro} onChange={(e) => set("startTime", e.target.value)} />
            </Field>
            <Field label="End" hint={data.budgetType === "lifetime" ? "Required for lifetime budgets." : "Optional."}>
              <div className="flex gap-2">
                <Input type="datetime-local" value={f.endTime} min={f.startTime || undefined} disabled={ro} onChange={(e) => set("endTime", e.target.value)} />
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

export function NewAdsetForm({ accountId, currency, timeZone, parents, parentId, target, setDirty, onClose, onNavigate }: FormProps & { parentId?: string }) {
  const hint = target.mode === "create" ? target.parentHint : undefined;
  const campaigns = hint && !parents.campaigns.some((c) => c.id === hint.id) ? [hint, ...parents.campaigns] : parents.campaigns;
  const [campaignId, setCampaignId] = useState(parentId ?? campaigns[0]?.id ?? "");
  const campaign = campaigns.find((c) => c.id === campaignId);
  const objective = (campaign?.objective ?? "OUTCOME_SALES") as CreateObjective;
  const goals = OPTIMIZATION_BY_OBJECTIVE[objective] ?? OPTIMIZATION_BY_OBJECTIVE.OUTCOME_SALES;

  const [f, setF] = useState({
    name: "",
    optimizationGoal: goals[0],
    pixelId: "",
    conversionEvent: objective === "OUTCOME_LEADS" ? "LEAD" : "PURCHASE",
    budgetType: "daily" as "daily" | "lifetime",
    budget: "20",
    bidStrategy: "LOWEST_COST_WITHOUT_CAP" as BidStrategy,
    bidAmount: "",
    roasFloor: "",
    startTime: "",
    endTime: "",
    attribution: "7d_click_1d_view" as AdsetInput["attribution"],
    audience: DEFAULT_AUDIENCE,
    placements: DEFAULT_PLACEMENTS,
  });
  const [pixels, setPixels] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => setDirty(f.name.trim().length > 0), [f.name, setDirty]);

  // Keep the goal valid when switching to a campaign with another objective.
  const goal = goals.includes(f.optimizationGoal) ? f.optimizationGoal : goals[0];
  const pixel = usesPixel(goal);
  useEffect(() => {
    if (!pixel || pixels) return;
    lookupPixels(accountId).then((res) => {
      if (res.ok) {
        setPixels(res.items);
        setF((x) => (x.pixelId ? x : { ...x, pixelId: res.items[0]?.id ?? "" }));
      } else setError(res.error);
    });
  }, [pixel, pixels, accountId]);

  const strategy = campaign?.hasBudget ? (campaign.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP") : f.bidStrategy;
  const lifetime = !campaign?.hasBudget && f.budgetType === "lifetime";
  const canCreate =
    campaign &&
    f.name.trim() &&
    (!pixel || (f.pixelId && f.conversionEvent)) &&
    (campaign.hasBudget || Number(f.budget) > 0) &&
    (!lifetime || f.endTime) &&
    (!needsBidAmount(strategy) || Number(f.bidAmount) > 0) &&
    f.audience.locations.length > 0 &&
    f.audience.ageMin <= f.audience.ageMax &&
    placementsValid(f.placements);

  const create = () =>
    start(async () => {
      setError(null);
      const res = await createAdsetAction({
        campaignId,
        name: f.name.trim(),
        optimizationGoal: goal as Parameters<typeof createAdsetAction>[0]["optimizationGoal"],
        pixelId: pixel ? f.pixelId : undefined,
        conversionEvent: pixel ? (f.conversionEvent as (typeof CONVERSION_EVENTS)[number]) : undefined,
        budgetType: f.budgetType,
        budget: campaign?.hasBudget ? undefined : Number(f.budget),
        bidStrategy: f.bidStrategy,
        bidAmount: Number(f.bidAmount) > 0 ? Number(f.bidAmount) : undefined,
        roasFloor: Number(f.roasFloor) > 0 ? Number(f.roasFloor) : undefined,
        startTime: f.startTime || undefined,
        endTime: f.endTime || undefined,
        attribution: f.attribution,
        audience: f.audience,
        placements: f.placements,
      });
      if (res?.ok && res.id) {
        toast(res.message ?? "Ad set created");
        setDirty(false);
        onNavigate({ mode: "create", level: "ad", parentId: res.id });
      } else {
        setError(res?.error ?? "Couldn't create the ad set");
        toast(res?.error ?? "Couldn't create the ad set", "error");
      }
    });

  if (campaigns.length === 0) {
    return (
      <div className="p-5">
        <Alert tone="info" title="Create a campaign first">
          Ad sets live inside a campaign.
          <div className="mt-2">
            <Link href="/launches/new" className={buttonClass("primary", "sm")}>
              New campaign
            </Link>
          </div>
        </Alert>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <Section title="Ad set" icon={Crosshair}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Campaign">
              <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <ReadOnly label="Objective">{label(OBJECTIVE_LABELS, campaign?.objective)}</ReadOnly>
          </div>
          <Field label="Ad set name">
            <Input autoFocus value={f.name} maxLength={400} placeholder="e.g. US — 25-54 — Broad" onChange={(e) => set("name", e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Performance goal">
              <Select value={goal} onChange={(e) => set("optimizationGoal", e.target.value)}>
                {goals.map((g) => (
                  <option key={g} value={g}>
                    {OPTIMIZATION_LABELS[g] ?? g}
                  </option>
                ))}
              </Select>
            </Field>
            {pixel && (
              <Field label="Attribution setting">
                <Select value={f.attribution} onChange={(e) => set("attribution", e.target.value as AdsetInput["attribution"])}>
                  <option value="7d_click_1d_view">7-day click, 1-day view</option>
                  <option value="7d_click">7-day click</option>
                  <option value="1d_click_1d_view">1-day click, 1-day view</option>
                  <option value="1d_click">1-day click</option>
                </Select>
              </Field>
            )}
          </div>
          {pixel && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Pixel">
                <Select value={f.pixelId} onChange={(e) => set("pixelId", e.target.value)} disabled={!pixels}>
                  {!pixels && <option>Loading pixels…</option>}
                  {pixels?.length === 0 && <option value="">No pixels on this account</option>}
                  {pixels?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Conversion event">
                <ConversionEventSelect accountId={accountId} pixelId={f.pixelId} value={f.conversionEvent} onChange={(ev) => set("conversionEvent", ev)} />
              </Field>
            </div>
          )}
        </Section>

        <Section title="Budget & schedule" icon={CalendarClock} description={campaign?.hasBudget ? "Uses the campaign's Advantage budget." : undefined}>
          {!campaign?.hasBudget && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Budget">
                <div className="flex flex-col gap-2">
                  <Choice
                    label="Budget type"
                    value={f.budgetType}
                    onChange={(v) => set("budgetType", v)}
                    options={[
                      { value: "daily", label: "Daily" },
                      { value: "lifetime", label: "Lifetime" },
                    ]}
                  />
                  <MoneyInput currency={currency} value={f.budget} onChange={(v) => set("budget", v)} />
                </div>
              </Field>
              <Field label="Bid strategy">
                <Select value={f.bidStrategy} onChange={(e) => set("bidStrategy", e.target.value as BidStrategy)}>
                  {BID_STRATEGIES.filter((b) => b !== "LOWEST_COST_WITH_MIN_ROAS" || goal === "VALUE").map((b) => (
                    <option key={b} value={b}>
                      {BID_STRATEGY_LABELS[b]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          <BidFields strategy={strategy} bidAmount={f.bidAmount} roasFloor={f.roasFloor} onBid={(v) => set("bidAmount", v)} onRoas={(v) => set("roasFloor", v)} currency={currency} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start" hint={`Empty = now. Times in ${timeZone}.`}>
              <Input type="datetime-local" value={f.startTime} onChange={(e) => set("startTime", e.target.value)} />
            </Field>
            <Field label="End" hint={lifetime ? "Required for lifetime budgets." : "Optional."}>
              <Input type="datetime-local" value={f.endTime} min={f.startTime || undefined} onChange={(e) => set("endTime", e.target.value)} />
            </Field>
          </div>
        </Section>

        <AudienceEditor accountId={accountId} value={f.audience} onChange={(a) => set("audience", a)} />
        <PlacementsEditor value={f.placements} onChange={(p) => set("placements", p)} />
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
      <SaveBar note="Created off. Add ads next.">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="create" disabled={!canCreate || pending} onClick={create}>
          {pending ? "Creating…" : "Create & add ad"}
        </Button>
      </SaveBar>
    </>
  );
}
