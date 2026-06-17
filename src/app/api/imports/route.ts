import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { DEFAULT_COMPANY_ID, SOURCE_TYPE_LABELS } from "@/lib/defaults";
import { getPrisma } from "@/lib/db";
import { applyClassificationRules, normalizeCsvRow, summarizeTransactions } from "@/lib/accounting";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { serializeAccount, serializeClassificationRule, serializeImportBatch, serializeTransaction } from "@/lib/server/serializers";
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
  headers: z.array(z.string()).optional().default([]),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).min(1).max(2000)
});

const deleteImportSchema = z.object({
  companyId: z.string().default(DEFAULT_COMPANY_ID),
  importBatchId: z.string().min(1)
});

export async function GET() {
  const db = getPrisma();

  if (!db) {
    return NextResponse.json({ importBatches: [], mode: "sample" });
  }

  const company = await ensureDefaultCompany(db);
  const importBatches = await db.importBatch.findMany({
    where: { companyId: company.id },
    orderBy: { importedAt: "desc" },
    take: 50
  });

  return NextResponse.json({ importBatches: importBatches.map(serializeImportBatch), mode: "database" });
}

export async function DELETE(request: Request) {
  const parsed = deleteImportSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const db = getPrisma();
  if (!db) {
    return NextResponse.json({ ok: true, mode: "sample", deletedTransactions: 0 });
  }

  const company = await ensureDefaultCompany(db);
  const importBatch = await db.importBatch.findFirst({
    where: {
      id: parsed.data.importBatchId,
      companyId: company.id
    }
  });

  if (!importBatch) {
    return NextResponse.json({ ok: false, message: "업로드 이력을 찾을 수 없습니다." }, { status: 404 });
  }

  const transactions = await db.transaction.findMany({
    where: {
      companyId: company.id,
      importBatchId: importBatch.id
    },
    select: { id: true }
  });
  const transactionIds = transactions.map((transaction) => transaction.id);
  const approvedJournalCount = transactionIds.length
    ? await db.journalEntry.count({
        where: {
          companyId: company.id,
          transactionId: { in: transactionIds },
          status: "APPROVED"
        }
      })
    : 0;

  if (approvedJournalCount > 0) {
    return NextResponse.json(
      {
        ok: false,
        message: "승인된 분개가 있는 업로드는 삭제할 수 없습니다. 분개를 취소한 뒤 다시 시도하세요.",
        approvedJournalCount
      },
      { status: 409 }
    );
  }

  const result = await db.$transaction(async (tx) => {
    if (transactionIds.length) {
      await tx.evidence.updateMany({
        where: {
          companyId: company.id,
          transactionId: { in: transactionIds }
        },
        data: { transactionId: null }
      });
      await tx.reviewItem.deleteMany({
        where: {
          companyId: company.id,
          transactionId: { in: transactionIds }
        }
      });
      const draftJournalEntries = await tx.journalEntry.findMany({
        where: {
          companyId: company.id,
          transactionId: { in: transactionIds },
          status: "DRAFT"
        },
        select: { id: true }
      });
      const draftJournalEntryIds = draftJournalEntries.map((entry) => entry.id);
      if (draftJournalEntryIds.length) {
        await tx.journalLine.deleteMany({ where: { journalEntryId: { in: draftJournalEntryIds } } });
        await tx.journalEntry.deleteMany({ where: { id: { in: draftJournalEntryIds } } });
      }
      await tx.transaction.deleteMany({
        where: {
          companyId: company.id,
          importBatchId: importBatch.id
        }
      });
    }
    await tx.importBatch.delete({ where: { id: importBatch.id } });
    return { deletedTransactions: transactionIds.length };
  });

  return NextResponse.json({
    ok: true,
    mode: "database",
    importBatchId: importBatch.id,
    ...result
  });
}

export async function POST(request: Request) {
  const parsed = importSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const payload = parsed.data;
  const originalFileHash = createImportHash({
    sourceType: payload.sourceType,
    headers: payload.headers,
    rows: payload.rows
  });
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
      originalFileHash,
      transactions,
      summary: summarizeTransactions(transactions)
    });
  }

  const company = await ensureDefaultCompany(db);
  const existingBatch = await db.importBatch.findFirst({
    where: {
      companyId: company.id,
      sourceType: payload.sourceType,
      originalFileHash
    },
    orderBy: { importedAt: "desc" }
  });

  if (existingBatch) {
    const saved = await db.transaction.findMany({
      where: { importBatchId: existingBatch.id },
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
      duplicate: true,
      importBatchId: existingBatch.id,
      importBatch: serializeImportBatch(existingBatch),
      originalFileHash,
      transactions: serialized,
      summary: summarizeTransactions(serialized)
    });
  }

  const accounts = await db.account.findMany({ where: { companyId: company.id } });
  const accountByCode = new Map(accounts.map((account) => [account.code, account]));
  const appAccounts = accounts.flatMap((account) => {
    const serialized = serializeAccount(account);
    return serialized ? [serialized] : [];
  });
  const classificationRules = await db.classificationRule.findMany({
    where: {
      companyId: company.id,
      isActive: true
    },
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }]
  });
  const appRules = classificationRules.map((rule) => serializeClassificationRule(rule, accountByCode));
  const classified = normalized.map((transaction) => applyClassificationRules(transaction, appRules, appAccounts));

  const importBatch = await db.importBatch.create({
    data: {
      companyId: company.id,
      sourceType: payload.sourceType,
      originalFileName: payload.originalFileName,
      originalFileHash,
      rowCount: classified.length,
      mapping: payload.mapping
    }
  });

  const accountIdByCode = new Map(accounts.map((account) => [account.code, account.id]));
  const templateName = `${SOURCE_TYPE_LABELS[payload.sourceType]} 기본 템플릿`;
  const headerSignature = payload.headers.join("|");
  const existingTemplate = await db.csvTemplate.findFirst({
    where: {
      companyId: company.id,
      sourceType: payload.sourceType,
      name: templateName
    }
  });

  if (existingTemplate) {
    await db.csvTemplate.update({
      where: { id: existingTemplate.id },
      data: {
        headerSignature,
        mapping: payload.mapping
      }
    });
  } else {
    await db.csvTemplate.create({
      data: {
        companyId: company.id,
        sourceType: payload.sourceType,
        name: templateName,
        headerSignature,
        mapping: payload.mapping
      }
    });
  }

  await db.$transaction(
    classified.map((transaction, index) =>
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
          suggestedAccountId: transaction.suggestedAccount ? accountIdByCode.get(transaction.suggestedAccount.code) : null,
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
    duplicate: false,
    importBatchId: importBatch.id,
    importBatch: serializeImportBatch(importBatch),
    originalFileHash,
    transactions: serialized,
    summary: summarizeTransactions(serialized)
  });
}

function createImportHash(input: { sourceType: string; headers: string[]; rows: Array<Record<string, string | number | null>> }) {
  return createHash("sha256").update(JSON.stringify(stableValue(input))).digest("hex");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value ?? "";
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)])
  );
}
