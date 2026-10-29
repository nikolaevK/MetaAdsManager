import { KeyRound, Lock, Users as UsersIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Avatar, Badge, Card, CardHeader, cn, EmptyState, type Tone } from "@/components/ui";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { hasRole } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { getUsersList } from "@/lib/queries/settings";
import { getWorkspace } from "@/lib/workspace";
import { SectionHeader, SettingsSkeleton } from "../section-header";
import { ChangePasswordForm, CreateUserForm, UserRowActions } from "./user-forms";

export const metadata: Metadata = { title: "Users" };

export default function UsersPage() {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <Users />
    </Suspense>
  );
}

const ROLE_TONE: Record<string, Tone> = { admin: "info", buyer: "success", viewer: "muted" };

type ListedUser = Awaited<ReturnType<typeof getUsersList>>[number];

function UserIdentity({ user: u, isSelf }: { user: ListedUser; isSelf: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={u.name || u.email} className={cn(u.disabled && "opacity-40 grayscale")} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={cn("truncate font-medium", u.disabled && "text-muted")}>{u.name}</span>
          {isSelf && <Badge tone="info">You</Badge>}
        </div>
        <div className="truncate text-xs text-muted">{u.email}</div>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge tone={ROLE_TONE[role] ?? "muted"} className="capitalize">
      {role}
    </Badge>
  );
}

function StatusBadge({ disabled }: { disabled: boolean }) {
  return disabled ? (
    <Badge tone="danger" dot>
      Disabled
    </Badge>
  ) : (
    <Badge tone="success" dot>
      Active
    </Badge>
  );
}
const DESCRIPTION = "Admins manage settings and approve launches; buyers build launches and edit campaigns; viewers can only look.";

async function Users() {
  const { user } = await getWorkspace();
  const isAdmin = hasRole(user, "admin");
  const list = isAdmin ? await getUsersList() : [];
  const admins = list.filter((u) => u.role === "admin").length;
  const disabled = list.filter((u) => u.disabled).length;

  return (
    <div className="flex flex-col gap-5">
      {isAdmin ? (
        <>
          <CreateUserForm minLength={PASSWORD_MIN_LENGTH} title="Users" description={DESCRIPTION} />
          <Card className="overflow-hidden">
            <CardHeader
              icon={UsersIcon}
              title="Members"
              description={
                <span className="tabular">
                  {list.length} {list.length === 1 ? "person" : "people"} · {admins} admin{admins === 1 ? "" : "s"}
                  {disabled > 0 && ` · ${disabled} disabled`}
                </span>
              }
            />
            {/* Wide containers: a table. Narrow ones (phones, tablets beside the settings nav): stacked rows. */}
            <div className="hidden overflow-x-auto @3xl:block">
              <table className="w-full min-w-[760px] text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-left text-[12px] text-muted">
                    <th className="px-5 py-2.5 font-medium">User</th>
                    <th className="px-3 py-2.5 font-medium">Role</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Created</th>
                    <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((u) => (
                    <tr key={u.id} className="border-b border-line-soft transition-colors last:border-b-0 hover:bg-hover/60">
                      <td className="px-5 py-3">
                        <UserIdentity user={u} isSelf={u.id === user.id} />
                      </td>
                      <td className="px-3 py-3">
                        <RoleBadge role={u.role} />
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge disabled={u.disabled} />
                      </td>
                      <td className="tabular whitespace-nowrap px-3 py-3 text-muted">{formatDateTime(u.createdAt)}</td>
                      <td className="px-5 py-3">
                        <UserRowActions user={{ id: u.id, name: u.name, role: u.role, disabled: u.disabled }} isSelf={u.id === user.id} minLength={PASSWORD_MIN_LENGTH} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line-soft @3xl:hidden">
              {list.map((u) => (
                <li key={u.id} className="flex flex-col gap-3 px-4 py-3.5">
                  <UserIdentity user={u} isSelf={u.id === user.id} />
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pl-11 text-xs text-muted">
                    <RoleBadge role={u.role} />
                    <StatusBadge disabled={u.disabled} />
                    <span className="tabular">Added {formatDateTime(u.createdAt)}</span>
                  </div>
                  {u.id !== user.id && (
                    <div className="pl-11">
                      <UserRowActions user={{ id: u.id, name: u.name, role: u.role, disabled: u.disabled }} isSelf={false} minLength={PASSWORD_MIN_LENGTH} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : (
        <>
          <SectionHeader title="Users" description={DESCRIPTION} />
          <Card>
            <EmptyState icon={Lock} title="Admins only">
              Ask an admin to add or change users. You can still change your own password below.
            </EmptyState>
          </Card>
        </>
      )}

      <Card className="overflow-hidden">
        <CardHeader
          icon={KeyRound}
          title="Change my password"
          description={
            <>
              Signed in as <span className="font-medium text-ink">{user.email}</span>. Changing it signs out your other sessions.
            </>
          }
        />
        <ChangePasswordForm minLength={PASSWORD_MIN_LENGTH} />
      </Card>
    </div>
  );
}
