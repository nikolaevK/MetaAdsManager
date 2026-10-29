"use client";

import { ArrowRight, Layers, Megaphone } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, buttonClass, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { label, OBJECTIVE_LABELS } from "@/lib/meta/labels";

type Options = {
  campaigns: { id: string; name: string; objective: string | null }[];
  adsets: { id: string; name: string; campaignId: string }[];
};

/** "Add ad sets" / "Add ads" without a campaign or ad set in scope: pick where they go, then open the builder. */
export function AddTargetPicker({ level, options }: { level: "adsets" | "ads"; options: Options }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [choice, setChoice] = useState("");
  const campaignName = useMemo(() => new Map(options.campaigns.map((c) => [c.id, c.name])), [options.campaigns]);
  const needle = q.trim().toLowerCase();

  const items =
    level === "adsets"
      ? options.campaigns.filter((c) => !needle || c.name.toLowerCase().includes(needle)).map((c) => ({ id: c.id, label: `${c.name} · ${label(OBJECTIVE_LABELS, c.objective)}` }))
      : options.adsets
          .filter((s) => !needle || s.name.toLowerCase().includes(needle) || (campaignName.get(s.campaignId) ?? "").toLowerCase().includes(needle))
          .map((s) => ({ id: s.id, label: `${s.name} · in ${campaignName.get(s.campaignId) ?? "campaign"}` }));
  const selected = items.some((i) => i.id === choice) ? choice : "";
  const go = () => selected && router.push(`/launches/new?${level === "adsets" ? "campaign" : "adset"}=${selected}`);

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader
        icon={level === "adsets" ? Megaphone : Layers}
        title={level === "adsets" ? "Which campaign do the new ad sets go into?" : "Which ad set do the new ads go into?"}
        description="Pick an existing one. To build a whole new campaign, use the campaign builder instead."
      />
      <div className="flex flex-col gap-4 p-5">
        {items.length === 0 && !needle ? (
          <p className="text-[13px] text-muted">
            This ad account has no {level === "adsets" ? "campaigns" : "ad sets"} yet.{" "}
            <Link href="/launches/new" className="font-medium text-primary-ink hover:underline">
              Build a new campaign
            </Link>
            .
          </p>
        ) : (
          <>
            <Field label="Search" htmlFor="parent-q">
              <Input id="parent-q" type="search" value={q} placeholder={level === "adsets" ? "Campaign name" : "Ad set or campaign name"} onChange={(e) => setQ(e.target.value)} />
            </Field>
            <Field label={level === "adsets" ? "Campaign" : "Ad set"} htmlFor="parent">
              <Select id="parent" value={selected} onChange={(e) => setChoice(e.target.value)} size={Math.min(10, Math.max(4, items.length))} className="h-auto py-1">
                {items.map((i) => (
                  <option key={i.id} value={i.id} className="truncate px-1 py-1">
                    {i.label}
                  </option>
                ))}
              </Select>
              {items.length === 0 && <p className="mt-1 text-[12.5px] text-muted">No matches for “{q.trim()}”.</p>}
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href="/launches/new" className={buttonClass("ghost", "sm")}>
                New campaign instead
              </Link>
              <Button variant="primary" disabled={!selected} onClick={go}>
                Continue <ArrowRight />
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
