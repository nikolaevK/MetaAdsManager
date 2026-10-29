"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

function useSetParam() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (key: string, value: string | null) => {
    const p = new URLSearchParams(params);
    if (value) p.set(key, value);
    else p.delete(key);
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
}

/** Debounced search box bound to ?q= */
export function SearchInput({ placeholder = "Search" }: { placeholder?: string }) {
  const params = useSearchParams();
  const setParam = useSetParam();
  const urlValue = params.get("q") ?? "";
  const [value, setValue] = useState(urlValue);
  // Follow external URL changes (e.g. a "clear filters" link) without fighting the user's typing.
  const [seenUrlValue, setSeenUrlValue] = useState(urlValue);
  if (urlValue !== seenUrlValue) {
    setSeenUrlValue(urlValue);
    setValue(urlValue);
  }
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setParam("q", v.trim() || null), 250);
        }}
        className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-2 text-[13px] shadow-xs placeholder:text-faint focus:border-primary focus:outline-none focus:ring-4 focus:ring-[var(--ring)]"
      />
    </div>
  );
}

export function ParamSelect({ name, options, label }: { name: string; options: { value: string; label: string }[]; label: string }) {
  const params = useSearchParams();
  const setParam = useSetParam();
  return (
    <select
      aria-label={label}
      value={params.get(name) ?? options[0].value}
      onChange={(e) => setParam(name, e.target.value === options[0].value ? null : e.target.value)}
      className="h-9 cursor-pointer rounded-lg border border-line bg-surface px-3 pr-8 text-[13px] shadow-xs focus:border-primary focus:outline-none focus:ring-4 focus:ring-[var(--ring)]"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
