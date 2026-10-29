import "server-only";
import { asc } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { adAccounts, clients } from "@/lib/db/schema";

export const ACCOUNT_COOKIE = "mam_account";

export type Account = typeof adAccounts.$inferSelect;
export type Client = typeof clients.$inferSelect;

/** Authenticated user + the client / ad account currently selected in the top bar. */
export const getWorkspace = cache(async () => {
  const user = await requireUser();
  const [clientList, accountList, jar] = await Promise.all([
    db().select().from(clients).orderBy(asc(clients.name)),
    db().select().from(adAccounts).orderBy(asc(adAccounts.name)),
    cookies(),
  ]);
  const selected = jar.get(ACCOUNT_COOKIE)?.value;
  const account =
    accountList.find((a) => a.id === selected) ?? accountList.find((a) => a.accountStatus === 1) ?? accountList[0] ?? null;
  const client = (account && clientList.find((c) => c.id === account.clientId)) ?? clientList[0] ?? null;
  return { user, clients: clientList, accounts: accountList, account, client };
});
