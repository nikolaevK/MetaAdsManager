import { count, eq, isNull, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { reviewEvents } from "@/lib/db/schema";
import { getWorkspace } from "@/lib/workspace";
import type { SidebarData } from "./sidebar-content";

/** Loads everything the sidebar needs (once per request; getWorkspace is cached). */
export async function loadSidebarData(): Promise<SidebarData> {
  const { user, accounts, clients, account } = await getWorkspace();
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const [review] = await db()
    .select({ n: count() })
    .from(reviewEvents)
    .where(and(isNull(reviewEvents.acknowledgedAt), account ? eq(reviewEvents.adAccountId, account.id) : undefined));
  return {
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, clientName: clientName.get(a.clientId) ?? "—" })),
    currentId: account?.id ?? null,
    user: { name: user.name, email: user.email, role: user.role },
    reviewCount: review?.n ?? 0,
  };
}
