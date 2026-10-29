import { FileQuestionMark } from "lucide-react";
import Link from "next/link";
import { buttonClass, Card, EmptyState } from "@/components/ui";

/** notFound() inside the app (e.g. a launch or template that no longer exists): the sidebar and top bar stay. */
export default function AppNotFound() {
  return (
    <Card className="mx-auto mt-6 max-w-xl overflow-hidden">
      <EmptyState
        icon={FileQuestionMark}
        title="This page doesn't exist"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/campaigns" className={buttonClass("primary")}>
              Back to campaigns
            </Link>
            <Link href="/launches" className={buttonClass("secondary")}>
              Back to launches
            </Link>
          </div>
        }
      >
        It may have been deleted, or the link is incomplete.
      </EmptyState>
    </Card>
  );
}
