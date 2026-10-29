"use client";

import { Crosshair, Globe, Layers, MessageCircle, MousePointerClick, Smartphone, Target, Wallet, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { lookupApps, lookupPixels, type AppOption } from "@/app/(app)/lookups";
import { AudienceEditor, PlacementsEditor } from "@/app/(app)/campaigns/editor/audience";
import { ConversionEventSelect } from "@/app/(app)/campaigns/editor/conversion-event";
import { MoneyInput, Section } from "@/app/(app)/campaigns/editor/fields";
import { Alert, cn, Field, Input, Select } from "@/components/ui";
import { MAX_ADSETS, resolveAdset, type AdsetDraft, type BuilderState } from "@/lib/launch/draft";
import { DESTINATION_LABELS, goalsFor, isConversionGoal, MESSAGING_APP_LABELS, MESSAGING_APPS, type Destination, type MessagingApp } from "@/lib/launch/objectives";
import { needsBidAmount } from "@/lib/meta/editor-types";
import { OPTIMIZATION_LABELS } from "@/lib/meta/labels";
import { NameField } from "./campaign-step";
import { ItemTabs } from "./parts";

const DESTINATION_CARDS: Record<Destination, { icon: LucideIcon; body: string }> = {
  website: { icon: Globe, body: "Send people to your website." },
  messaging: { icon: MessageCircle, body: "Start chats in Messenger, Instagram or WhatsApp." },
  app: { icon: Smartphone, body: "Send people to the app store to install your app." },
  on_ad: { icon: MousePointerClick, body: "Video views, post engagement or reach on the ad itself." },
};

const ATTRIBUTION = [
  { value: "7-1-0", label: "7-day click, 1-day view" },
  { value: "7-0-0", label: "7-day click" },
  { value: "1-1-0", label: "1-day click, 1-day view" },
  { value: "1-0-0", label: "1-day click" },
  { value: "7-1-1", label: "7-day click, 1-day view, 1-day engaged view" },
] as const;

const GOAL_LABELS: Record<string, string> = { ...OPTIMIZATION_LABELS, TWO_SECOND_CONTINUOUS_VIDEO_VIEWS: "2-second continuous video views" };

export function AdsetStep({
  state,
  names,
  accountId,
  currency,
  active,
  issues,
  onSelect,
  onAdd,
  onDuplicate,
  onRemove,
  patch,
}: {
  state: BuilderState;
  names: string[];
  accountId: string;
  currency: string;
  active: number;
  issues: Set<number>;
  onSelect: (i: number) => void;
  onAdd: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  patch: (key: string, patch: Partial<AdsetDraft>) => void;
}) {
  const c = state.campaign;
  const s = state.adsets[active];
  const r = resolveAdset(c.objective, s);
  const set = (p: Partial<AdsetDraft>) => patch(s.key, p);
  const cbo = c.budgetLevel === "campaign";

  const [pixels, setPixels] = useState<{ id: string; name: string }[] | null>(null);
  const [apps, setApps] = useState<AppOption[] | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const needPixels = r.pixel !== "none";
  const needApps = r.destination === "app";
  useEffect(() => {
    if (!needPixels || pixels) return;
    lookupPixels(accountId).then((res) => (res.ok ? setPixels(res.items) : setLookupError(res.error)));
  }, [needPixels, pixels, accountId]);
  useEffect(() => {
    if (!needApps || apps) return;
    lookupApps(accountId).then((res) => (res.ok ? setApps(res.items) : setLookupError(res.error)));
  }, [needApps, apps, accountId]);

  const setDestination = (d: Destination) => set({ destination: d, goal: goalsFor(c.objective, d, s.messagingApps)[0] });
  const toggleApp = (a: MessagingApp) => {
    const next = s.messagingApps.includes(a) ? s.messagingApps.filter((x) => x !== a) : [...s.messagingApps, a];
    if (next.length === 0) return;
    const goals = goalsFor(c.objective, "messaging", next);
    set({ messagingApps: MESSAGING_APPS.filter((x) => next.includes(x)), goal: goals.includes(s.goal) ? s.goal : goals[0] });
  };
  const app = apps?.find((a) => a.id === s.appId);

  return (
    <div className="flex flex-col gap-4">
      <ItemTabs
        noun="Ad set"
        items={state.adsets.map((x, j) => ({ key: x.key, label: names[j] }))}
        active={active}
        max={MAX_ADSETS}
        issues={issues}
        onSelect={onSelect}
        onAdd={onAdd}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
      />

      <Section title="Ad set" icon={Layers} description="Every ad in the Ads step runs in every ad set.">
        <NameField id={`adset-${active}-name`} label="Ad set name" value={names[active]} edited={s.nameEdited} onChange={(name) => set({ name, nameEdited: true })} onReset={() => set({ nameEdited: false })} />
      </Section>

      <Section title="Conversion location" icon={Target} description="Where you want people to go when they tap the ad.">
        <div role="radiogroup" aria-label="Conversion location" className="grid gap-2 sm:grid-cols-2">
          {r.destinations.map((d) => {
            const { icon: Icon, body } = DESTINATION_CARDS[d];
            const on = r.destination === d;
            return (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setDestination(d)}
                className={cn("flex gap-3 rounded-xl border p-3 text-left transition-colors", on ? "border-primary bg-primary-soft/40 ring-4 ring-[var(--ring)]" : "border-line hover:bg-hover/60")}
              >
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", on ? "bg-primary text-white" : "bg-surface-2 text-muted ring-1 ring-inset ring-line")}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <span>
                  <span className="block text-[13.5px] font-medium">{DESTINATION_LABELS[d]}</span>
                  <span className="mt-0.5 block text-[12.5px] text-muted">{body}</span>
                </span>
              </button>
            );
          })}
        </div>
        {c.objective === "OUTCOME_AWARENESS" && <p className="text-[12.5px] text-muted">Awareness ad sets don&apos;t optimize for a conversion location; the ads link to your website.</p>}

        {r.destination === "messaging" && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-medium">Messaging apps</legend>
            <p className="-mt-1 text-[12.5px] text-muted">Pick one app, or several and Meta sends each person to the app they&apos;re most likely to reply in.</p>
            <div className="flex flex-wrap gap-2">
              {MESSAGING_APPS.map((a) => {
                const on = s.messagingApps.includes(a);
                return (
                  <label key={a} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition-colors", on ? "border-primary bg-primary-soft/40" : "border-line hover:bg-hover/60")}>
                    <input type="checkbox" checked={on} onChange={() => toggleApp(a)} className="size-4 accent-primary" />
                    {MESSAGING_APP_LABELS[a]}
                  </label>
                );
              })}
            </div>
            <p className="text-[12px] text-faint">
              {s.messagingApps.length > 1 ? "Multiple destinations" : "Single destination"}
              {s.messagingApps.includes("WHATSAPP") && " · WhatsApp needs a WhatsApp Business number connected to the Page"}
              {s.messagingApps.includes("INSTAGRAM_DIRECT") && " · Instagram needs the Page's Instagram account"}
            </p>
          </fieldset>
        )}

        {r.destination === "app" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="App" hint={apps && apps.length === 0 ? "No apps are connected to this ad account. Enter the app ID instead." : undefined}>
              {apps && apps.length > 0 ? (
                <Select
                  value={s.appId}
                  onChange={(e) => {
                    const next = apps.find((a) => a.id === e.target.value);
                    set({ appId: e.target.value, appStoreUrl: next?.storeUrls[0] ?? "" });
                  }}
                >
                  <option value="">Choose an app</option>
                  {apps.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input value={s.appId} placeholder={apps ? "App ID" : "Loading apps…"} inputMode="numeric" onChange={(e) => set({ appId: e.target.value.replace(/\D/g, "") })} />
              )}
            </Field>
            <Field label="App store" hint="Where people install the app.">
              {app && app.storeUrls.length > 1 ? (
                <Select value={s.appStoreUrl} onChange={(e) => set({ appStoreUrl: e.target.value })}>
                  {app.storeUrls.map((u) => (
                    <option key={u} value={u}>
                      {u.includes("apple.com") ? "App Store" : u.includes("google.com") ? "Google Play" : u}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input type="url" value={s.appStoreUrl} placeholder="https://apps.apple.com/…" onChange={(e) => set({ appStoreUrl: e.target.value.trim() })} />
              )}
            </Field>
          </div>
        )}
      </Section>

      <Section title="Performance goal" icon={Crosshair} description="What Meta optimizes delivery for.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Performance goal">
            <Select value={r.goal} onChange={(e) => set({ goal: e.target.value })}>
              {r.goals.map((g) => (
                <option key={g} value={g}>
                  {GOAL_LABELS[g] ?? g}
                </option>
              ))}
            </Select>
          </Field>
          {isConversionGoal(r.goal) && r.pixel !== "none" && (
            <Field label="Attribution setting">
              <Select
                value={`${s.attribution.clickDays}-${s.attribution.viewDays}-${s.attribution.engagedViewDays}`}
                onChange={(e) => {
                  const [clickDays, viewDays, engagedViewDays] = e.target.value.split("-").map(Number) as [1 | 7, 0 | 1, 0 | 1];
                  set({ attribution: { clickDays, viewDays, engagedViewDays } });
                }}
              >
                {ATTRIBUTION.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        {r.pixel !== "none" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Pixel${r.pixel === "optional" ? " (optional)" : ""}`}>
              {pixels && pixels.length > 0 ? (
                <Select value={s.pixelId} onChange={(e) => set({ pixelId: e.target.value })}>
                  <option value="">{r.pixel === "optional" ? "No pixel" : "Choose a pixel"}</option>
                  {pixels.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id})
                    </option>
                  ))}
                  {s.pixelId && !pixels.some((p) => p.id === s.pixelId) && <option value={s.pixelId}>Pixel {s.pixelId}</option>}
                </Select>
              ) : (
                <Input value={s.pixelId} placeholder={pixels ? "No pixels found. Enter a pixel ID" : "Loading pixels…"} inputMode="numeric" onChange={(e) => set({ pixelId: e.target.value.replace(/\D/g, "") })} />
              )}
            </Field>
            <Field label="Conversion event">
              <ConversionEventSelect accountId={accountId} pixelId={s.pixelId} value={s.conversionEvent} onChange={(conversionEvent) => set({ conversionEvent })} />
            </Field>
          </div>
        )}
        {lookupError && <Alert tone="warning">Couldn&apos;t load from Meta: {lookupError}</Alert>}
      </Section>

      <Section title="Budget & bidding" icon={Wallet} description={cbo ? "This ad set uses the campaign budget (CBO)." : "Ad set budget (ABO): this ad set spends its own budget."}>
        {!cbo && (
          <Field label={`${c.budgetSchedule === "lifetime" ? "Lifetime" : "Daily"} budget`}>
            <MoneyInput currency={currency} value={s.budget} onChange={(v) => set({ budget: v })} />
          </Field>
        )}
        {needsBidAmount(c.bidStrategy) && (
          <Field label={c.bidStrategy === "COST_CAP" ? "Cost per result goal" : "Bid cap"} hint={c.bidStrategy === "COST_CAP" ? "The average cost per result you want to stay around." : "The most you'll bid in any auction."}>
            <MoneyInput currency={currency} value={s.bidAmount} onChange={(v) => set({ bidAmount: v })} />
          </Field>
        )}
        {c.bidStrategy === "LOWEST_COST_WITH_MIN_ROAS" && (
          <Field label="Minimum ROAS" hint="e.g. 2.5 = $2.50 of purchase value per $1 spent. Needs the Conversion value goal.">
            <Input type="number" min="0.01" step="0.01" value={s.roasFloor} onChange={(e) => set({ roasFloor: e.target.value })} />
          </Field>
        )}
        {cbo && !needsBidAmount(c.bidStrategy) && c.bidStrategy !== "LOWEST_COST_WITH_MIN_ROAS" && <p className="text-[12.5px] text-muted">Nothing to set here. Change the budget on the Campaign step.</p>}
      </Section>

      <AudienceEditor key={`aud-${s.key}`} accountId={accountId} value={s.audience} onChange={(audience) => set({ audience })} />
      <PlacementsEditor key={`pl-${s.key}`} value={s.placements} onChange={(placements) => set({ placements })} />
    </div>
  );
}
