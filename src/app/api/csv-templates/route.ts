import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_COMPANY_ID, SOURCE_TYPE_LABELS } from "@/lib/defaults";
import { getPrisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/server/audit";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";

const deleteSchema = z.object({
  companyId: z.string().default(DEFAULT_COMPANY_ID),
  id: z.string().min(1)
});

export async function DELETE(request: Request) {
  const parsed = deleteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const db = getPrisma();
  if (!db) {
    return NextResponse.json({ ok: true, mode: "sample", id: parsed.data.id });
  }

  const company = await ensureDefaultCompany(db);
  const existing = await db.csvTemplate.findFirst({
    where: {
      id: parsed.data.id,
      companyId: company.id
    }
  });
  if (!existing) {
    return NextResponse.json({ ok: false, message: "CSV 매핑 템플릿을 찾을 수 없습니다." }, { status: 404 });
  }

  await db.csvTemplate.delete({ where: { id: existing.id } });
  await recordAuditEvent(db, {
    companyId: company.id,
    action: "CSV_TEMPLATE_DELETE",
    entityType: "CSV_TEMPLATE",
    entityId: existing.id,
    summary: `CSV 매핑 템플릿을 삭제했습니다: ${existing.name}`,
    metadata: {
      sourceType: existing.sourceType,
      sourceTypeLabel: SOURCE_TYPE_LABELS[existing.sourceType],
      headerSignature: existing.headerSignature
    }
  });

  return NextResponse.json({ ok: true, mode: "database", id: existing.id });
}
