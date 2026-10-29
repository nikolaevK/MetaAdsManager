import { ArrowRight, Cable } from "lucide-react";
import Link from "next/link";
import { buttonClass, Card, EmptyState } from "./ui";

const STEPS = [
  { title: "Create a client", text: "Group ad accounts by brand or customer." },
  { title: "Connect an ad account", text: "Pick any account your Meta token can access." },
  { title: "Sync starts automatically", text: "Campaigns, insights and review status." },
];

export function NoAccount() {
  return (
    <Card className="overflow-hidden">
      <EmptyState
        icon={Cable}
        title="No ad account connected yet"
        action={
          <Link href="/settings/clients" className={buttonClass("primary")}>
            Connect an ad account <ArrowRight />
          </Link>
        }
      >
        Add a client and connect one of the ad accounts your Meta token can access. Campaigns, insights and review status will sync
        automatically.
      </EmptyState>
      <ol className="grid gap-px border-t border-line-soft bg-line-soft sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex items-start gap-3 bg-surface-2 px-5 py-4">
            <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-[12px] font-semibold text-primary-ink">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">{s.title}</p>
              <p className="text-[12.5px] text-muted">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
