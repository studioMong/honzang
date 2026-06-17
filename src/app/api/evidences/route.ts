import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_COMPANY_ID } from "@/lib/defaults";
import { getPrisma } from "@/lib/db";
import { sampleEvidences } from "@/lib/sample-data";
import { recordAuditEvent } from "@/lib/server/audit";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { closedPeriodResponse, findClosedPeriodForDate } from "@/lib/server/closing-periods";
import {
  MAX_EVIDENCE_FILE_DATA_URL_LENGTH,
  MAX_EVIDENCE_FILE_SIZE,
  normalizeEvidenceFileUrl,
  parseStrictEvidenceDate,
  validateEvidenceFile,
  validateEvidenceFileUrl
} from "@/lib/server/evidence-validation";
import { serializeEvidence } from "@/lib/server/serializers";

const evidenceSchema = z.object({
  companyId: z.string().default(DEFAULT_COMPANY_ID),
  evidenceType: z.string().min(1).max(80),
  issueDate: z.string().optional().nullable(),
  counterparty: z.string().max(120).optional().nullable(),
  businessRegistrationNumber: z.string().max(40).optional().nullable(),
  supplyAmount: z.coerce.number().nonnegative().optional().nullable(),
  vatAmount: z.coerce.number().nonnegative().optional().nullable(),
  totalAmount: z.coerce.number().nonnegative().optional().nullable(),
  fileName: z.string().max(240).optional().nullable(),
  fileUrl: z.string().max(500).optional().nullable(),
  fileDataUrl: z.string().max(MAX_EVIDENCE_FILE_DATA_URL_LENGTH).optional().nullable(),
  fileMimeType: z.string().max(120).optional().nullable(),
  fileSize: z.coerce.number().int().nonnegative().max(MAX_EVIDENCE_FILE_SIZE).optional().nullable(),
  transactionId: z.string().optional().nullable()
});

const deleteEvidenceSchema = z.object({
  id: z.string().min(1)
});

export async function GET() {
  const db = getPrisma();

  if (!db) {
    return NextResponse.json({ evidences: sampleEvidences, mode: "sample" });
  }

  const company = await ensureDefaultCompany(db);
  const evidences = await db.evidence.findMany({
    where: { companyId: company.id },
    include: {
      transaction: {
        include: {
          suggestedAccount: true,
          confirmedAccount: true
        }
      }
    },
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    take: 300
  });

  return NextResponse.json({ evidences: evidences.map(serializeEvidence), mode: "database" });
}

export async function POST(request: Request) {
  const parsed = evidenceSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const payload = parsed.data;
  const issueDate = parseStrictEvidenceDate(payload.issueDate);
  if (payload.issueDate && !issueDate) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_EVIDENCE_DATE",
        message: "증빙 발행일은 유효한 날짜여야 합니다."
      },
      { status: 400 }
    );
  }

  const fileIssue = validateEvidenceFile(payload);
  if (fileIssue) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_EVIDENCE_FILE",
        message: fileIssue
      },
      { status: 400 }
    );
  }

  const fileUrl = normalizeEvidenceFileUrl(payload.fileUrl);
  const fileUrlIssue = validateEvidenceFileUrl(fileUrl);
  if (fileUrlIssue) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_EVIDENCE_FILE_URL",
        message: fileUrlIssue
      },
      { status: 400 }
    );
  }

  const db = getPrisma();

  if (!db) {
    return NextResponse.json({
      ok: true,
      evidence: {
        id: `ev-preview-${Date.now()}`,
        ...payload,
        issueDate,
        fileUrl
      },
      mode: "sample"
    });
  }

  const company = await ensureDefaultCompany(db);
  const transaction = payload.transactionId
    ? await db.transaction.findFirst({
        where: {
          id: payload.transactionId,
          companyId: company.id
        }
      })
    : null;

  if (payload.transactionId && !transaction) {
    return NextResponse.json({ ok: false, message: "거래를 찾을 수 없습니다." }, { status: 404 });
  }
  const closedIssuePeriod = await findClosedPeriodForDate(db, company.id, issueDate);
  if (closedIssuePeriod) return closedPeriodResponse(closedIssuePeriod.period);
  const closedTransactionPeriod = await findClosedPeriodForDate(db, company.id, transaction?.transactionDate);
  if (closedTransactionPeriod) return closedPeriodResponse(closedTransactionPeriod.period);

  const evidence = await db.$transaction(async (tx) => {
    const created = await tx.evidence.create({
      data: {
        companyId: company.id,
        transactionId: transaction?.id ?? null,
        evidenceType: payload.evidenceType,
        issueDate: issueDate ? new Date(issueDate) : null,
        counterparty: payload.counterparty,
        businessRegistrationNumber: payload.businessRegistrationNumber,
        supplyAmount: payload.supplyAmount,
        vatAmount: payload.vatAmount,
        totalAmount: payload.totalAmount,
        fileName: payload.fileName,
        fileUrl,
        rawPayload: {
          fileDataUrl: payload.fileDataUrl ?? null,
          fileMimeType: payload.fileMimeType ?? null,
          fileSize: payload.fileSize ?? null
        }
      }
    });

    if (transaction) {
      await tx.transaction.update({
        where: { id: transaction.id },
        data: { evidenceStatus: "MATCHED" }
      });
    }
    await recordAuditEvent(tx, {
      companyId: company.id,
      action: "EVIDENCE_CREATE",
      entityType: "EVIDENCE",
      entityId: created.id,
      summary: `증빙을 추가했습니다: ${payload.evidenceType}`,
      metadata: {
        transactionId: transaction?.id ?? null,
        counterparty: payload.counterparty ?? null,
        totalAmount: payload.totalAmount ?? null,
        hasFile: Boolean(payload.fileDataUrl || fileUrl)
      }
    });

    return tx.evidence.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        transaction: {
          include: {
            suggestedAccount: true,
            confirmedAccount: true
          }
        }
      }
    });
  });

  return NextResponse.json({ ok: true, evidence: serializeEvidence(evidence), mode: "database" });
}

export async function DELETE(request: Request) {
  const parsed = deleteEvidenceSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const db = getPrisma();
  if (!db) {
    return NextResponse.json({ ok: true, mode: "sample", deletedEvidenceId: parsed.data.id });
  }

  const company = await ensureDefaultCompany(db);
  const evidence = await db.evidence.findFirst({
    where: {
      id: parsed.data.id,
      companyId: company.id
    },
    include: {
      transaction: true
    }
  });

  if (!evidence) {
    return NextResponse.json({ ok: false, message: "증빙을 찾을 수 없습니다." }, { status: 404 });
  }

  const closedIssuePeriod = await findClosedPeriodForDate(db, company.id, evidence.issueDate);
  if (closedIssuePeriod) return closedPeriodResponse(closedIssuePeriod.period);
  const closedTransactionPeriod = await findClosedPeriodForDate(db, company.id, evidence.transaction?.transactionDate);
  if (closedTransactionPeriod) return closedPeriodResponse(closedTransactionPeriod.period);

  const result = await db.$transaction(async (tx) => {
    await tx.evidence.delete({ where: { id: evidence.id } });

    let nextEvidenceStatus: "UNCHECKED" | "MISSING" | null = null;
    if (evidence.transactionId && evidence.transaction) {
      const remainingEvidenceCount = await tx.evidence.count({
        where: {
          companyId: company.id,
          transactionId: evidence.transactionId
        }
      });

      if (remainingEvidenceCount === 0) {
        nextEvidenceStatus = Number(evidence.transaction.withdrawalAmount) > 0 ? "MISSING" : "UNCHECKED";
        await tx.transaction.update({
          where: { id: evidence.transactionId },
          data: { evidenceStatus: nextEvidenceStatus }
        });
      }
    }

    await recordAuditEvent(tx, {
      companyId: company.id,
      action: "EVIDENCE_DELETE",
      entityType: "EVIDENCE",
      entityId: evidence.id,
      summary: `증빙을 삭제했습니다: ${evidence.evidenceType}`,
      metadata: {
        transactionId: evidence.transactionId,
        counterparty: evidence.counterparty,
        totalAmount: evidence.totalAmount ? Number(evidence.totalAmount) : null
      }
    });

    return {
      deletedEvidenceId: evidence.id,
      transactionId: evidence.transactionId,
      evidenceStatus: nextEvidenceStatus
    };
  });

  return NextResponse.json({ ok: true, mode: "database", ...result });
}
