"use client";

import { useEffect, useEffectEvent, useState, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "./ui";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';
const TYPING = 'textarea, input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="range"], [type="color"], [type="file"])';

/** Open dialogs, innermost last: only the top one answers Escape and Tab. */
const stack: object[] = [];
let locks = 0;
let savedOverflow = "";

const focusables = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
// Focusing a text field pops the on-screen keyboard, so on touch screens it waits for a tap.
const quiet = (el: HTMLElement) => !(el.matches(TYPING) && matchMedia("(pointer: coarse)").matches);

/**
 * Dialog behaviour for `ref`'s element: moves focus in on open (an element already focused inside it, else
 * `initialFocus`, else the first focusable one, else the panel), keeps Tab inside, closes on Escape, locks page
 * scroll, and hands focus back to whatever had it before on close.
 */
export function useModal(ref: RefObject<HTMLElement | null>, { onClose, initialFocus }: { onClose: () => void; initialFocus?: RefObject<HTMLElement | null> }) {
  // Read during the first render, before an autoFocus child or the effect below moves focus.
  const [opener] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));
  // The first pick, reused if the effect runs again (StrictMode re-runs it after cleanup has refocused the opener).
  const picked = useRef<HTMLElement | null>(null);
  const close = useEffectEvent(onClose);

  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const token = {};
    stack.push(token);
    if (locks++ === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    const active = document.activeElement as HTMLElement | null;
    const preferred = initialFocus?.current;
    const target =
      (active && panel.contains(active) ? active : null) ??
      (picked.current?.isConnected && panel.contains(picked.current) ? picked.current : null) ??
      (preferred && quiet(preferred) ? preferred : null) ??
      focusables(panel).find(quiet) ??
      panel;
    picked.current = target;
    if (target !== active) target.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (stack.at(-1) !== token || e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Tab") {
        const items = focusables(panel);
        const first = items[0];
        const last = items.at(-1);
        const active = document.activeElement;
        if (!first || !last) {
          e.preventDefault();
          panel.focus();
        } else if (e.shiftKey && (active === first || !panel.contains(active) || active === panel)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(token), 1);
      if (--locks === 0) document.body.style.overflow = savedOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [ref, initialFocus, opener]);
}

/**
 * Overlay + dialog panel in a portal (so it escapes `main`'s scroll and stacking context). The backdrop follows the
 * documented overlay style; `overlayClassName` places the panel (centered by default) and `className` styles it.
 */
export function Modal({
  onClose,
  initialFocus,
  className,
  overlayClassName = "z-50 grid place-items-center p-3",
  children,
  ...aria
}: {
  onClose: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
  overlayClassName?: string;
  children: ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useModal(panel, { onClose, initialFocus });
  return createPortal(
    <div className={cn("fixed inset-0 animate-fade-in bg-black/40 backdrop-blur-[2px]", overlayClassName)} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" tabIndex={-1} className={cn("outline-none", className)} {...aria}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
