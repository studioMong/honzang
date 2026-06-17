import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db";
import { sampleTransactions } from "@/lib/sample-data";
import { recordAuditEvent } from "@/lib/server/audit";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { serializeTransaction, serializeVendor } from "@/lib/server/serializers";
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
  if (payload.depositAmount <= 0 && payload.withdrawalAmount <= 0) {
    return NextResponse.json({ ok: false, message: "입금 또는 출금 금액을 입력해야 합니다." }, { status: 400 });
  }
  if (payload.depositAmount > 0 && payload.withdrawalAmount > 0) {
    return NextResponse.json({ ok: false, message: "입금과 출금 중 하나만 입력해야 합니다." }, { status: 400 });
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
        transactionDate: payload.transactionDate,
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
      transactionDate: new Date(payload.transactionDate),
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
  const db = getPrisma();
  const body = await request.json();

  if (!db) {
    return NextResponse.json({ ok: true, transaction: body, mode: "sample" });
  }

  const company = await ensureDefaultCompany(db);
  const transaction = await db.transaction.update({
    where: {
      id: String(body.id)
    },
    data: {
      confirmedAccountId: body.confirmedAccountId || null,
      evidenceStatus: body.evidenceStatus || undefined,
      memo: body.memo ?? undefined
    },
    include: {
      suggestedAccount: true,
      confirmedAccount: true
    }
  });

  if (transaction.companyId !== company.id) {
    return NextResponse.json({ ok: false, message: "Invalid company transaction." }, { status: 403 });
  }
  await recordAuditEvent(db, {
    companyId: company.id,
    action: "TRANSACTION_UPDATE",
    entityType: "TRANSACTION",
    entityId: transaction.id,
    summary: `거래를 수정했습니다: ${transaction.description}`,
    metadata: {
      confirmedAccountId: body.confirmedAccountId ?? null,
      evidenceStatus: body.evidenceStatus ?? null,
      memoChanged: body.memo !== undefined
    }
  });

  return NextResponse.json({ ok: true, transaction: serializeTransaction(transaction), mode: "database" });
}
