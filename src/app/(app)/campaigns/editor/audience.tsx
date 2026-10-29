"use client";

import { LayoutPanelTop, MapPin, Sparkles, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { lookupAudiences } from "@/app/(app)/lookups";
import { Alert, cn, Field, Select } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { POSITION_LABELS } from "@/lib/launch/spec";
import {
  AN_POSITIONS,
  FB_POSITIONS,
  IG_POSITIONS,
  MESSENGER_POSITIONS,
  type Audience,
  type AudienceRef,
  type DetailedItem,
  type GeoItem,
  type Placements,
} from "@/lib/meta/editor-types";
import { searchDetailedAction, searchLocationsAction } from "./actions";
import { Chip, Choice, SearchPicker, Section, Switch } from "./fields";

const AGES = Array.from({ length: 48 }, (_, i) => i + 18);
const GEO_KIND: Record<GeoItem["kind"], string> = { country: "Country", region: "Region", city: "City", zip: "ZIP", geo_market: "DMA" };
const DETAILED_TYPE: Record<string, string> = {
  interests: "Interest",
  behaviors: "Behavior",
  life_events: "Life event",
  industries: "Industry",
  income: "Income",
  family_statuses: "Family",
  work_positions: "Job title",
  work_employers: "Employer",
  education_schools: "School",
  education_majors: "Field of study",
  education_statuses: "Education",
  relationship_statuses: "Relationship",
};

export function AudienceEditor({ value, onChange, accountId, disabled }: { value: Audience; onChange: (a: Audience) => void; accountId: string; disabled?: boolean }) {
  const set = <K extends keyof Audience>(k: K, v: Audience[K]) => onChange({ ...value, [k]: v });
  const [showExcludedGeo, setShowExcludedGeo] = useState(value.excludedLocations.length > 0);
  const [showExcludedDetailed, setShowExcludedDetailed] = useState(value.detailedExcluded.length > 0);
  const geoKey = (g: GeoItem) => `${g.kind}:${g.key}`;
  const geoTaken = new Set([...value.locations, ...value.excludedLocations].map(geoKey));
  const detailedTaken = new Set([...value.detailed, ...value.detailedExcluded].map((d) => d.id));

  const renderGeo = (g: GeoItem) => (
    <span className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate">
        {g.name}
        {g.detail && <span className="text-muted"> · {g.detail}</span>}
      </span>
      <span className="shrink-0 text-[11.5px] text-faint">{GEO_KIND[g.kind]}</span>
    </span>
  );
  const renderDetailed = (d: DetailedItem) => (
    <span className="flex items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block truncate">{d.name}</span>
        {d.path && d.path.length > 1 && <span className="block truncate text-[11.5px] text-faint">{d.path.slice(0, -1).join(" › ")}</span>}
      </span>
      <span className="shrink-0 text-right text-[11.5px] text-faint">
        {DETAILED_TYPE[d.type] ?? d.type}
        {d.size ? <span className="block">{compactSize(d.size)}</span> : null}
      </span>
    </span>
  );

  return (
    <Section title="Audience" icon={Users} description="Who sees these ads. Changes apply to new delivery right away.">
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-1.5 text-[13px] font-medium">
          <MapPin className="size-3.5 text-faint" aria-hidden /> Locations
        </span>
        <SearchPicker<GeoItem>
          placeholder="Search countries, regions, cities or ZIP codes"
          search={(q) => searchLocationsAction(accountId, q)}
          render={renderGeo}
          keyOf={geoKey}
          exclude={geoTaken}
          disabled={disabled}
          onPick={(g) => set("locations", [...value.locations, g])}
        />
        <div className="flex flex-wrap gap-1.5">
          {value.locations.map((g, i) => (
            <span key={geoKey(g)} className="inline-flex items-center gap-1">
              <Chip onRemove={disabled ? undefined : () => set("locations", value.locations.filter((_, j) => j !== i))} title={g.detail}>
                <span className="opacity-60">{GEO_KIND[g.kind]} · </span>
                {g.name}
              </Chip>
              {g.kind === "city" && !disabled && (
                <select
                  aria-label={`Radius around ${g.name}`}
                  value={g.radius ?? 0}
                  onChange={(e) => {
                    const radius = Number(e.target.value) || undefined;
                    set("locations", value.locations.map((x, j) => (j === i ? { ...x, radius, distanceUnit: "mile" as const } : x)));
                  }}
                  className="h-7 rounded-md border border-line bg-surface px-1 text-[12px] text-muted"
                >
                  <option value={0}>City only</option>
                  {[10, 15, 25, 40, 50].map((r) => (
                    <option key={r} value={r}>
                      +{r} mi
                    </option>
                  ))}
                </select>
              )}
            </span>
          ))}
          {value.locations.length === 0 && <p className="text-[12.5px] text-danger-ink">Add at least one location.</p>}
        </div>
        {showExcludedGeo ? (
          <div className="mt-1 flex flex-col gap-2 rounded-lg border border-dashed border-line p-3">
            <span className="text-[12.5px] font-medium text-muted">Exclude locations</span>
            <SearchPicker<GeoItem>
              placeholder="Search a location to exclude"
              search={(q) => searchLocationsAction(accountId, q)}
              render={renderGeo}
              keyOf={geoKey}
              exclude={geoTaken}
              disabled={disabled}
              onPick={(g) => set("excludedLocations", [...value.excludedLocations, g])}
            />
            <div className="flex flex-wrap gap-1.5">
              {value.excludedLocations.map((g, i) => (
                <Chip key={geoKey(g)} tone="exclude" onRemove={disabled ? undefined : () => set("excludedLocations", value.excludedLocations.filter((_, j) => j !== i))}>
                  {g.name}
                </Chip>
              ))}
            </div>
          </div>
        ) : (
          !disabled && (
            <button type="button" onClick={() => setShowExcludedGeo(true)} className="w-fit text-[12.5px] font-medium text-primary-ink hover:underline">
              + Exclude locations
            </button>
          )
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Age">
          <div className="flex items-center gap-2">
            <Select aria-label="Minimum age" value={value.ageMin} disabled={disabled} onChange={(e) => set("ageMin", Number(e.target.value))}>
              {AGES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
            <span className="text-faint">–</span>
            <Select aria-label="Maximum age" value={value.ageMax} disabled={disabled} onChange={(e) => set("ageMax", Number(e.target.value))}>
              {AGES.map((a) => (
                <option key={a} value={a}>
                  {a === 65 ? "65+" : a}
                </option>
              ))}
            </Select>
          </div>
        </Field>
        <Field label="Gender">
          <Choice
            label="Gender"
            value={value.genders}
            disabled={disabled}
            onChange={(v) => set("genders", v)}
            options={[
              { value: "all", label: "All" },
              { value: "men", label: "Men" },
              { value: "women", label: "Women" },
            ]}
          />
        </Field>
      </div>
      {value.ageMin > value.ageMax && <p className="-mt-2 text-[12.5px] text-danger-ink">Max age must be at least the min age.</p>}

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">Detailed targeting</span>
        <p className="-mt-1 text-[12.5px] text-muted">People who match at least one of these interests, behaviors or demographics.</p>
        <SearchPicker<DetailedItem>
          placeholder="Search interests, behaviors, demographics"
          search={(q) => searchDetailedAction(accountId, q)}
          render={renderDetailed}
          keyOf={(d) => d.id}
          exclude={detailedTaken}
          disabled={disabled}
          onPick={(d) => set("detailed", [...value.detailed, d])}
        />
        {value.detailed.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {value.detailed.map((d) => (
              <Chip key={d.id} onRemove={disabled ? undefined : () => set("detailed", value.detailed.filter((x) => x.id !== d.id))}>
                <span className="opacity-60">{DETAILED_TYPE[d.type] ?? d.type} · </span>
                {d.name}
              </Chip>
            ))}
          </div>
        )}
        {showExcludedDetailed ? (
          <div className="mt-1 flex flex-col gap-2 rounded-lg border border-dashed border-line p-3">
            <span className="text-[12.5px] font-medium text-muted">Exclude people who match</span>
            <SearchPicker<DetailedItem>
              placeholder="Search to exclude"
              search={(q) => searchDetailedAction(accountId, q)}
              render={renderDetailed}
              keyOf={(d) => d.id}
              exclude={detailedTaken}
              disabled={disabled}
              onPick={(d) => set("detailedExcluded", [...value.detailedExcluded, d])}
            />
            <div className="flex flex-wrap gap-1.5">
              {value.detailedExcluded.map((d) => (
                <Chip key={d.id} tone="exclude" onRemove={disabled ? undefined : () => set("detailedExcluded", value.detailedExcluded.filter((x) => x.id !== d.id))}>
                  {d.name}
                </Chip>
              ))}
            </div>
          </div>
        ) : (
          !disabled && (
            <button type="button" onClick={() => setShowExcludedDetailed(true)} className="w-fit text-[12.5px] font-medium text-primary-ink hover:underline">
              + Exclude interests or behaviors
            </button>
          )
        )}
      </div>

      <CustomAudiences accountId={accountId} value={value} onChange={onChange} disabled={disabled} />

      <div className="flex items-start justify-between gap-4 rounded-lg bg-surface-2 p-3 ring-1 ring-inset ring-line-soft">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-medium">
            <Sparkles className="size-3.5 text-primary" aria-hidden /> Advantage+ audience
          </p>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Let Meta reach beyond your detailed targeting when it&apos;s likely to improve results. Your settings become suggestions; locations, minimum age and exclusions stay strict.
          </p>
        </div>
        <Switch on={value.advantageAudience} disabled={disabled} label="Advantage+ audience" onChange={(on) => set("advantageAudience", on)} />
      </div>
    </Section>
  );
}

const compactSize = (n: number) => `${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)} people`;

function CustomAudiences({ accountId, value, onChange, disabled }: { accountId: string; value: Audience; onChange: (a: Audience) => void; disabled?: boolean }) {
  const [list, setList] = useState<{ id: string; name: string; subtype?: string; size?: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let live = true;
    lookupAudiences(accountId).then((res) => {
      if (!live) return;
      if (res.ok) setList(res.items);
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [accountId]);

  const included = new Set(value.customAudiences.map((a) => a.id));
  const excluded = new Set(value.excludedCustomAudiences.map((a) => a.id));
  const setMode = (a: AudienceRef, mode: "off" | "include" | "exclude") =>
    onChange({
      ...value,
      customAudiences: mode === "include" ? [...value.customAudiences.filter((x) => x.id !== a.id), a] : value.customAudiences.filter((x) => x.id !== a.id),
      excludedCustomAudiences: mode === "exclude" ? [...value.excludedCustomAudiences.filter((x) => x.id !== a.id), a] : value.excludedCustomAudiences.filter((x) => x.id !== a.id),
    });
  const visible = (list ?? []).filter((a) => !q.trim() || a.name.toLowerCase().includes(q.trim().toLowerCase()));
  // Audiences already on the ad set but missing from the list (e.g. shared from another account) stay visible.
  const known = new Set((list ?? []).map((a) => a.id));
  const orphans = [...value.customAudiences, ...value.excludedCustomAudiences].filter((a) => !known.has(a.id));

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium">Custom audiences</span>
      <p className="-mt-1 text-[12.5px] text-muted">Include or exclude website visitors, customer lists, lookalikes and engagement audiences.</p>
      {error && <Alert tone="warning">{error}</Alert>}
      {list === null && !error && <p className="text-[12.5px] text-faint">Loading audiences…</p>}
      {list && list.length > 6 && (
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter audiences"
          aria-label="Filter audiences"
          className="h-8 rounded-lg border border-line bg-surface px-2.5 text-[13px] focus:border-primary focus:outline-none"
        />
      )}
      {(list?.length ?? 0) + orphans.length > 0 && (
        <ul className="max-h-56 divide-y divide-line-soft overflow-y-auto rounded-lg border border-line">
          {[...orphans.map((a) => ({ ...a, subtype: undefined, size: undefined })), ...visible].map((a) => {
            const mode = included.has(a.id) ? "include" : excluded.has(a.id) ? "exclude" : "off";
            return (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[13px]">{a.name}</span>
                  <span className="block text-[11.5px] text-faint">
                    {[a.subtype?.toLowerCase().replaceAll("_", " "), a.size ? `${formatNumber(a.size)}+ people` : null].filter(Boolean).join(" · ") || "Custom audience"}
                  </span>
                </span>
                <span className="inline-flex shrink-0 rounded-lg border border-line bg-surface-2 p-0.5 text-[12px]">
                  {(["off", "include", "exclude"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      disabled={disabled}
                      aria-pressed={mode === m}
                      onClick={() => setMode({ id: a.id, name: a.name }, m)}
                      className={cn(
                        "h-6 rounded-md px-2 capitalize transition-colors",
                        mode === m ? (m === "exclude" ? "bg-danger-soft text-danger-ink" : m === "include" ? "bg-primary-soft text-primary-ink" : "bg-surface text-ink shadow-xs") : "text-muted hover:text-ink",
                      )}
                    >
                      {m === "off" ? "—" : m}
                    </button>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {list && list.length === 0 && orphans.length === 0 && <p className="text-[12.5px] text-muted">This ad account has no custom audiences yet.</p>}
    </div>
  );
}

// ── Placements ───────────────────────────────────────────────────────────────

const PLATFORM_LABEL = { facebook: "Facebook", instagram: "Instagram", audience_network: "Audience Network", messenger: "Messenger" } as const;
const EXTRA_LABELS: Record<string, string> = {
  right_hand_column: "Right column",
  facebook_reels_overlay: "Ads on Reels",
  classic: "Native, banner & interstitial",
  rewarded_video: "Rewarded videos",
  messenger_home: "Inbox",
};
const positionLabel = (p: string) => EXTRA_LABELS[p] ?? POSITION_LABELS[p] ?? p;

const PLATFORM_POSITIONS = {
  facebook: { field: "facebook", options: FB_POSITIONS },
  instagram: { field: "instagram", options: IG_POSITIONS },
  audience_network: { field: "audienceNetwork", options: AN_POSITIONS },
  messenger: { field: "messenger", options: MESSENGER_POSITIONS },
} as const;

export function PlacementsEditor({ value, onChange, disabled }: { value: Placements; onChange: (p: Placements) => void; disabled?: boolean }) {
  const togglePlatform = (pl: Placements["platforms"][number]) => {
    const on = value.platforms.includes(pl);
    const { field, options } = PLATFORM_POSITIONS[pl];
    onChange({
      ...value,
      platforms: on ? value.platforms.filter((x) => x !== pl) : [...value.platforms, pl],
      // Turning a platform on starts with all its positions.
      [field]: on ? [] : value[field].length ? value[field] : [...options],
    });
  };
  const togglePosition = (field: "facebook" | "instagram" | "audienceNetwork" | "messenger", p: string) =>
    onChange({ ...value, [field]: value[field].includes(p) ? value[field].filter((x) => x !== p) : [...value[field], p] });

  const anyPosition = value.platforms.some((pl) => value[PLATFORM_POSITIONS[pl].field].length > 0);

  return (
    <Section title="Placements" icon={LayoutPanelTop} description="Where ads appear across Meta's apps.">
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          { auto: true, title: "Advantage+ placements", body: "Recommended. Meta spreads budget across placements where results are likely cheapest." },
          { auto: false, title: "Manual placements", body: "Pick the exact platforms and positions. Fewer placements usually means higher costs." },
        ].map((o) => (
          <label
            key={o.title}
            className={cn(
              "flex cursor-pointer gap-2.5 rounded-xl border p-3 transition-colors",
              value.automatic === o.auto ? "border-primary bg-primary-soft/40 ring-4 ring-[var(--ring)]" : "border-line hover:bg-hover/60",
              disabled && "pointer-events-none opacity-70",
            )}
          >
            <input type="radio" name="placements-mode" checked={value.automatic === o.auto} onChange={() => onChange({ ...value, automatic: o.auto })} className="mt-0.5 accent-primary" />
            <span>
              <span className="block text-[13px] font-medium">{o.title}</span>
              <span className="mt-0.5 block text-[12.5px] text-muted">{o.body}</span>
            </span>
          </label>
        ))}
      </div>

      {!value.automatic && (
        <div className="flex flex-col gap-3">
          {(Object.keys(PLATFORM_POSITIONS) as Placements["platforms"][number][]).map((pl) => {
            const { field, options } = PLATFORM_POSITIONS[pl];
            const on = value.platforms.includes(pl);
            return (
              <div key={pl} className="rounded-lg border border-line">
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5">
                  <input type="checkbox" checked={on} disabled={disabled} onChange={() => togglePlatform(pl)} className="size-4 accent-primary" />
                  <span className="text-[13px] font-medium">{PLATFORM_LABEL[pl]}</span>
                  {on && <span className="ml-auto text-[12px] text-faint">{value[field].length} of {options.length} positions</span>}
                </label>
                {on && (
                  <div className="grid gap-1 border-t border-line-soft px-3 py-2.5 sm:grid-cols-2">
                    {options.map((p) => (
                      <label key={p} className="flex cursor-pointer items-center gap-2 text-[12.5px]">
                        <input type="checkbox" checked={value[field].includes(p)} disabled={disabled} onChange={() => togglePosition(field, p)} className="size-3.5 accent-primary" />
                        {positionLabel(p)}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {!anyPosition && <p className="text-[12.5px] text-danger-ink">Choose at least one position.</p>}
        </div>
      )}

      <Field label="Devices">
        <div className="flex gap-4">
          {(["mobile", "desktop"] as const).map((d) => (
            <label key={d} className="flex cursor-pointer items-center gap-2 text-[13px] capitalize">
              <input
                type="checkbox"
                checked={value.devices.includes(d)}
                disabled={disabled || (value.devices.length === 1 && value.devices[0] === d)}
                onChange={() => onChange({ ...value, devices: value.devices.includes(d) ? value.devices.filter((x) => x !== d) : [...value.devices, d] })}
                className="size-4 accent-primary"
              />
              {d}
            </label>
          ))}
        </div>
      </Field>
    </Section>
  );
}

export const placementsValid = (p: Placements) =>
  p.automatic || p.platforms.some((pl) => p[PLATFORM_POSITIONS[pl].field].length > 0);
