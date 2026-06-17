import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/server/audit";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { asJsonValue, periodRangeFromMonth } from "@/lib/server/closing-periods";
import { validateJsonPayloadSize } from "@/lib/server/json-payload-validation";
import { serializeClosingPeriod } from "@/lib/server/serializers";

const closePeriodSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  summaryPayload: z.unknown().optional()
});

const reopenPeriodSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/)
});

export async function GET() {
  const db = getPrisma();
  if (!db) {
    return NextResponse.json({ closingPeriods: [], mode: "sample" });
  }

  const company = await ensureDefaultCompany(db);
  const closingPeriods = await db.closingPeriod.findMany({
    where: { companyId: company.id },
    orderBy: { period: "desc" },
    take: 120
  });

  return NextResponse.json({ closingPeriods: closingPeriods.map(serializeClosingPeriod), mode: "database" });
}

export async function POST(request: Request) {
  const parsed = closePeriodSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const range = periodRangeFromMonth(parsed.data.period);
  if (!range) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_CLOSING_PERIOD",
        message: "마감 기간 형식이 올바르지 않습니다."
      },
      { status: 400 }
    );
  }

  const payloadIssue = validateJsonPayloadSize(parsed.data.summaryPayload, "마감 summaryPayload");
  if (payloadIssue) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_CLOSING_PAYLOAD",
        message: payloadIssue
      },
      { status: 400 }
    );
  }

  const readinessRows = getFilingReadinessRows(parsed.data.summaryPayload);
  if (readinessRows.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        code: "FILING_READINESS_REQUIRED",
        message: "마감 잠금 전 최종 신고 점검 결과가 필요합니다."
      },
      { status: 400 }
    );
  }

  const readinessBlockers = getClosingReadinessBlockers(parsed.data.summaryPayload);
  if (readinessBlockers.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        code: "FILING_READINESS_BLOCKED",
        message: `마감 잠금 전 차단 항목을 먼저 해결해야 합니다: ${readinessBlockers.map((blocker) => blocker.check).join(", ")}`,
        blockers: readinessBlockers
      },
      { status: 409 }
    );
  }

  const db = getPrisma();
  if (!db) {
    return NextResponse.json({
      ok: true,
      mode: "sample",
      closingPeriod: {
        id: `closing-preview-${parsed.data.period}`,
        period: parsed.data.period,
        periodStart: range.start.toISOString().slice(0, 10),
        periodEnd: range.end.toISOString().slice(0, 10),
        summaryPayload: parsed.data.summaryPayload ?? null,
        closedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });
  }

  const company = await ensureDefaultCompany(db);
  const closingPeriod = await db.closingPeriod.upsert({
    where: {
      companyId_period: {
        companyId: company.id,
        period: parsed.data.period
      }
    },
    update: {
      summaryPayload: asJsonValue(parsed.data.summaryPayload),
      closedAt: new Date(),
      periodStart: range.start,
      periodEnd: range.end
    },
    create: {
      companyId: company.id,
      period: parsed.data.period,
      periodStart: range.start,
      periodEnd: range.end,
      summaryPayload: asJsonValue(parsed.data.summaryPayload)
    }
  });
  await recordAuditEvent(db, {
    companyId: company.id,
    action: "PERIOD_CLOSE",
    entityType: "CLOSING_PERIOD",
    entityId: closingPeriod.id,
    summary: `${parsed.data.period} 기간을 마감 잠금했습니다.`,
    metadata: {
      period: parsed.data.period,
      periodStart: range.start.toISOString().slice(0, 10),
      periodEnd: range.end.toISOString().slice(0, 10)
    }
  });

  return NextResponse.json({ ok: true, mode: "database", closingPeriod: serializeClosingPeriod(closingPeriod) });
}

export async function DELETE(request: Request) {
  const parsed = reopenPeriodSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const db = getPrisma();
  if (!db) {
    return NextResponse.json({ ok: true, mode: "sample", period: parsed.data.period });
  }

  const company = await ensureDefaultCompany(db);
  const existing = await db.closingPeriod.findUnique({
    where: {
      companyId_period: {
        companyId: company.id,
        period: parsed.data.period
      }
    }
  });
  if (!existing) {
    return NextResponse.json({ ok: false, message: "마감 기간을 찾을 수 없습니다." }, { status: 404 });
  }

  await db.closingPeriod.delete({ where: { id: existing.id } });
  await recordAuditEvent(db, {
    companyId: company.id,
    action: "PERIOD_REOPEN",
    entityType: "CLOSING_PERIOD",
    entityId: existing.id,
    summary: `${parsed.data.period} 기간 마감 잠금을 해제했습니다.`,
    metadata: {
      period: parsed.data.period
    }
  });

  return NextResponse.json({ ok: true, mode: "database", period: parsed.data.period });
}

function getClosingReadinessBlockers(summaryPayload: unknown) {
  return getFilingReadinessRows(summaryPayload).flatMap((row) => {
    if (!isRecord(row)) return [];
    const check = typeof row.점검 === "string" ? row.점검 : "";
    const tone = row.톤;
    if (tone !== "red" || check === "월 마감") return [];
    return [{ check: check || "미확인 차단 항목" }];
  });
}

function getFilingReadinessRows(summaryPayload: unknown): unknown[] {
  if (!isRecord(summaryPayload)) return [];
  if (Array.isArray(summaryPayload.filingReadinessRows)) return summaryPayload.filingReadinessRows;
  if (isRecord(summaryPayload.report) && Array.isArray(summaryPayload.report.filingReadinessRows)) {
    return summaryPayload.report.filingReadinessRows;
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
