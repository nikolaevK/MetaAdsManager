import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { SettingsNav } from "./settings-nav";

export const metadata: Metadata = { title: { default: "Settings", template: "%s · Settings · Ads Manager" } };

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 border-b border-line lg:mb-7">
        <PageHeader title="Settings" description="Clients and ad accounts, launch defaults, naming, people and system health for this workspace." />
      </div>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-10">
        <SettingsNav />
        {/* Sections size their grids to this column (container queries), not the viewport. */}
        <div className="@container min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
