import { Link2, Type } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ReadOnlyNote } from "@/components/settings-ui";
import { hasRole } from "@/lib/auth/session";
import { getNamingData } from "@/lib/queries/settings";
import { getWorkspace } from "@/lib/workspace";
import { SectionHeader, SettingsSkeleton, SubsectionHeader } from "../section-header";
import { NamingForm } from "./naming-form";
import { UtmForm } from "./utm-form";

export const metadata: Metadata = { title: "Naming & UTM" };

export default function NamingPage() {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <Naming />
    </Suspense>
  );
}

async function Naming() {
  const { user } = await getWorkspace();
  const canEdit = hasRole(user, "admin");
  const { conventions, rules, clients } = await getNamingData();
  const usedBy = (key: "namingConventionId" | "utmRuleId", id: string) => clients.filter((c) => c[key] === id).map((c) => c.name);
  const unassigned = (key: "namingConventionId" | "utmRuleId") => clients.filter((c) => !c[key]).map((c) => c.name);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-5">
        <SectionHeader
          title="Naming & UTM"
          description={
            <>
              Conventions name every campaign, ad set and ad at launch; UTM rules tag every link. Assign them per client under{" "}
              <Link href="/settings/clients" className="font-medium text-primary-ink hover:underline">
                Clients &amp; accounts
              </Link>
              .
            </>
          }
        />
        {!canEdit && <ReadOnlyNote />}
      </div>

      <section className="flex flex-col gap-4">
        <SubsectionHeader
          icon={Type}
          title="Naming conventions"
          count={conventions.length}
          description={`Patterns generate campaign, ad set and ad names at launch. Empty tokens drop out together with their separator. Clients without a convention (${unassigned("namingConventionId").length}) use the built-in default.`}
        />
        {conventions.map((c) => (
          <NamingForm key={c.id} convention={c} canEdit={canEdit} usedBy={usedBy("namingConventionId", c.id)} />
        ))}
        {canEdit && <NamingForm canEdit />}
      </section>

      <section className="flex flex-col gap-4">
        <SubsectionHeader
          icon={Link2}
          title="UTM rules"
          count={rules.length}
          description={
            <>
              Sent as the creative&apos;s <code className="rounded bg-hover px-1 py-px font-mono text-[12px] text-ink">url_tags</code>; Meta fills
              dynamic parameters like <code className="rounded bg-hover px-1 py-px font-mono text-[12px] text-ink">{"{{ad.name}}"}</code> at click
              time. Clients without a rule ({unassigned("utmRuleId").length}) use the built-in default.
            </>
          }
        />
        {rules.map((r) => (
          <UtmForm key={r.id} rule={r} canEdit={canEdit} usedBy={usedBy("utmRuleId", r.id)} />
        ))}
        {canEdit && <UtmForm canEdit />}
      </section>
    </div>
  );
}
