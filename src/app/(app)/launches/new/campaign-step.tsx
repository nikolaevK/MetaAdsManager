"use client";

import { CalendarClock, Heart, Megaphone, MousePointerClick, PiggyBank, RotateCcw, ShoppingBag, Smartphone, UserPlus, UserRound, WandSparkles, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { lookupInstagramAccounts, type InstagramOption, type PageOption } from "@/app/(app)/lookups";
import { Choice, MoneyInput, Section, Switch } from "@/app/(app)/campaigns/editor/fields";
import { Button, cn, Field, Input, Select } from "@/components/ui";
import type { BuilderState, CampaignDraft, ParentView } from "@/lib/launch/draft";
import { LAUNCH_OBJECTIVES, type LaunchObjective } from "@/lib/launch/objectives";
import type { TemplateConfig } from "@/lib/launch/spec";
import { BID_STRATEGIES, SPECIAL_AD_CATEGORIES, type BidStrategy } from "@/lib/meta/editor-types";
import { BID_STRATEGY_LABELS, OBJECTIVE_LABELS } from "@/lib/meta/labels";
import { ParentCampaignCard } from "./parent-cards";

const OBJECTIVE_CARDS: Record<LaunchObjective, { icon: LucideIcon; body: string }> = {
  OUTCOME_AWARENESS: { icon: Megaphone, body: "Show ads to people most likely to remember them." },
  OUTCOME_TRAFFIC: { icon: MousePointerClick, body: "Send people to a website or a chat in Messenger, Instagram or WhatsApp." },
  OUTCOME_ENGAGEMENT: { icon: Heart, body: "Get messages, video views or post engagement." },
  OUTCOME_LEADS: { icon: UserPlus, body: "Collect leads for your business on your website." },
  OUTCOME_APP_PROMOTION: { icon: Smartphone, body: "Find people to install your app." },
  OUTCOME_SALES: { icon: ShoppingBag, body: "Find people likely to purchase, on your website or in a chat." },
};

/** Pages the ad account already used come first; Pages only the system user can reach may belong to another client. */
const PAGE_GROUPS = [
  { source: "promoted", label: "Used by this ad account" },
  { source: "business", label: "This ad account's business" },
  { source: "token", label: "Other Pages the system user can access" },
] as const;

const CATEGORY_LABEL: Record<string, string> = {
  CREDIT: "Credit",
  EMPLOYMENT: "Employment",
  HOUSING: "Housing",
  ISSUES_ELECTIONS_POLITICS: "Social issues, elections or politics",
  FINANCIAL_PRODUCTS_SERVICES: "Financial products and services",
};

const BID_HELP: Record<string, string> = {
  LOWEST_COST_WITHOUT_CAP: "Get the most results for your budget.",
  COST_CAP: "Keep the average cost per result around a goal you set on each ad set.",
  LOWEST_COST_WITH_BID_CAP: "Cap the bid in every auction (set on each ad set).",
  LOWEST_COST_WITH_MIN_ROAS: "Aim for a minimum return on ad spend (Conversion value goal).",
};

export function CampaignStep({
  state,
  campaignName,
  currency,
  timeZone,
  templates,
  invalidTemplates,
  pages,
  pagesError,
  onReloadPages,
  setState,
  setCampaign,
  onTemplate,
  parent,
  accountId,
}: {
  state: BuilderState;
  campaignName: string;
  currency: string;
  timeZone: string;
  templates: { id: string; name: string; config: TemplateConfig }[];
  invalidTemplates: { id: string; name: string }[];
  pages: PageOption[] | null;
  pagesError: string | null;
  onReloadPages: () => void;
  setState: (patch: Partial<BuilderState>) => void;
  setCampaign: (patch: Partial<CampaignDraft>) => void;
  onTemplate: (id: string) => void;
  /** Set when the launch adds to an existing campaign / ad set. */
  parent: ParentView | null;
  accountId: string;
}) {
  const c = state.campaign;
  const cbo = c.budgetLevel === "campaign";
  const mode = parent?.target.mode ?? "new";
  const lifetime = c.budgetSchedule === "lifetime";
  const page = pages?.find((p) => p.id === state.pageId);
  const [typing, setTyping] = useState(false);
  const manualPage = !pages || pages.length === 0 || typing || (!!state.pageId && !page);

  return (
    <div className="flex flex-col gap-4">
      <Section title="Identity" icon={UserRound} description="Where the campaign starts from and who the ads run as.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {mode !== "adset" && (
            <Field
              label="Start from a template"
              htmlFor="template"
              hint={
                invalidTemplates.length ? (
                  <span>
                    Incomplete:{" "}
                    {invalidTemplates.map((t, k) => (
                      <span key={t.id}>
                        {k > 0 && ", "}
                        <Link href={`/settings/templates/${t.id}`} className="font-semibold text-primary-ink hover:underline">
                          {t.name}
                        </Link>
                      </span>
                    ))}
                  </span>
                ) : (
                  "Pre-fills objective, budget, pixel, audience, placements and enhancements. Everything stays editable."
                )
              }
            >
              <Select id="template" value={state.templateId} onChange={(e) => onTemplate(e.target.value)}>
                <option value="">No template</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Launch label" htmlFor="label" hint="Fills the {label} token in names, e.g. an angle or offer.">
            <Input id="label" value={state.label} onChange={(e) => setState({ label: e.target.value })} placeholder="e.g. Winter Promo" maxLength={80} />
          </Field>
          <Field
            label={
              <span className="flex items-center justify-between gap-2">
                Facebook Page
                <button type="button" onClick={onReloadPages} className="inline-flex items-center gap-1 text-xs font-medium text-primary-ink hover:underline">
                  <RotateCcw className="size-3" aria-hidden /> Reload
                </button>
              </span>
            }
            htmlFor="page"
            hint={
              pagesError
                ? `Couldn't load Pages (${pagesError}). Enter the Page ID instead.`
                : pages && pages.length === 0
                  ? "Meta returned no Pages for this ad account. Give the system user access to the Page in Business Settings, or enter the Page ID."
                  : undefined
            }
          >
            {pages && pages.length > 0 && (
              <Select
                id="page"
                value={page && !typing ? state.pageId : manualPage ? "__manual" : ""}
                onChange={(e) => {
                  if (e.target.value === "__manual") {
                    setTyping(true);
                    return setState({ pageId: "", igId: "" });
                  }
                  setTyping(false);
                  const p = pages.find((x) => x.id === e.target.value);
                  setState({ pageId: e.target.value, igId: p?.instagram?.id ?? "" });
                }}
              >
                <option value="">Choose a Page</option>
                {PAGE_GROUPS.map((g) => {
                  const list = pages.filter((p) => p.source === g.source);
                  return (
                    list.length > 0 && (
                      <optgroup key={g.source} label={g.label}>
                        {list.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.instagram?.username ? ` · @${p.instagram.username}` : ""}
                          </option>
                        ))}
                      </optgroup>
                    )
                  );
                })}
                <option value="__manual">Other Page (enter ID)…</option>
              </Select>
            )}
            {manualPage && (
              <Input
                id={pages && pages.length > 0 ? "page-id" : "page"}
                className={pages && pages.length > 0 ? "mt-2" : undefined}
                value={state.pageId}
                onChange={(e) => setState({ pageId: e.target.value.replace(/\D/g, "") })}
                placeholder={pages ? "Page ID, e.g. 104523…" : "Loading Pages…"}
                inputMode="numeric"
              />
            )}
          </Field>
          <InstagramField accountId={accountId} page={page} value={state.igId} onChange={(igId) => setState({ igId })} />
        </div>
      </Section>

      {parent && <ParentCampaignCard parent={parent} currency={currency} />}

      {!parent && (
        <Section title="Campaign" icon={Megaphone} description="The objective decides which conversion locations and goals the ad sets can use.">
          <NameField id="campaign-name" label="Campaign name" value={campaignName} edited={c.nameEdited} onChange={(name) => setCampaign({ name, nameEdited: true })} onReset={() => setCampaign({ nameEdited: false })} />
          <div role="radiogroup" aria-label="Objective" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {LAUNCH_OBJECTIVES.map((o) => {
              const { icon: Icon, body } = OBJECTIVE_CARDS[o];
              const on = c.objective === o;
              return (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setCampaign({ objective: o, bidStrategy: o !== "OUTCOME_SALES" && c.bidStrategy === "LOWEST_COST_WITH_MIN_ROAS" ? "LOWEST_COST_WITHOUT_CAP" : c.bidStrategy })}
                  className={cn("flex gap-3 rounded-xl border p-3 text-left transition-colors", on ? "border-primary bg-primary-soft/40 ring-4 ring-[var(--ring)]" : "border-line hover:bg-hover/60")}
                >
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", on ? "bg-primary text-on-primary" : "bg-surface-2 text-muted ring-1 ring-inset ring-line")}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span>
                    <span className="block text-[13.5px] font-medium">{OBJECTIVE_LABELS[o]}</span>
                    <span className="mt-0.5 block text-[12.5px] text-muted">{body}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-medium">Special ad categories</legend>
            <p className="-mt-1 text-[12.5px] text-muted">Declare if ads are about credit, employment, housing, social issues or politics. Targeting options are limited for these.</p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {SPECIAL_AD_CATEGORIES.map((cat) => (
                <label key={cat} className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={c.specialAdCategories.includes(cat)}
                    onChange={() => setCampaign({ specialAdCategories: c.specialAdCategories.includes(cat) ? c.specialAdCategories.filter((x) => x !== cat) : [...c.specialAdCategories, cat] })}
                    className="size-4 accent-primary"
                  />
                  {CATEGORY_LABEL[cat]}
                </label>
              ))}
            </div>
            {c.specialAdCategories.length > 0 && (
              <Field label="Countries where the ads run" hint="Two-letter codes, comma separated." htmlFor="cats">
                <Input id="cats" value={c.specialAdCountries} onChange={(e) => setCampaign({ specialAdCountries: e.target.value })} />
              </Field>
            )}
          </fieldset>
        </Section>
      )}

      {mode === "campaign" && !cbo && (
        <Section title="New ad sets" icon={PiggyBank} description="This campaign has no campaign budget, so each new ad set gets its own budget (set on the Ad sets step) with this schedule and bid strategy.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Budget schedule">
              <Choice
                label="Budget schedule"
                value={c.budgetSchedule}
                onChange={(v) => setCampaign({ budgetSchedule: v })}
                options={[
                  { value: "daily", label: "Daily" },
                  { value: "lifetime", label: "Lifetime" },
                ]}
              />
            </Field>
            <Field label="Bid strategy" hint={BID_HELP[c.bidStrategy]} htmlFor="bid">
              <Select id="bid" value={c.bidStrategy} onChange={(e) => setCampaign({ bidStrategy: e.target.value as BidStrategy })}>
                {BID_STRATEGIES.filter((b) => b !== "LOWEST_COST_WITH_MIN_ROAS" || c.objective === "OUTCOME_SALES").map((b) => (
                  <option key={b} value={b}>
                    {BID_STRATEGY_LABELS[b]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Section>
      )}

      {!parent && (
        <Section title="Budget & bidding" icon={PiggyBank} description="Choose who owns the budget. You can't switch a campaign between the two after it's created.">
          <div role="radiogroup" aria-label="Budget type" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              [
                { level: "campaign", title: "Campaign budget (CBO)", body: "Advantage campaign budget: one budget for the campaign. Meta shifts spend to the best-performing ad sets." },
                { level: "adset", title: "Ad set budget (ABO)", body: "Set a separate budget on each ad set, so every ad set gets exactly what you assign." },
              ] as const
            ).map((o) => (
              <button
                key={o.level}
                type="button"
                role="radio"
                aria-checked={c.budgetLevel === o.level}
                onClick={() => setCampaign({ budgetLevel: o.level })}
                className={cn("rounded-xl border p-3 text-left transition-colors", c.budgetLevel === o.level ? "border-primary bg-primary-soft/40 ring-4 ring-[var(--ring)]" : "border-line hover:bg-hover/60")}
              >
                <span className="flex items-center gap-2 text-[13.5px] font-medium">
                  <span className={cn("grid size-4 place-items-center rounded-full border", c.budgetLevel === o.level ? "border-primary" : "border-line")}>
                    {c.budgetLevel === o.level && <span className="size-2 rounded-full bg-primary" />}
                  </span>
                  {o.title}
                </span>
                <span className="mt-1 block text-[12.5px] text-muted">{o.body}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Budget schedule">
              <Choice
                label="Budget schedule"
                value={c.budgetSchedule}
                onChange={(v) => setCampaign({ budgetSchedule: v })}
                options={[
                  { value: "daily", label: "Daily" },
                  { value: "lifetime", label: "Lifetime" },
                ]}
              />
            </Field>
            {cbo ? (
              <Field label={`${lifetime ? "Lifetime" : "Daily"} campaign budget`} htmlFor="campaign-budget">
                <MoneyInput id="campaign-budget" currency={currency} value={c.budget} onChange={(v) => setCampaign({ budget: v })} />
              </Field>
            ) : (
              <p className="self-end pb-2 text-[12.5px] text-muted">You&apos;ll set a {lifetime ? "lifetime" : "daily"} budget on each ad set.</p>
            )}
            {!cbo && !lifetime && (
              <div className="flex items-start justify-between gap-4 rounded-lg bg-surface-2 p-3 ring-1 ring-inset ring-line-soft sm:col-span-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">Budget sharing</p>
                  <p className="mt-0.5 text-[12.5px] text-muted">Let Meta move up to 20% of each ad set&apos;s daily budget to other ad sets in this campaign when they&apos;re likely to do better.</p>
                </div>
                <Switch on={c.budgetSharing} label="Budget sharing" onChange={(budgetSharing) => setCampaign({ budgetSharing })} />
              </div>
            )}
            <Field label="Bid strategy" hint={BID_HELP[c.bidStrategy]} htmlFor="bid">
              <Select id="bid" value={c.bidStrategy} onChange={(e) => setCampaign({ bidStrategy: e.target.value as BidStrategy })}>
                {BID_STRATEGIES.filter((b) => b !== "LOWEST_COST_WITH_MIN_ROAS" || c.objective === "OUTCOME_SALES").map((b) => (
                  <option key={b} value={b}>
                    {BID_STRATEGY_LABELS[b]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Campaign spending limit" hint="Optional lifetime cap across the campaign." htmlFor="cap">
              <MoneyInput id="cap" currency={currency} value={c.spendCap} placeholder="No limit" onChange={(v) => setCampaign({ spendCap: v })} />
            </Field>
          </div>
        </Section>
      )}

      {mode !== "adset" && (
        <Section title="Schedule" icon={CalendarClock} description={`Applies to every ${mode === "campaign" ? "new " : ""}ad set. Times are in the ad account's timezone (${timeZone}).`}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Start" htmlFor="start" hint="Leave empty to start as soon as it's approved.">
              <Input id="start" type="datetime-local" value={c.start} onChange={(e) => setCampaign({ start: e.target.value })} />
            </Field>
            <Field label={`End${lifetime ? " (required for lifetime budgets)" : " (optional)"}`} htmlFor="end">
              <div className="flex gap-2">
                <Input id="end" type="datetime-local" value={c.end} min={c.start || undefined} onChange={(e) => setCampaign({ end: e.target.value })} />
                {c.end && (
                  <Button variant="ghost" onClick={() => setCampaign({ end: "" })}>
                    Clear
                  </Button>
                )}
              </div>
            </Field>
          </div>
        </Section>
      )}
    </div>
  );
}

/**
 * Instagram identity: the Page's linked account, accounts assigned to the ad account, the Page itself, or an ID.
 * An account the ad account can't use fails with 1815199, so the assigned ones come from Meta rather than guesses.
 */
function InstagramField({ accountId, page, value, onChange }: { accountId: string; page?: PageOption; value: string; onChange: (id: string) => void }) {
  const [accounts, setAccounts] = useState<InstagramOption[] | null>(null);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    let live = true;
    lookupInstagramAccounts(accountId).then((res) => live && setAccounts(res.ok ? res.items : []));
    return () => {
      live = false;
    };
  }, [accountId]);
  const options = [
    ...(page?.instagram ? [{ id: page.instagram.id, label: `@${page.instagram.username ?? page.instagram.id} · linked to the Page` }] : []),
    ...(accounts ?? []).filter((a) => a.id !== page?.instagram?.id).map((a) => ({ id: a.id, label: `@${a.username ?? a.id}` })),
  ];
  const known = !value || options.some((o) => o.id === value);
  const manual = typing || !known;
  return (
    <Field
      label="Instagram account"
      htmlFor="ig"
      hint={
        options.length === 0 && accounts !== null
          ? "No Instagram accounts are assigned to this ad account. Ads on Instagram will run as the Page, or assign one in Business Settings → Accounts → Instagram accounts."
          : "Ads on Instagram run as this account."
      }
    >
      <Select
        id="ig"
        value={manual ? "__manual" : value}
        onChange={(e) => {
          if (e.target.value === "__manual") return setTyping(true);
          setTyping(false);
          onChange(e.target.value);
        }}
      >
        <option value="">Use the Facebook Page</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
        <option value="__manual">Other account (enter ID)…</option>
      </Select>
      {manual && <Input className="mt-2" value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))} placeholder="Instagram account ID" inputMode="numeric" aria-label="Instagram account ID" />}
    </Field>
  );
}

export function NameField({ id, label, value, edited, onChange, onReset }: { id: string; label: string; value: string; edited: boolean; onChange: (v: string) => void; onReset: () => void }) {
  return (
    <Field
      label={
        <span className="flex items-center justify-between gap-2">
          {label}
          {edited ? (
            <button type="button" onClick={onReset} className="inline-flex items-center gap-1 text-xs font-medium text-primary-ink hover:underline">
              <RotateCcw className="size-3" aria-hidden /> Use naming convention
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-normal text-faint">
              <WandSparkles className="size-3" aria-hidden /> From naming convention
            </span>
          )}
        </span>
      }
      htmlFor={id}
    >
      <Input id={id} value={value} maxLength={400} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
