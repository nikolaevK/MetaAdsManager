"use client";

import { ChevronDown, ClipboardList, CopyCheck, Eye, Globe, ImageIcon, Images, MessageCircle, MessageSquareText, Plus, RotateCcw, Smartphone, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { MediaThumb } from "@/app/(app)/library/media-thumb";
import { Enhancements, TextOptions } from "@/app/(app)/campaigns/editor/creative-fields";
import { Choice, Counter, Section, Switch } from "@/app/(app)/campaigns/editor/fields";
import { Button, buttonClass, cn, Field, Input, Select } from "@/components/ui";
import { MAX_ADS, MAX_TEXTS, mediaPick, type AdDraft, type BuilderState } from "@/lib/launch/draft";
import { lookupLeadForms, type LeadFormOption } from "@/app/(app)/lookups";
import { APP_CTAS, LEAD_CTAS, MESSAGING_APP_LABELS, WEBSITE_CTAS, type MessagingApp } from "@/lib/launch/objectives";
import { MAX_FEED_BODY, MAX_FLEXIBLE_FILES } from "@/lib/launch/spec";
import type { BuilderCreative } from "@/lib/queries/launches";
import { CTA_LABELS } from "@/lib/meta/labels";
import { NameField } from "./campaign-step";
import { FlexibleMedia, MediaSlots, type Asset } from "./media";
import { ItemTabs } from "./parts";

const CTA_TEXT: Record<string, string> = { ...CTA_LABELS, INSTALL_MOBILE_APP: "Install now", USE_APP: "Use app", PLAY_GAME: "Play game" };

/** What the ad sets of this launch need from every ad. */
export type AdNeeds = { website: boolean; app: boolean; instantForm: boolean; messaging: MessagingApp[] };

export function AdStep({
  state,
  names,
  accountId,
  clientId,
  assets,
  creatives,
  needs,
  defaultUrlTags,
  active,
  issues,
  canPreview,
  onSelect,
  onAdd,
  onDuplicate,
  onRemove,
  onApplyToAll,
  onPreview,
  patch,
  onAssetsAdded,
}: {
  state: BuilderState;
  names: string[];
  accountId: string;
  clientId: string;
  assets: Asset[];
  creatives: BuilderCreative[];
  needs: AdNeeds;
  defaultUrlTags: string;
  active: number;
  issues: Set<number>;
  canPreview: boolean;
  onSelect: (i: number) => void;
  onAdd: (creative?: BuilderCreative) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onApplyToAll: () => void;
  onPreview: () => void;
  patch: (key: string, patch: Partial<AdDraft> | ((ad: AdDraft) => Partial<AdDraft>)) => void;
  onAssetsAdded: (a: Asset[]) => void;
}) {
  const a = state.ads[active];
  const set = (p: Partial<AdDraft>) => patch(a.key, p);
  const [showLibrary, setShowLibrary] = useState(false);
  const hasMedia = !!mediaPick(a);

  const ctas = needs.website ? WEBSITE_CTAS : needs.app ? APP_CTAS : [];
  const messagingOnly = !needs.website && !needs.app && !needs.instantForm;

  return (
    <div className="flex flex-col gap-4">
      {creatives.length > 0 && (
        <div className="rounded-xl border border-line bg-surface shadow-card">
          <button type="button" onClick={() => setShowLibrary((v) => !v)} aria-expanded={showLibrary} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left">
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <Images className="size-4 text-faint" aria-hidden /> Start an ad from a library creative
              <span className="tabular text-xs font-normal text-faint">{creatives.length}</span>
            </span>
            <ChevronDown className={cn("size-4 text-faint transition-transform", showLibrary && "rotate-180")} aria-hidden />
          </button>
          {showLibrary && (
            <ul className="grid max-h-72 grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3 overflow-y-auto border-t border-line-soft p-4">
              {creatives.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={state.ads.length >= MAX_ADS}
                    onClick={() => onAdd(c)}
                    className="group block w-full overflow-hidden rounded-xl border border-line text-left transition hover:border-primary/50 hover:shadow-card disabled:opacity-50"
                  >
                    <span className="relative block">
                      <MediaThumb id={c.squareAssetId} kind={c.kind} alt={c.name} className="aspect-square w-full" />
                      <span className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-center gap-1 rounded-lg bg-surface/90 py-1 text-xs font-medium shadow-card ring-1 ring-line backdrop-blur transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-visible:opacity-100">
                        <Plus className="size-3.5" aria-hidden /> New ad
                      </span>
                    </span>
                    <span className="block truncate px-2 py-1.5 text-[12px]">{c.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ItemTabs
        noun="Ad"
        items={state.ads.map((x, i) => ({ key: x.key, label: names[i] }))}
        active={active}
        max={MAX_ADS}
        issues={issues}
        onSelect={onSelect}
        onAdd={() => onAdd()}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
        extra={
          <Button size="sm" variant="ghost" disabled={!canPreview || !hasMedia} onClick={onPreview} title={!canPreview ? "Choose a Facebook Page to preview" : !hasMedia ? "Add media to preview" : undefined}>
            <Eye /> Preview
          </Button>
        }
      />

      <Section title="Ad" icon={ImageIcon}>
        <NameField id={`ad-${active}-name`} label="Ad name" value={names[active]} edited={a.nameEdited} onChange={(name) => set({ name, nameEdited: true })} onReset={() => set({ nameEdited: false })} />
      </Section>

      <Section
        title="Media"
        icon={Images}
        description={
          a.format === "flexible"
            ? `Up to ${MAX_FLEXIBLE_FILES} images or videos. Meta shows each person one of them, a carousel or a video, whichever it expects to work best.`
            : "Upload or pick a file for each placement group. Images can be cropped to the right ratio here."
        }
      >
        <Choice
          label="Ad format"
          value={a.format}
          onChange={(format) => set({ format })}
          options={[
            { value: "single", label: "Single image or video" },
            { value: "flexible", label: `Flexible · up to ${MAX_FLEXIBLE_FILES} files` },
          ]}
        />
        {a.format === "flexible" ? (
          <FlexibleMedia key={a.key} clientId={clientId} assets={assets} files={a.files} onAssetsAdded={onAssetsAdded} onChange={(update) => patch(a.key, (x) => ({ files: update(x.files) }))} />
        ) : (
          <MediaSlots
            key={a.key}
            clientId={clientId}
            assets={assets}
            feedAssetId={a.feedAssetId}
            verticalAssetId={a.verticalAssetId}
            onAssetsAdded={onAssetsAdded}
            onSlot={(slot, id) => patch(a.key, slot === "feed" ? { feedAssetId: id } : { verticalAssetId: id })}
          />
        )}
        {needs.messaging.length > 0 && (
          <p className="text-[12px] text-faint">{a.format === "flexible" ? "Flexible format needs ad sets that send people to a website." : "Messaging ad sets use the feed file for every placement."}</p>
        )}
      </Section>

      <Section
        title="Text"
        icon={MessageSquareText}
        description={`Add up to ${MAX_TEXTS} primary texts and headlines. Meta shows the best combination to each person.${needs.messaging.length ? " Messaging ad sets use the first of each." : ""}`}
      >
        <TextOptions
          label="Primary text"
          values={a.primaryTexts}
          // Several texts, a Stories & Reels file or Flexible put the texts in an asset feed, which caps them lower.
          max={a.primaryTexts.length > 1 || a.headlines.length > 1 || a.format === "flexible" || !!a.verticalAssetId ? MAX_FEED_BODY : 2200}
          limit={MAX_TEXTS}
          multiline
          placeholder="Tell people what your ad is about"
          onChange={(primaryTexts) => set({ primaryTexts })}
        />
        <TextOptions label="Headline" values={a.headlines} max={255} limit={MAX_TEXTS} placeholder="Write a short headline" onChange={(headlines) => set({ headlines })} />
        <Field label={<span className="flex items-center justify-between">Description <Counter value={a.description} max={255} /></span>} hint="Optional. Shown under the headline in some placements.">
          <Input value={a.description} maxLength={255} onChange={(e) => set({ description: e.target.value })} />
        </Field>
      </Section>

      <Section title="Destination" icon={needs.website ? Globe : needs.instantForm ? ClipboardList : needs.app ? Smartphone : MessageCircle} description="Where people go when they tap the ad. The conversion location is set on each ad set.">
        {needs.website && (
          <div className="flex flex-col gap-4">
            <p className="flex items-center gap-1.5 text-[13px] font-medium">
              <Globe className="size-3.5 text-faint" aria-hidden /> Website
            </p>
            <Field label="Website URL" error={a.url && !/^https?:\/\/[^\s.]+\.[^\s]+$/.test(a.url) ? "Enter a full URL starting with https://" : undefined}>
              <Input type="url" placeholder="https://example.com/product" value={a.url} onChange={(e) => set({ url: e.target.value.trim() })} />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Display link" hint="Optional. Shown instead of the full URL, e.g. example.com/offer">
                <Input value={a.displayLink} maxLength={100} placeholder="example.com" onChange={(e) => set({ displayLink: e.target.value })} />
              </Field>
              <Field label="Call to action">
                <Select value={a.cta} onChange={(e) => set({ cta: e.target.value })}>
                  {[...new Set([...ctas, ...(ctas.includes(a.cta as never) ? [] : [a.cta])])].map((c) => (
                    <option key={c} value={c}>
                      {CTA_TEXT[c] ?? c}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field
              label={
                <span className="flex items-center justify-between gap-2">
                  URL parameters
                  {a.urlTags !== defaultUrlTags && (
                    <button type="button" onClick={() => set({ urlTags: defaultUrlTags })} className="inline-flex items-center gap-1 text-xs font-medium text-primary-ink hover:underline">
                      <RotateCcw className="size-3" aria-hidden /> Client default
                    </button>
                  )}
                </span>
              }
              hint="Appended to the website URL for tracking, e.g. utm_source=facebook&utm_campaign={{campaign.name}}"
            >
              <Input value={a.urlTags} className="font-mono text-[12.5px]" onChange={(e) => set({ urlTags: e.target.value })} />
            </Field>
          </div>
        )}
        {needs.instantForm && (
          <LeadFormFields
            accountId={accountId}
            pageId={state.pageId}
            value={a.leadFormId}
            cta={a.cta}
            showCta={!needs.website && !needs.app}
            onChange={(p) => set(p)}
          />
        )}
        {needs.app && (
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-1.5 text-[13px] font-medium">
              <Smartphone className="size-3.5 text-faint" aria-hidden /> App
            </p>
            <p className="text-[12.5px] text-muted">Taps go to the app store link chosen on the ad set.</p>
            {!needs.website && (
              <Field label="Call to action">
                <Select value={(APP_CTAS as readonly string[]).includes(a.cta) ? a.cta : "INSTALL_MOBILE_APP"} onChange={(e) => set({ cta: e.target.value })}>
                  {APP_CTAS.map((c) => (
                    <option key={c} value={c}>
                      {CTA_TEXT[c] ?? c}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        )}
        {needs.messaging.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="flex items-center gap-1.5 text-[13px] font-medium">
              <MessageCircle className="size-3.5 text-faint" aria-hidden /> Messaging apps
            </p>
            <p className="text-[12.5px] text-muted">
              Taps open a chat in {needs.messaging.map((m) => MESSAGING_APP_LABELS[m]).join(", ")}. The button (e.g. “Send message”) is set by Meta for each app
              {messagingOnly ? ", so there's no website or call to action to fill in." : "."}
            </p>
          </div>
        )}
        {state.ads.length > 1 && (
          <div>
            <button type="button" onClick={onApplyToAll} className={buttonClass("subtle", "sm")}>
              <CopyCheck /> Apply this text, destination and automation settings to all ads
            </button>
          </div>
        )}
      </Section>

      <Section title="Meta automations" icon={Sparkles} description="Placements and destinations Meta adds unless the ad says otherwise.">
        <AutomationToggle
          label="Multi-advertiser ads"
          body="Meta may show this ad in a unit next to other businesses' ads (e.g. after someone engages with a similar ad)."
          on={a.multiAdvertiser}
          onChange={(multiAdvertiser) => set({ multiAdvertiser })}
        />
        {needs.website && (
          <AutomationToggle
            label="Send people to your shop when it fits"
            body="If the business has a Facebook or Instagram shop, Meta may open it instead of the website. Off = always the website."
            on={a.shopDestination}
            onChange={(shopDestination) => set({ shopDestination })}
          />
        )}
      </Section>

      <Enhancements value={a.features} onChange={(features) => set({ features })} />
    </div>
  );
}

/** Instant-form ads open a form on the ad's Page; forms are read from the Page (needs the system user on the Page). */
function LeadFormFields({
  accountId,
  pageId,
  value,
  cta,
  showCta,
  onChange,
}: {
  accountId: string;
  pageId: string;
  value: string;
  cta: string;
  showCta: boolean;
  onChange: (p: Partial<AdDraft>) => void;
}) {
  const [forms, setForms] = useState<{ pageId: string; items: LeadFormOption[] | null; error?: string } | null>(null);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!/^\d+$/.test(pageId)) return;
    let live = true;
    lookupLeadForms(accountId, pageId).then((res) => live && setForms(res.ok ? { pageId, items: res.items } : { pageId, items: [], error: res.error }));
    return () => {
      live = false;
    };
  }, [accountId, pageId]);
  const current = forms?.pageId === pageId ? forms : null;
  const list = current?.items ?? [];
  const manual = typing || (!!value && !list.some((f) => f.id === value)) || (current !== null && list.length === 0);
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-1.5 text-[13px] font-medium">
        <ClipboardList className="size-3.5 text-faint" aria-hidden /> Instant form
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Form"
          hint={
            !pageId
              ? "Choose the Facebook Page on the Campaign step first."
              : current?.error
                ? `Couldn't load the Page's forms (${current.error}). Enter the form ID instead.`
                : current && list.length === 0
                  ? "This Page has no instant forms yet. Create one in Meta (Page → Publishing tools → Forms library), then enter its ID."
                  : "Forms come from the ad's Facebook Page."
          }
        >
          {!manual && (
            <Select
              value={value}
              disabled={!current}
              onChange={(e) => (e.target.value === "__manual" ? setTyping(true) : onChange({ leadFormId: e.target.value }))}
            >
              <option value="">{current ? "Choose a form" : "Loading forms…"}</option>
              {list.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.active ? "" : " (archived)"}
                </option>
              ))}
              <option value="__manual">Other form (enter ID)…</option>
            </Select>
          )}
          {manual && <Input value={value} inputMode="numeric" placeholder="Form ID" aria-label="Instant form ID" onChange={(e) => onChange({ leadFormId: e.target.value.replace(/\D/g, "") })} />}
        </Field>
        {showCta && (
          <Field label="Call to action">
            <Select value={(LEAD_CTAS as readonly string[]).includes(cta) ? cta : LEAD_CTAS[0]} onChange={(e) => onChange({ cta: e.target.value })}>
              {LEAD_CTAS.map((c) => (
                <option key={c} value={c}>
                  {CTA_TEXT[c] ?? c}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <p className="text-[12.5px] text-muted">Instant-form ads use the feed file for every placement and the first primary text and headline.</p>
    </div>
  );
}

function AutomationToggle({ label, body, on, onChange }: { label: string; body: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{label}</p>
        <p className="mt-0.5 text-[12.5px] text-muted">{body}</p>
      </div>
      <Switch on={on} label={label} onChange={onChange} />
    </div>
  );
}
