import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_COMPANY_ID } from "@/lib/defaults";
import { getPrisma } from "@/lib/db";
import { sampleTaxReports } from "@/lib/sample-data";
import { recordAuditEvent } from "@/lib/server/audit";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { closedPeriodResponse, findClosedPeriodForDate } from "@/lib/server/closing-periods";
import { serializeTaxReport } from "@/lib/server/serializers";

const taxReportSchema = z.object({
  companyId: z.string().default(DEFAULT_COMPANY_ID),
  reportType: z.enum(["MONTHLY_PROFIT", "VAT_PREP", "WITHHOLDING_CHECKLIST", "CORPORATE_TAX_PREP", "RISK_REVIEW"]).default("CORPORATE_TAX_PREP"),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  calculatedPayload: z.unknown()
});

const deleteTaxReportSchema = z.object({
  id: z.string().min(1)
});

export async function GET() {
  const db = getPrisma();

  if (!db) {
    return NextResponse.json({ taxReports: sampleTaxReports, mode: "sample" });
  }

  const company = await ensureDefaultCompany(db);
  const taxReports = await db.taxReport.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
    take: 20
  });

  return NextResponse.json({ taxReports: taxReports.map(serializeTaxReport), mode: "database" });
}

export async function POST(request: Request) {
  const parsed = taxReportSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const payload = parsed.data;
  const periodStart = new Date(payload.periodStart);
  const periodEnd = new Date(payload.periodEnd);

  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    return NextResponse.json({ ok: false, message: "기간 날짜가 올바르지 않습니다." }, { status: 400 });
  }

  const db = getPrisma();
  if (!db) {
    return NextResponse.json({
      ok: true,
      taxReport: {
        id: `tax-report-preview-${Date.now()}`,
        reportType: payload.reportType,
        periodStart: payload.periodStart,
        periodEnd: payload.periodEnd,
        calculatedPayload: payload.calculatedPayload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      mode: "sample"
    });
  }

  const company = await ensureDefaultCompany(db);
  const closedPeriod = await findClosedPeriodForDate(db, company.id, periodStart);
  if (closedPeriod) return closedPeriodResponse(closedPeriod.period);

  const taxReport = await db.taxReport.create({
    data: {
      companyId: company.id,
      reportType: payload.reportType,
      periodStart,
      periodEnd,
      calculatedPayload: payload.calculatedPayload as Prisma.InputJsonValue
    }
  });
  await recordAuditEvent(db, {
    companyId: company.id,
    action: "REPORT_CREATE",
    entityType: "TAX_REPORT",
    entityId: taxReport.id,
    summary: `${payload.reportType} 리포트 스냅샷을 저장했습니다.`,
    metadata: {
      reportType: payload.reportType,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd
    }
  });

  return NextResponse.json({ ok: true, taxReport: serializeTaxReport(taxReport), mode: "database" });
}

export async function DELETE(request: Request) {
  const parsed = deleteTaxReportSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const db = getPrisma();
  if (!db) {
    return NextResponse.json({ ok: true, id: parsed.data.id, mode: "sample" });
  }

  const company = await ensureDefaultCompany(db);
  const taxReport = await db.taxReport.findFirst({
    where: {
      id: parsed.data.id,
      companyId: company.id
    }
  });

  if (!taxReport) {
    return NextResponse.json({ ok: false, message: "리포트를 찾을 수 없습니다." }, { status: 404 });
  }
  const closedPeriod = await findClosedPeriodForDate(db, company.id, taxReport.periodStart);
  if (closedPeriod) return closedPeriodResponse(closedPeriod.period);

  await db.taxReport.delete({ where: { id: taxReport.id } });
  await recordAuditEvent(db, {
    companyId: company.id,
    action: "REPORT_DELETE",
    entityType: "TAX_REPORT",
    entityId: taxReport.id,
    summary: `${taxReport.reportType} 리포트 스냅샷을 삭제했습니다.`,
    metadata: {
      reportType: taxReport.reportType,
      periodStart: taxReport.periodStart.toISOString().slice(0, 10),
      periodEnd: taxReport.periodEnd.toISOString().slice(0, 10)
    }
  });

  return NextResponse.json({ ok: true, id: taxReport.id, mode: "database" });
}
