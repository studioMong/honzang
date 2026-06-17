import type { Prisma } from "@prisma/client";

type AuditWriter = {
  auditEvent: {
    create: (args: {
      data: {
        companyId: string;
        action: string;
        entityType: string;
        entityId?: string | null;
        summary: string;
        metadata?: Prisma.InputJsonValue;
      };
    }) => Promise<unknown>;
  };
};

export async function recordAuditEvent(
  db: AuditWriter,
  event: {
    companyId: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    summary: string;
    metadata?: Prisma.InputJsonValue;
  }
) {
  await db.auditEvent.create({
    data: {
      companyId: event.companyId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      summary: event.summary,
      metadata: event.metadata ?? undefined
    }
  });
}
