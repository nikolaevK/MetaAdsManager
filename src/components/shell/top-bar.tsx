import { Plus } from "lucide-react";
import Link from "next/link";
import { buttonClass, cn } from "@/components/ui";
import { hasRole } from "@/lib/auth/session";
import { formatRelative, isStale } from "@/lib/format";
import { getWorkspace } from "@/lib/workspace";
import { Breadcrumbs } from "./breadcrumbs";
import { CommandPalette, CommandTrigger } from "./command-palette";
import { MobileNav } from "./mobile-nav";
import { loadSidebarData } from "./sidebar";
import { BrandMark } from "./sidebar-content";
import { SyncButton } from "./sync-button";

const STALE_MS = 2 * 60 * 60 * 1000;

export async function TopBar() {
  const [{ user, account }, sidebar] = await Promise.all([getWorkspace(), loadSidebarData()]);
  const canEdit = hasRole(user, "buyer");
  const lastSync = account ? Math.min(account.lastStructureSyncAt ?? 0, account.lastInsightsSyncAt ?? 0) || null : null;
  const stale = isStale(lastSync, STALE_MS);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas/80 px-3 backdrop-blur-md sm:px-5">
      <MobileNav data={sidebar} />
      <BrandMark className="size-7 md:hidden" />
      <div className="hidden min-w-0 flex-1 md:block">
        <Breadcrumbs />
      </div>
      <div className="flex flex-1 items-center justify-end gap-2 md:flex-none">
        <CommandTrigger className="w-9 justify-center sm:w-64 sm:justify-start max-sm:pointer-coarse:w-10" />
        {account && (
          <div className="hidden items-center gap-1 rounded-lg border border-line bg-surface py-0.5 pl-2.5 pr-0.5 shadow-xs lg:flex">
            <span className={cn("size-1.5 rounded-full", stale ? "bg-warning" : "bg-success")} aria-hidden />
            <span className="whitespace-nowrap text-xs text-muted">Synced {formatRelative(lastSync)}</span>
            {canEdit && <SyncButton accountId={account.id} />}
          </div>
        )}
        {canEdit && (
          <Link href="/launches/new" className={buttonClass("create", "md", "max-sm:hidden")}>
            <Plus /> New campaign
          </Link>
        )}
      </div>
      <CommandPalette accounts={sidebar.accounts} currentAccountId={sidebar.currentId} canEdit={canEdit} />
    </header>
  );
}

export function TopBarSkeleton() {
  return <header className="h-14 shrink-0 border-b border-line bg-canvas" />;
}
