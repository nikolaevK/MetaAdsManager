import { History as HistoryIcon, ImageIcon, Layers, Megaphone, RefreshCw, Rocket, Undo2, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { NoAccount } from "@/components/no-account";
import { Avatar, Badge, Card, EmptyState, PageHeader, PageSkeleton } from "@/components/ui";
import { hasRole } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { fromMinorUnits } from "@/lib/money";
import { BID_STRATEGY_LABELS, label } from "@/lib/meta/labels";
import type { Change } from "@/lib/meta/objects";
import { getHistory, type HistoryEntry } from "@/lib/queries/history";
import { getWorkspace } from "@/lib/workspace";
import { UndoButton } from "./undo-button";

export const metadata: Metadata = { title: "History" };

export default function HistoryPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <History />
    </Suspense>
  );
}

const ICON: Record<string, LucideIcon> = { campaign: Megaphone, adset: Layers, ad: ImageIcon, launch: Rocket, ad_account: RefreshCw };
const NOUN: Record<string, [string, string]> = { campaign: ["campaign", "campaigns"], adset: ["ad set", "ad sets"], ad: ["ad", "ads"], launch: ["launch", "launches"] };

function verb(e: HistoryEntry): string {
  const [kind, act] = e.action.split(".");
  const n = e.entityIds.length;
  const noun = NOUN[kind] ? NOUN[kind][n === 1 ? 0 : 1] : kind;
  const status = e.details.status as string | undefined;
  switch (act) {
    case "status":
      return `${status === "ACTIVE" ? "turned on" : status === "PAUSED" ? "turned off" : "archived"} ${n > 1 ? `${n} ` : ""}${noun}`;
    case "budget":
      return `changed the budget of ${noun}`;
    case "rename":
      return `renamed ${noun}`;
    case "update":
      return `edited ${noun}`;
    case "bulk_edit":
      return `bulk edited ${e.changes.length} ${NOUN[kind]?.[e.changes.length === 1 ? 0 : 1] ?? kind}`;
    case "duplicate":
      return `duplicated ${noun}`;
    case "created":
      return `created ${noun}`;
    case "undo":
      return `undid a change to ${noun}`;
    case "manual":
      return "started a sync with Meta";
    default:
      return `${act?.replaceAll("_", " ") ?? "changed"} ${noun}`;
  }
}

function describe(field: string, v: unknown, currency: string): string {
  if (v === undefined || v === null || v === "") return field.endsWith("_time") ? "none" : "—";
  switch (field) {
    case "status":
      return v === "ACTIVE" ? "On" : v === "PAUSED" ? "Off" : String(v).toLowerCase();
    case "daily_budget":
    case "lifetime_budget":
    case "bid_amount":
      return formatMoney(fromMinorUnits(Number(v), currency), currency);
    case "spend_cap":
      return Number(v) >= 9e14 ? "no limit" : formatMoney(fromMinorUnits(Number(v), currency), currency);
    case "bid_strategy":
      return label(BID_STRATEGY_LABELS, String(v));
    case "start_time":
    case "stop_time":
    case "end_time":
      return new Date(String(v)).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    case "bid_constraints":
      return `ROAS ≥ ${Number((v as { roas_average_floor?: number }).roas_average_floor ?? 0) / 10000}`;
    default:
      return typeof v === "object" ? "…" : String(v);
  }
}

const FIELD: Record<string, string> = {
  name: "Name",
  status: "Status",
  daily_budget: "Daily budget",
  lifetime_budget: "Lifetime budget",
  bid_strategy: "Bid strategy",
  bid_amount: "Bid / cost goal",
  bid_constraints: "ROAS goal",
  spend_cap: "Spending limit",
  start_time: "Start",
  stop_time: "End",
  end_time: "End",
  targeting: "Audience & placements",
  creative: "Creative",
};

function ChangeLines({ changes, names, currency, undo }: { changes: Change[]; names: Map<string, string>; currency: string; undo: boolean }) {
  const lines = changes.flatMap((c) =>
    Object.keys(c.after).map((field) => {
      const opaque = field === "targeting" || field === "creative";
      return {
        key: `${c.id}:${field}`,
        who: changes.length > 1 ? names.get(c.id) ?? c.id : null,
        field: FIELD[field] ?? field,
        text: opaque ? (field === "creative" ? (undo ? "restored the previous creative" : "new creative (copy edit)") : undo ? "restored" : "updated") : `${describe(field, c.before[field], currency)} → ${describe(field, c.after[field], currency)}`,
      };
    }),
  );
  if (!lines.length) return null;
  return (
    <ul className="mt-1.5 flex flex-col gap-0.5 text-[12.5px] text-muted">
      {lines.slice(0, 8).map((l) => (
        <li key={l.key} className="truncate">
          {l.who && <span className="text-ink">{l.who}: </span>}
          <span className="text-faint">{l.field}</span> {l.text}
        </li>
      ))}
      {lines.length > 8 && <li className="text-faint">+{lines.length - 8} more</li>}
    </ul>
  );
}

async function History() {
  const { user, account } = await getWorkspace();
  if (!account) return <NoAccount />;
  const entries = await getHistory(account.id);
  const canEdit = hasRole(user, "buyer");
  const names = new Map(entries.flatMap((e) => e.entityIds.map((id, i) => [id, e.names[i]] as const)));

  const days = new Map<string, HistoryEntry[]>();
  for (const e of entries) {
    const day = new Date(e.createdAt).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
    days.set(day, [...(days.get(day) ?? []), e]);
  }

  return (
    <div>
      <PageHeader title="History" description={`Everything changed in ${account.name} from this app: who did it, what changed, and one-click undo.`} />
      {entries.length === 0 ? (
        <Card>
          <EmptyState icon={HistoryIcon} title="No changes yet">
            Edits to campaigns, ad sets and ads made here show up in this timeline.
          </EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {[...days.entries()].map(([day, list]) => (
            <section key={day} aria-label={day}>
              <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-faint">{day}</h2>
              <Card>
                <ol className="divide-y divide-line-soft">
                  {list.map((e) => {
                    const Icon = ICON[e.entityType ?? ""] ?? HistoryIcon;
                    const shown = e.names.slice(0, 3);
                    return (
                      <li key={e.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                        <span className="relative mt-0.5 shrink-0">
                          <Avatar name={e.userName ?? "System"} className="size-8" />
                          <span className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full bg-surface text-muted ring-2 ring-surface">
                            <Icon className="size-3" aria-hidden />
                          </span>
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13.5px]">
                            <span className="font-medium">{e.userName ?? "System"}</span> <span className="text-muted">{verb(e)}</span>{" "}
                            {shown.length > 0 && <span className="font-medium">{shown.join(", ")}</span>}
                            {e.names.length > shown.length && <span className="text-muted"> and {e.names.length - shown.length} more</span>}
                          </p>
                          <ChangeLines changes={e.changes} names={names} currency={account.currency} undo={e.action.endsWith(".undo")} />
                          {Array.isArray(e.details.errors) && e.details.errors.length > 0 && (
                            <p className="mt-1 text-[12px] text-danger-ink">{(e.details.errors as unknown[]).length} failed</p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <time className="tabular text-[12px] text-faint" dateTime={new Date(e.createdAt).toISOString()}>
                            {new Date(e.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                          </time>
                          {e.undoneAt ? (
                            <Badge tone="muted">
                              <Undo2 className="size-3" aria-hidden /> Undone
                            </Badge>
                          ) : (
                            canEdit && e.undoable && <UndoButton id={e.id} />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
