"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn, focusRing } from "@/components/ui";

export type Theme = "light" | "dark" | "system";

const ORDER: Theme[] = ["light", "dark", "system"];
const ICON = { light: Sun, dark: Moon, system: Monitor };
const LABEL = { light: "Light", dark: "Dark", system: "System" };

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem("theme", theme);
  } catch {}
  apply(theme);
  window.dispatchEvent(new CustomEvent("themechange", { detail: theme }));
}

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function subscribe(onChange: () => void) {
  // Follow OS changes while in "system" mode.
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const onSystem = () => readTheme() === "system" && apply("system");
  window.addEventListener("themechange", onChange);
  window.addEventListener("storage", onChange);
  mq.addEventListener("change", onSystem);
  return () => {
    window.removeEventListener("themechange", onChange);
    window.removeEventListener("storage", onChange);
    mq.removeEventListener("change", onSystem);
  };
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => "system");
}

/** Three-way segmented switch: light / dark / follow the OS. */
export function ThemeSwitch({ className }: { className?: string }) {
  const theme = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className={cn("inline-flex rounded-lg border border-line bg-surface-2 p-0.5", className)}>
      {ORDER.map((t) => {
        const Icon = ICON[t];
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={theme === t}
            title={LABEL[t]}
            aria-label={LABEL[t]}
            onClick={() => setTheme(t)}
            className={cn(
              "grid size-6 place-items-center rounded-md transition-colors pointer-coarse:size-10",
              focusRing,
              theme === t ? "bg-surface text-ink shadow-card ring-1 ring-line" : "text-faint hover:text-ink",
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
