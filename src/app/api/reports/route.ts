import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_COMPANY_ID } from "@/lib/defaults";
import { getPrisma } from "@/lib/db";
import { sampleTaxReports } from "@/lib/sample-data";
import { recordAuditEvent } from "@/lib/server/audit";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { closedPeriodResponse, findClosedPeriodForDates, periodRangeFromMonth } from "@/lib/server/closing-periods";
import { parseStrictDate } from "@/lib/server/date-validation";
import { validateJsonPayloadSize } from "@/lib/server/json-payload-validation";
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
  const normalizedPeriodStart = parseStrictDate(payload.periodStart);
  const normalizedPeriodEnd = parseStrictDate(payload.periodEnd);

  if (!normalizedPeriodStart || !normalizedPeriodEnd) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_REPORT_PERIOD",
        message: "리포트 기간 날짜가 올바르지 않습니다."
      },
      { status: 400 }
    );
  }

  const periodStart = new Date(normalizedPeriodStart);
  const periodEnd = new Date(normalizedPeriodEnd);
  if (periodStart > periodEnd) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_REPORT_PERIOD_RANGE",
        message: "리포트 기간 종료일은 시작일보다 빠를 수 없습니다."
      },
      { status: 400 }
    );
  }

  const payloadIssue = validateJsonPayloadSize(payload.calculatedPayload, "리포트 calculatedPayload");
  if (payloadIssue) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_REPORT_PAYLOAD",
        message: payloadIssue
      },
      { status: 400 }
    );
  }

  const payloadPeriodIssues = getReportPayloadPeriodIssues(payload.calculatedPayload, normalizedPeriodStart, normalizedPeriodEnd);
  if (payloadPeriodIssues.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        code: "REPORT_PAYLOAD_PERIOD_MISMATCH",
        message: "리포트 스냅샷 기간이 요청한 리포트 기간과 일치하지 않습니다.",
        issues: payloadPeriodIssues
      },
      { status: 400 }
    );
  }

  const db = getPrisma();
  if (!db) {
    return NextResponse.json({
      ok: true,
      taxReport: {
        id: `tax-report-preview-${Date.now()}`,
        reportType: payload.reportType,
        periodStart: normalizedPeriodStart,
        periodEnd: normalizedPeriodEnd,
        calculatedPayload: payload.calculatedPayload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      mode: "sample"
    });
  }

  const company = await ensureDefaultCompany(db);
  const closedPeriod = await findClosedPeriodForDates(db, company.id, [periodStart, periodEnd]);
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
      periodStart: normalizedPeriodStart,
      periodEnd: normalizedPeriodEnd
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
  const closedPeriod = await findClosedPeriodForDates(db, company.id, [taxReport.periodStart, taxReport.periodEnd]);
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

function getReportPayloadPeriodIssues(calculatedPayload: unknown, normalizedPeriodStart: string, normalizedPeriodEnd: string) {
  const issues: string[] = [];
  if (!isRecord(calculatedPayload)) return issues;

  const periodValue = getPayloadPeriodValue(calculatedPayload);
  if (periodValue && periodValue !== "ALL" && /^\d{4}-\d{2}$/.test(periodValue)) {
    const range = periodRangeFromMonth(periodValue);
    const expectedStart = range?.start.toISOString().slice(0, 10);
    const expectedEnd = range?.end.toISOString().slice(0, 10);
    if (expectedStart && expectedStart !== normalizedPeriodStart) {
      issues.push(`payload.period(${periodValue}) 시작일은 ${expectedStart}이나 요청 시작일은 ${normalizedPeriodStart}입니다.`);
    }
    if (expectedEnd && expectedEnd !== normalizedPeriodEnd) {
      issues.push(`payload.period(${periodValue}) 종료일은 ${expectedEnd}이나 요청 종료일은 ${normalizedPeriodEnd}입니다.`);
    }
  }

  const periodObject = isRecord(calculatedPayload.period) ? calculatedPayload.period : null;
  const payloadStart = typeof periodObject?.start === "string" ? periodObject.start : "";
  const payloadEnd = typeof periodObject?.end === "string" ? periodObject.end : "";
  if (payloadStart && payloadStart !== normalizedPeriodStart) {
    issues.push(`payload.period.start(${payloadStart})가 요청 시작일 ${normalizedPeriodStart}와 일치하지 않습니다.`);
  }
  if (payloadEnd && payloadEnd !== normalizedPeriodEnd) {
    issues.push(`payload.period.end(${payloadEnd})가 요청 종료일 ${normalizedPeriodEnd}와 일치하지 않습니다.`);
  }

  return issues;
}

function getPayloadPeriodValue(calculatedPayload: Record<string, unknown>) {
  if (typeof calculatedPayload.period === "string") return calculatedPayload.period;
  if (isRecord(calculatedPayload.period) && typeof calculatedPayload.period.value === "string") return calculatedPayload.period.value;
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
