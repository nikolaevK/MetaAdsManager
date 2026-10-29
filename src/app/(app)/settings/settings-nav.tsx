"use client";

import { Activity, Building2, LayoutTemplate, Tags, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { cn, focusRing, segmentClass } from "@/components/ui";

const SECTIONS: { href: string; label: string; description: string; icon: LucideIcon }[] = [
  { href: "/settings/clients", label: "Clients & accounts", description: "Accounts and identities", icon: Building2 },
  { href: "/settings/templates", label: "Launch templates", description: "Tracking and placements", icon: LayoutTemplate },
  { href: "/settings/naming", label: "Naming & UTM", description: "Name patterns and URL tags", icon: Tags },
  { href: "/settings/users", label: "Users", description: "Members and roles", icon: Users },
  { href: "/settings/system", label: "System", description: "Health, jobs and audit log", icon: Activity },
];

/**
 * Section navigation: a vertical list on lg+, a scrollable pill bar below. The pathname is
 * request-time data, so the static shell renders the nav without a highlight.
 */
export function SettingsNav() {
  return (
    <Suspense fallback={<Nav pathname="" />}>
      <ActiveNav />
    </Suspense>
  );
}

function ActiveNav() {
  return <Nav pathname={usePathname()} />;
}

function Nav({ pathname }: { pathname: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  // Keep the active pill in view on narrow screens.
  useEffect(() => {
    const el = scroller.current;
    const active = el?.querySelector<HTMLElement>("[aria-current=page]");
    if (el && active) el.scrollLeft = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2;
  }, [pathname]);

  return (
    <>
      <nav aria-label="Settings" className="lg:hidden">
        <div ref={scroller} className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6">
          <div className="inline-flex items-center gap-0.5 rounded-xl border border-line bg-surface-2 p-0.5">
            {SECTIONS.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link key={href} href={href} aria-current={active ? "page" : undefined} className={segmentClass(active)}>
                  <Icon className={active ? "text-primary" : "text-faint"} aria-hidden />
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      <nav aria-label="Settings" className="hidden w-56 shrink-0 lg:sticky lg:top-6 lg:block xl:w-60">
        <ul className="flex flex-col gap-0.5">
          {SECTIONS.map(({ href, label, description, icon: Icon }) => {
            const active = isActive(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors",
                    focusRing,
                    active ? "bg-surface shadow-card ring-1 ring-line" : "hover:bg-hover",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-lg border transition-colors",
                      active ? "border-primary/20 bg-primary-soft text-primary-ink" : "border-line bg-surface text-faint group-hover:text-muted",
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 leading-tight">
                    <span className={cn("block truncate text-[13.5px] font-medium", active ? "text-ink" : "text-muted group-hover:text-ink")}>
                      {label}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-faint">{description}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
