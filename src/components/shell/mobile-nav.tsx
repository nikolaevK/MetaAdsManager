"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SidebarContent, type SidebarData } from "./sidebar-content";

/** Hamburger + slide-over drawer with the full sidebar, below the md breakpoint. */
export function MobileNav({ data }: { data: SidebarData }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="Open navigation"
        onClick={() => setOpen(true)}
        className="grid size-9 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink md:hidden"
      >
        <Menu className="size-5" />
      </button>
      {/* Portal: the sticky, blurred top bar would otherwise become the containing block for `fixed`. */}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[80] md:hidden">
            <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setOpen(false)} />
            <div role="dialog" aria-modal="true" aria-label="Navigation" className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-slide-in border-r border-line bg-sidebar shadow-pop">
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
                className="absolute right-3 top-3.5 z-10 grid size-8 place-items-center rounded-lg text-muted hover:bg-hover"
              >
                <X className="size-4" />
              </button>
              <SidebarContent data={data} />
              <Suspense>
                <CloseOnNavigate onNavigate={() => setOpen(false)} />
              </Suspense>
            </div>
          </div>,
          document.body,
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
