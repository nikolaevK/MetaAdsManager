import "server-only";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";

export async function audit(
  userId: string | null,
  action: string,
  entity?: { type: string; id: string },
  details?: Record<string, unknown>,
): Promise<void> {
  await db()
    .insert(auditLog)
    .values({ userId, action, entityType: entity?.type, entityId: entity?.id, details });
}
