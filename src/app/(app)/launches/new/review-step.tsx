"use client";

import { ArrowRight, CircleCheck, ImageIcon, Layers, Megaphone, ShieldCheck, TriangleAlert } from "lucide-react";
import { MediaThumb } from "@/app/(app)/library/media-thumb";
import { Section } from "@/app/(app)/campaigns/editor/fields";
import { Alert, Badge, cn } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { mediaPick, positiveNumber, resolveAdset, STEPS, type BuilderState } from "@/lib/launch/draft";
import { DESTINATION_LABELS, MESSAGING_APP_LABELS } from "@/lib/launch/objectives";
import type { LaunchIssue } from "@/lib/launch/spec";
import type { Asset } from "./media";
import { BID_STRATEGY_LABELS, OBJECTIVE_LABELS, OPTIMIZATION_LABELS } from "@/lib/meta/labels";

const STEP_INDEX: Record<LaunchIssue["step"], number> = { campaign: 0, adsets: 1, ads: 2 };

/** "Ad set 3" → 2, so an issue can jump to the right tab. */
export const issueItem = (where: string) => {
  const m = /(\d+)$/.exec(where);
  return m ? Number(m[1]) - 1 : 0;
};

export function ReviewStep({
  state,
  names,
  issues,
  currency,
  asset,
  pageName,
  onJump,
}: {
  state: BuilderState;
  names: { campaign: string; adsets: string[]; ads: string[] };
  issues: LaunchIssue[];
  currency: string;
  asset: (id: string) => Asset | undefined;
  pageName?: string;
  onJump: (step: number, item: number) => void;
}) {
  const c = state.campaign;
  const cbo = c.budgetLevel === "campaign";
  const money = (v: string) => (positiveNumber(v) !== undefined ? formatMoney(positiveNumber(v)!, currency) : "—");

  return (
    <div className="flex flex-col gap-4">
      {issues.length > 0 ? (
        <Alert tone="warning" title={`${issues.length} thing${issues.length === 1 ? "" : "s"} to fix before publishing`}>
          <ul className="mt-1 flex flex-col gap-1">
            {issues.map((i, k) => (
              <li key={k}>
                <button type="button" onClick={() => onJump(STEP_INDEX[i.step], issueItem(i.where))} className="group inline-flex items-baseline gap-1.5 text-left hover:underline">
                  <span className="font-medium">
                    {STEPS[STEP_INDEX[i.step]].label} · {i.where}:
                  </span>
                  <span>{i.message}</span>
                  <ArrowRight className="size-3 shrink-0 self-center opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Alert>
      ) : (
        <Alert tone="success" title="Ready to publish">
          Everything is created <span className="font-medium">paused</span> in Meta. Nothing goes live until an admin approves the launch.
        </Alert>
      )}

      <Section title="Campaign" icon={Megaphone}>
        <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
          <Row label="Name">{names.campaign || "—"}</Row>
          <Row label="Objective">{OBJECTIVE_LABELS[c.objective]}</Row>
          <Row label="Budget">
            {cbo ? `${money(c.budget)} ${c.budgetSchedule} · Campaign budget (CBO)` : `${c.budgetSchedule === "daily" ? "Daily" : "Lifetime"} per ad set · Ad set budgets (ABO)`}
          </Row>
          <Row label="Bid strategy">{BID_STRATEGY_LABELS[c.bidStrategy]}</Row>
          <Row label="Schedule">{c.start ? c.start.replace("T", " ") : "On approval"}{c.end ? ` → ${c.end.replace("T", " ")}` : ""}</Row>
          <Row label="Identity">
            {pageName ?? (state.pageId ? `Page ${state.pageId}` : "—")}
            {state.igId ? ` · Instagram ${state.igId}` : ""}
          </Row>
          {c.spendCap && <Row label="Spending limit">{money(c.spendCap)}</Row>}
          {c.specialAdCategories.length > 0 && <Row label="Special categories">{c.specialAdCategories.join(", ").toLowerCase().replaceAll("_", " ")}</Row>}
        </dl>
      </Section>

      <Section title={`Ad sets (${state.adsets.length})`} icon={Layers}>
        <ul className="divide-y divide-line-soft rounded-lg border border-line">
          {state.adsets.map((s, j) => {
            const r = resolveAdset(c.objective, s);
            const where = r.destination === "messaging" ? `${DESTINATION_LABELS.messaging}: ${s.messagingApps.map((a) => MESSAGING_APP_LABELS[a]).join(", ")}` : DESTINATION_LABELS[r.destination];
            return (
              <li key={s.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-[13px]">
                <button type="button" onClick={() => onJump(1, j)} className="min-w-0 max-w-full truncate font-medium hover:text-primary-ink hover:underline">
                  {j + 1}. {names.adsets[j]}
                </button>
                <span className="text-[12.5px] text-muted">
                  {where} · {OPTIMIZATION_LABELS[r.goal] ?? r.goal} · {s.audience.locations.map((l) => (l.kind === "country" ? l.key : l.name)).join(", ") || "No locations"} · {s.audience.ageMin}–{s.audience.ageMax >= 65 ? "65+" : s.audience.ageMax} ·{" "}
                  {s.placements.automatic ? "Advantage+ placements" : "Manual placements"}
                  {!cbo && ` · ${money(s.budget)}`}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={`Ads (${state.ads.length})`} icon={ImageIcon} description={state.adsets.length > 1 ? `Each ad runs in all ${state.adsets.length} ad sets: ${state.ads.length * state.adsets.length} ads in total.` : undefined}>
        <ul className="divide-y divide-line-soft rounded-lg border border-line">
          {state.ads.map((a, i) => {
            const pick = mediaPick(a);
            const file = pick ? asset(pick.feedAssetId) : undefined;
            const texts = a.primaryTexts.filter((t) => t.trim()).length;
            const heads = a.headlines.filter((t) => t.trim()).length;
            return (
              <li key={a.key} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                <span className="size-11 shrink-0 overflow-hidden rounded-md border border-line bg-hover">
                  {file && <MediaThumb id={file.id} kind={file.kind} alt="" className="size-full" />}
                </span>
                <span className="min-w-0 flex-1">
                  <button type="button" onClick={() => onJump(2, i)} className="block max-w-full truncate font-medium hover:text-primary-ink hover:underline">
                    {i + 1}. {names.ads[i]}
                  </button>
                  <span className="block truncate text-[12.5px] text-muted">
                    {a.primaryTexts[0]?.trim() || "No primary text"}
                    {texts > 1 && ` · +${texts - 1} text option${texts > 2 ? "s" : ""}`}
                    {heads > 1 && ` · ${heads} headlines`}
                  </span>
                </span>
                <span className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                  {pick ? (
                    <Badge tone="muted">{pick.moreAssetIds ? `Flexible · ${pick.moreAssetIds.length + 1} files` : pick.verticalAssetId ? "Feed + Stories/Reels" : "1 file"}</Badge>
                  ) : (
                    <Badge tone="warning">
                      <TriangleAlert className="size-3" aria-hidden /> No media
                    </Badge>
                  )}
                  <span className="text-[11.5px] text-faint">{a.features.length} enhancement{a.features.length === 1 ? "" : "s"} on</span>
                </span>
              </li>
            );
          })}
        </ul>
      </Section>

      <p className={cn("flex items-center gap-2 text-[12.5px]", issues.length ? "text-muted" : "text-success-ink")}>
        {issues.length ? <ShieldCheck className="size-4 text-success" aria-hidden /> : <CircleCheck className="size-4" aria-hidden />}
        Your draft is saved automatically. You can leave and come back to it from Launches.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
