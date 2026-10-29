import { ChevronRight, CircleCheck, FilePen, Hourglass, LoaderCircle, Plus, Rocket, TriangleAlert, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Avatar, Badge, buttonClass, Card, CardHeader, cn, EmptyState, PageHeader, PageSkeleton, Stat } from "@/components/ui";
import { ParamSelect } from "@/components/url-filters";
import { hasRole } from "@/lib/auth/session";
import { formatDateTime, formatRelative } from "@/lib/format";
import { listDrafts, listLaunches } from "@/lib/queries/launches";
import { getWorkspace } from "@/lib/workspace";
import { DeleteDraftButton } from "./draft-actions";
import { MiniProgress } from "./progress";
import { IN_FLIGHT, LAUNCH_STATUS, listProgress } from "./status";

export const metadata: Metadata = { title: "Launches" };

export default function LaunchesPage(props: PageProps<"/launches">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Launches searchParams={props.searchParams} />
    </Suspense>
  );
}

type Row = Awaited<ReturnType<typeof listLaunches>>[number];

async function Launches({ searchParams }: { searchParams: PageProps<"/launches">["searchParams"] }) {
  const sp = await searchParams;
  const { user, client, account } = await getWorkspace();
  const all = sp.scope === "all" || !client;
  const canCreate = hasRole(user, "buyer");
  const [rows, drafts] = await Promise.all([listLaunches(all ? null : client.id), canCreate && account ? listDrafts(account.id) : Promise.resolve([])]);

  const count = (pred: (r: Row) => boolean) => rows.filter(pred).length;
  const stats: { label: string; value: number; footer: string; icon: LucideIcon; tint: string }[] = [
    { label: "In progress", value: count((r) => IN_FLIGHT.includes(r.status)), footer: "Building, activating or rolling back", icon: LoaderCircle, tint: "bg-primary-soft text-primary-ink" },
    { label: "Awaiting approval", value: count((r) => r.status === "ready_for_review"), footer: "Paused in Meta, ready to review", icon: Hourglass, tint: "bg-warning-soft text-warning-ink" },
    { label: "Live", value: count((r) => r.status === "active"), footer: "Approved and delivering", icon: CircleCheck, tint: "bg-success-soft text-success-ink" },
    { label: "Needs attention", value: count((r) => r.status === "failed" || r.status === "activation_failed"), footer: "Retry or discard", icon: TriangleAlert, tint: "bg-danger-soft text-danger-ink" },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Launches"
        description="Campaigns from the campaign builder: media → creatives → campaign → ad sets → ads, all created paused, then approved to go live."
        actions={
          <>
            {client && (
              <ParamSelect
                name="scope"
                label="Which launches"
                options={[
                  { value: "client", label: `${client.name} only` },
                  { value: "all", label: "All clients" },
                ]}
              />
            )}
            {/* The top bar carries the global "New campaign" CTA from sm up. */}
            {canCreate && (
              <Link href="/launches/new" className={buttonClass("create", "md", "sm:hidden")}>
                <Plus /> New campaign
              </Link>
            )}
          </>
        }
      />

      {drafts.length > 0 && account && (
        <Card className="overflow-hidden">
          <CardHeader icon={FilePen} title="Drafts" description={`Campaigns still being built for ${account.name}. Pick up where you left off.`} />
          <ul className="divide-y divide-line-soft">
            {drafts.map((d) => (
              <li key={d.id} className="relative flex items-center gap-3 px-5 py-3 transition-colors hover:bg-hover/60">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/launches/new?draft=${d.id}`}
                    className="block truncate text-[13.5px] font-medium outline-none after:absolute after:inset-0 after:content-[''] hover:text-primary focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-primary/50"
                  >
                    {d.name}
                  </Link>
                  <p className="truncate text-[12.5px] text-muted">
                    {d.createdByName ?? "Someone"} · edited <time title={formatDateTime(d.updatedAt)}>{formatRelative(d.updatedAt)}</time>
                  </p>
                </div>
                <span className="text-[12.5px] font-medium text-primary-ink max-sm:hidden">Continue</span>
                <DeleteDraftButton id={d.id} name={d.name} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map(({ label, value, footer, icon: Icon, tint }) => (
            <Stat
              key={label}
              label={label}
              value={value}
              footer={<span className="max-sm:hidden">{footer}</span>}
              visual={
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", tint)}>
                  <Icon className="size-4" aria-hidden />
                </span>
              }
            />
          ))}
        </div>
      )}

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={Rocket}
            title="No launches yet"
            action={
              canCreate && (
                <Link href="/launches/new" className={buttonClass("primary")}>
                  <Plus /> Build a campaign
                </Link>
              )
            }
          >
            The campaign builder creates a full campaign, keeps it paused for review, and it goes live only after approval.
          </EmptyState>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3">
              <h2 className="min-w-0 truncate text-[14.5px] font-semibold tracking-tight">{all ? "All launches" : `${client.name} launches`}</h2>
              <span className="tabular shrink-0 text-xs text-faint">
                {rows.length} launch{rows.length === 1 ? "" : "es"}
                <span className="max-sm:hidden"> · newest first</span>
              </span>
            </div>

            {/* Desktop: dense table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-left text-[12px] text-muted">
                    <th className="px-5 py-2.5 font-medium">Launch</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Progress</th>
                    <th className="px-3 py-2.5 font-medium">Created by</th>
                    <th className="px-3 py-2.5 font-medium">Created</th>
                    <th className="px-3 py-2.5 font-medium">Updated</th>
                    <th className="w-10 px-3 py-2.5">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const s = LAUNCH_STATUS[r.status];
                    return (
                      <tr key={r.id} className="group relative border-b border-line-soft transition-colors last:border-0 hover:bg-hover/60">
                        <td className="max-w-0 px-5 py-3 lg:w-[38%]">
                          <RowLink id={r.id} name={r.name} />
                          <span className="block truncate text-[12.5px] text-muted">
                            {r.clientName ?? "—"} · {r.accountName ?? r.adAccountId}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={s.tone} dot>
                            {s.label}
                          </Badge>
                        </td>
                        <td className="px-3 py-3">
                          <MiniProgress states={listProgress(r.status, r.step)} status={r.status} />
                          <StepCaption row={r} className="mt-1 max-w-44" />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <Creator name={r.createdByName} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-muted">
                          <time title={formatDateTime(r.createdAt)}>{formatRelative(r.createdAt)}</time>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-muted">
                          <time title={formatDateTime(r.updatedAt)}>{formatRelative(r.updatedAt)}</time>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <ChevronRight className="ml-auto size-4 text-faint transition-colors group-hover:text-muted" aria-hidden />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile: stacked rows */}
            <ul className="divide-y divide-line-soft md:hidden">
              {rows.map((r) => {
                const s = LAUNCH_STATUS[r.status];
                return (
                  <li key={r.id} className="relative px-4 py-3.5 transition-colors hover:bg-hover/60">
                    <div className="flex items-baseline gap-3">
                      <div className="min-w-0 flex-1">
                        <RowLink id={r.id} name={r.name} />
                      </div>
                      <time className="shrink-0 text-xs text-faint" title={formatDateTime(r.updatedAt)}>
                        {formatRelative(r.updatedAt)}
                      </time>
                    </div>
                    <p className="truncate text-[12.5px] text-muted">
                      {r.clientName ?? "—"} · {r.accountName ?? r.adAccountId}
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <Badge tone={s.tone} dot>
                        {s.label}
                      </Badge>
                      <MiniProgress states={listProgress(r.status, r.step)} status={r.status} />
                    </div>
                    <StepCaption row={r} className="mt-1.5" />
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

/** Name link stretched over the whole row, so the row is one big click target. */
function RowLink({ id, name }: { id: string; name: string }) {
  return (
    <Link
      href={`/launches/${id}`}
      title={name}
      className="block truncate text-[13.5px] font-medium text-ink outline-none transition-colors after:absolute after:inset-0 after:content-[''] hover:text-primary focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-primary/50"
    >
      {name}
    </Link>
  );
}

function StepCaption({ row, className }: { row: Row; className?: string }) {
  const text = row.error ?? row.step;
  if (!text) return null;
  return (
    <span className={cn("block truncate text-xs", row.error ? "text-danger-ink" : "text-muted", className)} title={text}>
      {text}
    </span>
  );
}

function Creator({ name }: { name: string | null }) {
  if (!name) return <span className="text-faint">—</span>;
  return (
    <span className="flex items-center gap-2">
      <Avatar name={name} className="size-6 text-[10px]" />
      <span className="max-w-32 truncate">{name}</span>
    </span>
  );
}
