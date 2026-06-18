import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
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
  validateEvidenceAmounts,
  validateEvidenceFile,
  validateEvidenceFileUrl
} from "@/lib/server/evidence-validation";
import { resolveTransactionEvidenceStatus } from "@/lib/server/evidence-amount-reviews";
import { encryptStoredText } from "@/lib/server/file-encryption";
import { parseJsonRequest } from "@/lib/server/request-json";
import { serializeEvidence } from "@/lib/server/serializers";

const evidenceSchema = z.object({
  companyId: z.string().default(DEFAULT_COMPANY_ID),
  evidenceType: z.string().trim().min(1).max(80),
  issueDate: z.string().optional().nullable(),
  counterparty: z.string().trim().max(120).optional().nullable(),
  businessRegistrationNumber: z.string().trim().max(40).optional().nullable(),
  supplyAmount: z.coerce.number().nonnegative().optional().nullable(),
  vatAmount: z.coerce.number().nonnegative().optional().nullable(),
  totalAmount: z.coerce.number().nonnegative().optional().nullable(),
  fileName: z.string().trim().max(240).optional().nullable(),
  fileUrl: z.string().trim().max(500).optional().nullable(),
  fileDataUrl: z.string().max(MAX_EVIDENCE_FILE_DATA_URL_LENGTH).optional().nullable(),
  fileMimeType: z.string().trim().max(120).optional().nullable(),
  fileSize: z.coerce.number().int().nonnegative().max(MAX_EVIDENCE_FILE_SIZE).optional().nullable(),
  transactionId: z.string().optional().nullable()
});

const patchEvidenceSchema = z.object({
  id: z.string().min(1),
  evidenceType: z.string().trim().min(1).max(80).optional(),
  issueDate: z.string().optional().nullable(),
  counterparty: z.string().trim().max(120).optional().nullable(),
  businessRegistrationNumber: z.string().trim().max(40).optional().nullable(),
  supplyAmount: z.coerce.number().nonnegative().optional().nullable(),
  vatAmount: z.coerce.number().nonnegative().optional().nullable(),
  totalAmount: z.coerce.number().nonnegative().optional().nullable(),
  fileName: z.string().trim().max(240).optional().nullable(),
  fileUrl: z.string().trim().max(500).optional().nullable(),
  fileDataUrl: z.string().max(MAX_EVIDENCE_FILE_DATA_URL_LENGTH).optional().nullable(),
  fileMimeType: z.string().trim().max(120).optional().nullable(),
  fileSize: z.coerce.number().int().nonnegative().max(MAX_EVIDENCE_FILE_SIZE).optional().nullable(),
  transactionId: z.string().optional().nullable()
});

const deleteEvidenceSchema = z.object({
  id: z.string().min(1)
});

const MAX_EVIDENCE_REQUEST_BYTES = MAX_EVIDENCE_FILE_DATA_URL_LENGTH + 20_000;

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
  const parsed = await parseJsonRequest(request, evidenceSchema, { label: "증빙 추가 요청", maxBytes: MAX_EVIDENCE_REQUEST_BYTES });
  if (!parsed.ok) return parsed.response;

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

  const amountIssue = validateEvidenceAmounts(payload);
  if (amountIssue) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_EVIDENCE_AMOUNTS",
        message: amountIssue
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
          fileDataUrl: encryptStoredText(payload.fileDataUrl),
          fileMimeType: payload.fileMimeType ?? null,
          fileSize: payload.fileSize ?? null
        }
      }
    });

    if (transaction) {
      await updateLinkedTransactionEvidenceStatus(tx, company.id, transaction);
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

export async function PATCH(request: Request) {
  const parsed = await parseJsonRequest(request, patchEvidenceSchema, { label: "증빙 수정 요청", maxBytes: MAX_EVIDENCE_REQUEST_BYTES });
  if (!parsed.ok) return parsed.response;

  const payload = parsed.data;
  const hasEvidenceType = Object.prototype.hasOwnProperty.call(payload, "evidenceType");
  const hasIssueDate = Object.prototype.hasOwnProperty.call(payload, "issueDate");
  const hasCounterparty = Object.prototype.hasOwnProperty.call(payload, "counterparty");
  const hasBusinessRegistrationNumber = Object.prototype.hasOwnProperty.call(payload, "businessRegistrationNumber");
  const hasSupplyAmount = Object.prototype.hasOwnProperty.call(payload, "supplyAmount");
  const hasVatAmount = Object.prototype.hasOwnProperty.call(payload, "vatAmount");
  const hasTotalAmount = Object.prototype.hasOwnProperty.call(payload, "totalAmount");
  const hasFileName = Object.prototype.hasOwnProperty.call(payload, "fileName");
  const hasFileUrl = Object.prototype.hasOwnProperty.call(payload, "fileUrl");
  const hasFileDataUrl = Object.prototype.hasOwnProperty.call(payload, "fileDataUrl");
  const hasFileMimeType = Object.prototype.hasOwnProperty.call(payload, "fileMimeType");
  const hasFileSize = Object.prototype.hasOwnProperty.call(payload, "fileSize");
  const hasTransactionId = Object.prototype.hasOwnProperty.call(payload, "transactionId");
  if (
    !hasEvidenceType &&
    !hasIssueDate &&
    !hasCounterparty &&
    !hasBusinessRegistrationNumber &&
    !hasSupplyAmount &&
    !hasVatAmount &&
    !hasTotalAmount &&
    !hasFileName &&
    !hasFileUrl &&
    !hasFileDataUrl &&
    !hasFileMimeType &&
    !hasFileSize &&
    !hasTransactionId
  ) {
    return NextResponse.json({ ok: false, message: "수정할 증빙 항목이 없습니다." }, { status: 400 });
  }

  if (!hasFileDataUrl && (hasFileMimeType || hasFileSize)) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_EVIDENCE_FILE",
        message: "증빙 파일 데이터 없이 MIME 또는 크기만 수정할 수 없습니다."
      },
      { status: 400 }
    );
  }
  const fileIssue = validateEvidenceFile({
    fileDataUrl: payload.fileDataUrl,
    fileMimeType: payload.fileMimeType,
    fileSize: payload.fileSize
  });
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

  const fileUrl = hasFileUrl ? normalizeEvidenceFileUrl(payload.fileUrl) : undefined;
  const fileUrlIssue = hasFileUrl ? validateEvidenceFileUrl(fileUrl) : null;
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
    return NextResponse.json({ ok: true, mode: "sample", evidence: payload });
  }

  const company = await ensureDefaultCompany(db);
  const existing = await db.evidence.findFirst({
    where: {
      id: payload.id,
      companyId: company.id
    },
    include: {
      transaction: true
    }
  });
  if (!existing) {
    return NextResponse.json({ ok: false, message: "증빙을 찾을 수 없습니다." }, { status: 404 });
  }

  const nextIssueDate = hasIssueDate ? parseStrictEvidenceDate(payload.issueDate) : existing.issueDate?.toISOString().slice(0, 10) ?? null;
  if (payload.issueDate && !nextIssueDate) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_EVIDENCE_DATE",
        message: "증빙 발행일은 유효한 날짜여야 합니다."
      },
      { status: 400 }
    );
  }
  const nextSupplyAmount = hasSupplyAmount ? payload.supplyAmount ?? null : existing.supplyAmount === null ? null : Number(existing.supplyAmount);
  const nextVatAmount = hasVatAmount ? payload.vatAmount ?? null : existing.vatAmount === null ? null : Number(existing.vatAmount);
  const nextTotalAmount = hasTotalAmount ? payload.totalAmount ?? null : existing.totalAmount === null ? null : Number(existing.totalAmount);
  const amountIssue = validateEvidenceAmounts({
    supplyAmount: nextSupplyAmount,
    vatAmount: nextVatAmount,
    totalAmount: nextTotalAmount
  });
  if (amountIssue) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_EVIDENCE_AMOUNTS",
        message: amountIssue
      },
      { status: 400 }
    );
  }

  const nextTransaction = hasTransactionId && payload.transactionId
    ? await db.transaction.findFirst({
        where: {
          id: payload.transactionId,
          companyId: company.id
        }
      })
    : null;
  if (hasTransactionId && payload.transactionId && !nextTransaction) {
    return NextResponse.json({ ok: false, message: "거래를 찾을 수 없습니다." }, { status: 404 });
  }

  const closedCurrentIssuePeriod = await findClosedPeriodForDate(db, company.id, existing.issueDate);
  if (closedCurrentIssuePeriod) return closedPeriodResponse(closedCurrentIssuePeriod.period);
  const closedNextIssuePeriod = await findClosedPeriodForDate(db, company.id, nextIssueDate);
  if (closedNextIssuePeriod) return closedPeriodResponse(closedNextIssuePeriod.period);
  const closedCurrentTransactionPeriod = await findClosedPeriodForDate(db, company.id, existing.transaction?.transactionDate);
  if (closedCurrentTransactionPeriod) return closedPeriodResponse(closedCurrentTransactionPeriod.period);
  const closedNextTransactionPeriod = await findClosedPeriodForDate(db, company.id, nextTransaction?.transactionDate);
  if (closedNextTransactionPeriod) return closedPeriodResponse(closedNextTransactionPeriod.period);

  const nextTransactionId = hasTransactionId ? payload.transactionId || null : existing.transactionId;
  const updateData: Prisma.EvidenceUncheckedUpdateInput = {};
  if (hasEvidenceType) updateData.evidenceType = payload.evidenceType;
  if (hasIssueDate) updateData.issueDate = nextIssueDate ? new Date(nextIssueDate) : null;
  if (hasCounterparty) updateData.counterparty = payload.counterparty || null;
  if (hasBusinessRegistrationNumber) updateData.businessRegistrationNumber = payload.businessRegistrationNumber || null;
  if (hasSupplyAmount) updateData.supplyAmount = nextSupplyAmount;
  if (hasVatAmount) updateData.vatAmount = nextVatAmount;
  if (hasTotalAmount) updateData.totalAmount = nextTotalAmount;
  if (hasFileName) updateData.fileName = payload.fileName || null;
  if (hasFileUrl) updateData.fileUrl = fileUrl ?? null;
  if (hasFileDataUrl) {
    const rawPayload = readRawPayloadObject(existing.rawPayload);
    rawPayload.fileDataUrl = encryptStoredText(payload.fileDataUrl);
    rawPayload.fileMimeType = payload.fileMimeType ?? null;
    rawPayload.fileSize = payload.fileSize ?? null;
    updateData.rawPayload = rawPayload;
  }
  if (hasTransactionId) updateData.transactionId = nextTransactionId;

  const result = await db.$transaction(async (tx) => {
    const updated = await tx.evidence.update({
      where: { id: existing.id },
      data: updateData
    });

    const transactionUpdates: Array<{ transactionId: string; evidenceStatus: string }> = [];
    if (existing.transactionId && existing.transaction) {
      const evidenceStatus = await updateLinkedTransactionEvidenceStatus(tx, company.id, existing.transaction);
      transactionUpdates.push({ transactionId: existing.transactionId, evidenceStatus });
    }
    if (nextTransactionId && nextTransaction && nextTransactionId !== existing.transactionId) {
      const evidenceStatus = await updateLinkedTransactionEvidenceStatus(tx, company.id, nextTransaction);
      transactionUpdates.push({ transactionId: nextTransactionId, evidenceStatus });
    }

    await recordAuditEvent(tx, {
      companyId: company.id,
      action: "EVIDENCE_UPDATE",
      entityType: "EVIDENCE",
      entityId: updated.id,
      summary: `증빙을 수정했습니다: ${updated.evidenceType}`,
      metadata: {
        previousTransactionId: existing.transactionId,
        transactionId: nextTransactionId,
        counterparty: updated.counterparty,
        totalAmount: updated.totalAmount ? Number(updated.totalAmount) : null
      }
    });

    const evidence = await tx.evidence.findUniqueOrThrow({
      where: { id: updated.id },
      include: {
        transaction: {
          include: {
            suggestedAccount: true,
            confirmedAccount: true
          }
        }
      }
    });

    return {
      evidence,
      transactionUpdates
    };
  });

  return NextResponse.json({
    ok: true,
    evidence: serializeEvidence(result.evidence),
    transactionUpdates: result.transactionUpdates,
    mode: "database"
  });
}

export async function DELETE(request: Request) {
  const parsed = await parseJsonRequest(request, deleteEvidenceSchema, { label: "증빙 삭제 요청" });
  if (!parsed.ok) return parsed.response;

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

    let nextEvidenceStatus = null;
    if (evidence.transactionId && evidence.transaction) {
      nextEvidenceStatus = await updateLinkedTransactionEvidenceStatus(tx, company.id, evidence.transaction);
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

async function updateLinkedTransactionEvidenceStatus(
  tx: Prisma.TransactionClient,
  companyId: string,
  transaction: { id: string; depositAmount: unknown; withdrawalAmount: unknown }
) {
  const linkedEvidences = await tx.evidence.findMany({
    where: {
      companyId,
      transactionId: transaction.id
    },
    select: {
      supplyAmount: true,
      vatAmount: true,
      totalAmount: true
    }
  });
  const evidenceStatus = resolveTransactionEvidenceStatus(
    {
      depositAmount: decimalLikeToNumber(transaction.depositAmount),
      withdrawalAmount: decimalLikeToNumber(transaction.withdrawalAmount)
    },
    linkedEvidences.map((evidence) => ({
      supplyAmount: nullableDecimalLikeToNumber(evidence.supplyAmount),
      vatAmount: nullableDecimalLikeToNumber(evidence.vatAmount),
      totalAmount: nullableDecimalLikeToNumber(evidence.totalAmount)
    }))
  );

  await tx.transaction.update({
    where: { id: transaction.id },
    data: { evidenceStatus }
  });

  return evidenceStatus;
}

function nullableDecimalLikeToNumber(value: unknown) {
  return value === null || value === undefined ? null : decimalLikeToNumber(value);
}

function readRawPayloadObject(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...value } as Record<string, Prisma.JsonValue>;
}

function decimalLikeToNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "object" && value !== null && "toString" in value) {
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
