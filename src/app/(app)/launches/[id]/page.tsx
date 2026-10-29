import {
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  Boxes,
  Building2,
  Check,
  Hourglass,
  Image as ImageIcon,
  Layers,
  Link2,
  LoaderCircle,
  Megaphone,
  PencilLine,
  RectangleHorizontal,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Alert, Avatar, Badge, buttonClass, Card, CardHeader, cn, EmptyState, PageSkeleton, type Tone } from "@/components/ui";
import { hasRole } from "@/lib/auth/session";
import type { LaunchStatus } from "@/lib/db/schema";
import { formatDateTime, formatMoney, formatRelative } from "@/lib/format";
import { DESTINATION_LABELS, MESSAGING_APP_LABELS, needsWebsite } from "@/lib/launch/objectives";
import { creativeGroups } from "@/lib/launch/payloads";
import { CREATIVE_FEATURES, type LaunchSpec } from "@/lib/launch/spec";
import { DEFAULT_PLACEMENTS } from "@/lib/meta/editor-types";
import { BID_STRATEGY_LABELS, CTA_LABELS, label, OBJECTIVE_LABELS, OPTIMIZATION_LABELS } from "@/lib/meta/labels";
import { PREVIEW_FORMATS } from "@/lib/meta/previews";
import { getLaunchDetail } from "@/lib/queries/launches";
import { getWorkspace } from "@/lib/workspace";
import { IN_FLIGHT, LAUNCH_STATUS, PIPELINE_STEPS, type StepState } from "../status";
import { AdPreviewButton, AutoRefresh, LaunchActions } from "./launch-controls";

export const metadata: Metadata = { title: "Launch" };

export default function LaunchPage(props: PageProps<"/launches/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LaunchDetail params={props.params} />
    </Suspense>
  );
}

type Ledger = NonNullable<Awaited<ReturnType<typeof getLaunchDetail>>>["ledger"];

/** Derives the stepper from status + ledger. "deleted" rows still count: they were created, then rolled back. */
function pipelineStates(status: LaunchStatus, spec: LaunchSpec, ledger: Ledger): StepState[] {
  const made = (kind: string) => ledger.filter((r) => r.kind === kind && (r.status === "created" || r.status === "deleted")).length;
  const built = ["ready_for_review", "activating", "active", "activation_failed"].includes(status);
  const done = [
    built || ledger.length > 0,
    built || made("creative") >= spec.ads.length * creativeGroups(spec, DEFAULT_PLACEMENTS).count,
    built || made("campaign") >= 1,
    built || made("adset") >= spec.adsets.length,
    built || made("ad") >= spec.adsets.length * spec.ads.length,
    ["activating", "active", "activation_failed"].includes(status),
    status === "active",
  ];
  const first = done.indexOf(false);
  const failed = ["failed", "activation_failed", "rolling_back"].includes(status);
  const working = IN_FLIGHT.includes(status) || status === "ready_for_review";
  return done.map((d, i) => (d ? "done" : i !== first ? "pending" : failed ? "error" : working ? "current" : "pending"));
}

const KIND: Record<string, { label: string; icon: LucideIcon }> = {
  campaign: { label: "Campaign", icon: Megaphone },
  adset: { label: "Ad set", icon: Layers },
  creative: { label: "Creative", icon: ImageIcon },
  ad: { label: "Ad", icon: RectangleHorizontal },
};
const LEDGER_TONE: Record<string, Tone> = { created: "success", failed: "danger", pending: "info", deleted: "muted" };

const sentence = (s: string) => {
  const t = s.replaceAll("_", " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

async function LaunchDetail({ params }: { params: PageProps<"/launches/[id]">["params"] }) {
  const { id } = await params;
  const [{ user }, detail] = await Promise.all([getWorkspace(), getLaunchDetail(id)]);
  if (!detail) notFound();
  const { launch, spec, ledger, currency } = detail;
  const c = spec.campaign;
  const s = LAUNCH_STATUS[launch.status];
  const states = pipelineStates(launch.status, spec, ledger);
  const inFlight = IN_FLIGHT.includes(launch.status);
  const creativeById = new Map(detail.creatives.map((x) => [x.id, x]));
  const money = (n?: number) => (n === undefined ? "—" : formatMoney(n, currency));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <AutoRefresh active={inFlight} />

      <Link href="/launches" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-ink">
        <ArrowLeft className="size-3.5" /> Launches
      </Link>

      {/* Hero: identity, actions and the pipeline stepper */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 p-5">
          <div className="min-w-0 flex-1 basis-80">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={s.tone} dot>
                {s.label}
              </Badge>
              {inFlight && (
                <span className="inline-flex items-center gap-1.5 text-xs text-faint">
                  <LoaderCircle className="size-3 animate-spin" aria-hidden /> Updating automatically
                </span>
              )}
            </div>
            <h1 className="mt-2.5 break-words text-[22px] font-semibold leading-tight tracking-tight sm:text-2xl">{launch.name}</h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Building2 className="size-3.5 shrink-0 text-faint" aria-hidden />
                <span className="truncate">
                  {detail.clientName} · {detail.accountName ?? launch.adAccountId}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                {detail.createdByName && <Avatar name={detail.createdByName} className="size-5 text-[9px]" />}
                <span>
                  Created by <span className="font-medium text-ink">{detail.createdByName ?? "—"}</span>{" "}
                  <time title={formatDateTime(launch.createdAt)}>{formatRelative(launch.createdAt)}</time>
                </span>
              </span>
              {launch.approvedAt && (
                <span className="inline-flex items-center gap-1.5">
                  <BadgeCheck className="size-3.5 text-success" aria-hidden />
                  <span>
                    Approved by <span className="font-medium text-ink">{detail.approvedByName ?? "—"}</span>{" "}
                    <time title={formatDateTime(launch.approvedAt)}>{formatRelative(launch.approvedAt)}</time>
                  </span>
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {detail.draftId && hasRole(user, "buyer") && (
              <Link href={`/launches/new?draft=${detail.draftId}`} className={buttonClass("secondary")} title="Edit the draft this launch was built from and publish it again">
                <PencilLine /> Open in builder
              </Link>
            )}
            {launch.metaCampaignId && (
              <Link href={`/campaigns?level=adsets&campaigns=${launch.metaCampaignId}`} className={buttonClass("secondary")}>
                View in Campaigns <ArrowUpRight />
              </Link>
            )}
            <LaunchActions launchId={launch.id} status={launch.status} canEdit={hasRole(user, "buyer")} canApprove={hasRole(user, "admin")} />
          </div>
        </div>

        <div className="border-t border-line-soft bg-surface-2 px-5 pb-5 pt-6">
          <Stepper states={states} status={launch.status} />
          <div className="mt-5 flex flex-col gap-3 empty:hidden">
            {launch.step && (
              <p className="flex items-center gap-2 text-[13px] text-muted">
                {inFlight && <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden />}
                {launch.step}
              </p>
            )}
            {launch.status === "ready_for_review" && (
              <Alert tone="info" title="Ready for approval">
                Everything is created and paused in Meta. Check the placement previews below, then approve to go live.
              </Alert>
            )}
            {launch.error && (
              <Alert
                tone={launch.status === "rolling_back" ? "warning" : "danger"}
                title={
                  launch.status === "activation_failed"
                    ? "Activation failed"
                    : launch.status === "failed"
                      ? "Build failed"
                      : launch.status === "rolling_back"
                        ? "Rolling back after an error"
                        : "Something went wrong"
                }
              >
                <span className="whitespace-pre-line break-words">{launch.error}</span>
              </Alert>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          {/* Ads */}
          <Card>
            <CardHeader
              icon={ImageIcon}
              title={<Count label="Ads" n={spec.ads.length} />}
              description={`Each runs in all ${spec.adsets.length} ad set${spec.adsets.length === 1 ? "" : "s"}.`}
            />
            <ul className="divide-y divide-line-soft">
              {spec.ads.map((ad, i) => {
                const lib = creativeById.get(ad.creativeId);
                return (
                  <li key={i} className="flex flex-col gap-4 px-5 py-4 sm:flex-row">
                    <div className="relative size-24 shrink-0 overflow-hidden rounded-lg border border-line bg-hover">
                      {lib &&
                        (lib.kind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element -- authenticated library file served by our API
                          <img src={`/api/media/${lib.squareAssetId}`} alt="" loading="lazy" className="size-full object-cover" />
                        ) : (
                          <video src={`/api/media/${lib.squareAssetId}`} preload="metadata" muted playsInline className="size-full object-cover" />
                        ))}
                      {lib && (
                        <span className="absolute bottom-1 left-1 rounded-md bg-surface/90 px-1.5 py-px text-[10px] font-medium text-muted ring-1 ring-line backdrop-blur">
                          {ad.moreAssetIds?.length ? `${ad.moreAssetIds.length + 1} files` : lib.kind === "image" ? "Image" : "Video"}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px] font-medium" title={ad.name}>
                            {ad.name}
                          </p>
                          <p className="truncate text-xs text-muted">{lib?.name ?? "Creative removed"}</p>
                        </div>
                        <div className="shrink-0">
                          <AdPreviewButton launchId={launch.id} adIndex={i} title={ad.name} formats={PREVIEW_FORMATS} />
                        </div>
                      </div>
                      {/* Copy, laid out like the ad itself */}
                      <div className="mt-3 rounded-lg border border-line-soft bg-surface-2 p-3 text-[13px]">
                        <p className="line-clamp-2 whitespace-pre-line text-muted">{ad.primaryTexts[0]}</p>
                        <div className="mt-2.5 flex items-end justify-between gap-3">
                          <div className="min-w-0">
                            {ad.url && <p className="truncate text-[11px] uppercase tracking-wider text-faint">{ad.displayLink || hostOf(ad.url)}</p>}
                            <p className="truncate font-semibold">{ad.headlines[0]}</p>
                            {ad.description && <p className="truncate text-xs text-muted">{ad.description}</p>}
                          </div>
                          {ad.url && <span className="shrink-0 rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium shadow-xs">{label(CTA_LABELS, ad.cta)}</span>}
                        </div>
                      </div>
                      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                        {(ad.primaryTexts.length > 1 || ad.headlines.length > 1) && (
                          <span>
                            {ad.primaryTexts.length} primary text{ad.primaryTexts.length === 1 ? "" : "s"} · {ad.headlines.length} headline{ad.headlines.length === 1 ? "" : "s"}
                          </span>
                        )}
                        <span>
                          {(ad.creativeFeaturesOptIn ?? []).length} of {CREATIVE_FEATURES.length} enhancements on
                        </span>
                      </p>
                      {ad.url && spec.adsets.some((a) => needsWebsite(a.destination)) && (
                        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted">
                          <Link2 className="size-3.5 shrink-0 text-faint" aria-hidden />
                          <span className="truncate" title={ad.url}>
                            {ad.url}
                          </span>
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* Ad sets */}
          <Card className="overflow-hidden">
            <CardHeader icon={Layers} title={<Count label="Ad sets" n={spec.adsets.length} />} description="Targeting and budget for each ad set." />
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-left text-[12px] text-muted">
                    <th className="px-5 py-2.5 font-medium">Name</th>
                    <th className="px-3 py-2.5 font-medium">Conversion location</th>
                    <th className="px-3 py-2.5 font-medium">Locations</th>
                    <th className="px-3 py-2.5 font-medium">Ages</th>
                    <th className="px-5 py-2.5 text-right font-medium">Budget</th>
                  </tr>
                </thead>
                <tbody>
                  {spec.adsets.map((a, j) => (
                    <tr key={j} className="border-b border-line-soft transition-colors last:border-0 hover:bg-hover/60">
                      <td className="max-w-xs px-5 py-3">
                        <span className="block truncate font-medium" title={a.name}>
                          {a.name}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="block">
                          {DESTINATION_LABELS[a.destination]}
                          {a.destination === "messaging" && <span className="text-muted"> · {a.messagingApps.map((m) => MESSAGING_APP_LABELS[m]).join(", ")}</span>}
                        </span>
                        <span className="block text-xs text-muted">
                          {label(OPTIMIZATION_LABELS, a.optimizationGoal)}
                          {a.conversionEvent && a.pixelId ? ` · ${sentence(a.conversionEvent)} (pixel ${a.pixelId})` : ""}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex flex-wrap gap-1">
                          {a.audience.locations.map((l) => (
                            <span key={`${l.kind}:${l.key}`} className="rounded-md bg-hover px-1.5 py-px text-[11.5px] text-muted ring-1 ring-inset ring-line">
                              {l.kind === "country" ? l.key : l.name}
                            </span>
                          ))}
                        </span>
                        <span className="mt-1 block text-xs text-faint">{a.placements.automatic ? "Advantage+ placements" : `${a.placements.platforms.map(sentence).join(", ")} placements`}</span>
                      </td>
                      <td className="tabular whitespace-nowrap px-3 py-3">
                        {a.audience.ageMin}–{a.audience.ageMax >= 65 ? "65+" : a.audience.ageMax}
                      </td>
                      <td className="tabular whitespace-nowrap px-5 py-3 text-right">
                        {c.budgetLevel === "adset" ? money(a.budget) : <span className="text-muted">Campaign budget</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Ledger */}
          <Card className="overflow-hidden">
            <CardHeader icon={Boxes} title={<Count label="Meta objects" n={ledger.length} />} description="Ledger of everything this launch created. Used for safe retries and rollback." />
            {ledger.length === 0 ? (
              <EmptyState icon={Boxes} title="Nothing created in Meta yet">
                Objects appear here as the build creates them.
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-2 text-left text-[12px] text-muted">
                      <th className="px-5 py-2.5 font-medium">Type</th>
                      <th className="px-3 py-2.5 font-medium">Name</th>
                      <th className="px-3 py-2.5 font-medium">Meta ID</th>
                      <th className="px-5 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((r) => {
                      const k = KIND[r.kind] ?? { label: r.kind, icon: Boxes };
                      return (
                        <tr key={r.id} className="border-b border-line-soft transition-colors last:border-0 hover:bg-hover/60">
                          <td className="whitespace-nowrap px-5 py-2.5">
                            <span className="inline-flex items-center gap-2">
                              <span className="grid size-6 place-items-center rounded-md border border-line bg-surface-2 text-faint">
                                <k.icon className="size-3.5" aria-hidden />
                              </span>
                              {k.label}
                            </span>
                          </td>
                          <td className="max-w-xs px-3 py-2.5">
                            <span className="block truncate" title={r.name}>
                              {r.name}
                            </span>
                          </td>
                          <td className="tabular whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted">{r.metaId ?? "—"}</td>
                          <td className="px-5 py-2.5">
                            <Badge tone={LEDGER_TONE[r.status] ?? "muted"} dot>
                              {sentence(r.status)}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Settings snapshot */}
        <aside className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader
              icon={SlidersHorizontal}
              title="Settings"
              description={detail.templateName ? `Started from “${detail.templateName}”` : "As submitted"}
            />
            <dl className="divide-y divide-line-soft px-5 py-1 text-[13px]">
              <Term label="Objective">{label(OBJECTIVE_LABELS, c.objective)}</Term>
              <Term label="Budget">
                {c.budgetLevel === "campaign" ? (
                  <>
                    <span className="tabular font-medium">{money(c.budget)}</span> {c.budgetSchedule} <span className="text-muted">(CBO)</span>
                  </>
                ) : (
                  <>
                    {sentence(c.budgetSchedule)} per ad set <span className="text-muted">(ABO)</span>
                  </>
                )}
              </Term>
              <Term label="Bid strategy">{label(BID_STRATEGY_LABELS, c.bidStrategy)}</Term>
              {c.spendCap && <Term label="Spending limit">{money(c.spendCap)}</Term>}
              <Term label="Schedule">
                {c.startTime ? formatDateTime(c.startTime) : "On activation"}
                {c.endTime && <span className="block text-muted">→ {formatDateTime(c.endTime)}</span>}
              </Term>
              {c.specialAdCategories.length > 0 && <Term label="Special categories">{c.specialAdCategories.map(sentence).join(", ")}</Term>}
              <Term label="Page">
                <span className="font-mono text-xs">{spec.pageId}</span>
              </Term>
              <Term label="Instagram">{spec.instagramUserId ? <span className="font-mono text-xs">{spec.instagramUserId}</span> : <span className="text-muted">Uses Page</span>}</Term>
              <Term label="URL parameters" stacked>
                <code className="block break-all rounded-lg border border-line-soft bg-surface-2 px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-muted">
                  {spec.urlTags || "None"}
                </code>
              </Term>
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Count({ label, n }: { label: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      {label}
      <span className="tabular rounded-full bg-hover px-1.5 text-[11.5px] font-medium leading-5 text-muted ring-1 ring-inset ring-line">{n}</span>
    </span>
  );
}

const STEP_NOTE: Partial<Record<StepState, string>> = { current: "In progress", error: "Failed" };

function Stepper({ states, status }: { states: StepState[]; status: LaunchStatus }) {
  return (
    <>
      <CompactSteps states={states} status={status} />
      <FullSteps states={states} status={status} />
    </>
  );
}

/** Phones: one segmented bar plus the step that matters right now. */
function CompactSteps({ states, status }: { states: StepState[]; status: LaunchStatus }) {
  const at = states.findIndex((s) => s === "current" || s === "error");
  const done = states.filter((s) => s === "done").length;
  const awaiting = status === "ready_for_review";
  const headline =
    at >= 0 ? `${PIPELINE_STEPS[at]} · ${states[at] === "error" ? "Failed" : awaiting ? "Waiting" : "In progress"}` : done === states.length ? "All steps complete" : LAUNCH_STATUS[status].label;
  return (
    <div className="sm:hidden">
      <div className="flex items-baseline justify-between gap-3">
        <p className={cn("text-[13px] font-medium", at >= 0 && states[at] === "error" ? "text-danger-ink" : awaiting ? "text-warning-ink" : "text-ink")}>{headline}</p>
        <p className="tabular shrink-0 text-xs text-faint">
          {done}/{states.length} steps
        </p>
      </div>
      <div className="mt-2.5 flex gap-1" aria-hidden>
        {states.map((s, i) => (
          <span
            key={PIPELINE_STEPS[i]}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              s === "done" && "bg-success",
              s === "current" && (awaiting ? "bg-warning" : "animate-pulse bg-primary"),
              s === "error" && "bg-danger",
              s === "pending" && "bg-line",
            )}
          />
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-faint">{PIPELINE_STEPS.join(" → ")}</p>
    </div>
  );
}

function FullSteps({ states, status }: { states: StepState[]; status: LaunchStatus }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5 pb-1 max-sm:hidden">
      <ol className="grid min-w-[600px] grid-cols-7">
        {PIPELINE_STEPS.map((label, i) => {
          const state = states[i];
          const awaiting = state === "current" && status === "ready_for_review";
          return (
            <li key={label} className="relative flex flex-col items-center gap-2 px-1 text-center" aria-current={state === "current" ? "step" : undefined}>
              {i > 0 && (
                <span
                  aria-hidden
                  className={cn("absolute right-1/2 top-3.5 h-0.5 w-[calc(100%-2.25rem)] -translate-x-[1.125rem] rounded-full", states[i - 1] === "done" ? "bg-success/50" : "bg-line")}
                />
              )}
              <StepDot state={state} n={i + 1} awaiting={awaiting} />
              <span className="flex flex-col">
                <span
                  className={cn(
                    "text-[12.5px] font-medium",
                    state === "pending" && "text-faint",
                    state === "error" && "text-danger-ink",
                    state === "current" && (awaiting ? "text-warning-ink" : "text-primary-ink"),
                  )}
                >
                  {label}
                </span>
                <span className="text-[11px] text-faint">{awaiting ? "Waiting" : (STEP_NOTE[state] ?? " ")}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StepDot({ state, n, awaiting }: { state: StepState; n: number; awaiting: boolean }) {
  const base = "relative z-10 grid size-7 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold";
  if (state === "done")
    return (
      <span className={cn(base, "bg-success-soft text-success-ink ring-1 ring-inset ring-success/30")}>
        <Check className="size-3.5" strokeWidth={3} aria-label="Done" />
      </span>
    );
  if (state === "error")
    return (
      <span className={cn(base, "bg-danger-soft text-danger-ink ring-1 ring-inset ring-danger/30")}>
        <X className="size-3.5" strokeWidth={3} aria-label="Failed" />
      </span>
    );
  if (state === "current")
    return awaiting ? (
      <span className={cn(base, "bg-surface text-warning-ink ring-2 ring-warning shadow-[0_0_0_4px_var(--warning-soft)]")}>
        <Hourglass className="size-3.5" aria-label="Waiting" />
      </span>
    ) : (
      <span className={cn(base, "bg-surface text-primary ring-2 ring-primary shadow-[0_0_0_4px_var(--primary-soft)]")}>
        <LoaderCircle className="size-3.5 animate-spin" aria-label="In progress" />
      </span>
    );
  return <span className={cn(base, "tabular bg-surface text-faint ring-1 ring-inset ring-line")}>{n}</span>;
}

function Term({ label, children, stacked }: { label: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={cn("py-2.5", stacked ? "flex flex-col gap-1.5" : "grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3")}>
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
