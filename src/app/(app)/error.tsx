"use client";

import { ErrorScreen } from "@/components/error-screen";

/** Page errors keep the sidebar and top bar, so the rest of the app stays reachable. */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} />;
}
