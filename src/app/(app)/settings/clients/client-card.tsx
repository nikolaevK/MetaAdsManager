"use client";

import { Link2, Pencil, Trash2, Unplug } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { FormFooter, useSettingsAction } from "@/components/settings-ui";
import { Badge, Button, Card, cn, focusRing, Input, Select, StatusDot, type Tone } from "@/components/ui";
import { InlineEmpty } from "../section-header";
import { deleteClient, disconnectAccount, moveAccount, renameClient, setClientConventions } from "./actions";
import { AccountIdentity } from "./account-identity";
import { ConnectAccount } from "./connect-account";
import { DetailPanel, Monogram } from "./detail-panel";

export type AccountView = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  status: string;
  statusTone: Tone;
  syncs: { label: string; when: string; tone: Tone }[];
  backfilled: boolean;
  defaultPageId: string | null;
  defaultInstagramUserId: string | null;
};

type Option = { id: string; name: string };

export function ClientCard({
  client,
  accounts,
  conventions,
  rules,
  clients,
  canEdit,
}: {
  client: { id: string; name: string; namingConventionId: string | null; utmRuleId: string | null };
  accounts: AccountView[];
  conventions: Option[];
  rules: Option[];
  clients: Option[];
  canEdit: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(client.name);
  const { pending, run, error } = useSettingsAction({ inlineErrors: true });
  const confirm = useConfirm();
  const active = accounts.filter((a) => a.statusTone === "success").length;

  const removeClient = async () => {
    const ok = await confirm({
      title: `Delete ${client.name}?`,
      body: `This disconnects its ${accounts.length === 1 ? "ad account" : `${accounts.length} ad accounts`} and deletes their synced data, launches, templates and creative library files. Nothing is deleted in Meta.`,
      confirmLabel: "Delete client",
      tone: "danger",
    });
    if (ok) run(() => deleteClient({ id: client.id }));
  };

  const setConventions = (patch: { namingConventionId?: string | null; utmRuleId?: string | null }) =>
    run(() =>
      setClientConventions({
        id: client.id,
        namingConventionId: patch.namingConventionId !== undefined ? patch.namingConventionId : client.namingConventionId,
        utmRuleId: patch.utmRuleId !== undefined ? patch.utmRuleId : client.utmRuleId,
      }),
    );

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-line-soft px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <Monogram name={client.name} className="size-9 rounded-[10px] text-[14px]" />
          {renaming ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => renameClient({ id: client.id, name }), { onOk: () => setRenaming(false) });
              }}
            >
              <Input autoFocus aria-label="Client name" value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-52 text-[13px]" maxLength={120} />
              <Button type="submit" size="sm" variant="primary" disabled={pending || !name.trim()}>
                Save
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
              {error && (
                <p role="alert" className="w-full text-xs text-danger-ink">
                  {error}
                </p>
              )}
            </form>
          ) : (
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <h3 className="truncate text-[14.5px] font-semibold tracking-tight">{client.name}</h3>
                {canEdit && (
                  <button
                    type="button"
                    aria-label={`Rename ${client.name}`}
                    title="Rename"
                    onClick={() => setRenaming(true)}
                    className={cn("grid size-6 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink pointer-coarse:size-10", focusRing)}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                )}
              </div>
              <p className="tabular text-[12.5px] text-muted">
                {accounts.length} ad account{accounts.length === 1 ? "" : "s"}
                {active > 0 && <span className="text-faint"> · {active} active</span>}
              </p>
            </div>
          )}
        </div>

        <div className="grid w-full grid-cols-2 items-end gap-2 @2xl:flex @2xl:w-auto @2xl:items-center">
          <LabeledSelect
            label="Naming"
            aria-label="Naming convention"
            disabled={!canEdit || pending}
            value={client.namingConventionId ?? ""}
            onChange={(e) => setConventions({ namingConventionId: e.target.value || null })}
          >
            <option value="">Default</option>
            {conventions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </LabeledSelect>
          <LabeledSelect
            label="UTM"
            aria-label="UTM rule"
            disabled={!canEdit || pending}
            value={client.utmRuleId ?? ""}
            onChange={(e) => setConventions({ utmRuleId: e.target.value || null })}
          >
            <option value="">Default</option>
            {rules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </LabeledSelect>
        </div>
      </div>

      {accounts.length === 0 ? (
        <InlineEmpty icon={Link2} title="No ad accounts connected">
          {canEdit ? "Connect one to start syncing campaigns, review status and insights." : "An admin can connect ad accounts to this client."}
        </InlineEmpty>
      ) : (
        <ul className="divide-y divide-line-soft">
          {accounts.map((a) => (
            <li key={a.id} className="flex flex-col gap-3 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <Monogram name={a.name} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="truncate text-[13.5px] font-semibold">{a.name}</p>
                      <Badge tone={a.statusTone} dot>
                        {a.status}
                      </Badge>
                    </div>
                    <p className="tabular mt-0.5 text-[12.5px] text-muted">
                      {a.id.replace("act_", "")} <span className="text-faint">·</span> {a.currency} <span className="text-faint">·</span> {a.timezone}
                    </p>
                  </div>
                </div>
                {canEdit && (
                  <div className="flex flex-wrap items-center gap-2">
                    {clients.length > 1 && (
                      <Select
                        aria-label={`Move ${a.name} to another client`}
                        value=""
                        disabled={pending}
                        onChange={async (e) => {
                          const to = clients.find((c) => c.id === e.target.value);
                          if (!to) return;
                          const ok = await confirm({ title: `Move ${a.name} to ${to.name}?`, confirmLabel: "Move account" });
                          if (ok) run(() => moveAccount({ accountId: a.id, clientId: to.id }));
                        }}
                        className="h-8 w-36 text-[13px]"
                      >
                        <option value="">Move to…</option>
                        {clients
                          .filter((c) => c.id !== client.id)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </Select>
                    )}
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={pending}
                      title="Disconnect"
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Disconnect ${a.name}?`,
                          body: "The mirrored campaigns, ad sets, ads, insights history, review events and launches for this account are deleted from this app. Nothing changes in Meta, and you can reconnect later (insights will be re-synced).",
                          confirmLabel: "Disconnect",
                          tone: "danger",
                        });
                        if (ok) run(() => disconnectAccount({ accountId: a.id }));
                      }}
                    >
                      <Unplug /> Disconnect
                    </Button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2.5 @2xl:grid-cols-2 @2xl:pl-11">
                <DetailPanel title="Sync health">
                  <ul className="flex flex-col gap-1.5 text-[13px]">
                    {a.syncs.map((s) => (
                      <li key={s.label} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <StatusDot
                          tone={s.tone}
                          label={
                            <>
                              <span className="inline-block w-[4.25rem] text-muted">{s.label}</span>
                              <span className="tabular text-ink">{s.when}</span>
                            </>
                          }
                        />
                        {s.label === "Insights" && !a.backfilled && <Badge tone="warning">Backfill pending</Badge>}
                      </li>
                    ))}
                  </ul>
                </DetailPanel>
                <AccountIdentity
                  accountId={a.id}
                  pageId={a.defaultPageId}
                  instagramUserId={a.defaultInstagramUserId}
                  canEdit={canEdit}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <FormFooter error={renaming ? null : error}>
          <Button variant="ghost" disabled={pending} className="mr-auto hover:bg-danger-soft hover:text-danger-ink" onClick={removeClient}>
            <Trash2 /> Delete<span className="max-sm:sr-only"> client</span>
          </Button>
          <ConnectAccount clientId={client.id} clientName={client.name} />
        </FormFooter>
      )}
    </Card>
  );
}

function LabeledSelect({ label, ...props }: ComponentProps<typeof Select> & { label: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 @2xl:flex-row @2xl:items-center @2xl:gap-2">
      <span className="text-[11.5px] font-medium text-faint @2xl:text-[12px]">{label}</span>
      <Select {...props} className="h-8 w-full text-[13px] @2xl:w-40" />
    </label>
  );
}
