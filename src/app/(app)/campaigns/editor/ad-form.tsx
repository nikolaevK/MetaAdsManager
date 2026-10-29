"use client";

import { Eye, ImageIcon, MessageSquareText, Users } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { PreviewDialog } from "@/app/(app)/launches/preview-dialog";
import { toast } from "@/components/toast";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { WEBSITE_CTAS } from "@/lib/launch/objectives";
import { isCreativeFeature, type CreativeFeature } from "@/lib/launch/spec";
import type { AdCopy, AdData } from "@/lib/meta/editor-types";
import { CTA_LABELS } from "@/lib/meta/labels";
import { PREVIEW_FORMATS } from "@/lib/meta/preview-formats";
import { previewAdAction, saveAdAction } from "./actions";
import { Enhancements, TextOptions } from "./creative-fields";
import { Counter, ReadOnly, Section } from "./fields";
import { SaveBar, type FormProps } from "./sheet";

const FORMAT_LABEL: Record<AdData["format"], string> = {
  image: "Single image",
  video: "Single video",
  flexible: "Flexible",
  placement: "Placement-customized",
  carousel: "Carousel",
  post: "Existing post",
  unknown: "Other format",
};
const urlOk = (u: string) => /^https?:\/\/[^\s.]+\.[^\s]+$/.test(u.trim());

function CopyFields({ copy, onChange, disabled, maxTexts, fixedTexts, website }: { copy: AdCopy; onChange: (c: AdCopy) => void; disabled?: boolean; maxTexts: number; fixedTexts?: boolean; website: boolean }) {
  const set = <K extends keyof AdCopy>(k: K, v: AdCopy[K]) => onChange({ ...copy, [k]: v });
  return (
    <>
      <TextOptions label="Primary text" values={copy.primaryTexts} max={2200} limit={maxTexts} fixed={fixedTexts} multiline disabled={disabled} placeholder="Tell people what your ad is about" onChange={(v) => set("primaryTexts", v)} />
      <TextOptions label="Headline" values={copy.headlines} max={255} limit={maxTexts} fixed={fixedTexts} disabled={disabled} placeholder="Write a short headline" onChange={(v) => set("headlines", v)} />
      {maxTexts === 1 && !fixedTexts && <p className="-mt-2 text-[12.5px] text-faint">This ad&apos;s format takes one primary text and one headline.</p>}
      <Field label={<span className="flex items-center justify-between">Description <Counter value={copy.description} max={255} /></span>} hint="Optional. Shown under the headline in some placements.">
        <Input value={copy.description} disabled={disabled} maxLength={255} onChange={(e) => set("description", e.target.value)} />
      </Field>
      {website && (
        <>
          <Field label="Website URL" error={copy.url && !urlOk(copy.url) ? "Enter a full URL starting with https://" : undefined}>
            <Input type="url" value={copy.url} disabled={disabled} placeholder="https://example.com/product" onChange={(e) => set("url", e.target.value.trim())} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Display link" hint="Optional. Shown instead of the full URL.">
              <Input value={copy.displayLink} disabled={disabled} maxLength={100} placeholder="example.com" onChange={(e) => set("displayLink", e.target.value)} />
            </Field>
            <Field label="Call to action">
              <Select value={copy.cta} disabled={disabled} onChange={(e) => set("cta", e.target.value)}>
                {[...new Set([...WEBSITE_CTAS, copy.cta])].map((c) => (
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
      )}
    </>
  );
}

const copyValid = (c: AdCopy, website: boolean) => c.primaryTexts.every((t) => t.trim()) && c.headlines.every((t) => t.trim()) && (!website || urlOk(c.url));
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

export function AdForm({ data, canEdit, setDirty, onSaved }: FormProps & { data: AdData }) {
  const [name, setName] = useState(data.name);
  const [copy, setCopy] = useState(data.copy);
  const initialFeatures = data.features.filter(isCreativeFeature);
  const [features, setFeatures] = useState<CreativeFeature[]>(initialFeatures);
  const [multi, setMulti] = useState<"keep" | "on" | "off">("keep");
  const [preview, setPreview] = useState(false);
  const [pending, start] = useTransition();
  const copyChanged = JSON.stringify(copy) !== JSON.stringify(data.copy);
  const featuresChanged = !sameList(features, initialFeatures);
  const dirty = (name.trim() && name !== data.name) || copyChanged || featuresChanged || multi !== "keep";
  useEffect(() => setDirty(!!dirty), [dirty, setDirty]);

  const save = () =>
    start(async () => {
      const res = await saveAdAction(data.id, {
        ...(name.trim() && name !== data.name ? { name: name.trim() } : {}),
        ...(copyChanged ? { copy } : {}),
        ...(featuresChanged ? { features } : {}),
        ...(multi !== "keep" ? { multiAdvertiser: multi } : {}),
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
          <div className="flex flex-col gap-4 sm:flex-row">
            {data.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Meta CDN thumbnail
              <img src={data.thumbnailUrl} alt="" className="size-28 shrink-0 rounded-xl border border-line object-cover" />
            ) : (
              <span className="grid size-28 shrink-0 place-items-center rounded-xl border border-line bg-surface-2 text-faint">
                <ImageIcon className="size-6" />
              </span>
            )}
            <div className="grid grid-cols-1 min-w-0 flex-1 gap-3 sm:grid-cols-2">
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
            <CopyFields copy={copy} onChange={setCopy} disabled={ro} maxTexts={data.maxTexts} fixedTexts={data.fixedTexts} website={data.website} />
          ) : (
            <Alert tone="info">
              {data.format === "post"
                ? "This ad uses an existing Facebook or Instagram post, so its text can only be changed on the post itself."
                : "This creative format (e.g. carousel) can't be edited here. Open it in Meta to change it."}
            </Alert>
          )}
        </Section>
        {data.copyEditable && (
          <>
            <Enhancements value={features} onChange={setFeatures} disabled={ro} />
            <Section title="Multi-advertiser ads" icon={Users} description="Whether Meta may show this ad in a unit next to other businesses' ads.">
              <Field label="Setting for the edited ad">
                <Select value={multi} disabled={ro} onChange={(e) => setMulti(e.target.value as typeof multi)}>
                  <option value="keep">Keep the current setting</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </Select>
              </Field>
            </Section>
          </>
        )}
      </div>
      {canEdit && (
        <SaveBar note={copyChanged || featuresChanged || multi !== "keep" ? "Changes → new creative → Meta review" : dirty ? "Unsaved changes" : "All changes saved"}>
          <Button
            variant="ghost"
            disabled={!dirty || pending}
            onClick={() => {
              setName(data.name);
              setCopy(data.copy);
              setFeatures(initialFeatures);
              setMulti("keep");
            }}
          >
            Discard
          </Button>
          <Button variant="primary" disabled={!dirty || pending || (copyChanged && !copyValid(copy, data.website))} onClick={save}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </SaveBar>
      )}
      {preview && <PreviewDialog title={data.name} formats={PREVIEW_FORMATS} load={(format) => previewAdAction(data.id, format)} onClose={() => setPreview(false)} />}
    </>
  );
}
