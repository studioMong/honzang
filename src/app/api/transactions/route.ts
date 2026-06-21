import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/db";
import { sampleTransactions } from "@/lib/sample-data";
import { recordAuditEvent } from "@/lib/server/audit";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { closedPeriodResponse, findClosedPeriodForDate } from "@/lib/server/closing-periods";
import { parseStrictDate } from "@/lib/server/date-validation";
import { parseJsonRequest } from "@/lib/server/request-json";
import { serializeTransaction, serializeVendor } from "@/lib/server/serializers";
import { validateTransactionAmounts } from "@/lib/server/transaction-validation";
import { applyVendorDefaults, inferAccount, summarizeTransactions } from "@/lib/accounting";

const manualTransactionSchema = z.object({
  transactionDate: z.string().min(1),
  description: z.string().trim().min(1).max(240),
  counterparty: z.string().trim().max(120).optional().nullable(),
  depositAmount: z.coerce.number().nonnegative().default(0),
  withdrawalAmount: z.coerce.number().nonnegative().default(0),
  supplyAmount: z.coerce.number().nonnegative().optional().nullable(),
  vatAmount: z.coerce.number().nonnegative().optional().nullable(),
  confirmedAccountId: z.string().optional().nullable(),
  evidenceStatus: z.enum(["UNCHECKED", "MISSING", "ATTACHED", "MATCHED", "NOT_REQUIRED"]).default("UNCHECKED"),
  memo: z.string().trim().max(500).optional().nullable()
});

const patchTransactionSchema = z.object({
  id: z.string().min(1),
  transactionDate: z.string().min(1).optional(),
  description: z.string().trim().min(1).max(240).optional(),
  counterparty: z.string().trim().max(120).optional().nullable(),
  depositAmount: z.coerce.number().nonnegative().optional(),
  withdrawalAmount: z.coerce.number().nonnegative().optional(),
  supplyAmount: z.coerce.number().nonnegative().optional().nullable(),
  vatAmount: z.coerce.number().nonnegative().optional().nullable(),
  confirmedAccountId: z.string().optional().nullable(),
  evidenceStatus: z.enum(["UNCHECKED", "MISSING", "ATTACHED", "MATCHED", "NOT_REQUIRED"]).optional(),
  memo: z.string().trim().max(500).optional().nullable()
});

const deleteTransactionSchema = z.object({
  id: z.string().min(1)
});

export async function GET() {
  const db = getPrisma();

  if (!db) {
    return NextResponse.json({
      transactions: sampleTransactions,
      summary: summarizeTransactions(sampleTransactions),
      mode: "sample"
    });
  }

  const company = await ensureDefaultCompany(db);
  const transactions = await db.transaction.findMany({
    where: { companyId: company.id },
    include: {
      suggestedAccount: true,
      confirmedAccount: true
    },
    orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
    take: 300
  });
  const serialized = transactions.map(serializeTransaction);

  return NextResponse.json({
    transactions: serialized,
    summary: summarizeTransactions(serialized),
    mode: "database"
  });
}

export async function POST(request: Request) {
  const parsed = await parseJsonRequest(request, manualTransactionSchema, { label: "수기 거래 요청" });
  if (!parsed.ok) return parsed.response;

  const payload = parsed.data;
  const transactionDate = parseStrictDate(payload.transactionDate);
  if (!transactionDate) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_TRANSACTION_DATE",
        message: "거래일은 유효한 날짜여야 합니다."
      },
      { status: 400 }
    );
  }
  const amountIssue = validateTransactionAmounts(payload);
  if (amountIssue) {
    return NextResponse.json({ ok: false, code: "INVALID_TRANSACTION_AMOUNTS", message: amountIssue }, { status: 400 });
  }

  const db = getPrisma();
  if (!db) {
    const inferred = inferAccount(payload.description, payload.counterparty);
    return NextResponse.json({
      ok: true,
      mode: "sample",
      transaction: {
        id: `manual-preview-${Date.now()}`,
        sourceType: "MANUAL",
        transactionDate,
        description: payload.description,
        counterparty: payload.counterparty ?? null,
        direction: payload.depositAmount > 0 ? "DEPOSIT" : "WITHDRAWAL",
        depositAmount: payload.depositAmount,
        withdrawalAmount: payload.withdrawalAmount,
        supplyAmount: payload.supplyAmount ?? null,
        vatAmount: payload.vatAmount ?? null,
        suggestedAccount: inferred.account,
        confirmedAccount: null,
        evidenceStatus: payload.evidenceStatus,
        memo: payload.memo ?? null,
        reviewReasons: inferred.reason ? [inferred.reason] : []
      }
    });
  }

  const company = await ensureDefaultCompany(db);
  const closedPeriod = await findClosedPeriodForDate(db, company.id, transactionDate);
  if (closedPeriod) return closedPeriodResponse(closedPeriod.period);

  const inferred = inferAccount(payload.description, payload.counterparty);
  const vendors = await db.vendor.findMany({
    where: { companyId: company.id },
    include: { defaultAccount: true }
  });
  const vendorApplied = applyVendorDefaults(
    {
      counterparty: payload.counterparty,
      suggestedAccount: inferred.account,
      reviewReasons: inferred.reason ? [inferred.reason] : []
    },
    vendors.map(serializeVendor)
  );
  const suggestedAccount = await db.account.findFirst({
    where: {
      companyId: company.id,
      code: vendorApplied.suggestedAccount?.code ?? inferred.account.code,
      isActive: true
    }
  });
  const confirmedAccount = payload.confirmedAccountId
    ? await db.account.findFirst({
        where: {
          companyId: company.id,
          id: payload.confirmedAccountId,
          isActive: true
        }
      })
    : null;

  if (payload.confirmedAccountId && !confirmedAccount) {
    return NextResponse.json({ ok: false, message: "계정과목을 찾을 수 없습니다." }, { status: 404 });
  }

  const transaction = await db.$transaction(async (tx) => {
    const created = await tx.transaction.create({
      data: {
        companyId: company.id,
        sourceType: "MANUAL",
        transactionDate: new Date(transactionDate),
        description: payload.description,
        counterparty: payload.counterparty,
        direction: payload.depositAmount > 0 ? "DEPOSIT" : "WITHDRAWAL",
        depositAmount: payload.depositAmount,
        withdrawalAmount: payload.withdrawalAmount,
        supplyAmount: payload.supplyAmount,
        vatAmount: payload.vatAmount,
        suggestedAccountId: suggestedAccount?.id ?? null,
        confirmedAccountId: confirmedAccount?.id ?? null,
        evidenceStatus: payload.evidenceStatus,
        memo: payload.memo,
        rawPayload: {
          manual: true,
          reviewReasons: vendorApplied.reviewReasons ?? []
        }
      },
      include: {
        suggestedAccount: true,
        confirmedAccount: true
      }
    });
    await recordAuditEvent(tx, {
      companyId: company.id,
      action: "TRANSACTION_CREATE",
      entityType: "TRANSACTION",
      entityId: created.id,
      summary: `수기 거래를 추가했습니다: ${created.description}`,
      metadata: {
        transactionDate: created.transactionDate.toISOString().slice(0, 10),
        depositAmount: Number(created.depositAmount),
        withdrawalAmount: Number(created.withdrawalAmount),
        evidenceStatus: created.evidenceStatus
      }
    });
    return created;
  });

  return NextResponse.json({ ok: true, transaction: serializeTransaction(transaction), mode: "database" });
}

export async function PATCH(request: Request) {
  const parsed = await parseJsonRequest(request, patchTransactionSchema, { label: "거래 수정 요청" });
  if (!parsed.ok) return parsed.response;

  const payload = parsed.data;
  const hasConfirmedAccountId = Object.prototype.hasOwnProperty.call(payload, "confirmedAccountId");
  const hasEvidenceStatus = Object.prototype.hasOwnProperty.call(payload, "evidenceStatus");
  const hasMemo = Object.prototype.hasOwnProperty.call(payload, "memo");
  const hasTransactionDate = Object.prototype.hasOwnProperty.call(payload, "transactionDate");
  const hasDescription = Object.prototype.hasOwnProperty.call(payload, "description");
  const hasCounterparty = Object.prototype.hasOwnProperty.call(payload, "counterparty");
  const hasDepositAmount = Object.prototype.hasOwnProperty.call(payload, "depositAmount");
  const hasWithdrawalAmount = Object.prototype.hasOwnProperty.call(payload, "withdrawalAmount");
  const hasSupplyAmount = Object.prototype.hasOwnProperty.call(payload, "supplyAmount");
  const hasVatAmount = Object.prototype.hasOwnProperty.call(payload, "vatAmount");
  const hasManualSourcePatch =
    hasTransactionDate || hasDescription || hasCounterparty || hasDepositAmount || hasWithdrawalAmount || hasSupplyAmount || hasVatAmount;
  if (!hasConfirmedAccountId && !hasEvidenceStatus && !hasMemo && !hasManualSourcePatch) {
    return NextResponse.json({ ok: false, message: "수정할 거래 항목이 없습니다." }, { status: 400 });
  }

  const db = getPrisma();

  if (!db) {
    return NextResponse.json({ ok: true, transaction: payload, mode: "sample" });
  }

  const company = await ensureDefaultCompany(db);
  const existing = await db.transaction.findFirst({
    where: {
      id: payload.id,
      companyId: company.id
    }
  });
  if (!existing) {
    return NextResponse.json({ ok: false, message: "거래를 찾을 수 없습니다." }, { status: 404 });
  }
  const closedPeriod = await findClosedPeriodForDate(db, company.id, existing.transactionDate);
  if (closedPeriod) return closedPeriodResponse(closedPeriod.period);
  const nextTransactionDateText = hasTransactionDate ? parseStrictDate(payload.transactionDate) : existing.transactionDate.toISOString().slice(0, 10);
  if (!nextTransactionDateText) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_TRANSACTION_DATE",
        message: "거래일은 유효한 날짜여야 합니다."
      },
      { status: 400 }
    );
  }
  if (hasTransactionDate) {
    const nextClosedPeriod = await findClosedPeriodForDate(db, company.id, nextTransactionDateText);
    if (nextClosedPeriod) return closedPeriodResponse(nextClosedPeriod.period);
  }

  if (hasManualSourcePatch && existing.sourceType !== "MANUAL") {
    return NextResponse.json(
      {
        ok: false,
        code: "NON_MANUAL_TRANSACTION_PATCH_BLOCKED",
        message: "CSV로 가져온 거래의 원천 날짜, 내용, 금액은 직접 수정할 수 없습니다. 업로드 배치를 삭제한 뒤 다시 가져오세요."
      },
      { status: 409 }
    );
  }

  const nextDepositAmount = hasDepositAmount ? payload.depositAmount ?? 0 : Number(existing.depositAmount);
  const nextWithdrawalAmount = hasWithdrawalAmount ? payload.withdrawalAmount ?? 0 : Number(existing.withdrawalAmount);
  const nextSupplyAmount = hasSupplyAmount ? payload.supplyAmount ?? null : existing.supplyAmount === null ? null : Number(existing.supplyAmount);
  const nextVatAmount = hasVatAmount ? payload.vatAmount ?? null : existing.vatAmount === null ? null : Number(existing.vatAmount);
  if (hasManualSourcePatch) {
    const amountIssue = validateTransactionAmounts({
      depositAmount: nextDepositAmount,
      withdrawalAmount: nextWithdrawalAmount,
      supplyAmount: nextSupplyAmount,
      vatAmount: nextVatAmount
    });
    if (amountIssue) {
      return NextResponse.json({ ok: false, code: "INVALID_TRANSACTION_AMOUNTS", message: amountIssue }, { status: 400 });
    }
  }

  const nextConfirmedAccountId = hasConfirmedAccountId ? payload.confirmedAccountId || null : existing.confirmedAccountId;
  const approvedJournalSensitivePatch = hasManualSourcePatch || (hasConfirmedAccountId && nextConfirmedAccountId !== existing.confirmedAccountId);
  if (approvedJournalSensitivePatch) {
    const approvedJournal = await db.journalEntry.findFirst({
      where: {
        companyId: company.id,
        transactionId: existing.id,
        status: "APPROVED"
      },
      select: {
        id: true
      }
    });

    if (approvedJournal) {
      if (hasManualSourcePatch) {
        return NextResponse.json(
          {
            ok: false,
            code: "APPROVED_JOURNAL_TRANSACTION_CHANGE_BLOCKED",
            message: "승인된 분개가 있는 수기 거래는 날짜, 내용, 금액을 변경할 수 없습니다. 먼저 승인 취소 후 다시 수정하세요.",
            approvedJournalId: approvedJournal.id
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        {
          ok: false,
          code: "APPROVED_JOURNAL_ACCOUNT_CHANGE_BLOCKED",
          message: "승인된 분개가 있는 거래는 계정과목을 변경할 수 없습니다. 먼저 승인 취소 후 다시 수정하세요.",
          approvedJournalId: approvedJournal.id
        },
        { status: 409 }
      );
    }
  }

  const confirmedAccount =
    hasConfirmedAccountId && nextConfirmedAccountId
      ? await db.account.findFirst({
          where: {
            companyId: company.id,
            id: nextConfirmedAccountId,
            isActive: true
          }
        })
      : null;
  if (hasConfirmedAccountId && nextConfirmedAccountId && !confirmedAccount) {
    return NextResponse.json({ ok: false, message: "계정과목을 찾을 수 없습니다." }, { status: 404 });
  }
  const nextDescription = hasDescription ? payload.description?.trim() ?? "" : existing.description;
  const nextCounterparty = hasCounterparty ? payload.counterparty?.trim() || null : existing.counterparty;
  const inferred = hasManualSourcePatch ? inferAccount(nextDescription, nextCounterparty) : null;
  const vendorApplied = hasManualSourcePatch
    ? applyVendorDefaults(
        {
          counterparty: nextCounterparty,
          suggestedAccount: inferred?.account,
          reviewReasons: inferred?.reason ? [inferred.reason] : []
        },
        (await db.vendor.findMany({
          where: { companyId: company.id },
          include: { defaultAccount: true }
        })).map(serializeVendor)
      )
    : null;
  const suggestedAccount =
    hasManualSourcePatch && vendorApplied?.suggestedAccount
      ? await db.account.findFirst({
          where: {
            companyId: company.id,
            code: vendorApplied.suggestedAccount.code,
            isActive: true
          }
        })
      : null;

  const updateData: Prisma.TransactionUncheckedUpdateInput = {};
  if (hasTransactionDate) updateData.transactionDate = new Date(nextTransactionDateText);
  if (hasDescription) updateData.description = nextDescription;
  if (hasCounterparty) updateData.counterparty = nextCounterparty;
  if (hasDepositAmount) updateData.depositAmount = nextDepositAmount;
  if (hasWithdrawalAmount) updateData.withdrawalAmount = nextWithdrawalAmount;
  if (hasDepositAmount || hasWithdrawalAmount) updateData.direction = nextDepositAmount > 0 ? "DEPOSIT" : "WITHDRAWAL";
  if (hasSupplyAmount) updateData.supplyAmount = nextSupplyAmount;
  if (hasVatAmount) updateData.vatAmount = nextVatAmount;
  if (hasManualSourcePatch) {
    updateData.suggestedAccountId = suggestedAccount?.id ?? null;
    updateData.rawPayload = {
      manual: true,
      reviewReasons: vendorApplied?.reviewReasons ?? []
    };
  }
  if (hasConfirmedAccountId) updateData.confirmedAccountId = nextConfirmedAccountId;
  if (hasEvidenceStatus && payload.evidenceStatus) updateData.evidenceStatus = payload.evidenceStatus;
  if (hasMemo) updateData.memo = payload.memo ?? null;

  const transaction = await db.$transaction(async (tx) => {
    const updated = await tx.transaction.update({
      where: {
        id: existing.id
      },
      data: updateData,
      include: {
        suggestedAccount: true,
        confirmedAccount: true
      }
    });
    await recordAuditEvent(tx, {
      companyId: company.id,
      action: "TRANSACTION_UPDATE",
      entityType: "TRANSACTION",
      entityId: updated.id,
      summary: `거래를 수정했습니다: ${updated.description}`,
      metadata: transactionUpdateMetadata({
        hasConfirmedAccountId,
        confirmedAccountId: payload.confirmedAccountId,
        sourceChanged: hasManualSourcePatch,
        evidenceStatus: payload.evidenceStatus,
        memoChanged: hasMemo
      })
    });
    return updated;
  });

  return NextResponse.json({ ok: true, transaction: serializeTransaction(transaction), mode: "database" });
}

export async function DELETE(request: Request) {
  const parsed = await parseJsonRequest(request, deleteTransactionSchema, { label: "거래 삭제 요청" });
  if (!parsed.ok) return parsed.response;

  const db = getPrisma();
  if (!db) {
    return NextResponse.json({ ok: true, mode: "sample", deletedTransactionId: parsed.data.id });
  }

  const company = await ensureDefaultCompany(db);
  const existing = await db.transaction.findFirst({
    where: {
      id: parsed.data.id,
      companyId: company.id
    }
  });
  if (!existing) {
    return NextResponse.json({ ok: false, message: "거래를 찾을 수 없습니다." }, { status: 404 });
  }
  const closedPeriod = await findClosedPeriodForDate(db, company.id, existing.transactionDate);
  if (closedPeriod) return closedPeriodResponse(closedPeriod.period);

  if (existing.sourceType !== "MANUAL") {
    return NextResponse.json(
      {
        ok: false,
        code: "NON_MANUAL_TRANSACTION_DELETE_BLOCKED",
        message: "CSV로 가져온 거래는 업로드 화면에서 해당 배치를 삭제해야 합니다."
      },
      { status: 409 }
    );
  }

  const approvedJournal = await db.journalEntry.findFirst({
    where: {
      companyId: company.id,
      transactionId: existing.id,
      status: "APPROVED"
    },
    select: { id: true }
  });
  if (approvedJournal) {
    return NextResponse.json(
      {
        ok: false,
        code: "APPROVED_JOURNAL_TRANSACTION_DELETE_BLOCKED",
        message: "승인된 분개가 있는 수기 거래는 삭제할 수 없습니다. 먼저 승인 취소 후 다시 삭제하세요.",
        approvedJournalId: approvedJournal.id
      },
      { status: 409 }
    );
  }

  const result = await db.$transaction(async (tx) => {
    const detachedEvidence = await tx.evidence.updateMany({
      where: {
        companyId: company.id,
        transactionId: existing.id
      },
      data: { transactionId: null }
    });
    await tx.reviewItem.deleteMany({
      where: {
        companyId: company.id,
        transactionId: existing.id
      }
    });
    const removableJournalEntries = await tx.journalEntry.findMany({
      where: {
        companyId: company.id,
        transactionId: existing.id,
        status: { in: ["DRAFT", "VOID"] }
      },
      select: { id: true }
    });
    const removableJournalEntryIds = removableJournalEntries.map((entry) => entry.id);
    if (removableJournalEntryIds.length) {
      await tx.journalLine.deleteMany({ where: { journalEntryId: { in: removableJournalEntryIds } } });
      await tx.journalEntry.deleteMany({ where: { id: { in: removableJournalEntryIds } } });
    }
    await tx.transaction.delete({ where: { id: existing.id } });
    await recordAuditEvent(tx, {
      companyId: company.id,
      action: "TRANSACTION_DELETE",
      entityType: "TRANSACTION",
      entityId: existing.id,
      summary: `수기 거래를 삭제했습니다: ${existing.description}`,
      metadata: {
        transactionDate: existing.transactionDate.toISOString().slice(0, 10),
        depositAmount: Number(existing.depositAmount),
        withdrawalAmount: Number(existing.withdrawalAmount),
        detachedEvidenceCount: detachedEvidence.count,
        deletedJournalEntryCount: removableJournalEntryIds.length
      }
    });
    return {
      detachedEvidenceCount: detachedEvidence.count,
      deletedJournalEntryCount: removableJournalEntryIds.length
    };
  });

  return NextResponse.json({
    ok: true,
    mode: "database",
    deletedTransactionId: existing.id,
    ...result
  });
}

function transactionUpdateMetadata(input: {
  hasConfirmedAccountId: boolean;
  confirmedAccountId?: string | null;
  sourceChanged: boolean;
  evidenceStatus?: string;
  memoChanged: boolean;
}): Prisma.InputJsonObject {
  return {
    sourceChanged: input.sourceChanged,
    evidenceStatus: input.evidenceStatus ?? null,
    memoChanged: input.memoChanged,
    ...(input.hasConfirmedAccountId ? { confirmedAccountId: input.confirmedAccountId ?? null } : {})
  };
}
