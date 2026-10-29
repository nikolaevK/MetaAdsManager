"use client";

import { useEffect, useState } from "react";
import { lookupPixelEvents } from "@/app/(app)/lookups";
import { Select } from "@/components/ui";
import { CONVERSION_EVENTS } from "@/lib/launch/spec";
import { RESULT_LABELS } from "@/lib/meta/actions";

/**
 * Conversion event picker. Once a pixel is chosen, the events it received in the last 7 days come
 * first with their counts, like Ads Manager's active events; the rest stay selectable below.
 */
export function ConversionEventSelect({
  accountId,
  pixelId,
  value,
  onChange,
}: {
  accountId: string;
  pixelId: string;
  value: string;
  onChange: (event: string) => void;
}) {
  const [activity, setActivity] = useState<{ pixelId: string; counts: Record<string, number> } | null>(null);
  useEffect(() => {
    if (!/^\d+$/.test(pixelId)) return;
    let live = true;
    // Debounced: a pixel ID can be typed in by hand.
    const timer = setTimeout(() => {
      lookupPixelEvents(accountId, pixelId).then((res) => {
        if (live && res.ok) setActivity({ pixelId, counts: Object.fromEntries(res.items.map((i) => [i.event, i.count])) });
      });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [accountId, pixelId]);

  const counts = activity?.pixelId === pixelId ? activity.counts : null;
  const option = (ev: string) => (
    <option key={ev} value={ev}>
      {RESULT_LABELS[ev] ?? ev}
      {counts?.[ev] ? ` · ${counts[ev].toLocaleString()} in 7 days` : ""}
    </option>
  );
  const active = counts ? CONVERSION_EVENTS.filter((ev) => counts[ev]).sort((a, b) => counts[b] - counts[a]) : [];

  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {counts ? (
        <>
          {active.length > 0 && <optgroup label="Active on this pixel (last 7 days)">{active.map(option)}</optgroup>}
          <optgroup label={active.length ? "No recent activity" : "No events received in the last 7 days"}>
            {CONVERSION_EVENTS.filter((ev) => !counts[ev]).map(option)}
          </optgroup>
        </>
      ) : (
        CONVERSION_EVENTS.map(option)
      )}
    </Select>
  );
}
