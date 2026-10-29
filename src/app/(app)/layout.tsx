import { Suspense } from "react";
import { loadSidebarData } from "@/components/shell/sidebar";
import { SidebarContent, SidebarFrame } from "@/components/shell/sidebar-content";
import { TopBar, TopBarSkeleton } from "@/components/shell/top-bar";
import { Toaster } from "@/components/toast";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex h-full">
      <SidebarFrame>
        {/* Static shell renders the nav instantly; account + user stream in. */}
        <Suspense fallback={<SidebarContent data={null} compact />}>
          <Sidebar />
        </Suspense>
      </SidebarFrame>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<TopBarSkeleton />}>
          <TopBar />
        </Suspense>
        <main className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:px-8">{children}</div>
        </main>
      </div>
      <Toaster />
    </div>
  );
}

async function Sidebar() {
  return <SidebarContent data={await loadSidebarData()} compact />;
}
