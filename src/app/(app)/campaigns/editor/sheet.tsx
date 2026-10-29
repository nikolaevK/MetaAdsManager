"use client";

import { ChartLine, ExternalLink, ImageIcon, Layers, Megaphone, RotateCcw, Settings2, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import Link from "next/link";
import { Alert, Badge, Button, buttonClass, cn, Skeleton, StatusDot } from "@/components/ui";
import { delivery } from "@/lib/format";
import type { AdData, AdsetData, CampaignData, EditorTarget, Level, ParentOptions } from "@/lib/meta/editor-types";
import { setStatusAction } from "../actions";
import { AdForm, NewAdForm } from "./ad-form";
import { loadObjectAction } from "./actions";
import { AdsetForm, NewAdsetForm } from "./adset-form";
import { CampaignForm } from "./campaign-form";
import { Switch } from "./fields";
import { ObjectPerformance } from "./performance";

export type { EditorTarget, ParentOptions };

const META: Record<Level, { label: string; icon: LucideIcon }> = {
  campaign: { label: "Campaign", icon: Megaphone },
  adset: { label: "Ad set", icon: Layers },
  ad: { label: "Ad", icon: ImageIcon },
};

export type SheetProps = {
  target: EditorTarget;
  accountId: string;
  clientId: string | null;
  currency: string;
  timeZone: string;
  canEdit: boolean;
  range: { since: string; until: string };
  parents: ParentOptions;
  onClose: () => void;
  /** Switch the sheet to another object or create flow (e.g. "Add an ad set" after creating a campaign). */
  onNavigate: (t: EditorTarget) => void;
};

type Loaded = CampaignData | AdsetData | AdData;

export function EditorSheet(props: SheetProps) {
  const { target, onClose } = props;
  const meta = META[target.level];
  const Icon = meta.icon;
  const [tab, setTab] = useState<"settings" | "performance">(target.mode === "edit" ? (target.tab ?? "settings") : "settings");
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [statusPending, startStatus] = useTransition();

  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    if (target.mode !== "edit") return;
    let live = true;
    loadObjectAction(target.level, target.id).then((res) => {
      if (!live) return;
      if (res.ok) {
        setData(res.data);
        setError(null);
      } else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [target, reloads]);
  const load = useCallback(() => setReloads((n) => n + 1), []);

  const close = useCallback(() => {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [close]);

  const title = target.mode === "create" ? `New ${meta.label.toLowerCase()}` : (data?.name ?? target.name);
  const d = data ? delivery(data.effectiveStatus) : null;

  const toggleStatus = (on: boolean) => {
    if (!data || target.mode !== "edit") return;
    startStatus(async () => {
      const res = await setStatusAction({ level: target.level, ids: [target.id], status: on ? "ACTIVE" : "PAUSED" });
      if (res?.ok) {
        toast(res.message ?? "Updated");
        setData({ ...data, status: on ? "ACTIVE" : "PAUSED" });
      } else toast(res?.error ?? "Couldn't change status", "error");
    });
  };

  const common = { ...props, setDirty, onSaved: load };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-[1px] animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <aside role="dialog" aria-modal="true" aria-labelledby="editor-title" className="flex h-full w-full max-w-[46rem] animate-sheet-in flex-col border-l border-line bg-canvas shadow-pop">
        <header className="flex items-start gap-3 border-b border-line bg-surface px-4 py-3.5 sm:px-5">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-brand-from to-primary text-white shadow-glow">
            <Icon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-faint">
              {target.mode === "create" ? "Create" : "Edit"} {meta.label.toLowerCase()}
            </p>
            <h2 id="editor-title" className="truncate text-[16px] font-semibold tracking-tight" title={title}>
              {title}
            </h2>
            {target.mode === "edit" && (
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                {d ? <StatusDot tone={d.tone} label={d.label} /> : <Skeleton className="h-3 w-16" />}
                <span className="tabular">ID {target.id}</span>
                {data && "learning" in data && data.learning && <Badge tone={data.learning === "SUCCESS" ? "success" : "warning"}>Learning: {data.learning.toLowerCase()}</Badge>}
              </div>
            )}
          </div>
          {target.mode === "edit" && data && (
            <label className="flex items-center gap-2 pt-1.5 text-[12.5px] text-muted">
              <span className="max-sm:sr-only">{data.status === "ACTIVE" ? "On" : "Off"}</span>
              <Switch on={data.status === "ACTIVE"} disabled={!props.canEdit || statusPending} label={`Turn ${data.status === "ACTIVE" ? "off" : "on"}`} onChange={toggleStatus} />
            </label>
          )}
          <button type="button" aria-label="Close" onClick={close} className="grid size-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-hover hover:text-ink">
            <X className="size-4" />
          </button>
        </header>

        {target.mode === "edit" && (
          <nav className="flex gap-1 border-b border-line bg-surface px-4 sm:px-5" aria-label="Editor sections">
            {(
              [
                { id: "settings", label: "Settings", icon: Settings2 },
                { id: "performance", label: "Performance", icon: ChartLine },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                aria-current={tab === t.id ? "page" : undefined}
                onClick={() => setTab(t.id)}
                className={cn(
                  "-mb-px inline-flex h-10 items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium transition-colors",
                  tab === t.id ? "border-primary text-ink" : "border-transparent text-muted hover:text-ink",
                )}
              >
                <t.icon className="size-3.5" aria-hidden />
                {t.label}
              </button>
            ))}
            <a
              href={`https://adsmanager.facebook.com/adsmanager/manage/${target.level === "campaign" ? "campaigns" : target.level === "adset" ? "adsets" : "ads"}?act=${props.accountId.replace("act_", "")}&selected_${target.level === "campaign" ? "campaign" : target.level === "adset" ? "adset" : "ad"}_ids=${target.id}`}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 self-center rounded-md px-2 py-1 text-[12px] text-faint transition-colors hover:bg-hover hover:text-ink"
            >
              Open in Meta <ExternalLink className="size-3" aria-hidden />
            </a>
          </nav>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {target.mode === "create" ? (
            target.level === "campaign" ? (
              <div className="p-5">
                <Alert tone="info" title="Campaigns are created in the campaign builder">
                  Build the campaign, its ad sets and ads step by step, with a draft that saves as you go.
                  <div className="mt-2">
                    <Link href="/launches/new" className={buttonClass("primary", "sm")}>
                      Open the campaign builder
                    </Link>
                  </div>
                </Alert>
              </div>
            ) : target.level === "adset" ? (
              <NewAdsetForm {...common} parentId={target.parentId} />
            ) : (
              <NewAdForm {...common} parentId={target.parentId} />
            )
          ) : tab === "performance" ? (
            <ObjectPerformance level={target.level} id={target.id} currency={props.currency} initialRange={props.range} />
          ) : error ? (
            <div className="p-5">
              <Alert tone="danger" title="Couldn't load from Meta">
                <p>{error}</p>
                <Button size="sm" className="mt-2" onClick={load}>
                  <RotateCcw /> Try again
                </Button>
              </Alert>
            </div>
          ) : !data ? (
            <div className="flex flex-col gap-4 p-5" aria-busy="true" aria-label="Loading">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-40 w-full rounded-xl" />
              ))}
            </div>
          ) : target.level === "campaign" ? (
            <CampaignForm key={JSON.stringify(data)} {...common} data={data as CampaignData} />
          ) : target.level === "adset" ? (
            <AdsetForm key={JSON.stringify(data)} {...common} data={data as AdsetData} />
          ) : (
            <AdForm key={JSON.stringify(data)} {...common} data={data as AdData} />
          )}
        </div>
      </aside>
    </div>
  );
}

export type FormProps = SheetProps & { setDirty: (d: boolean) => void; onSaved: () => void };

/** Sticky save bar at the bottom of every form. */
export function SaveBar({ children, note }: { children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:px-5">
      {note && <p className="mr-auto min-w-0 text-[12.5px] text-muted">{note}</p>}
      {children}
    </div>
  );
}
