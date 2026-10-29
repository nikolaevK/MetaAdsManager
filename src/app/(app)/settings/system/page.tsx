import {
  Activity,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  Clock,
  Cpu,
  Gauge,
  History,
  KeyRound,
  ListChecks,
  Lock,
  LoaderCircle,
  Plug,
  ShieldCheck,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { Avatar, Badge, Card, CardHeader, cn, EmptyState, Stat } from "@/components/ui";
import { hasRole } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { formatDateTime, formatRelative } from "@/lib/format";
import { whoAmI } from "@/lib/meta/accounts";
import { errorMessage } from "@/lib/meta/errors";
import { getSystemData } from "@/lib/queries/settings";
import { getWorkspace } from "@/lib/workspace";
import { InlineEmpty, SectionHeader, SettingsSkeleton, SubsectionHeader } from "../section-header";
import { RetryJobButton, RunWorkerButton } from "./system-controls";

export const metadata: Metadata = { title: "System" };

export default function SystemPage() {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <System />
    </Suspense>
  );
}

const isFuture = (ms: number | null) => ms !== null && ms > Date.now();

const JOB_TONE = { queued: "info", running: "warning", succeeded: "success", failed: "danger" } as const;

const TH = "px-3 py-2.5 font-medium";

async function System() {
  const { user } = await getWorkspace();
  if (!hasRole(user, "admin")) {
    return (
      <div className="flex flex-col gap-5">
        <SectionHeader title="System" />
        <Card>
          <EmptyState icon={Lock} title="Admins only">
            System status, jobs and the audit log are visible to admins.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const e = env();
  const [identity, data] = await Promise.all([
    whoAmI().then(
      (me) => ({ ok: true as const, me }),
      (err: unknown) => ({ ok: false as const, error: errorMessage(err) }),
    ),
    getSystemData(),
  ]);
  const count = (s: string) => data.jobCounts.find((c) => c.status === s)?.n ?? 0;
  const failed = count("failed");

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader title="System" description="Meta connection health, API rate limits, background jobs and a log of every change made through this app." />

      <section className="flex flex-col gap-4">
        <SubsectionHeader icon={Activity} title="Connection health" description="Credentials and endpoints this deployment uses to talk to Meta." />
        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
          <HealthCard
            icon={KeyRound}
            title="Meta access token"
            status={identity.ok ? <Badge tone="success" dot>Valid</Badge> : <Badge tone="danger" dot>Not working</Badge>}
            footer={`Graph API ${e.META_API_VERSION}`}
          >
            {identity.ok ? (
              <>
                Connected as <span className="font-medium text-ink">{identity.me.name}</span> <span className="tabular text-faint">({identity.me.id})</span>
              </>
            ) : (
              <span className="text-danger-ink">{identity.error}</span>
            )}
          </HealthCard>
          <HealthCard
            icon={ShieldCheck}
            title="appsecret_proof"
            status={e.META_APP_SECRET ? <Badge tone="success" dot>Enabled</Badge> : <Badge tone="warning" dot>Not set</Badge>}
            footer="META_APP_SECRET"
          >
            {e.META_APP_SECRET ? "Every Graph API call is signed with your app secret." : "META_APP_SECRET not set — Graph API calls aren't signed."}
          </HealthCard>
          <HealthCard
            icon={Webhook}
            title="Ad review webhook"
            status={e.META_WEBHOOK_VERIFY_TOKEN ? <Badge tone="success" dot>Verify token set</Badge> : <Badge tone="warning" dot>Not set</Badge>}
            footer="/api/webhooks/meta"
          >
            Real-time review updates from Meta. Polling every 10 minutes is the fallback.
          </HealthCard>
          <HealthCard
            icon={CalendarClock}
            title="Scheduler (cron)"
            status={e.CRON_SECRET ? <Badge tone="success" dot>Secret set</Badge> : <Badge tone="warning" dot>Not set</Badge>}
            footer="GET /api/cron · every minute"
          >
            Authorizes the scheduler that drains background jobs and runs syncs.
          </HealthCard>
        </div>

        <Card>
          <CardHeader icon={Plug} title="Setup" description="Wire Meta webhooks and the scheduler to this deployment." />
          <div className="grid grid-cols-1 gap-6 p-5 @3xl:grid-cols-2">
            <SetupStep n={1} title="Ad review webhooks">
              <p>
                In your Meta app, add the Webhooks product, choose the <b className="font-medium text-ink">Ad Account</b> object and subscribe to{" "}
                <Code>with_issues_ad_objects</Code> and <Code>in_process_ad_objects</Code>. Callback URL:
              </p>
              <CodeBlock>{`${e.APP_URL}/api/webhooks/meta`}</CodeBlock>
              <p className="text-xs text-faint">Verify token: the value of META_WEBHOOK_VERIFY_TOKEN. Polling still runs every 10 minutes as a fallback.</p>
            </SetupStep>
            <SetupStep n={2} title="Scheduler">
              <p>
                Call this every minute (cron, uptime monitor, or run <Code>npm run worker</Code> as a long-lived process):
              </p>
              <CodeBlock>{`GET ${e.APP_URL}/api/cron  ·  Authorization: Bearer $CRON_SECRET`}</CodeBlock>
            </SetupStep>
          </div>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SubsectionHeader
          icon={Gauge}
          title="Rate limits"
          description="Usage reported by Meta's x-app-usage, x-ad-account-usage and x-business-use-case-usage headers. Background work yields above 85%."
        />
        <Card className="overflow-hidden">
          {data.limits.length === 0 ? (
            <InlineEmpty icon={Gauge} title="No usage recorded yet">
              Buckets appear after the first Graph API calls report usage.
            </InlineEmpty>
          ) : (
            <ul className="divide-y divide-line-soft">
              {data.limits.map((l) => {
                const blocked = isFuture(l.blockedUntil);
                return (
                  <li key={l.key} className="grid grid-cols-1 gap-x-6 gap-y-2 px-5 py-3.5 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto] @2xl:items-center">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[12.5px] text-ink" title={l.key}>
                        {l.key}
                      </p>
                      <p className="text-xs text-faint">Updated {formatRelative(l.updatedAt)}</p>
                    </div>
                    <Meter pct={l.usagePct} />
                    <div className="@2xl:text-right">
                      {blocked ? (
                        <Badge tone="danger" dot>
                          Blocked until {formatDateTime(l.blockedUntil)}
                        </Badge>
                      ) : (
                        <span className="text-xs text-faint">Not throttled</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SubsectionHeader
          icon={ListChecks}
          title="Background jobs"
          description="Syncs, launches and uploads run as jobs. Finished jobs are kept for 14 days."
          actions={<RunWorkerButton />}
        />
        <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
          <Stat label="Queued" value={count("queued")} visual={<StatIcon icon={Clock} tone="info" />} footer="Waiting to run" />
          <Stat label="Running" value={count("running")} visual={<StatIcon icon={LoaderCircle} tone="warning" />} footer="In progress now" />
          <Stat
            label="Failed"
            value={failed}
            visual={<StatIcon icon={CircleAlert} tone={failed ? "danger" : "muted"} />}
            footer={failed ? "Retry from the list below" : "Nothing to retry"}
          />
          <Stat label="Succeeded" value={count("succeeded")} visual={<StatIcon icon={CircleCheck} tone="success" />} footer="Last 14 days" />
        </div>
        <Card className="overflow-hidden">
          {data.recentJobs.length === 0 ? (
            <InlineEmpty icon={ListChecks} title="No jobs yet">
              Jobs show up here as soon as a sync, launch or upload is queued.
            </InlineEmpty>
          ) : (
            <div className="overflow-x-auto">
              <table className="tabular w-full min-w-[820px] text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-left text-[12px] text-muted">
                    <th className="px-5 py-2.5 font-medium">Job</th>
                    <th className={TH}>Status</th>
                    <th className={cn(TH, "text-right")}>Attempts</th>
                    <th className={TH}>Run at</th>
                    <th className={TH}>Last error / note</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {data.recentJobs.map((j) => (
                    <tr key={j.id} className="border-b border-line-soft align-top transition-colors last:border-b-0 hover:bg-hover/60">
                      <td className="px-5 py-3">
                        <div className="font-medium">{j.type}</div>
                        <div className="font-mono text-[11.5px] text-faint">{j.adAccountId ?? (j.payload.launchId as string | undefined) ?? ""}</div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={JOB_TONE[j.status]} dot className="capitalize">
                          {j.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className={j.attempts >= j.maxAttempts ? "text-danger-ink" : undefined}>{j.attempts}</span>
                        <span className="text-faint">/{j.maxAttempts}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-muted">{formatDateTime(j.runAt)}</td>
                      <td className="max-w-md px-3 py-3 text-xs text-muted">
                        <span className="line-clamp-2 break-words" title={j.lastError ?? undefined}>
                          {j.lastError ? j.lastError.slice(0, 300) : <span className="text-faint">—</span>}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-right">{j.status === "failed" && <RetryJobButton id={j.id} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SubsectionHeader icon={History} title="Audit log" description="Latest 100 changes made through this app." />
        <Card className="overflow-hidden">
          {data.audit.length === 0 ? (
            <InlineEmpty icon={History} title="Nothing logged yet">
              Changes to settings, launches and campaigns are recorded here.
            </InlineEmpty>
          ) : (
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead className="sticky top-0 z-10 bg-surface-2">
                  <tr className="text-left text-[12px] text-muted shadow-[inset_0_-1px_0_var(--line)]">
                    <th className="px-5 py-2.5 font-medium">When</th>
                    <th className={TH}>Who</th>
                    <th className={TH}>Action</th>
                    <th className="px-5 py-2.5 font-medium">Object</th>
                  </tr>
                </thead>
                <tbody>
                  {data.audit.map((a) => (
                    <tr key={a.id} className="border-b border-line-soft transition-colors last:border-b-0 hover:bg-hover/60">
                      <td className="tabular whitespace-nowrap px-5 py-2.5 text-muted" title={formatRelative(a.createdAt)}>
                        {formatDateTime(a.createdAt)}
                      </td>
                      <td className="px-3 py-2.5">
                        {a.userName ? (
                          <span className="flex items-center gap-2">
                            <Avatar name={a.userName} className="size-6! text-[10px]!" />
                            <span className="truncate">{a.userName}</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-2 text-muted">
                            <span className="grid size-6 place-items-center rounded-full border border-line bg-surface-2 text-faint">
                              <Cpu className="size-3.5" aria-hidden />
                            </span>
                            System
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <code className="whitespace-nowrap rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px] text-ink">
                          {a.action}
                        </code>
                      </td>
                      <td className="max-w-sm px-5 py-2.5 text-xs text-muted" title={a.entityId ?? undefined}>
                        {a.entityType ? (
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="shrink-0 font-medium text-ink first-letter:uppercase">{a.entityType.replaceAll("_", " ")}</span>
                            <span className="truncate font-mono text-faint">{a.entityId ?? ""}</span>
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}

function HealthCard({
  icon: Icon,
  title,
  status,
  footer,
  children,
}: {
  icon: LucideIcon;
  title: string;
  status: ReactNode;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-muted">
          <Icon className="size-4" aria-hidden />
        </span>
        {status}
      </div>
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold tracking-tight">{title}</p>
        <p className="mt-1 line-clamp-3 break-words text-[12.5px] leading-snug text-muted">{children}</p>
      </div>
      {footer && <p className="mt-auto truncate border-t border-line-soft pt-2.5 font-mono text-[11.5px] text-faint">{footer}</p>}
    </div>
  );
}

function SetupStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3">
      <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-[12px] font-semibold text-primary-ink">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-[13px] text-muted">
        <p className="font-semibold text-ink">{title}</p>
        {children}
      </div>
    </div>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-hover px-1 py-px font-mono text-[12px] text-ink">{children}</code>;
}

function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <code className="block wrap-anywhere rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-[12px] leading-relaxed text-ink">{children}</code>
  );
}

function Meter({ pct }: { pct: number }) {
  const tone = pct >= 85 ? "bg-danger" : pct >= 65 ? "bg-warning" : "bg-success";
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-hover" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Usage">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(100, pct)}%` }} />
        <span className="absolute inset-y-0 left-[85%] w-px bg-faint/60" aria-hidden title="85% — background work yields" />
      </div>
      <span className="tabular w-10 text-right text-[12.5px] font-medium">{pct.toFixed(0)}%</span>
    </div>
  );
}

const STAT_TONE = {
  info: "bg-primary-soft text-primary-ink",
  warning: "bg-warning-soft text-warning-ink",
  danger: "bg-danger-soft text-danger-ink",
  success: "bg-success-soft text-success-ink",
  muted: "bg-hover text-faint",
} as const;

function StatIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: keyof typeof STAT_TONE }) {
  return (
    <span className={cn("grid size-8 place-items-center rounded-lg", STAT_TONE[tone])}>
      <Icon className="size-4" aria-hidden />
    </span>
  );
}
