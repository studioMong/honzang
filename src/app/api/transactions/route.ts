import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/db";
import { sampleTransactions } from "@/lib/sample-data";
import { recordAuditEvent } from "@/lib/server/audit";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { closedPeriodResponse, findClosedPeriodForDate } from "@/lib/server/closing-periods";
import { serializeTransaction, serializeVendor } from "@/lib/server/serializers";
import { validateTransactionAmounts } from "@/lib/server/transaction-validation";
import { applyVendorDefaults, inferAccount, summarizeTransactions } from "@/lib/accounting";

const manualTransactionSchema = z.object({
  transactionDate: z.string().min(1),
  description: z.string().min(1).max(240),
  counterparty: z.string().max(120).optional().nullable(),
  depositAmount: z.coerce.number().nonnegative().default(0),
  withdrawalAmount: z.coerce.number().nonnegative().default(0),
  supplyAmount: z.coerce.number().nonnegative().optional().nullable(),
  vatAmount: z.coerce.number().nonnegative().optional().nullable(),
  confirmedAccountId: z.string().optional().nullable(),
  evidenceStatus: z.enum(["UNCHECKED", "MISSING", "ATTACHED", "MATCHED", "NOT_REQUIRED"]).default("UNCHECKED"),
  memo: z.string().max(500).optional().nullable()
});

const patchTransactionSchema = z.object({
  id: z.string().min(1),
  confirmedAccountId: z.string().optional().nullable(),
  evidenceStatus: z.enum(["UNCHECKED", "MISSING", "ATTACHED", "MATCHED", "NOT_REQUIRED"]).optional(),
  memo: z.string().max(500).optional().nullable()
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
  const parsed = manualTransactionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const payload = parsed.data;
  const transactionDate = parseStrictTransactionDate(payload.transactionDate);
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

  const transaction = await db.transaction.create({
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
  await recordAuditEvent(db, {
    companyId: company.id,
    action: "TRANSACTION_CREATE",
    entityType: "TRANSACTION",
    entityId: transaction.id,
    summary: `수기 거래를 추가했습니다: ${transaction.description}`,
    metadata: {
      transactionDate: transaction.transactionDate.toISOString().slice(0, 10),
      depositAmount: Number(transaction.depositAmount),
      withdrawalAmount: Number(transaction.withdrawalAmount),
      evidenceStatus: transaction.evidenceStatus
    }
  });

  return NextResponse.json({ ok: true, transaction: serializeTransaction(transaction), mode: "database" });
}

export async function PATCH(request: Request) {
  const parsed = patchTransactionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const payload = parsed.data;
  const hasConfirmedAccountId = Object.prototype.hasOwnProperty.call(payload, "confirmedAccountId");
  const hasEvidenceStatus = Object.prototype.hasOwnProperty.call(payload, "evidenceStatus");
  const hasMemo = Object.prototype.hasOwnProperty.call(payload, "memo");
  if (!hasConfirmedAccountId && !hasEvidenceStatus && !hasMemo) {
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

  const confirmedAccount =
    hasConfirmedAccountId && payload.confirmedAccountId
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

  const updateData: Prisma.TransactionUncheckedUpdateInput = {};
  if (hasConfirmedAccountId) updateData.confirmedAccountId = payload.confirmedAccountId || null;
  if (hasEvidenceStatus && payload.evidenceStatus) updateData.evidenceStatus = payload.evidenceStatus;
  if (hasMemo) updateData.memo = payload.memo ?? null;

  const transaction = await db.transaction.update({
    where: {
      id: existing.id
    },
    data: updateData,
    include: {
      suggestedAccount: true,
      confirmedAccount: true
    }
  });
  await recordAuditEvent(db, {
    companyId: company.id,
    action: "TRANSACTION_UPDATE",
    entityType: "TRANSACTION",
    entityId: transaction.id,
    summary: `거래를 수정했습니다: ${transaction.description}`,
    metadata: transactionUpdateMetadata({
      hasConfirmedAccountId,
      confirmedAccountId: payload.confirmedAccountId,
      evidenceStatus: payload.evidenceStatus,
      memoChanged: hasMemo
    })
  });

  return NextResponse.json({ ok: true, transaction: serializeTransaction(transaction), mode: "database" });
}

function parseStrictTransactionDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const dotted = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (dotted) {
    const [, year, month, day] = dotted;
    return validDateParts(Number(year), Number(month), Number(day));
  }

  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    const [, year, month, day] = compact;
    return validDateParts(Number(year), Number(month), Number(day));
  }

  return null;
}

function validDateParts(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function transactionUpdateMetadata(input: {
  hasConfirmedAccountId: boolean;
  confirmedAccountId?: string | null;
  evidenceStatus?: string;
  memoChanged: boolean;
}): Prisma.InputJsonObject {
  return {
    evidenceStatus: input.evidenceStatus ?? null,
    memoChanged: input.memoChanged,
    ...(input.hasConfirmedAccountId ? { confirmedAccountId: input.confirmedAccountId ?? null } : {})
  };
}
