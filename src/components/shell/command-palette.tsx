"use client";

import {
  ArrowRight,
  Building2,
  CornerDownLeft,
  LogOut,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { selectAccount, syncNow } from "@/app/(app)/actions";
import { logout } from "@/app/login/actions";
import { Modal } from "@/components/modal";
import { toast } from "@/components/toast";
import { cn, focusRing, Kbd } from "@/components/ui";
import type { AccountOption } from "./account-switcher";
import { NAV_GROUPS } from "./nav-items";
import { setTheme } from "./theme-toggle";

type Command = { id: string; group: string; label: string; hint?: string; icon: LucideIcon; keywords?: string; run: () => void };

const SETTINGS_PAGES = [
  { href: "/settings/clients", label: "Clients & accounts" },
  { href: "/settings/templates", label: "Launch templates" },
  { href: "/settings/naming", label: "Naming & UTM" },
  { href: "/settings/users", label: "Users" },
  { href: "/settings/system", label: "System status" },
];

/** ⌘K / Ctrl+K: jump anywhere, switch ad account, run common actions. */
export function CommandPalette({
  accounts,
  currentAccountId,
  canEdit,
}: {
  accounts: AccountOption[];
  currentAccountId: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [, start] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpen);
    };
  }, []);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => router.push(href);
    const list: Command[] = [];
    if (canEdit) {
      list.push({ id: "new-launch", group: "Actions", label: "New campaign", icon: Plus, keywords: "create campaign launch builder", run: go("/launches/new") });
    }
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        list.push({ id: item.href, group: "Go to", label: item.label, icon: item.icon, run: go(item.href) });
      }
    }
    list.push(
      { id: "adsets", group: "Go to", label: "Ad sets", icon: ArrowRight, keywords: "campaigns", run: go("/campaigns?level=adsets") },
      { id: "ads", group: "Go to", label: "Ads", icon: ArrowRight, keywords: "campaigns creative", run: go("/campaigns?level=ads") },
    );
    for (const s of SETTINGS_PAGES) {
      list.push({ id: s.href, group: "Settings", label: s.label, icon: ArrowRight, keywords: "settings", run: go(s.href) });
    }
    for (const a of accounts) {
      if (a.id === currentAccountId) continue;
      list.push({
        id: `acct:${a.id}`,
        group: "Switch ad account",
        label: a.name,
        hint: a.clientName,
        icon: Building2,
        keywords: `${a.clientName} ${a.id}`,
        run: () => start(() => selectAccount(a.id)),
      });
    }
    if (canEdit && currentAccountId) {
      list.push({
        id: "sync",
        group: "Actions",
        label: "Sync from Meta now",
        icon: RefreshCw,
        keywords: "refresh pull",
        run: () =>
          start(async () => {
            const res = await syncNow(currentAccountId);
            toast(res?.ok ? (res.message ?? "Sync started") : (res?.error ?? "Sync failed"), res?.ok ? "info" : "error");
          }),
      });
    }
    list.push(
      { id: "theme-light", group: "Appearance", label: "Light theme", icon: Sun, keywords: "mode", run: () => setTheme("light") },
      { id: "theme-dark", group: "Appearance", label: "Dark theme", icon: Moon, keywords: "mode", run: () => setTheme("dark") },
      { id: "theme-system", group: "Appearance", label: "System theme", icon: Monitor, keywords: "mode auto", run: () => setTheme("system") },
      { id: "logout", group: "Account", label: "Log out", icon: LogOut, keywords: "sign out", run: () => start(() => logout()) },
    );
    return list;
  }, [accounts, currentAccountId, canEdit, router]);

  const q = query.trim().toLowerCase();
  const results = q
    ? commands.filter((c) => `${c.label} ${c.hint ?? ""} ${c.keywords ?? ""} ${c.group}`.toLowerCase().includes(q))
    : commands;

  const runAt = (i: number) => {
    const cmd = results[i];
    if (!cmd) return;
    close();
    cmd.run();
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  let index = -1;
  const groups = [...new Set(results.map((r) => r.group))];
  // Modal portals to <body>: the sticky, blurred top bar would otherwise become the containing block for `fixed`.
  return (
    <Modal
      onClose={close}
      aria-label="Command palette"
      overlayClassName="z-[90] flex items-start justify-center p-4 pt-[12vh]"
      className="w-full max-w-xl animate-pop-in overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
    >
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <Search className="size-4 shrink-0 text-faint" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              runAt(active);
            }
          }}
          placeholder="Search pages, accounts and actions…"
          aria-label="Search commands"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-list"
          className="h-12 flex-1 bg-transparent text-[14px] placeholder:text-faint focus:outline-none"
        />
        {/* Keyboard hints only where there's likely a keyboard; touch screens get a close button instead. */}
        <Kbd className="pointer-coarse:hidden">Esc</Kbd>
        <button
          type="button"
          aria-label="Close"
          onClick={close}
          className={cn("-mr-2 hidden size-10 shrink-0 place-items-center rounded-lg text-faint hover:bg-hover hover:text-ink pointer-coarse:grid", focusRing)}
        >
          <X className="size-4" />
        </button>
      </div>
      <div ref={listRef} id="command-list" role="listbox" className="max-h-[min(60vh,26rem)] overflow-y-auto p-1.5">
        {results.length === 0 && <p className="px-3 py-8 text-center text-[13px] text-muted">No results for “{query}”.</p>}
        {groups.map((group) => (
          <div key={group} className="mb-1">
            <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-faint">{group}</p>
            {results
              .filter((r) => r.group === group)
              .map((cmd) => {
                index++;
                const i = index;
                const Icon = cmd.icon;
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    data-index={i}
                    onMouseMove={() => setActive(i)}
                    onClick={() => runAt(i)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13.5px]",
                      i === active ? "bg-hover text-ink" : "text-muted",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", i === active ? "text-primary" : "text-faint")} />
                    <span className="flex-1 truncate text-ink">{cmd.label}</span>
                    {cmd.hint && <span className="truncate text-xs text-faint">{cmd.hint}</span>}
                    {i === active && <CornerDownLeft className="size-3.5 text-faint" />}
                  </button>
                );
              })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-line bg-surface-2 px-4 py-2 text-[11.5px] text-faint pointer-coarse:hidden">
        <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
        <span className="flex items-center gap-1"><Kbd>↵</Kbd> select</span>
        <span className="ml-auto flex items-center gap-1"><Kbd>⌘</Kbd><Kbd>K</Kbd> toggle</span>
      </div>
    </Modal>
  );
}

export function CommandTrigger({ className }: { className?: string }) {
  return (
    <button
      type="button"
      aria-label="Search or jump to…"
      aria-keyshortcuts="Meta+K Control+K"
      onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
      className={cn(
        "flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-faint shadow-xs transition-colors hover:bg-hover hover:text-muted pointer-coarse:h-10",
        focusRing,
        className,
      )}
    >
      <Search className="size-4" aria-hidden />
      <span className="hidden flex-1 text-left sm:inline">Search or jump to…</span>
      <span className="hidden items-center gap-0.5 sm:flex pointer-coarse:hidden" aria-hidden>
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}
