"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { breadcrumbs } from "./nav-items";

export function Breadcrumbs() {
  return (
    <Suspense fallback={<span />}>
      <Crumbs />
    </Suspense>
  );
}

function Crumbs() {
  const crumbs = breadcrumbs(usePathname());
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-[13px]">
        {crumbs.map((c, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-faint" />}
            {c.href ? (
              <Link href={c.href} className="truncate text-muted transition-colors hover:text-ink">
                {c.label}
              </Link>
            ) : (
              <span className="truncate font-medium text-ink" aria-current="page">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
