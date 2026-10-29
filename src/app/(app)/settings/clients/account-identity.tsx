"use client";

import { AtSign, Flag, Pencil } from "lucide-react";
import { useState, useTransition } from "react";
import { lookupPages, type PageOption } from "@/app/(app)/lookups";
import { useSettingsAction } from "@/components/settings-ui";
import { Button, Select, Skeleton } from "@/components/ui";
import { setAccountDefaults } from "./actions";
import { DetailPanel } from "./detail-panel";

/** Default Facebook Page + Instagram account used when building creatives for this ad account. */
export function AccountIdentity({
  accountId,
  pageId,
  instagramUserId,
  canEdit,
}: {
  accountId: string;
  pageId: string | null;
  instagramUserId: string | null;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pages, setPages] = useState<PageOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(pageId ?? "");
  const [ig, setIg] = useState(instagramUserId ?? "");
  const [loading, startLoading] = useTransition();
  const { pending, run } = useSettingsAction();

  const knownPage = pages?.find((p) => p.id === pageId);
  const notSet = <span className="text-faint">Not set</span>;

  if (!editing) {
    return (
      <DetailPanel
        title="Default identity"
        action={
          canEdit && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-primary-ink transition-colors hover:bg-primary-soft"
              onClick={() => {
                setEditing(true);
                if (!pages)
                  startLoading(async () => {
                    const res = await lookupPages(accountId);
                    if (res.ok) setPages(res.items);
                    else setError(res.error);
                  });
              }}
            >
              <Pencil className="size-3" aria-hidden /> Change
            </button>
          )
        }
      >
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-[13px]">
          <dt className="flex items-center gap-2 text-muted">
            <Flag className="size-3.5 text-faint" aria-hidden /> Page
          </dt>
          <dd className="truncate">{pageId ? (knownPage?.name ?? <span className="tabular">{pageId}</span>) : notSet}</dd>
          <dt className="flex items-center gap-2 text-muted">
            <AtSign className="size-3.5 text-faint" aria-hidden /> Instagram
          </dt>
          <dd className="truncate">
            {instagramUserId ? (knownPage?.instagram?.username ? `@${knownPage.instagram.username}` : <span className="tabular">{instagramUserId}</span>) : notSet}
          </dd>
        </dl>
      </DetailPanel>
    );
  }

  const selected = pages?.find((p) => p.id === page);
  return (
    <DetailPanel title="Default identity">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => setAccountDefaults({ accountId, pageId: page || null, instagramUserId: ig || null }), {
            onOk: () => setEditing(false),
          });
        }}
      >
        {loading && (
          <div role="status" aria-label="Loading Pages…" className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full rounded-lg" />
            <Skeleton className="h-8 w-full rounded-lg" />
          </div>
        )}
        {error && <p className="text-xs text-danger-ink">{error}</p>}
        {pages && (
          <>
            <Select
              aria-label="Facebook Page"
              value={page}
              onChange={(e) => {
                setPage(e.target.value);
                setIg(pages.find((p) => p.id === e.target.value)?.instagram?.id ?? "");
              }}
              className="h-8 text-[13px]"
            >
              <option value="">No default Page</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Instagram account" value={ig} onChange={(e) => setIg(e.target.value)} className="h-8 text-[13px]" disabled={!page}>
              <option value="">No Instagram account</option>
              {selected?.instagram && (
                <option value={selected.instagram.id}>@{selected.instagram.username ?? selected.instagram.id}</option>
              )}
            </Select>
          </>
        )}
        <div className="flex justify-end gap-2 pt-0.5">
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" variant="primary" disabled={pending || loading || !pages}>
            Save
          </Button>
        </div>
      </form>
    </DetailPanel>
  );
}
