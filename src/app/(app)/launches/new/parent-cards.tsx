"use client";

import { Layers, Megaphone } from "lucide-react";
import Link from "next/link";
import { ReadOnly, Section } from "@/app/(app)/campaigns/editor/fields";
import { Badge, StatusDot } from "@/components/ui";
import { delivery, formatMoney } from "@/lib/format";
import type { ParentView } from "@/lib/launch/draft";
import { DESTINATION_LABELS, MESSAGING_APP_LABELS } from "@/lib/launch/objectives";
import { BID_STRATEGY_LABELS, label, OBJECTIVE_LABELS, OPTIMIZATION_LABELS } from "@/lib/meta/labels";

/** The existing campaign a launch adds to: shown, never edited here (its settings stay as they are in Meta). */
export function ParentCampaignCard({ parent, currency }: { parent: ParentView; currency: string }) {
  const c = parent.campaign;
  const d = delivery(c.status);
  const cbo = c.budgetLevel === "campaign";
  return (
    <Section
      title="Existing campaign"
      icon={Megaphone}
      description={parent.target.mode === "campaign" ? "New ad sets and their ads are added to this campaign. Its own settings don't change." : "New ads are added to an ad set in this campaign."}
      actions={
        <Link href={`/campaigns?level=adsets&campaigns=${parent.target.campaignId}`} className="shrink-0 text-xs font-medium text-primary-ink hover:underline">
          View
        </Link>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ReadOnly label="Name">
          <span className="block break-words">{c.name}</span>
        </ReadOnly>
        <ReadOnly label="Delivery">
          <StatusDot tone={d.tone} label={d.label} />
        </ReadOnly>
        <ReadOnly label="Objective">{label(OBJECTIVE_LABELS, c.objective)}</ReadOnly>
        <ReadOnly label="Budget">
          {cbo ? `${c.budget !== undefined ? formatMoney(c.budget, currency) : "—"} ${c.budgetSchedule} · Campaign budget (CBO)` : "Ad set budgets (ABO)"}
        </ReadOnly>
        {cbo && <ReadOnly label="Bid strategy">{label(BID_STRATEGY_LABELS, c.bidStrategy)}</ReadOnly>}
        {c.specialAdCategories.length > 0 && <ReadOnly label="Special ad categories">{c.specialAdCategories.join(", ").toLowerCase().replaceAll("_", " ")}</ReadOnly>}
      </div>
      {c.status !== "ACTIVE" && (
        <p className="text-[12.5px] text-muted">The campaign is off: once approved, the new {parent.target.mode === "campaign" ? "ad sets" : "ads"} deliver only after you turn the campaign on.</p>
      )}
    </Section>
  );
}

/** The existing ad set new ads go into. */
export function ExistingAdsetCard({ parent }: { parent: ParentView }) {
  const s = parent.adset;
  if (!s) return null;
  const d = delivery(s.status);
  const where = s.destination === "messaging" ? `${DESTINATION_LABELS.messaging}: ${s.messagingApps.map((a) => MESSAGING_APP_LABELS[a]).join(", ")}` : DESTINATION_LABELS[s.destination];
  const geo = s.audience.locations.map((l) => (l.kind === "country" ? l.key : l.name)).join(", ");
  return (
    <Section title="Existing ad set" icon={Layers} description="New ads are added to this ad set and use its audience, budget and placements. Its own settings don't change.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ReadOnly label="Name">
          <span className="block break-words">{s.name}</span>
        </ReadOnly>
        <ReadOnly label="Delivery">
          <StatusDot tone={d.tone} label={d.label} />
        </ReadOnly>
        <ReadOnly label="Conversion location">{where}</ReadOnly>
        <ReadOnly label="Performance goal">{label(OPTIMIZATION_LABELS, s.goal)}</ReadOnly>
        <ReadOnly label="Audience">
          {geo || "Custom locations"} · {s.audience.ageMin}–{s.audience.ageMax >= 65 ? "65+" : s.audience.ageMax}
          {s.audience.advantageAudience && (
            <Badge tone="info" className="ml-1.5">
              Advantage+
            </Badge>
          )}
        </ReadOnly>
        <ReadOnly label="Placements">{s.placements.automatic ? "Advantage+ placements" : `Manual: ${s.placements.platforms.join(", ")}`}</ReadOnly>
      </div>
    </Section>
  );
}
