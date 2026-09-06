import { db } from "@/lib/db";
import type { Prisma, AuditActorType } from "../../prisma/generated/client";

// Append-only audit trail — docs/27-audit-logging.md.
// Never log secrets, tokens, passwords, or document contents in `metadata`: reference
// resources by id, not by payload.

export async function writeAuditLog(
  entry: {
    actorId?: string | null;
    actorType: AuditActorType;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Prisma.InputJsonValue;
    ipAddress?: string | null;
  },
  // Pass the transaction client when the audit row must commit atomically with the
  // change it describes (docs/09-database-architecture.md §7: admin action -> audit log).
  client: Prisma.TransactionClient | typeof db = db,
) {
  await client.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      actorType: entry.actorType,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata,
      ipAddress: entry.ipAddress ?? null,
    },
  });
}
