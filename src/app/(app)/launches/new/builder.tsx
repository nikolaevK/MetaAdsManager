"use client";

import { ArrowLeft, ArrowRight, Check, CloudOff, LoaderCircle, Rocket, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { baseName } from "@/app/(app)/library/pairing";
import { lookupPages, type PageOption } from "@/app/(app)/lookups";
import { useConfirm } from "@/components/confirm-dialog";
import { Alert, Button, Card, cn } from "@/components/ui";
import { formatMoney, formatRelative } from "@/lib/format";
import {
  applyTemplate,
  blankAd,
  blankAdset,
  computeNames,
  launchIssues,
  MAX_ADS,
  mediaPick,
  MAX_ADSETS,
  newKey,
  positiveNumber,
  resolveAdset,
  STEPS,
  toLaunchInput,
  withParent,
  type AdDraft,
  type AdsetDraft,
  type BuilderState,
  type CampaignDraft,
  type ParentView,
} from "@/lib/launch/draft";
import type { MessagingApp } from "@/lib/launch/objectives";
import type { MediaPick } from "@/lib/launch/spec";
import type { BuilderAsset, BuilderCreative, BuilderTemplate } from "@/lib/queries/launches";
import { OBJECTIVE_LABELS } from "@/lib/meta/labels";
import { createLaunchAction, deleteDraftAction, previewDraftAction, saveDraftAction } from "../actions";
import { PreviewDialog, type FormatOption } from "../preview-dialog";
import { AdStep, type AdNeeds } from "./ad-step";
import { AdsetStep } from "./adset-step";
import { CampaignStep } from "./campaign-step";
import type { Asset } from "./media";
import { issueItem, ReviewStep } from "./review-step";

type Props = {
  client: { id: string; name: string };
  account: { id: string; name: string; currency: string; timezoneName: string };
  templates: BuilderTemplate[];
  invalidTemplates: { id: string; name: string }[];
  creatives: BuilderCreative[];
  assets: BuilderAsset[];
  naming: { campaignPattern: string; adsetPattern: string; adPattern: string };
  urlTags: string;
  dateToken: string;
  formats: readonly FormatOption[];
  initialState: BuilderState;
  draftId: string | null;
  /** The existing campaign / ad set this launch adds to, read live from Meta (null for a new campaign). */
  parent: ParentView | null;
};

type SaveState = { status: "idle" | "pending" | "saving" | "saved" | "error"; at?: number; error?: string };

const AUTOSAVE_MS = 800;
/** Validation runs before a real idempotency key exists; one is generated per submitted version of the campaign. */
const PLACEHOLDER_KEY = "00000000-0000-4000-8000-000000000000";

/**
 * With Cache Components, Next keeps visited pages alive (React Activity), so without a key the next
 * "New campaign" would come back with the previous campaign's state and idempotency key. `bfcacheId`
 * changes on every push/replace navigation (fresh builder) but not on Back/Forward, refreshes, or the
 * search-param-only `?draft=` update below (state kept). Don't key on server data here: server actions
 * re-render this page (the session cookie is refreshed on every request), so a per-render key would remount
 * the builder after every action.
 */
export function LaunchBuilder(props: Props) {
  const { bfcacheId } = useRouter();
  return <Builder key={`${props.account.id}:${bfcacheId}`} {...props} />;
}

function Builder(props: Props) {
  const { client, account, templates } = props;
  const router = useRouter();
  const [state, setStateRaw] = useState(props.initialState);
  const [assets, setAssets] = useState<Asset[]>(props.assets);
  const [activeAdset, setActiveAdset] = useState(0);
  const [activeAd, setActiveAd] = useState(0);
  const [pages, setPages] = useState<PageOption[] | null>(null);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const template = templates.find((t) => t.id === state.templateId);
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const step = Math.min(Math.max(state.step, 0), STEPS.length - 1);

  // ── State updates ─────────────────────────────────────────────────────────
  const setState = useCallback((patch: Partial<BuilderState> | ((s: BuilderState) => BuilderState)) => setStateRaw((s) => (typeof patch === "function" ? patch(s) : { ...s, ...patch })), []);
  const setCampaign = (patch: Partial<CampaignDraft>) => setState((s) => ({ ...s, campaign: { ...s.campaign, ...patch } }));
  const patchAdset = (key: string, patch: Partial<AdsetDraft>) => setState((s) => ({ ...s, adsets: s.adsets.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
  const patchAd = (key: string, patch: Partial<AdDraft> | ((ad: AdDraft) => Partial<AdDraft>)) =>
    setState((s) => ({ ...s, ads: s.ads.map((x) => (x.key === key ? { ...x, ...(typeof patch === "function" ? patch(x) : patch) } : x)) }));
  const goTo = (n: number) => {
    setState({ step: n });
    // The app scrolls <main>, not the window: bring the step rail back into view.
    document.getElementById("builder-steps")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ── Pages ─────────────────────────────────────────────────────────────────
  /** Set when the builder itself changes state (not the user), so that change alone doesn't create a draft. */
  const quiet = useRef(false);
  const fetchPages = useCallback(
    (fresh?: boolean) =>
      lookupPages(account.id, fresh).then((res) => {
        if (res.ok) {
          setPages(res.items);
          setPagesError(null);
          // Nothing chosen yet and exactly one Page: use it.
          if (res.items.length === 1)
            setState((s) => {
              if (s.pageId) return s;
              quiet.current = true;
              return { ...s, pageId: res.items[0].id, igId: res.items[0].instagram?.id ?? "" };
            });
        } else {
          setPages([]);
          setPagesError(res.error);
        }
      }),
    [account.id, setState],
  );
  useEffect(() => {
    void fetchPages();
  }, [fetchPages]);
  const reloadPages = () => {
    setPages(null);
    void fetchPages(true);
  };

  // ── Names, input and issues ───────────────────────────────────────────────
  /** Naming info for an ad's files: the matching library creative if there is one, else the feed file. */
  const creativeFor = useCallback(
    (m: MediaPick) => {
      const vertical = m.verticalAssetId ?? m.feedAssetId;
      const lib = props.creatives.find((c) => c.squareAssetId === m.feedAssetId && c.verticalAssetId === vertical);
      if (lib) return lib;
      const file = assetById.get(m.feedAssetId);
      return file ? { name: baseName(file.fileName), angle: null, kind: file.kind } : undefined;
    },
    [props.creatives, assetById],
  );
  const names = useMemo(
    () => computeNames(state, { client: client.name, account: account.name, template: template?.name, dateToken: props.dateToken, patterns: props.naming, creative: creativeFor }),
    [state, client.name, account.name, template?.name, props.dateToken, props.naming, creativeFor],
  );

  // ── Autosave ──────────────────────────────────────────────────────────────
  const [draftId, setDraftId] = useState(props.draftId);
  const [save, setSave] = useState<SaveState>({ status: props.draftId ? "saved" : "idle" });
  const draftRef = useRef(props.draftId);
  const lastSaved = useRef(JSON.stringify(props.initialState));
  const queue = useRef<Promise<void>>(Promise.resolve());
  const deleted = useRef(false);
  const latest = useRef({ state, name: names.campaign });
  useEffect(() => {
    latest.current = { state, name: names.campaign };
  });

  /** Saves run one after another, so the first save's draft id is known before the next one starts. */
  const persist = useCallback(
    (json: string) => {
      queue.current = queue.current.then(async () => {
        if (deleted.current || json === lastSaved.current) return;
        setSave((s) => ({ ...s, status: "saving" }));
        const res = await saveDraftAction({ id: draftRef.current ?? undefined, clientId: client.id, adAccountId: account.id, name: latest.current.name, state: JSON.parse(json) });
        if (!res.ok) return setSave({ status: "error", error: res.error });
        lastSaved.current = json;
        if (draftRef.current !== res.id) {
          draftRef.current = res.id;
          setDraftId(res.id);
          window.history.replaceState(null, "", `/launches/new?draft=${res.id}`);
        }
        setSave({ status: "saved", at: res.savedAt });
      });
    },
    [client.id, account.id],
  );

  useEffect(() => {
    const json = JSON.stringify(state);
    if (json === lastSaved.current || deleted.current) return;
    if (quiet.current) {
      quiet.current = false;
      // Opening the builder shouldn't leave a draft behind just because a Page was picked automatically.
      if (!draftRef.current) {
        lastSaved.current = json;
        return;
      }
    }
    setSave((s) => ({ ...s, status: "pending" }));
    const timer = setTimeout(() => persist(json), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [state, persist]);

  // Navigating away hides this page (React Activity) and cancels the debounce: save what's pending right away.
  useLayoutEffect(
    () => () => {
      const json = JSON.stringify(latest.current.state);
      if (json !== lastSaved.current && !deleted.current) persist(json);
    },
    [persist],
  );

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (JSON.stringify(state) !== lastSaved.current && !deleted.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);

  const input = useMemo(
    () => toLaunchInput(state, names, { idempotencyKey: PLACEHOLDER_KEY, draftId: draftId ?? undefined, clientId: client.id, adAccountId: account.id, timeZone: account.timezoneName }),
    [state, names, draftId, client.id, account.id, account.timezoneName],
  );
  const { data, issues } = useMemo(() => launchIssues(input, (id) => assetById.get(id)), [input, assetById]);
  const issueCount = [0, 0, 0, 0];
  const adsetIssues = new Set<number>();
  const adIssues = new Set<number>();
  for (const i of issues) {
    issueCount[i.step === "campaign" ? 0 : i.step === "adsets" ? 1 : 2]++;
    if (i.step === "adsets") adsetIssues.add(issueItem(i.where));
    if (i.step === "ads") adIssues.add(issueItem(i.where));
  }

  // ── Ad set / ad list operations ───────────────────────────────────────────
  const adsetIndex = Math.min(activeAdset, state.adsets.length - 1);
  const adIndex = Math.min(activeAd, state.ads.length - 1);
  const addAdset = () => {
    const last = state.adsets.at(-1);
    const fresh = last ? { ...structuredClone(last), key: newKey(), name: "", nameEdited: false } : blankAdset(state.campaign.objective, template?.config);
    setState((s) => ({ ...s, adsets: [...s.adsets, fresh].slice(0, MAX_ADSETS) }));
    setActiveAdset(state.adsets.length);
  };
  const duplicateAdset = () => {
    const src = state.adsets[adsetIndex];
    setState((s) => ({ ...s, adsets: [...s.adsets.slice(0, adsetIndex + 1), { ...structuredClone(src), key: newKey(), nameEdited: false }, ...s.adsets.slice(adsetIndex + 1)].slice(0, MAX_ADSETS) }));
    setActiveAdset(adsetIndex + 1);
  };
  const removeAdset = () => {
    setState((s) => ({ ...s, adsets: s.adsets.filter((_, j) => j !== adsetIndex) }));
    setActiveAdset(Math.max(0, adsetIndex - 1));
  };
  const addAd = (c?: BuilderCreative) => {
    const fresh = blankAd(state.ads[adIndex], template?.config);
    const media = c ? { feedAssetId: c.squareAssetId, verticalAssetId: c.verticalAssetId === c.squareAssetId ? "" : c.verticalAssetId } : null;
    // The first ad is often still empty: fill it instead of adding a second one.
    const replaceEmpty = !!media && state.ads.length === 1 && !mediaPick(state.ads[0]);
    setState((s) => ({ ...s, ads: replaceEmpty ? [{ ...s.ads[0], ...media }] : [...s.ads, { ...fresh, ...media }].slice(0, MAX_ADS) }));
    setActiveAd(replaceEmpty ? 0 : state.ads.length);
  };
  const duplicateAd = () => {
    const src = state.ads[adIndex];
    setState((s) => ({ ...s, ads: [...s.ads.slice(0, adIndex + 1), { ...structuredClone(src), key: newKey(), nameEdited: false }, ...s.ads.slice(adIndex + 1)].slice(0, MAX_ADS) }));
    setActiveAd(adIndex + 1);
  };
  const removeAd = () => {
    setState((s) => ({ ...s, ads: s.ads.filter((_, i) => i !== adIndex) }));
    setActiveAd(Math.max(0, adIndex - 1));
  };
  const applyToAll = () => {
    const a = state.ads[adIndex];
    setState((s) => ({
      ...s,
      ads: s.ads.map((x) => ({
        ...x,
        primaryTexts: [...a.primaryTexts],
        headlines: [...a.headlines],
        description: a.description,
        url: a.url,
        displayLink: a.displayLink,
        urlTags: a.urlTags,
        cta: a.cta,
        leadFormId: a.leadFormId,
        features: [...a.features],
        multiAdvertiser: a.multiAdvertiser,
        shopDestination: a.shopDestination,
      })),
    }));
  };

  const needs: AdNeeds = (() => {
    const resolved = state.adsets.map((s) => ({ s, r: resolveAdset(state.campaign.objective, s) }));
    const apps = new Set<MessagingApp>(resolved.flatMap(({ s, r }) => (r.destination === "messaging" ? s.messagingApps : [])));
    return {
      website: resolved.some(({ r }) => r.destination === "website" || r.destination === "on_ad"),
      app: resolved.some(({ r }) => r.destination === "app"),
      instantForm: resolved.some(({ r }) => r.destination === "instant_form"),
      messaging: [...apps],
    };
  })();

  // ── Submit / delete ───────────────────────────────────────────────────────
  /** The idempotency key belongs to one version of the campaign: re-submitting it (double click, or Back then Create) is absorbed; any edit makes a new launch. */
  const submitted = useRef<{ json: string; key: string } | null>(null);
  const submit = () => {
    if (!data) return;
    setError(null);
    const json = JSON.stringify(input);
    if (submitted.current?.json !== json) submitted.current = { json, key: crypto.randomUUID() };
    const idempotencyKey = submitted.current.key;
    startTransition(async () => {
      const res = await createLaunchAction({ ...input, idempotencyKey });
      if (res && !res.ok) setError(res.error ?? "Could not create the launch.");
    });
  };
  const confirm = useConfirm();
  const deleteDraft = async () => {
    if (!(await confirm({ title: "Delete this draft?", body: "This can't be undone.", confirmLabel: "Delete draft", tone: "danger" }))) return;
    startTransition(async () => {
      // Stop autosave first and let an in-flight save land, so nothing re-creates the draft after it's deleted.
      deleted.current = true;
      await queue.current;
      if (draftRef.current) await deleteDraftAction(draftRef.current);
      setSave({ status: "error", error: "draft deleted" });
      router.push("/launches");
    });
  };

  const c = state.campaign;
  const mode = state.target.mode;
  const cbo = c.budgetLevel === "campaign";
  const totalBudget = cbo ? (positiveNumber(c.budget) ?? 0) : state.adsets.reduce((t, s) => t + (positiveNumber(s.budget) ?? 0), 0);
  const totalAds = state.adsets.length * state.ads.length;
  const page = pages?.find((p) => p.id === state.pageId);
  const last = step === STEPS.length - 1;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-4">
        <StepRail step={step} issues={issueCount} onGo={goTo} />

        {step === 0 && (
          <CampaignStep
            state={state}
            campaignName={names.campaign}
            currency={account.currency}
            timeZone={account.timezoneName}
            templates={templates}
            invalidTemplates={props.invalidTemplates}
            pages={pages}
            pagesError={pagesError}
            onReloadPages={reloadPages}
            setState={setState}
            setCampaign={setCampaign}
            onTemplate={(id) => {
              const t = templates.find((x) => x.id === id);
              // A template never changes an existing campaign's settings; it only prefills the new ad sets and ads.
              setState((s) => (t ? (props.parent ? withParent(applyTemplate(s, t), props.parent) : applyTemplate(s, t)) : { ...s, templateId: "" }));
            }}
            parent={props.parent}
            accountId={account.id}
          />
        )}
        {step === 1 && (
          <AdsetStep
            state={state}
            names={names.adsets}
            accountId={account.id}
            currency={account.currency}
            active={adsetIndex}
            issues={adsetIssues}
            onSelect={setActiveAdset}
            onAdd={addAdset}
            onDuplicate={duplicateAdset}
            onRemove={removeAdset}
            patch={patchAdset}
            parent={props.parent}
          />
        )}
        {step === 2 && (
          <AdStep
            state={state}
            names={names.ads}
            accountId={account.id}
            clientId={client.id}
            assets={assets}
            creatives={props.creatives}
            needs={needs}
            defaultUrlTags={props.urlTags}
            active={adIndex}
            issues={adIssues}
            canPreview={!!state.pageId}
            onSelect={setActiveAd}
            onAdd={addAd}
            onDuplicate={duplicateAd}
            onRemove={removeAd}
            onApplyToAll={applyToAll}
            onPreview={() => setPreviewIndex(adIndex)}
            patch={patchAd}
            onAssetsAdded={(list) => setAssets((prev) => [...list.filter((a) => !prev.some((p) => p.id === a.id)), ...prev])}
          />
        )}
        {step === 3 && (
          <ReviewStep
            state={state}
            parent={props.parent}
            names={names}
            issues={issues}
            currency={account.currency}
            asset={(id) => assetById.get(id)}
            pageName={page?.name}
            onJump={(s, item) => {
              if (s === 1) setActiveAdset(item);
              if (s === 2) setActiveAd(item);
              goTo(s);
            }}
          />
        )}

        {/* Navigation: Back / Next, and publish on the last step */}
        <div className="sticky bottom-0 z-20 -mx-4 border-t border-line bg-canvas/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 xl:mx-0 xl:rounded-xl xl:border xl:px-4">
          {error && (
            <div className="mb-3">
              <Alert>
                <span className="whitespace-pre-line">{error}</span>
              </Alert>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" disabled={step === 0} onClick={() => goTo(step - 1)}>
              <ArrowLeft /> Back
            </Button>
            <SaveIndicator save={save} className="min-w-0 truncate max-sm:hidden" />
            {last ? (
              <Button variant="create" onClick={submit} disabled={pending || !data || issues.length > 0}>
                <Rocket /> {pending ? "Creating…" : "Create paused launch"}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => goTo(step + 1)}>
                {STEPS[step + 1].label} <ArrowRight />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Summary */}
      <aside className="min-w-0 max-xl:hidden xl:sticky xl:top-6 xl:self-start">
        <Card className="overflow-hidden">
          <div className="px-5 pb-4 pt-5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-faint">{mode === "new" ? "Summary" : mode === "campaign" ? "Adding ad sets to" : "Adding ads to"}</p>
            <p className="mt-1.5 break-words text-[14.5px] font-semibold leading-snug tracking-tight">{(mode === "adset" ? names.adsets[0] : names.campaign) || "Untitled campaign"}</p>
            <p className="mt-0.5 text-xs text-muted">
              {OBJECTIVE_LABELS[c.objective]} · {cbo ? "Campaign budget (CBO)" : "Ad set budgets (ABO)"}
            </p>
          </div>
          <dl className="flex flex-col gap-2 border-t border-dashed border-line px-5 py-4 text-[13px]">
            <LineItem label={mode === "new" ? "Campaign" : "New campaign"} value={mode === "new" ? 1 : 0} />
            <LineItem label={`${mode === "adset" ? "New ad set" : "Ad set"}${state.adsets.length === 1 ? "" : "s"}`} value={mode === "adset" ? 0 : state.adsets.length} />
            <LineItem label={`Ad${totalAds === 1 ? "" : "s"}`} detail={state.adsets.length > 1 && state.ads.length > 0 ? `${state.ads.length} × ${state.adsets.length}` : undefined} value={totalAds} />
          </dl>
          {!(mode !== "new" && cbo) && mode !== "adset" && (
            <div className="flex items-baseline justify-between gap-3 border-t border-line bg-surface-2 px-5 py-4">
              <p className="text-[13px] font-medium">
                {c.budgetSchedule === "lifetime" ? "Lifetime" : "Daily"} budget{mode === "campaign" ? " (new ad sets)" : ""}
              </p>
              <p className="tabular shrink-0 text-xl font-semibold tracking-tight">{formatMoney(totalBudget, account.currency)}</p>
            </div>
          )}
          <div className="flex flex-col gap-3 border-t border-line-soft p-5">
            <SaveIndicator save={save} />
            <p className="flex gap-2 text-xs text-muted">
              <ShieldCheck className="mt-px size-4 shrink-0 text-success" aria-hidden />
              <span>
                Everything is created <span className="font-medium text-ink">paused</span>. Nothing goes live until an admin approves.
              </span>
            </p>
            {draftId && (
              <Button size="sm" variant="ghost" className="w-fit text-muted" onClick={deleteDraft} disabled={pending}>
                <Trash2 /> Delete draft
              </Button>
            )}
          </div>
        </Card>
      </aside>

      {previewIndex !== null && input.ads[previewIndex] && (
        <PreviewDialog
          title={`Preview · ${names.ads[previewIndex]}`}
          formats={props.formats}
          onClose={() => setPreviewIndex(null)}
          load={(format) =>
            previewDraftAction({
              clientId: client.id,
              adAccountId: account.id,
              pageId: state.pageId,
              instagramUserId: state.igId || undefined,
              adset: input.adsets[0],
              ad: input.ads[previewIndex],
              format,
            })
          }
        />
      )}
    </div>
  );
}

/** Numbered steps; any step can be opened at any time. Counts show what still blocks publishing. */
function StepRail({ step, issues, onGo }: { step: number; issues: number[]; onGo: (n: number) => void }) {
  return (
    <nav id="builder-steps" aria-label="Builder steps" className="scroll-mt-6 overflow-x-auto rounded-xl border border-line bg-surface p-1.5 shadow-card">
      {/* Phones only show the current step's label in the rail; say where you are in words too. */}
      <p className="px-1.5 pb-1.5 text-xs text-muted sm:hidden" aria-hidden>
        Step {step + 1} of {STEPS.length} · <span className="font-medium text-ink">{STEPS[step].label}</span>
      </p>
      <ol className="flex min-w-max items-center gap-1">
        {STEPS.map((s, i) => {
          const done = i < STEPS.length - 1 && issues[i] === 0;
          return (
            <li key={s.id} className="flex flex-1 items-center gap-1">
              {i > 0 && <span aria-hidden className={cn("h-px min-w-3 flex-1", i <= step ? "bg-primary/40" : "bg-line")} />}
              <button
                type="button"
                onClick={() => onGo(i)}
                aria-current={i === step ? "step" : undefined}
                className={cn(
                  "flex h-8 items-center gap-2 whitespace-nowrap rounded-lg px-1.5 text-[13px] font-medium transition-colors sm:px-2.5",
                  i === step ? "bg-primary-soft text-primary-ink" : "text-muted hover:bg-hover hover:text-ink",
                )}
              >
                <span
                  className={cn(
                    "tabular grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ring-1 ring-inset",
                    i === step ? "bg-primary text-on-primary ring-primary" : done ? "bg-success-soft text-success-ink ring-success/30" : "bg-surface-2 text-muted ring-line",
                  )}
                >
                  {done && i !== step ? <Check className="size-3" strokeWidth={3} aria-hidden /> : i + 1}
                </span>
                <span className={cn(i !== step && "max-sm:sr-only")}>{s.label}</span>
                {issues[i] > 0 && i < STEPS.length - 1 && (
                  <span className="tabular rounded-full bg-warning-soft px-1.5 text-[11px] font-semibold leading-5 text-warning-ink" title={`${issues[i]} to fix`}>
                    {issues[i]}
                    <span className="sr-only"> to fix</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SaveIndicator({ save, className }: { save: SaveState; className?: string }) {
  const content =
    save.status === "saving" || save.status === "pending" ? (
      <>
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Saving draft…
      </>
    ) : save.status === "saved" ? (
      <>
        <Check className="size-3.5 text-success" aria-hidden /> Draft saved{save.at ? ` ${formatRelative(save.at)}` : ""}
      </>
    ) : save.status === "error" ? (
      <span className="text-danger-ink">
        <CloudOff className="mr-1 inline size-3.5" aria-hidden />
        Not saved: {save.error}
      </span>
    ) : (
      "Changes are saved as a draft automatically"
    );
  return (
    <p className={cn("flex items-center gap-1.5 text-xs text-muted", className)} aria-live="polite">
      {content}
    </p>
  );
}

function LineItem({ label, detail, value }: { label: string; detail?: string; value: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-muted">{label}</dt>
      {detail && <span className="truncate text-xs text-faint">{detail}</span>}
      <span aria-hidden className="mx-1 min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-line" />
      <dd className="tabular shrink-0 font-medium">{value}</dd>
    </div>
  );
}
