"use client";

import { ChartLine, ExternalLink, ImageIcon, Layers, Megaphone, Plus, RotateCcw, Settings2, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { Modal } from "@/components/modal";
import { toast } from "@/components/toast";
import Link from "next/link";
import { Alert, Badge, Button, cn, focusRing, Skeleton, StatusDot } from "@/components/ui";
import { delivery, learningStage } from "@/lib/format";
import type { AdData, AdsetData, CampaignData, EditorTarget, Level } from "@/lib/meta/editor-types";
import { setStatusAction } from "../actions";
import { AdForm } from "./ad-form";
import { loadObjectAction } from "./actions";
import { AdsetForm } from "./adset-form";
import { CampaignForm } from "./campaign-form";
import { Switch } from "./fields";
import { ObjectPerformance } from "./performance";

export type { EditorTarget };

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
  onClose: () => void;
};

type Loaded = CampaignData | AdsetData | AdData;

export function EditorSheet(props: SheetProps) {
  const { target, onClose } = props;
  const meta = META[target.level];
  const Icon = meta.icon;
  const [tab, setTab] = useState<"settings" | "performance">(target.tab ?? "settings");
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [statusPending, startStatus] = useTransition();

  const [reloads, setReloads] = useState(0);
  useEffect(() => {
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

  const confirm = useConfirm();
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = async () => {
    if (dirty && !(await confirm({ title: "Discard unsaved changes?", body: "Your edits haven't been saved to Meta.", confirmLabel: "Discard changes", cancelLabel: "Keep editing", tone: "danger" })))
      return;
    onClose();
  };

  const title = data?.name ?? target.name;
  const d = data ? delivery(data.effectiveStatus) : null;
  const learning = data && "learning" in data && data.learning ? learningStage(data.learning) : null;

  const toggleStatus = (on: boolean) => {
    if (!data) return;
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
    <Modal
      onClose={close}
      initialFocus={closeButton}
      aria-labelledby="editor-title"
      overlayClassName="z-50 flex justify-end"
      className="flex h-full w-full max-w-[46rem] animate-sheet-in flex-col border-l border-line bg-canvas shadow-pop"
    >
      <header className="flex items-start gap-3 border-b border-line bg-surface px-4 py-3.5 sm:px-5">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-brand-from to-primary text-on-primary shadow-glow">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wider text-faint">Edit {meta.label.toLowerCase()}</p>
          <h2 id="editor-title" className="truncate text-[16px] font-semibold tracking-tight" title={title}>
            {title}
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
            {d ? <StatusDot tone={d.tone} label={d.label} /> : !error && <Skeleton className="h-3 w-16" />}
            <span className="tabular">ID {target.id}</span>
            {learning && (
              <span title="Learning phase">
                <Badge tone={learning.tone}>{learning.label}</Badge>
              </span>
            )}
          </div>
        </div>
        {data && (
          <label className="flex items-center gap-2 pt-1.5 text-[12.5px] text-muted">
            <span className="max-sm:sr-only">{data.status === "ACTIVE" ? "On" : "Off"}</span>
            <Switch on={data.status === "ACTIVE"} disabled={!props.canEdit || statusPending} label={`Turn ${data.status === "ACTIVE" ? "off" : "on"}`} onChange={toggleStatus} />
          </label>
        )}
        <button
          ref={closeButton}
          type="button"
          aria-label="Close"
          onClick={close}
          className={cn("grid size-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-hover hover:text-ink pointer-coarse:size-10", focusRing)}
        >
          <X className="size-4" />
        </button>
      </header>

      {(
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
                "-mb-px inline-flex h-10 items-center gap-1.5 rounded-t-md border-b-2 px-2.5 text-[13px] font-medium transition-colors max-sm:px-2",
                focusRing,
                tab === t.id ? "border-primary text-ink" : "border-transparent text-muted hover:text-ink",
              )}
            >
              <t.icon className="size-3.5" aria-hidden />
              {t.label}
            </button>
          ))}
          {props.canEdit && target.level !== "ad" && (
            <Link
              href={target.level === "campaign" ? `/launches/new?campaign=${target.id}` : `/launches/new?adset=${target.id}`}
              className={cn("ml-auto inline-flex items-center gap-1 self-center whitespace-nowrap rounded-md px-2 py-1 text-[12px] font-medium text-primary-ink transition-colors hover:bg-hover", focusRing)}
            >
              <Plus className="size-3 max-sm:hidden" aria-hidden /> {target.level === "campaign" ? "Add ad sets" : "Add ads"}
            </Link>
          )}
          <a
            href={`https://adsmanager.facebook.com/adsmanager/manage/${target.level === "campaign" ? "campaigns" : target.level === "adset" ? "adsets" : "ads"}?act=${props.accountId.replace("act_", "")}&selected_${target.level === "campaign" ? "campaign" : target.level === "adset" ? "adset" : "ad"}_ids=${target.id}`}
            target="_blank"
            rel="noreferrer"
            className={cn("inline-flex items-center gap-1 self-center whitespace-nowrap rounded-md px-2 py-1 text-[12px] text-faint transition-colors hover:bg-hover hover:text-ink", focusRing, !(props.canEdit && target.level !== "ad") && "ml-auto")}
          >
            <span className="max-sm:sr-only">Open in</span> Meta <ExternalLink className="size-3" aria-hidden />
          </a>
        </nav>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "performance" ? (
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
    </Modal>
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
