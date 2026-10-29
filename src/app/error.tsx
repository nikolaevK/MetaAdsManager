"use client";

import { ErrorScreen } from "@/components/error-screen";

/** Errors outside a page (the app shell itself, or the login page). */
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="min-h-full bg-canvas p-4 sm:p-6">
      <ErrorScreen error={error} retry={retry} />
    </div>
  );
}
