import { FileQuestionMark } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/shell/sidebar-content";
import { buttonClass, Card, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Page not found" };

/** Unmatched URLs anywhere (outside the app shell, so it also works signed out). */
export default function NotFound() {
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-6 bg-canvas p-4 sm:p-6">
      <Link href="/campaigns" className="flex items-center gap-2.5 rounded-lg">
        <BrandMark />
        <span className="text-[15px] font-semibold tracking-tight text-ink">Ads Manager</span>
      </Link>
      <Card className="w-full max-w-xl overflow-hidden">
        <EmptyState
          icon={FileQuestionMark}
          title="Page not found"
          action={
            <Link href="/campaigns" className={buttonClass("primary")}>
              Go to campaigns
            </Link>
          }
        >
          There&apos;s nothing at this address. Check the link, or head back to your campaigns.
        </EmptyState>
      </Card>
    </main>
  );
}
