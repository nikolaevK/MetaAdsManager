"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Modal } from "@/components/modal";
import { cn, focusRing } from "@/components/ui";
import { SidebarContent, type SidebarData } from "./sidebar-content";

/** Hamburger + slide-over drawer with the full sidebar, below the md breakpoint. */
export function MobileNav({ data }: { data: SidebarData }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn("grid size-9 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink pointer-coarse:size-10 md:hidden", focusRing)}
      >
        <Menu className="size-5" />
      </button>
      {/* Modal portals to <body>: the sticky, blurred top bar would otherwise become the containing block for `fixed`. */}
      {open && (
        <Modal
          onClose={() => setOpen(false)}
          aria-label="Navigation"
          overlayClassName="z-[80] md:hidden"
          className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-slide-in border-r border-line bg-sidebar shadow-pop"
        >
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className={cn("absolute right-3 top-3.5 z-10 grid size-8 place-items-center rounded-lg text-muted hover:bg-hover pointer-coarse:top-2 pointer-coarse:size-10", focusRing)}
          >
            <X className="size-4" />
          </button>
          <SidebarContent data={data} />
          <Suspense>
            <CloseOnNavigate onNavigate={() => setOpen(false)} />
          </Suspense>
        </Modal>
      )}
    </>
  );
}

function CloseOnNavigate({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  const [initial] = useState(pathname);
  useEffect(() => {
    if (pathname !== initial) onNavigate();
  }, [pathname, initial, onNavigate]);
  return null;
}
