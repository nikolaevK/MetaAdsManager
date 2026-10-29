import "server-only";
import { asc, count, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  adAccounts,
  auditLog,
  clients,
  jobs,
  launchTemplates,
  namingConventions,
  rateLimitState,
  users,
  utmRules,
} from "@/lib/db/schema";

export async function getClientsOverview() {
  const [clientRows, accountRows, conventions, rules] = await Promise.all([
    db().select().from(clients).orderBy(asc(clients.name)),
    db().select().from(adAccounts).orderBy(asc(adAccounts.name)),
    db().select({ id: namingConventions.id, name: namingConventions.name }).from(namingConventions).orderBy(asc(namingConventions.name)),
    db().select({ id: utmRules.id, name: utmRules.name }).from(utmRules).orderBy(asc(utmRules.name)),
  ]);
  return {
    clients: clientRows.map((c) => ({ ...c, accounts: accountRows.filter((a) => a.clientId === c.id) })),
    conventions,
    rules,
  };
}

export async function getTemplatesList() {
  return db()
    .select({ template: launchTemplates, clientName: clients.name })
    .from(launchTemplates)
    .leftJoin(clients, eq(clients.id, launchTemplates.clientId))
    .orderBy(asc(launchTemplates.name));
}

export async function getTemplateById(id: string) {
  const [row] = await db().select().from(launchTemplates).where(eq(launchTemplates.id, id)).limit(1);
  return row ?? null;
}

/** Clients + connected accounts for template scope and pixel/audience lookups. */
export async function getTemplateEditorContext() {
  const [clientRows, accountRows] = await Promise.all([
    db().select({ id: clients.id, name: clients.name }).from(clients).orderBy(asc(clients.name)),
    db().select({ id: adAccounts.id, name: adAccounts.name, clientId: adAccounts.clientId }).from(adAccounts).orderBy(asc(adAccounts.name)),
  ]);
  return { clients: clientRows, accounts: accountRows };
}

export async function getNamingData() {
  const [conventions, rules, clientRows] = await Promise.all([
    db().select().from(namingConventions).orderBy(asc(namingConventions.name)),
    db().select().from(utmRules).orderBy(asc(utmRules.name)),
    db()
      .select({ id: clients.id, name: clients.name, namingConventionId: clients.namingConventionId, utmRuleId: clients.utmRuleId })
      .from(clients)
      .orderBy(asc(clients.name)),
  ]);
  return { conventions, rules, clients: clientRows };
}

/** Never selects password hashes. */
export async function getUsersList() {
  return db()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      disabled: users.disabled,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.name));
}

export async function getSystemData() {
  const [limits, jobCounts, recentJobs, audit] = await Promise.all([
    db().select().from(rateLimitState).orderBy(asc(rateLimitState.key)),
    db().select({ status: jobs.status, n: count() }).from(jobs).groupBy(jobs.status),
    db().select().from(jobs).orderBy(desc(jobs.updatedAt)).limit(50),
    db()
      .select({
        id: auditLog.id,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        details: auditLog.details,
        createdAt: auditLog.createdAt,
        userName: users.name,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .orderBy(desc(auditLog.createdAt))
      .limit(100),
  ]);
  return { limits, jobCounts, recentJobs, audit };
}
