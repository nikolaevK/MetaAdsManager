"use client";

import {
  CircleAlert,
  Copy,
  Crosshair,
  Info,
  LayoutGrid,
  Monitor,
  Save,
  Search,
  Settings2,
  Smartphone,
  Sparkles,
  Trash2,
  UsersRound,
  Wallet,
  X,
} from "lucide-react";
import { useState, useTransition } from "react";
import { lookupAudiences, lookupPixels } from "@/app/(app)/lookups";
import { useConfirm } from "@/components/confirm-dialog";
import { useSettingsAction } from "@/components/settings-ui";
import { Alert, Badge, Button, cn, Field, focusRing, Input, Select } from "@/components/ui";
import {
  CONVERSION_EVENTS,
  CREATIVE_FEATURES,
  CTA_TYPES,
  FACEBOOK_POSITIONS,
  INSTAGRAM_POSITIONS,
  POSITION_LABELS,
  VERTICAL_POSITIONS,
  type TemplateConfig,
} from "@/lib/launch/spec";
import { deleteTemplate, duplicateTemplate, saveTemplate } from "./actions";
import { AspectGlyph, CheckTile, FieldGroup, RadioTiles, Section, ToggleRow } from "./form-controls";

type Option = { id: string; name: string };
type AccountOption = Option & { clientId: string };
type Errors = Record<string, string[] | undefined>;
type Platform = "facebook" | "instagram";

const humanize = (s: string) => s.toLowerCase().replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
const PLATFORMS: { id: Platform; label: string; all: readonly string[] }[] = [
  { id: "facebook", label: "Facebook", all: FACEBOOK_POSITIONS },
  { id: "instagram", label: "Instagram", all: INSTAGRAM_POSITIONS },
];
const FORMATS = [
  { vertical: false, label: "Feed", aspect: "1:1", ratio: "square" },
  { vertical: true, label: "Stories & Reels", aspect: "9:16", ratio: "vertical" },
] as const;

export function TemplateForm({
  template,
  clients,
  accounts,
  canEdit,
}: {
  template: { id?: string; name: string; clientId: string | null; config: TemplateConfig };
  clients: Option[];
  accounts: AccountOption[];
  canEdit: boolean;
}) {
  const [name, setName] = useState(template.name);
  const [clientId, setClientId] = useState<string | null>(template.clientId);
  const [config, setConfig] = useState<TemplateConfig>(template.config);
  const [countries, setCountries] = useState(template.config.countries.join(", "));
  const [errors, setErrors] = useState<Errors>({});
  const { pending, run, error } = useSettingsAction({ inlineErrors: true });
  const confirm = useConfirm();

  const set = <K extends keyof TemplateConfig>(key: K, value: TemplateConfig[K]) => setConfig((c) => ({ ...c, [key]: value }));
  const err = (key: string) => errors[key]?.[0];

  const scopedAccounts = clientId ? accounts.filter((a) => a.clientId === clientId) : accounts;

  const save = () => {
    const parsedCountries = countries
      .split(/[\s,]+/)
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    const payload = { ...config, countries: parsedCountries };
    setErrors({});
    run(() => saveTemplate({ id: template.id, name, clientId, config: payload }), {
      onError: (s) => setErrors(s?.fieldErrors ?? {}),
    });
  };

  const togglePlacement = (platform: Platform, p: string) => {
    const all = PLATFORMS.find((x) => x.id === platform)!.all;
    const selected = config.placements[platform] as string[];
    const next = selected.includes(p) ? selected.filter((x) => x !== p) : [...selected, p];
    set("placements", { ...config.placements, [platform]: all.filter((x) => next.includes(x)) });
  };
  const optedIn = config.creativeFeaturesOptIn.length;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex flex-col gap-5"
    >
      <fieldset disabled={!canEdit} className="contents">
        <Section icon={Settings2} title="Basics" description="Name, who can use it, and the campaign objective.">
          <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
            <Field label="Template name" htmlFor="tpl-name" error={err("name")}>
              <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
            </Field>
            <Field label="Available to" htmlFor="tpl-scope" hint="Global templates can be used for every client.">
              <Select id="tpl-scope" value={clientId ?? ""} onChange={(e) => setClientId(e.target.value || null)}>
                <option value="">All clients (global)</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Campaign objective" htmlFor="tpl-objective" error={err("objective")}>
              <Select id="tpl-objective" value={config.objective} onChange={(e) => set("objective", e.target.value as TemplateConfig["objective"])}>
                <option value="OUTCOME_SALES">Sales</option>
                <option value="OUTCOME_LEADS">Leads</option>
              </Select>
            </Field>
            <Field label="Default call to action" htmlFor="tpl-cta" error={err("cta")}>
              <Select id="tpl-cta" value={config.cta} onChange={(e) => set("cta", e.target.value as TemplateConfig["cta"])}>
                {CTA_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {humanize(c)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Section>

        <Section icon={Crosshair} title="Conversion tracking" description="The pixel and standard event every ad set optimises for.">
          <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
            <PixelPicker value={config.pixelId} onChange={(v) => set("pixelId", v)} accounts={scopedAccounts} error={err("pixelId")} />
            <Field label="Conversion event" htmlFor="tpl-event" error={err("conversionEvent")}>
              <Select id="tpl-event" value={config.conversionEvent} onChange={(e) => set("conversionEvent", e.target.value as TemplateConfig["conversionEvent"])}>
                {CONVERSION_EVENTS.map((ev) => (
                  <option key={ev} value={ev}>
                    {humanize(ev)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Section>

        <Section icon={Wallet} title="Budget & attribution" description="How budget is split and which conversions Meta credits to your ads.">
          <div className="grid grid-cols-1 gap-5 @2xl:grid-cols-2">
            <FieldGroup legend="Budget type" error={err("budgetLevel")}>
              <RadioTiles
                name="budgetLevel"
                value={config.budgetLevel}
                onChange={(v) => set("budgetLevel", v)}
                options={[
                  { value: "campaign", label: "Campaign budget (CBO)", hint: "One budget; Meta shifts spend toward the best ad sets." },
                  { value: "adset", label: "Ad set budget (ABO)", hint: "Each ad set spends its own fixed budget." },
                ]}
              />
            </FieldGroup>
            <FieldGroup legend="Schedule" error={err("budgetSchedule")}>
              <RadioTiles
                name="budgetSchedule"
                value={config.budgetSchedule}
                onChange={(v) => set("budgetSchedule", v)}
                options={[
                  { value: "daily", label: "Daily budget", hint: "Spends up to the budget every day." },
                  { value: "lifetime", label: "Lifetime budget", hint: "Spreads the budget over the run; needs an end date." },
                ]}
              />
            </FieldGroup>
          </div>
          <div className="grid grid-cols-1 gap-4 border-t border-line-soft pt-5 @md:grid-cols-2 @3xl:grid-cols-4">
            <Field label="Default budget" htmlFor="tpl-budget" hint="In the ad account's currency." error={err("defaultBudget")}>
              <Input
                id="tpl-budget"
                type="number"
                min="1"
                step="0.01"
                className="tabular"
                value={Number.isFinite(config.defaultBudget) ? config.defaultBudget : ""}
                onChange={(e) => set("defaultBudget", Number(e.target.value))}
              />
            </Field>
            <Field label="Click-through window" htmlFor="tpl-click" error={err("attribution")}>
              <Select
                id="tpl-click"
                value={config.attribution.clickDays}
                onChange={(e) => set("attribution", { ...config.attribution, clickDays: Number(e.target.value) as 1 | 7 })}
              >
                <option value={1}>1-day click</option>
                <option value={7}>7-day click</option>
              </Select>
            </Field>
            <Field label="View-through window" htmlFor="tpl-view">
              <Select
                id="tpl-view"
                value={config.attribution.viewDays}
                onChange={(e) => set("attribution", { ...config.attribution, viewDays: Number(e.target.value) as 0 | 1 })}
              >
                <option value={0}>None</option>
                <option value={1}>1-day view</option>
              </Select>
            </Field>
            <Field label="Engaged-view window" htmlFor="tpl-engaged">
              <Select
                id="tpl-engaged"
                value={config.attribution.engagedViewDays}
                onChange={(e) => set("attribution", { ...config.attribution, engagedViewDays: Number(e.target.value) as 0 | 1 })}
              >
                <option value={0}>None</option>
                <option value={1}>1-day engaged view</option>
              </Select>
            </Field>
          </div>
        </Section>

        <Section icon={UsersRound} title="Audience" description="Default targeting for new ad sets; buyers can adjust geo and age per launch.">
          <div className="grid grid-cols-2 gap-4 @lg:grid-cols-3">
            <div className="col-span-2 @lg:col-span-1">
              <Field label="Countries" htmlFor="tpl-countries" hint="Two-letter codes, e.g. US, CA" error={err("countries")}>
                <Input id="tpl-countries" value={countries} onChange={(e) => setCountries(e.target.value)} />
              </Field>
            </div>
            <Field label="Minimum age" htmlFor="tpl-agemin" error={err("ageMin")}>
              <Input id="tpl-agemin" type="number" min={18} max={65} className="tabular" value={config.ageMin} onChange={(e) => set("ageMin", Number(e.target.value))} />
            </Field>
            <Field label="Maximum age" htmlFor="tpl-agemax" hint="65 means 65+" error={err("ageMax")}>
              <Input id="tpl-agemax" type="number" min={18} max={65} className="tabular" value={config.ageMax} onChange={(e) => set("ageMax", Number(e.target.value))} />
            </Field>
          </div>
          <ToggleRow
            className="rounded-lg border border-line bg-surface-2 px-4 py-3"
            checked={config.advantageAudience}
            onChange={(v) => set("advantageAudience", v)}
            label="Advantage+ audience"
            description="Lets Meta expand beyond your targeting when it expects better results. Off sends advantage_audience: 0."
          />
          <AudiencePicker
            value={config.exclusionAudiences}
            onChange={(v) => set("exclusionAudiences", v)}
            accounts={scopedAccounts}
            error={err("exclusionAudiences")}
          />
        </Section>

        <Section
          icon={LayoutGrid}
          title="Placements"
          description="Facebook and Instagram only. Feed placements use the 1:1 asset, Stories & Reels use the 9:16 asset, both in one ad."
        >
          {err("placements") && <Alert>{err("placements")}</Alert>}
          {FORMATS.map((f) => {
            const groups = PLATFORMS.map((pl) => ({ ...pl, items: pl.all.filter((p) => VERTICAL_POSITIONS[pl.id].has(p) === f.vertical) }));
            const total = groups.reduce((n, g) => n + g.items.length, 0);
            const picked = groups.reduce((n, g) => n + g.items.filter((p) => (config.placements[g.id] as string[]).includes(p)).length, 0);
            return (
              <FieldGroup
                key={f.label}
                legend={
                  <span className="flex items-center gap-2.5">
                    <span className="grid size-7 place-items-center rounded-md border border-primary/20 bg-primary-soft text-primary-ink">
                      <AspectGlyph ratio={f.ratio} />
                    </span>
                    <span>
                      {f.label} <span className="font-normal text-muted">({f.aspect})</span>
                    </span>
                    <span className="tabular ml-auto text-xs font-normal text-faint">
                      {picked} of {total}
                    </span>
                  </span>
                }
              >
                <div className="flex flex-col gap-3">
                  {groups.map((g) => (
                    <div key={g.id} className="grid grid-cols-1 gap-2 @xl:grid-cols-[6.5rem_minmax(0,1fr)] @xl:items-start">
                      <p className="pt-0.5 text-[12px] font-medium text-muted @xl:pt-2.5">{g.label}</p>
                      <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-3 @4xl:grid-cols-4">
                        {g.items.map((p) => (
                          <CheckTile
                            key={p}
                            checked={(config.placements[g.id] as string[]).includes(p)}
                            onChange={() => togglePlacement(g.id, p)}
                            label={POSITION_LABELS[p] ?? p}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </FieldGroup>
            );
          })}
          <div className="border-t border-line-soft pt-5">
            <FieldGroup legend="Devices" error={err("devicePlatforms")}>
              <div className="grid grid-cols-2 gap-2 @xl:max-w-sm">
                {(["mobile", "desktop"] as const).map((d) => (
                  <CheckTile
                    key={d}
                    checked={config.devicePlatforms.includes(d)}
                    onChange={() =>
                      set(
                        "devicePlatforms",
                        config.devicePlatforms.includes(d) ? config.devicePlatforms.filter((x) => x !== d) : [...config.devicePlatforms, d],
                      )
                    }
                    label={humanize(d)}
                    leading={d === "mobile" ? <Smartphone className="size-4" /> : <Monitor className="size-4" />}
                  />
                ))}
              </div>
            </FieldGroup>
          </div>
        </Section>

        <Section
          icon={Sparkles}
          title="Advantage+ creative enhancements"
          description="Meta turns these on by default. Leave a feature off to keep your creative exactly as uploaded."
        >
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3 @xl:flex-row @xl:items-center @xl:justify-between">
            <p className="flex items-start gap-2.5 text-[12.5px] leading-snug text-muted">
              <Info className="mt-px size-4 shrink-0 text-faint" aria-hidden />
              <span>
                Features left off are sent as <code className="font-mono text-[12px] text-ink">OPT_OUT</code> in{" "}
                <code className="break-words font-mono text-[12px] text-ink">degrees_of_freedom_spec</code>. Only switch on a feature you want Meta to
                apply.
              </span>
            </p>
            <Badge tone={optedIn ? "info" : "muted"} className="tabular w-fit shrink-0">
              {optedIn} of {CREATIVE_FEATURES.length} allowed
            </Badge>
          </div>
          <div className="grid grid-cols-1 gap-x-8 @xl:grid-cols-2 @4xl:grid-cols-3">
            {CREATIVE_FEATURES.map((f) => (
              <ToggleRow
                key={f}
                className="border-b border-line-soft py-2.5"
                checked={config.creativeFeaturesOptIn.includes(f)}
                onChange={() =>
                  set(
                    "creativeFeaturesOptIn",
                    config.creativeFeaturesOptIn.includes(f)
                      ? config.creativeFeaturesOptIn.filter((x) => x !== f)
                      : [...config.creativeFeaturesOptIn, f],
                  )
                }
                label={
                  <>
                    <span className="sr-only">Allow </span>
                    {humanize(f)}
                  </>
                }
              />
            ))}
          </div>
        </Section>
      </fieldset>

      {canEdit && (
        <div className="sticky bottom-3 z-20 flex flex-col gap-2 sm:bottom-4">
          {error && <Alert>{error}</Alert>}
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface/90 py-2 pl-4 pr-2 shadow-pop backdrop-blur-md">
            <div className="min-w-0 flex-1 text-[13px]">
              {Object.keys(errors).length > 0 ? (
                <span className="flex min-w-0 items-center gap-1.5 font-medium text-danger-ink">
                  <CircleAlert className="size-4 shrink-0" aria-hidden />
                  <span className="truncate sm:hidden">Fix errors</span>
                  <span className="hidden truncate sm:inline">Fix the highlighted fields.</span>
                </span>
              ) : (
                <span className="hidden truncate text-muted sm:block">
                  {template.id ? "Changes apply to future launches." : "Saved templates are available to launches right away."}
                </span>
              )}
            </div>
            {template.id && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  aria-label="Duplicate template"
                  onClick={() => run(() => duplicateTemplate({ id: template.id! }))}
                >
                  <Copy /> <span className="hidden sm:inline">Duplicate</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  aria-label="Delete template"
                  className="hover:bg-danger-soft hover:text-danger-ink"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Delete “${template.name}”?`,
                      body: "Existing launches keep their own copy of its settings.",
                      confirmLabel: "Delete template",
                      tone: "danger",
                    });
                    if (ok) run(() => deleteTemplate({ id: template.id! }));
                  }}
                >
                  <Trash2 /> <span className="hidden sm:inline">Delete</span>
                </Button>
                <span className="mx-1 h-5 w-px bg-line" aria-hidden />
              </>
            )}
            <Button type="submit" variant="primary" disabled={pending}>
              <Save /> {pending ? "Saving…" : template.id ? "Save template" : "Create template"}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

function AccountSelect({ accounts, value, onChange, label }: { accounts: AccountOption[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 min-w-0 flex-1 text-[13px]">
      {accounts.length === 0 && <option value="">No connected ad accounts</option>}
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name} · {a.id.replace("act_", "")}
        </option>
      ))}
    </Select>
  );
}

function PixelPicker({ value, onChange, accounts, error }: { value: string; onChange: (v: string) => void; accounts: AccountOption[]; error?: string }) {
  const [account, setAccount] = useState(accounts[0]?.id ?? "");
  const [pixels, setPixels] = useState<{ id: string; name: string; lastFired?: string }[] | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [loading, start] = useTransition();

  return (
    <Field label="Pixel / dataset" htmlFor="tpl-pixel" error={error} hint="Pick from an ad account or paste the numeric id.">
      <div className="flex flex-col gap-2">
        <Input id="tpl-pixel" inputMode="numeric" placeholder="e.g. 123456789012345" className="tabular" value={value} onChange={(e) => onChange(e.target.value.trim())} />
        <div className="flex items-center gap-2">
          <AccountSelect label="Load from ad account" accounts={accounts} value={account} onChange={setAccount} />
          <Button
            type="button"
            size="sm"
            disabled={!account || loading}
            onClick={() =>
              start(async () => {
                setLookupError(null);
                const res = await lookupPixels(account);
                if (res.ok) setPixels(res.items);
                else setLookupError(res.error);
              })
            }
          >
            {loading ? "Loading…" : "Load pixels"}
          </Button>
        </div>
        {lookupError && <p className="text-xs text-danger-ink">{lookupError}</p>}
        {pixels && (
          <Select aria-label="Pixels" value={pixels.some((p) => p.id === value) ? value : ""} onChange={(e) => e.target.value && onChange(e.target.value)} className="h-8 text-[13px]">
            <option value="">{pixels.length ? "Choose a pixel…" : "No pixels on this account"}</option>
            {pixels.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.id}
                {p.lastFired ? ` · last fired ${new Date(p.lastFired).toLocaleDateString()}` : " · never fired"}
              </option>
            ))}
          </Select>
        )}
      </div>
    </Field>
  );
}

function AudiencePicker({
  value,
  onChange,
  accounts,
  error,
}: {
  value: { id: string; name: string }[];
  onChange: (v: { id: string; name: string }[]) => void;
  accounts: AccountOption[];
  error?: string;
}) {
  const [account, setAccount] = useState(accounts[0]?.id ?? "");
  const [audiences, setAudiences] = useState<{ id: string; name: string; subtype?: string; size?: number }[] | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState({ id: "", name: "" });
  const [loading, start] = useTransition();

  const has = (id: string) => value.some((a) => a.id === id);
  const add = (a: { id: string; name: string }) => !has(a.id) && onChange([...value, a]);
  const q = query.trim().toLowerCase();

  return (
    <FieldGroup legend="Exclusion audiences" error={error} hint="People in these custom audiences won't see the ads (e.g. purchasers).">
      <div className="flex flex-col gap-3">
        <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface-2 p-2">
          {value.length === 0 && <span className="px-1 text-[13px] text-faint">No exclusions yet</span>}
          {value.map((a) => (
            <span
              key={a.id}
              title={a.id}
              className="inline-flex h-7 max-w-full items-center gap-1 rounded-md bg-surface pl-2.5 pr-1 text-[12.5px] font-medium text-ink shadow-xs ring-1 ring-inset ring-line"
            >
              <span className="truncate">{a.name || a.id}</span>
              <button
                type="button"
                aria-label={`Remove ${a.name || a.id}`}
                onClick={() => onChange(value.filter((x) => x.id !== a.id))}
                className={cn(
                  "relative grid size-5 shrink-0 place-items-center rounded text-faint transition-colors hover:bg-hover hover:text-ink",
                  "pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1.5 pointer-coarse:after:-inset-y-2.5",
                  focusRing,
                )}
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-line-soft p-3">
          <p className="text-xs font-medium text-muted">Add from an ad account</p>
          <div className="flex items-center gap-2">
            <AccountSelect label="Load from ad account" accounts={accounts} value={account} onChange={setAccount} />
            <Button
              type="button"
              size="sm"
              disabled={!account || loading}
              onClick={() =>
                start(async () => {
                  setLookupError(null);
                  const res = await lookupAudiences(account);
                  if (res.ok) setAudiences(res.items);
                  else setLookupError(res.error);
                })
              }
            >
              {loading ? "Loading…" : "Load audiences"}
            </Button>
          </div>
          {lookupError && <p className="text-xs text-danger-ink">{lookupError}</p>}
          {audiences && (
            <div className="overflow-hidden rounded-lg border border-line">
              <div className="relative border-b border-line-soft">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter audiences"
                  aria-label="Filter audiences"
                  className="h-9 w-full bg-surface pl-8 pr-3 text-[13px] text-ink placeholder:text-faint focus:outline-none"
                />
              </div>
              <ul className="max-h-52 overflow-y-auto py-1">
                {audiences
                  .filter((a) => !q || a.name.toLowerCase().includes(q) || a.id.includes(q))
                  .map((a) => (
                    <li key={a.id}>
                      <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[13px] transition-colors hover:bg-hover">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={has(a.id)}
                          onChange={() => (has(a.id) ? onChange(value.filter((x) => x.id !== a.id)) : add({ id: a.id, name: a.name }))}
                        />
                        <span className="min-w-0 flex-1 truncate">{a.name}</span>
                        <span className="tabular shrink-0 text-xs text-faint">
                          {a.subtype ? humanize(a.subtype) : ""}
                          {a.size ? ` · ${a.size.toLocaleString()}+` : ""}
                        </span>
                      </label>
                    </li>
                  ))}
                {audiences.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">No custom audiences on this account.</li>}
              </ul>
            </div>
          )}
          <p className="pt-1 text-xs font-medium text-muted">Or add by id</p>
          <div className="grid grid-cols-1 gap-2 @lg:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]">
            <Input
              aria-label="Audience id"
              placeholder="Audience id"
              inputMode="numeric"
              value={manual.id}
              onChange={(e) => setManual((m) => ({ ...m, id: e.target.value.trim() }))}
              className="tabular h-8 text-[13px]"
            />
            <Input
              aria-label="Audience name"
              placeholder="Name (optional)"
              value={manual.name}
              onChange={(e) => setManual((m) => ({ ...m, name: e.target.value }))}
              className="h-8 text-[13px]"
            />
            <Button
              type="button"
              size="sm"
              disabled={!/^\d+$/.test(manual.id)}
              onClick={() => {
                add({ id: manual.id, name: manual.name.trim() || manual.id });
                setManual({ id: "", name: "" });
              }}
            >
              Add by id
            </Button>
          </div>
        </div>
      </div>
    </FieldGroup>
  );
}
