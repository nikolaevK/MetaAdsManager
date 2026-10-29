"use client";

import { DatabaseZap, RotateCcw, TriangleAlert, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, EmptyState } from "./ui";

type Health = { database: "ok" | "unreachable"; pendingMigrations: number };

/**
 * Fallback for route error boundaries. Asks /api/health whether the cause is something the user can fix
 * (a migration that wasn't run, an unreachable database) because production hides server error messages.
 */
export function ErrorScreen({ error, retry }: { error: unknown; retry: () => void }) {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    console.error(error);
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth({ database: "unreachable", pendingMigrations: 0 }));
  }, [error]);

  const digest = error instanceof Error && "digest" in error ? String(error.digest) : null;
  const devMessage = process.env.NODE_ENV === "development" && error instanceof Error ? error.message : null;

  const view =
    health && health.pendingMigrations > 0
      ? {
          icon: DatabaseZap,
          title: "The database needs an update",
          body: (
            <>
              {health.pendingMigrations} database migration{health.pendingMigrations === 1 ? " hasn't" : "s haven't"} been applied. In the project folder run{" "}
              <code className="whitespace-nowrap rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-ink ring-1 ring-inset ring-line">npm run db:migrate</code>, then try
              again.
            </>
          ),
        }
      : health?.database === "unreachable"
        ? {
            icon: WifiOff,
            title: "Can't reach the database",
            body: "The database didn't respond. Check the connection (and the Turso status page if you use Turso), then try again.",
          }
        : { icon: TriangleAlert, title: "Something went wrong", body: "This page failed to load. Trying again usually fixes it; if it keeps happening, check the server log." };

  return (
    <Card className="mx-auto mt-6 max-w-xl overflow-hidden">
      <EmptyState
        icon={view.icon}
        title={view.title}
        action={
          <Button variant="primary" onClick={retry}>
            <RotateCcw /> Try again
          </Button>
        }
      >
        {view.body}
        {(devMessage || digest) && <span className="mt-3 block break-words font-mono text-[11.5px] text-faint">{devMessage ?? `Error reference: ${digest}`}</span>}
      </EmptyState>
    </Card>
  );
}
