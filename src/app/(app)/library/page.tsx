import { Archive, CircleCheck, Film, Image as ImageIcon, Images, LayoutGrid, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { buttonClass, Card, EmptyState, PageHeader, PageSkeleton, Segmented, segmentClass } from "@/components/ui";
import { SearchInput } from "@/components/url-filters";
import { hasRole } from "@/lib/auth/session";
import { getLibrary } from "@/lib/queries/library";
import { getWorkspace } from "@/lib/workspace";
import { CreativeCard } from "./creative-card";
import { UnpairedAssets } from "./unpaired-assets";
import { Uploader } from "./uploader";

export const metadata: Metadata = { title: "Creative library" };

export default function LibraryPage(props: PageProps<"/library">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Library searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Library({ searchParams }: { searchParams: PageProps<"/library">["searchParams"] }) {
  const sp = await searchParams;
  const { user, client } = await getWorkspace();
  if (!client) {
    return (
      <Card>
        <EmptyState
          icon={Users}
          title="No client yet"
          action={
            <Link href="/settings/clients" className={buttonClass("primary")}>
              Add a client
            </Link>
          }
        >
          The creative library is organised per client. Add a client and connect an ad account first.
        </EmptyState>
      </Card>
    );
  }

  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const kind = str("kind") === "image" || str("kind") === "video" ? (str("kind") as "image" | "video") : undefined;
  const archived = str("archived") === "1";
  const q = str("q")?.trim() || undefined;
  const canEdit = hasRole(user, "buyer");
  const { creatives, assets, unpaired } = await getLibrary(client.id, { q, kind, archived });

  /** Same params ParamSelect used to write: the default option removes the key. */
  const hrefWith = (key: string, value: string | null) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (typeof v === "string") p.set(k, v);
      else if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    }
    if (value) p.set(key, value);
    else p.delete(key);
    const qs = p.toString();
    return qs ? `/library?${qs}` : "/library";
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Creative library"
        description={`${client.name} · pair a 1:1 feed file with a 9:16 Stories/Reels file so each placement gets the right crop, or use any single image or video on its own.`}
      />

      {canEdit && <Uploader clientId={client.id} />}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-60">
          <SearchInput placeholder="Search creatives and files" />
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <Segmented className="max-sm:[&_svg]:hidden">
            <FilterLink href={hrefWith("kind", null)} active={!kind} label="All media">
              <LayoutGrid aria-hidden /> All
            </FilterLink>
            <FilterLink href={hrefWith("kind", "image")} active={kind === "image"} label="Images">
              <ImageIcon aria-hidden /> Images
            </FilterLink>
            <FilterLink href={hrefWith("kind", "video")} active={kind === "video"} label="Videos">
              <Film aria-hidden /> Videos
            </FilterLink>
          </Segmented>
          <Segmented className="max-sm:[&_svg]:hidden">
            <FilterLink href={hrefWith("archived", null)} active={!archived} label="Active creatives">
              Active
            </FilterLink>
            <FilterLink href={hrefWith("archived", "1")} active={archived} label="Archived creatives">
              <Archive aria-hidden /> Archived
            </FilterLink>
          </Segmented>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <SectionTitle title={archived ? "Archived creatives" : "Creatives"} count={creatives.length} hint="A 1:1 + 9:16 pair, or one file for every placement" />
        {creatives.length === 0 ? (
          <Card>
            <EmptyState icon={archived ? Archive : Images} title={archived ? "No archived creatives" : q || kind ? "No matching creatives" : "No creatives yet"}>
              {archived
                ? "Archived creatives show up here and can be restored."
                : q || kind
                  ? "Try a different search or media type."
                  : "Upload images or videos, then pair a 1:1 and a 9:16 version below (matching file names pair automatically) or use a single file on its own."}
            </EmptyState>
          </Card>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
            {creatives.map((c) => {
              const sq = assets.get(c.squareAssetId);
              const vt = assets.get(c.verticalAssetId);
              return (
                <li key={c.id}>
                  <CreativeCard
                    creative={{ id: c.id, name: c.name, kind: c.kind, angle: c.angle, createdAt: c.createdAt, archivedAt: c.archivedAt }}
                    square={sq ? { id: sq.id, aspect: sq.aspect } : null}
                    vertical={vt ? { id: vt.id, aspect: vt.aspect } : null}
                    canEdit={canEdit}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!archived && (
        <section className="flex flex-col gap-3">
          <SectionTitle title="Unpaired files" count={unpaired.length} hint={unpaired.length > 0 && canEdit ? "Pair a feed + Stories file, or use one alone" : undefined} />
          {unpaired.length === 0 ? (
            <p className="flex items-center gap-2 rounded-xl border border-dashed border-line px-4 py-3 text-[13px] text-muted">
              <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
              Every uploaded file belongs to a creative.
            </p>
          ) : (
            <UnpairedAssets
              canEdit={canEdit}
              assets={unpaired.map((a) => ({
                id: a.id,
                kind: a.kind,
                fileName: a.fileName,
                aspect: a.aspect,
                sizeBytes: a.sizeBytes,
                width: a.width,
                height: a.height,
              }))}
            />
          )}
        </section>
      )}
    </div>
  );
}

function FilterLink({ href, active, label, children }: { href: string; active: boolean; label: string; children: ReactNode }) {
  return (
    <Link href={href} replace scroll={false} role="tab" aria-selected={active} aria-label={label} className={segmentClass(active)}>
      {children}
    </Link>
  );
}

function SectionTitle({ title, count, hint }: { title: string; count: number; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="flex items-center gap-2 text-[14.5px] font-semibold tracking-tight">
        {title}
        <span className="tabular rounded-full bg-hover px-1.5 text-[11.5px] font-medium leading-5 text-muted ring-1 ring-inset ring-line">{count}</span>
      </h2>
      {hint && <p className="text-xs text-faint max-sm:hidden">{hint}</p>}
    </div>
  );
}
