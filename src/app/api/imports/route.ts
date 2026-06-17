import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_COMPANY_ID } from "@/lib/defaults";
import { getPrisma } from "@/lib/db";
import { normalizeCsvRow, summarizeTransactions } from "@/lib/accounting";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { serializeTransaction } from "@/lib/server/serializers";
import type { CsvColumnMapping, ParsedCsvRow, SourceType } from "@/types";

const mappingSchema = z.object({
  transactionDate: z.string().optional(),
  description: z.string().optional(),
  counterparty: z.string().optional(),
  depositAmount: z.string().optional(),
  withdrawalAmount: z.string().optional(),
  amount: z.string().optional(),
  supplyAmount: z.string().optional(),
  vatAmount: z.string().optional(),
  balance: z.string().optional(),
  approvalNumber: z.string().optional()
});

const importSchema = z.object({
  companyId: z.string().default(DEFAULT_COMPANY_ID),
  sourceType: z.enum(["BANK", "CARD", "HOMETAX_SALES", "HOMETAX_PURCHASES", "CASH_RECEIPT", "PG", "MANUAL"]),
  originalFileName: z.string().min(1),
  mapping: mappingSchema,
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).min(1).max(2000)
});

export async function POST(request: Request) {
  const parsed = importSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const payload = parsed.data;
  const normalized = payload.rows.map((row, index) =>
    normalizeCsvRow(row as ParsedCsvRow, payload.mapping as CsvColumnMapping, payload.sourceType as SourceType, index)
  );
  const db = getPrisma();

  if (!db) {
    const transactions = normalized.map((transaction, index) => ({
      id: `preview-${index + 1}`,
      ...transaction
    }));
    return NextResponse.json({
      ok: true,
      mode: "sample",
      transactions,
      summary: summarizeTransactions(transactions)
    });
  }

  const company = await ensureDefaultCompany(db);
  const importBatch = await db.importBatch.create({
    data: {
      companyId: company.id,
      sourceType: payload.sourceType,
      originalFileName: payload.originalFileName,
      rowCount: normalized.length,
      mapping: payload.mapping
    }
  });

  const accounts = await db.account.findMany({ where: { companyId: company.id } });
  const accountByCode = new Map(accounts.map((account) => [account.code, account.id]));

  await db.$transaction(
    normalized.map((transaction, index) =>
      db.transaction.create({
        data: {
          companyId: company.id,
          importBatchId: importBatch.id,
          sourceType: transaction.sourceType,
          sourceRowNumber: index + 1,
          transactionDate: new Date(transaction.transactionDate),
          description: transaction.description,
          counterparty: transaction.counterparty,
          direction: transaction.direction,
          depositAmount: transaction.depositAmount,
          withdrawalAmount: transaction.withdrawalAmount,
          supplyAmount: transaction.supplyAmount,
          vatAmount: transaction.vatAmount,
          balance: transaction.balance,
          approvalNumber: transaction.approvalNumber,
          rawPayload: transaction.rawPayload,
          suggestedAccountId: transaction.suggestedAccount ? accountByCode.get(transaction.suggestedAccount.code) : null,
          evidenceStatus: transaction.evidenceStatus
        }
      })
    )
  );

  const saved = await db.transaction.findMany({
    where: { importBatchId: importBatch.id },
    include: {
      suggestedAccount: true,
      confirmedAccount: true
    },
    orderBy: { sourceRowNumber: "asc" }
  });
  const serialized = saved.map(serializeTransaction);

  return NextResponse.json({
    ok: true,
    mode: "database",
    importBatchId: importBatch.id,
    transactions: serialized,
    summary: summarizeTransactions(serialized)
  });
}
