import { Building2 } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ReadOnlyNote } from "@/components/settings-ui";
import { Card, EmptyState, type Tone } from "@/components/ui";
import { hasRole } from "@/lib/auth/session";
import { formatRelative, isStale } from "@/lib/format";
import { ACCOUNT_STATUS } from "@/lib/meta/accounts";
import { getClientsOverview } from "@/lib/queries/settings";
import { getWorkspace } from "@/lib/workspace";
import { SectionHeader, SettingsSkeleton } from "../section-header";
import { ClientCard, type AccountView } from "./client-card";
import { NewClientForm } from "./new-client-form";

export const metadata: Metadata = { title: "Clients & accounts" };

export default function ClientsSettingsPage() {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <ClientsSettings />
    </Suspense>
  );
}

/** Same freshness window the top bar uses for its "Synced" indicator. */
const STALE_MS = 2 * 60 * 60 * 1000;

function statusTone(status: number | null): Tone {
  if (status === null) return "muted";
  if (status === 1) return "success";
  if (status === 2 || status === 101) return "danger";
  return "warning";
}

function sync(label: string, ms: number | null): AccountView["syncs"][number] {
  return { label, when: formatRelative(ms), tone: !ms ? "muted" : isStale(ms, STALE_MS) ? "warning" : "success" };
}

async function ClientsSettings() {
  const { user } = await getWorkspace();
  const canEdit = hasRole(user, "admin");
  const { clients, conventions, rules } = await getClientsOverview();
  const clientOptions = clients.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Clients & accounts"
        description="Clients group the ad accounts you manage. Each client can use its own naming convention and UTM rule; connected accounts sync campaigns, review status and insights in the background."
        actions={canEdit && <NewClientForm />}
      />
      {!canEdit && <ReadOnlyNote />}

      {clients.length === 0 ? (
        <Card>
          <EmptyState icon={Building2} title="No clients yet">
            {canEdit ? "Create a client with “New client”, then connect the ad accounts your Meta token can access." : "Ask an admin to add a client."}
          </EmptyState>
        </Card>
      ) : (
        clients.map((c) => {
          const accounts: AccountView[] = c.accounts.map((a) => ({
            id: a.id,
            name: a.name,
            currency: a.currency,
            timezone: a.timezoneName,
            status: a.accountStatus === null ? "Unknown" : (ACCOUNT_STATUS[a.accountStatus] ?? String(a.accountStatus)),
            statusTone: statusTone(a.accountStatus),
            syncs: [
              sync("Structure", a.lastStructureSyncAt),
              sync("Insights", a.lastInsightsSyncAt),
              sync("Review", a.lastReviewSyncAt),
            ],
            backfilled: a.insightsBackfilledAt !== null,
            defaultPageId: a.defaultPageId,
            defaultInstagramUserId: a.defaultInstagramUserId,
          }));
          return (
            <ClientCard
              key={c.id}
              client={{ id: c.id, name: c.name, namingConventionId: c.namingConventionId, utmRuleId: c.utmRuleId }}
              accounts={accounts}
              conventions={conventions}
              rules={rules}
              clients={clientOptions}
              canEdit={canEdit}
            />
          );
        })
      )}
    </div>
  );
}
