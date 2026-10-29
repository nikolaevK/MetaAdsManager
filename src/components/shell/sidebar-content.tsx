"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { logout } from "@/app/login/actions";
import { Avatar, cn, focusRing, Skeleton } from "@/components/ui";
import { AccountSwitcher, type AccountOption } from "./account-switcher";
import { NAV_GROUPS } from "./nav-items";
import { ThemeSwitch } from "./theme-toggle";

export type SidebarData = {
  accounts: AccountOption[];
  currentId: string | null;
  user: { name: string; email: string; role: string };
  reviewCount: number;
};

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-gradient-to-br from-brand-from to-brand-to text-on-primary shadow-glow",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
        <path d="M5 16.5 9.5 8l4 6.5L19 5" />
      </svg>
    </span>
  );
}

/**
 * Sidebar body, shared by the desktop rail and the mobile drawer. `data` is null in the static
 * shell (before the session streams in), so the chrome renders instantly with placeholders.
 */
export function SidebarContent({ data, compact = false }: { data: SidebarData | null; compact?: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-14 shrink-0 items-center gap-2.5 px-4", compact && "lg:px-4 md:max-lg:justify-center md:max-lg:px-0")}>
        <BrandMark />
        <span className={cn("text-[15px] font-semibold tracking-tight", compact && "md:max-lg:hidden")}>Ads Manager</span>
      </div>

      <div className={cn("px-3 pb-2", compact && "md:max-lg:hidden")}>
        {data ? (
          <AccountSwitcher accounts={data.accounts} currentId={data.currentId} />
        ) : (
          <Skeleton className="h-11 w-full rounded-lg" />
        )}
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">
        <Suspense fallback={<NavGroups pathname="" reviewCount={data?.reviewCount ?? 0} compact={compact} />}>
          <ActiveNavGroups reviewCount={data?.reviewCount ?? 0} compact={compact} />
        </Suspense>
      </nav>

      <div className={cn("border-t border-line p-3", compact && "md:max-lg:px-2")}>
        {data ? (
          <UserCard user={data.user} compact={compact} />
        ) : (
          <Skeleton className="h-10 w-full rounded-lg" />
        )}
      </div>
    </div>
  );
}

function ActiveNavGroups(props: { reviewCount: number; compact: boolean }) {
  return <NavGroups pathname={usePathname()} {...props} />;
}

function NavGroups({ pathname, reviewCount, compact }: { pathname: string; reviewCount: number; compact: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className={cn("mb-1.5 px-2.5 text-[11px] font-medium uppercase tracking-wider text-faint", compact && "md:max-lg:hidden")}>
            {group.label}
          </p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map(({ href, label, icon: Icon, badge }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              const count = badge === "review" ? reviewCount : 0;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    title={label}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors pointer-coarse:h-10",
                      focusRing,
                      compact && "md:max-lg:justify-center md:max-lg:px-0",
                      active
                        ? "bg-surface text-ink shadow-card ring-1 ring-line"
                        : "text-muted hover:bg-hover hover:text-ink",
                    )}
                  >
                    <Icon className={cn("size-[18px] shrink-0", active ? "text-primary" : "text-faint group-hover:text-muted")} strokeWidth={2} />
                    <span className={cn("flex-1 truncate", compact && "md:max-lg:sr-only")}>{label}</span>
                    {count > 0 && (
                      <span
                        className={cn(
                          "min-w-5 rounded-full bg-danger px-1.5 text-center text-[11px] font-semibold leading-5 text-on-primary",
                          compact && "md:max-lg:absolute md:max-lg:-right-0.5 md:max-lg:-top-0.5 md:max-lg:min-w-4 md:max-lg:px-1 md:max-lg:text-[10px] md:max-lg:leading-4",
                        )}
                      >
                        {count > 99 ? "99+" : count}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function UserCard({ user, compact }: { user: SidebarData["user"]; compact: boolean }) {
  return (
    <div className={cn("flex flex-col gap-2.5", compact && "md:max-lg:items-center")}>
      <div className={cn("flex items-center justify-between gap-2 px-1", compact && "md:max-lg:hidden")}>
        <span className="text-xs text-faint">Theme</span>
        <ThemeSwitch />
      </div>
      <div className="flex items-center gap-2.5 rounded-lg px-1">
        <Avatar name={user.name || user.email} />
        <div className={cn("min-w-0 flex-1 leading-tight", compact && "md:max-lg:hidden")}>
          <p className="truncate text-[13px] font-medium">{user.name}</p>
          <p className="truncate text-[11.5px] capitalize text-faint">{user.role}</p>
        </div>
        <form action={logout} className={cn(compact && "md:max-lg:hidden")}>
          <button
            type="submit"
            title="Log out"
            aria-label="Log out"
            className={cn("grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-hover hover:text-ink pointer-coarse:size-10", focusRing)}
          >
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

export function SidebarFrame({ children }: { children: ReactNode }) {
  return (
    <aside className="hidden h-full shrink-0 border-r border-line bg-sidebar md:block md:w-16 lg:w-64">{children}</aside>
  );
}
