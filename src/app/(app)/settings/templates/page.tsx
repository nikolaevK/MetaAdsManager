import { ChevronRight, Globe, LayoutGrid, LayoutTemplate, MousePointerClick, Plus, Target, Wallet, Zap, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ReadOnlyNote } from "@/components/settings-ui";
import { Badge, buttonClass, Card, EmptyState } from "@/components/ui";
import { hasRole } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { objectiveLabel } from "@/lib/launch/naming";
import { templateConfigSchema, type TemplateConfig } from "@/lib/launch/spec";
import { getTemplatesList } from "@/lib/queries/settings";
import { getWorkspace } from "@/lib/workspace";
import { SectionHeader, SettingsSkeleton } from "../section-header";
import { SettingChip } from "./setting-chip";

export const metadata: Metadata = { title: "Launch templates" };

export default function TemplatesPage() {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <Templates />
    </Suspense>
  );
}

function issueText(issue: { path: PropertyKey[]; message: string }): string {
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

const humanize = (s: string) => s.toLowerCase().replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());

function chips(c: TemplateConfig): { icon: LucideIcon; label: string; title: string }[] {
  const attribution = `${c.attribution.clickDays}d click${c.attribution.viewDays ? ` / ${c.attribution.viewDays}d view` : ""}`;
  const placements = c.placements.facebook.length + c.placements.instagram.length;
  const countries = c.countries.length > 3 ? `${c.countries.slice(0, 3).join(", ")} +${c.countries.length - 3}` : c.countries.join(", ");
  return [
    { icon: Target, label: objectiveLabel(c.objective), title: "Objective" },
    { icon: Zap, label: humanize(c.conversionEvent), title: "Conversion event" },
    { icon: Wallet, label: `${c.budgetLevel === "campaign" ? "CBO" : "ABO"} · ${c.budgetSchedule}`, title: "Budget" },
    { icon: MousePointerClick, label: attribution, title: "Attribution" },
    { icon: LayoutGrid, label: `${placements} placement${placements === 1 ? "" : "s"}`, title: "Placements" },
    { icon: Globe, label: countries, title: "Countries" },
  ];
}

async function Templates() {
  const { user } = await getWorkspace();
  const canEdit = hasRole(user, "admin");
  const rows = await getTemplatesList();
  const newButton = canEdit && (
    <Link href="/settings/templates/new" className={buttonClass("create")}>
      <Plus /> New template
    </Link>
  );

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Launch templates"
        description="Templates hold the launch recipe: pixel and conversion event, exclusions, placements (Facebook + Instagram), budget type, attribution and Advantage+ settings. Every launch freezes a copy of its template."
        actions={newButton}
      />
      {!canEdit && <ReadOnlyNote />}
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={LayoutTemplate} title="No launch templates yet" action={newButton || undefined}>
            {canEdit ? "Create one to start launching campaigns." : "Ask an admin to create one before launching campaigns."}
          </EmptyState>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-line bg-surface-2 px-5 py-2 text-[12px] font-medium text-muted">
              <span className="tabular">
                {rows.length} template{rows.length === 1 ? "" : "s"}
              </span>
              <span className="hidden @xl:block">Last updated</span>
            </div>
            <ul className="divide-y divide-line-soft">
              {rows.map(({ template: t, clientName }) => {
                const parsed = templateConfigSchema.safeParse(t.config);
                return (
                  <li key={t.id}>
                    <Link
                      href={`/settings/templates/${t.id}`}
                      className="group flex items-start gap-3 px-5 py-4 transition-colors hover:bg-hover/60 focus-visible:bg-hover/60 focus-visible:outline-none"
                    >
                      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-muted transition-colors group-hover:text-primary">
                        <LayoutTemplate className="size-4" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[13.5px] font-semibold text-ink group-hover:text-primary-ink">{t.name}</span>
                          {clientName ? <Badge tone="muted">{clientName}</Badge> : <Badge tone="info">Global</Badge>}
                          {!parsed.success && (
                            <Badge tone="warning" dot>
                              Incomplete
                            </Badge>
                          )}
                        </div>
                        {parsed.success ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {chips(parsed.data).map((c) => (
                              <SettingChip key={c.title} icon={c.icon} title={c.title}>
                                {c.label}
                              </SettingChip>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-1 text-[12.5px] text-muted">
                            Can&apos;t be used for launches yet — {issueText(parsed.error.issues[0])}
                          </p>
                        )}
                        <p className="tabular mt-2 text-xs text-faint @xl:hidden">Updated {formatDateTime(t.updatedAt)}</p>
                      </div>
                      <span className="tabular hidden shrink-0 pt-1 text-[12.5px] text-muted @xl:block">{formatDateTime(t.updatedAt)}</span>
                      <ChevronRight className="mt-1.5 size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-muted" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
