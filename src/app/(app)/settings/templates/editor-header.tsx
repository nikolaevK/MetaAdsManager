import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { SectionHeader } from "../section-header";

export function EditorHeader({ title, badge, description }: { title: ReactNode; badge?: ReactNode; description: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/settings/templates"
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-[13px] font-medium text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden /> Launch templates
      </Link>
      <SectionHeader
        title={
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {title}
            {badge}
          </span>
        }
        description={description}
      />
    </div>
  );
}
