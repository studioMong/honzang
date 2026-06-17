import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { serializeAuditEvent } from "@/lib/server/serializers";

export async function GET() {
  const db = getPrisma();
  if (!db) {
    return NextResponse.json({ auditEvents: [], mode: "sample" });
  }

  const company = await ensureDefaultCompany(db);
  const auditEvents = await db.auditEvent.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
    take: 100
  });

  return NextResponse.json({ auditEvents: auditEvents.map(serializeAuditEvent), mode: "database" });
}
