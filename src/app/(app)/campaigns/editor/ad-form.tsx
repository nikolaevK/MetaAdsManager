"use client";

import { Check, Eye, FolderOpen, ImageIcon, MessageSquareText, ShieldAlert, UserRound } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { baseName } from "@/app/(app)/library/pairing";
import { MediaThumb } from "@/app/(app)/library/media-thumb";
import { MediaSlots } from "@/app/(app)/launches/new/media";
import { lookupPages, type PageOption } from "@/app/(app)/lookups";
import { PreviewDialog } from "@/app/(app)/launches/preview-dialog";
import { toast } from "@/components/toast";
import { Alert, Badge, Button, cn, Field, Input, Select, Textarea } from "@/components/ui";
import { mediaPick } from "@/lib/launch/draft";
import { CTA_TYPES } from "@/lib/launch/spec";
import type { AdCopy, AdData, LibraryAsset, LibraryCreative } from "@/lib/meta/editor-types";
import { CTA_LABELS } from "@/lib/meta/labels";
import { PREVIEW_FORMATS } from "@/lib/meta/preview-formats";
import { createAdAction, defaultUrlTagsAction, libraryAssetsAction, libraryCreativesAction, previewAdAction, previewNewAdAction, saveAdAction } from "./actions";
import { Counter, ReadOnly, Section } from "./fields";
import { SaveBar, type FormProps } from "./sheet";

const FORMAT_LABEL: Record<AdData["format"], string> = { image: "Single image", video: "Single video", flexible: "Placement-customized", post: "Existing post", unknown: "Other format" };
const urlOk = (u: string) => /^https?:\/\/[^\s.]+\.[^\s]+$/.test(u.trim());

function CopyFields({ copy, onChange, disabled }: { copy: AdCopy; onChange: (c: AdCopy) => void; disabled?: boolean }) {
  const set = <K extends keyof AdCopy>(k: K, v: AdCopy[K]) => onChange({ ...copy, [k]: v });
  return (
    <>
      <Field label={<span className="flex items-center justify-between">Primary text <Counter value={copy.primaryText} max={2200} /></span>}>
        <Textarea rows={5} value={copy.primaryText} disabled={disabled} maxLength={2200} placeholder="Tell people what your ad is about" onChange={(e) => set("primaryText", e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={<span className="flex items-center justify-between">Headline <Counter value={copy.headline} max={255} /></span>}>
          <Input value={copy.headline} disabled={disabled} maxLength={255} onChange={(e) => set("headline", e.target.value)} />
        </Field>
        <Field label={<span className="flex items-center justify-between">Description <Counter value={copy.description} max={255} /></span>} hint="Optional">
          <Input value={copy.description} disabled={disabled} maxLength={255} onChange={(e) => set("description", e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <Field label="Website URL" error={copy.url && !urlOk(copy.url) ? "Enter a full URL starting with https://" : undefined}>
          <Input type="url" value={copy.url} disabled={disabled} placeholder="https://example.com/product" onChange={(e) => set("url", e.target.value)} />
        </Field>
        <Field label="Call to action">
          <Select value={copy.cta} disabled={disabled} onChange={(e) => set("cta", e.target.value)}>
            {[...new Set([...CTA_TYPES, copy.cta])].map((c) => (
              <option key={c} value={c}>
                {CTA_LABELS[c] ?? c}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="URL parameters" hint="Appended to the website URL, e.g. utm_source=facebook&utm_campaign={{campaign.name}}">
        <Input value={copy.urlTags} disabled={disabled} className="font-mono text-[12.5px]" onChange={(e) => set("urlTags", e.target.value)} />
      </Field>
    </>
  );
}

const copyValid = (c: AdCopy) => c.primaryText.trim() && c.headline.trim() && urlOk(c.url);

export function AdForm({ data, canEdit, setDirty, onSaved }: FormProps & { data: AdData }) {
  const [name, setName] = useState(data.name);
  const [copy, setCopy] = useState(data.copy);
  const [preview, setPreview] = useState(false);
  const [pending, start] = useTransition();
  const copyChanged = JSON.stringify(copy) !== JSON.stringify(data.copy);
  const dirty = (name.trim() && name !== data.name) || copyChanged;
  useEffect(() => setDirty(!!dirty), [dirty, setDirty]);

  const save = () =>
    start(async () => {
      const res = await saveAdAction(data.id, {
        ...(name.trim() && name !== data.name ? { name: name.trim() } : {}),
        ...(copyChanged ? { copy } : {}),
      });
      if (res?.ok) {
        toast(res.message ?? "Saved");
        setDirty(false);
        onSaved();
      } else toast(res?.error ?? "Couldn't save", "error");
    });

  const ro = !canEdit;
  return (
    <>
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        {(data.review.length > 0 || data.issues.length > 0) && (
          <Alert tone="danger" title="Review feedback">
            <ul className="list-disc pl-4">
              {[...data.review, ...data.issues.map((i) => i.message)].map((m, k) => (
                <li key={k}>{m}</li>
              ))}
            </ul>
          </Alert>
        )}
        <Section title="Ad" icon={ImageIcon}>
          <Field label="Ad name">
            <Input value={name} disabled={ro} maxLength={400} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="flex gap-4">
            {data.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Meta CDN thumbnail
              <img src={data.thumbnailUrl} alt="" className="size-28 shrink-0 rounded-xl border border-line object-cover" />
            ) : (
              <span className="grid size-28 shrink-0 place-items-center rounded-xl border border-line bg-surface-2 text-faint">
                <ImageIcon className="size-6" />
              </span>
            )}
            <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
              <ReadOnly label="Ad set">{data.adsetName || data.adsetId}</ReadOnly>
              <ReadOnly label="Format">{FORMAT_LABEL[data.format]}</ReadOnly>
              <ReadOnly label="Facebook Page">{data.pageId ?? "—"}</ReadOnly>
              <ReadOnly label="Creative">
                <span className="block truncate" title={data.creativeName ?? undefined}>
                  {data.creativeName ?? data.creativeId ?? "—"}
                </span>
              </ReadOnly>
              <div className="sm:col-span-2">
                <Button size="sm" onClick={() => setPreview(true)}>
                  <Eye /> Preview placements
                </Button>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Ad copy" icon={MessageSquareText} description={data.copyEditable ? "Saving new copy creates a new creative for this ad. The ad keeps its history and goes back through Meta review." : undefined}>
          {data.copyEditable ? (
            <CopyFields copy={copy} onChange={setCopy} disabled={ro} />
          ) : (
            <Alert tone="info">
              {data.format === "post"
                ? "This ad uses an existing Facebook or Instagram post, so its text can only be changed on the post itself."
                : "This creative format (e.g. carousel) can't be edited here. Open it in Meta to change it."}
            </Alert>
          )}
        </Section>
      </div>
      {canEdit && (
        <SaveBar note={copyChanged ? "New copy → new creative → Meta review" : dirty ? "Unsaved changes" : "All changes saved"}>
          <Button
            variant="ghost"
            disabled={!dirty || pending}
            onClick={() => {
              setName(data.name);
              setCopy(data.copy);
            }}
          >
            Discard
          </Button>
          <Button variant="primary" disabled={!dirty || pending || (copyChanged && !copyValid(copy))} onClick={save}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </SaveBar>
      )}
      {preview && <PreviewDialog title={data.name} formats={PREVIEW_FORMATS} load={(format) => previewAdAction(data.id, format)} onClose={() => setPreview(false)} />}
    </>
  );
}

export function NewAdForm({ accountId, parents, parentId, setDirty, onClose, onNavigate }: FormProps & { parentId?: string }) {
  const [adsetId, setAdsetId] = useState(parentId ?? parents.adsets[0]?.id ?? "");
  const [name, setName] = useState("");
  const [pages, setPages] = useState<PageOption[] | null>(null);
  const [pageId, setPageId] = useState("");
  const [igId, setIgId] = useState("");
  const [library, setLibrary] = useState<LibraryCreative[] | null>(null);
  const [files, setFiles] = useState<{ clientId: string; items: LibraryAsset[] } | null>(null);
  const [slots, setSlots] = useState({ feed: "", vertical: "" });
  const [copy, setCopy] = useState<AdCopy>({ primaryText: "", headline: "", description: "", url: "", cta: "SHOP_NOW", urlTags: "" });
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => setDirty(!!(name.trim() || copy.primaryText.trim())), [name, copy.primaryText, setDirty]);

  useEffect(() => {
    let live = true;
    lookupPages(accountId).then((res) => {
      if (!live) return;
      if (res.ok) {
        setPages(res.items);
        // Prefer a Page this ad account already uses (or its business owns) over one only the token can reach.
        const first = res.items.find((p) => p.source === "promoted") ?? res.items.find((p) => p.source === "business") ?? res.items[0];
        setPageId((p) => p || first?.id || "");
        setIgId((i) => i || first?.instagram?.id || "");
      } else {
        // Fall back to typing the Page ID rather than a select stuck on "Loading".
        setPages([]);
        setError(res.error);
      }
    });
    libraryCreativesAction(accountId).then((res) => live && (res.ok ? setLibrary(res.items) : setError(res.error)));
    libraryAssetsAction(accountId).then((res) => live && (res.ok ? setFiles({ clientId: res.clientId, items: res.items }) : setError(res.error)));
    defaultUrlTagsAction(accountId).then((tags) => live && setCopy((c) => (c.urlTags ? c : { ...c, urlTags: tags })));
    return () => {
      live = false;
    };
  }, [accountId]);

  const page = pages?.find((p) => p.id === pageId);
  // The server turns the picked files into a library creative when the ad is created.
  const media = mediaPick({ feedAssetId: slots.feed, verticalAssetId: slots.vertical });
  const chosen = library?.find((c) => c.assetId === media?.feedAssetId && c.verticalAssetId === (media?.verticalAssetId ?? media?.feedAssetId));
  const feedFile = files?.items.find((f) => f.id === media?.feedAssetId);
  const pickCreative = (c: LibraryCreative) => setSlots({ feed: c.assetId, vertical: c.single ? "" : c.verticalAssetId });
  const input = { adsetId, name: name.trim() || chosen?.name || (feedFile ? baseName(feedFile.fileName) : ""), pageId, instagramUserId: igId || undefined, media: media!, copy };
  const canCreate = adsetId && input.name && pageId && media && copyValid(copy);

  const create = () =>
    start(async () => {
      setError(null);
      const res = await createAdAction(input);
      if (res?.ok && res.id) {
        toast(res.message ?? "Ad created");
        setDirty(false);
        onNavigate({ mode: "edit", level: "ad", id: res.id, name: input.name });
      } else {
        setError(res?.error ?? "Couldn't create the ad");
        toast(res?.error ?? "Couldn't create the ad", "error");
      }
    });

  if (parents.adsets.length === 0 && !parentId) {
    return (
      <div className="p-5">
        <Alert tone="info" title="Create an ad set first">
          Ads live inside an ad set, which holds the audience and budget.
          <div className="mt-2">
            <Button size="sm" variant="primary" onClick={() => onNavigate({ mode: "create", level: "adset" })}>
              New ad set
            </Button>
          </div>
        </Alert>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <Section title="Ad" icon={ImageIcon}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ad set">
              <Select value={adsetId} onChange={(e) => setAdsetId(e.target.value)}>
                {parentId && !parents.adsets.some((s) => s.id === parentId) && <option value={parentId}>New ad set ({parentId})</option>}
                {parents.adsets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Ad name" hint="Defaults to the creative's name">
              <Input value={name} maxLength={400} placeholder={chosen?.name ?? (feedFile ? baseName(feedFile.fileName) : "e.g. UGC hook — v2")} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title="Identity" icon={UserRound} description="The Facebook Page and Instagram account the ad runs as.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Facebook Page" hint={pages?.length === 0 ? "Meta returned no Pages for this ad account. Give the system user access to the Page in Business Settings, or enter the Page ID." : undefined}>
              {pages?.length === 0 ? (
                <Input value={pageId} placeholder="Page ID, e.g. 104523…" inputMode="numeric" onChange={(e) => setPageId(e.target.value.replace(/\D/g, ""))} />
              ) : (
                <Select
                  value={pageId}
                  disabled={!pages}
                  onChange={(e) => {
                    setPageId(e.target.value);
                    setIgId(pages?.find((p) => p.id === e.target.value)?.instagram?.id ?? "");
                  }}
                >
                  {!pages && <option>Loading pages…</option>}
                  {pages?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Instagram account">
              <Select value={igId} onChange={(e) => setIgId(e.target.value)}>
                <option value="">Use Facebook Page</option>
                {page?.instagram && <option value={page.instagram.id}>@{page.instagram.username ?? page.instagram.id}</option>}
              </Select>
            </Field>
          </div>
        </Section>

        <Section
          title="Media"
          icon={FolderOpen}
          description="Upload, crop or pick a file for feeds and for Stories & Reels, or choose a creative from the library below. New files are saved to the library."
        >
          {files ? (
            <MediaSlots
              clientId={files.clientId}
              assets={files.items}
              feedAssetId={slots.feed}
              verticalAssetId={slots.vertical}
              onAssetsAdded={(list) => setFiles((f) => (f ? { ...f, items: [...list.filter((a) => !f.items.some((x) => x.id === a.id)), ...f.items] } : f))}
              onSlot={(slot, id) => setSlots((x) => ({ ...x, [slot]: id }))}
            />
          ) : (
            <p className="text-[12.5px] text-faint">Loading library…</p>
          )}
          {library && library.length > 0 && <p className="text-[12.5px] font-medium text-muted">Or pick a library creative</p>}
          {!library ? null : library.length === 0 ? null : (
            <ul className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
              {library.map((c) => {
                const on = c.id === chosen?.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => pickCreative(c)}
                      className={cn("group relative block w-full overflow-hidden rounded-xl border text-left transition", on ? "border-primary ring-4 ring-[var(--ring)]" : "border-line hover:border-faint")}
                    >
                      <MediaThumb id={c.assetId} kind={c.kind} alt={c.name} className="aspect-square w-full" />
                      <span className="block truncate px-2 py-1.5 text-[12px] font-medium">{c.name}</span>
                      <span className="absolute left-1.5 top-1.5 flex gap-1">
                        <Badge tone="muted" className="bg-surface/90">
                          {c.kind === "video" ? "Video" : "Image"}
                        </Badge>
                        {!c.single && (
                          <Badge tone="info" className="bg-surface/90">
                            1:1 + 9:16
                          </Badge>
                        )}
                      </span>
                      {on && (
                        <span className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-primary text-white shadow">
                          <Check className="size-3.5" />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Ad copy" icon={MessageSquareText}>
          <CopyFields copy={copy} onChange={setCopy} />
        </Section>
        {error && (
          <Alert tone="danger" title="Couldn't create the ad">
            {error}
          </Alert>
        )}
        {!error && (
          <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
            <ShieldAlert className="size-3.5" aria-hidden /> The ad is created off. Meta reviews it once it&apos;s turned on.
          </p>
        )}
      </div>
      <SaveBar>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!canCreate || pending} onClick={() => setPreview(true)}>
          <Eye /> Preview
        </Button>
        <Button variant="create" disabled={!canCreate || pending} onClick={create}>
          {pending ? "Creating…" : "Create ad"}
        </Button>
      </SaveBar>
      {preview && <PreviewDialog title={input.name || "New ad"} formats={PREVIEW_FORMATS} load={(format) => previewNewAdAction(input, format)} onClose={() => setPreview(false)} />}
    </>
  );
}
