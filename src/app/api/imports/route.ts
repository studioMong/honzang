import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { DEFAULT_COMPANY_ID, SOURCE_TYPE_LABELS } from "@/lib/defaults";
import { getPrisma } from "@/lib/db";
import { applyClassificationRules, applyVendorDefaults, normalizeCsvRow, summarizeTransactions } from "@/lib/accounting";
import { recordAuditEvent } from "@/lib/server/audit";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { closedPeriodResponse, findClosedPeriodForDates } from "@/lib/server/closing-periods";
import {
  serializeAccount,
  serializeClassificationRule,
  serializeCsvTemplate,
  serializeImportBatch,
  serializeTransaction,
  serializeVendor
} from "@/lib/server/serializers";
import type { CsvColumnMapping, ParsedCsvRow, SourceType } from "@/types";

const MAX_ORIGINAL_FILE_TEXT_LENGTH = 2_000_000;

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
  originalFileMimeType: z.string().max(120).optional().nullable(),
  originalFileSize: z.coerce.number().int().nonnegative().max(MAX_ORIGINAL_FILE_TEXT_LENGTH).optional().nullable(),
  originalFileText: z.string().max(MAX_ORIGINAL_FILE_TEXT_LENGTH).optional().nullable(),
  mapping: mappingSchema,
  headers: z.array(z.string()).optional().default([]),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).min(1).max(2000)
});

const deleteImportSchema = z.object({
  companyId: z.string().default(DEFAULT_COMPANY_ID),
  importBatchId: z.string().min(1)
});

export async function GET(request: Request) {
  const db = getPrisma();

  if (!db) {
    return NextResponse.json({ importBatches: [], mode: "sample" });
  }

  const company = await ensureDefaultCompany(db);
  const importBatchId = new URL(request.url).searchParams.get("importBatchId");

  if (importBatchId) {
    const importBatch = await db.importBatch.findFirst({
      where: {
        id: importBatchId,
        companyId: company.id
      }
    });

    if (!importBatch) {
      return NextResponse.json({ ok: false, message: "업로드 이력을 찾을 수 없습니다." }, { status: 404 });
    }
    if (!importBatch.originalFileText) {
      return NextResponse.json({ ok: false, message: "보관된 원본 CSV가 없습니다." }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      mode: "database",
      importBatch: serializeImportBatch(importBatch),
      originalFileName: importBatch.originalFileName,
      originalFileHash: importBatch.originalFileHash,
      originalFileMimeType: importBatch.originalFileMimeType,
      originalFileSize: importBatch.originalFileSize,
      originalFileText: importBatch.originalFileText
    });
  }

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
    select: { id: true, transactionDate: true }
  });
  const transactionIds = transactions.map((transaction) => transaction.id);
  const closedPeriod = await findClosedPeriodForDates(
    db,
    company.id,
    transactions.map((transaction) => transaction.transactionDate)
  );
  if (closedPeriod) return closedPeriodResponse(closedPeriod.period);
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
      const removableJournalEntries = await tx.journalEntry.findMany({
        where: {
          companyId: company.id,
          transactionId: { in: transactionIds },
          status: { in: ["DRAFT", "VOID"] }
        },
        select: { id: true }
      });
      const removableJournalEntryIds = removableJournalEntries.map((entry) => entry.id);
      if (removableJournalEntryIds.length) {
        await tx.journalLine.deleteMany({ where: { journalEntryId: { in: removableJournalEntryIds } } });
        await tx.journalEntry.deleteMany({ where: { id: { in: removableJournalEntryIds } } });
      }
      await tx.transaction.deleteMany({
        where: {
          companyId: company.id,
          importBatchId: importBatch.id
        }
      });
    }
    await tx.importBatch.delete({ where: { id: importBatch.id } });
    await recordAuditEvent(tx, {
      companyId: company.id,
      action: "IMPORT_DELETE",
      entityType: "IMPORT_BATCH",
      entityId: importBatch.id,
      summary: `${importBatch.originalFileName} 업로드 이력을 삭제했습니다.`,
      metadata: {
        sourceType: importBatch.sourceType,
        deletedTransactions: transactionIds.length
      }
    });
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
  const closedPeriod = await findClosedPeriodForDates(
    db,
    company.id,
    normalized.map((transaction) => transaction.transactionDate)
  );
  if (closedPeriod) return closedPeriodResponse(closedPeriod.period);
  const existingBatch = await db.importBatch.findFirst({
    where: {
      companyId: company.id,
      sourceType: payload.sourceType,
      originalFileHash
    },
    orderBy: { importedAt: "desc" }
  });

  if (existingBatch) {
    const csvTemplate = await saveCsvTemplate(db, {
      companyId: company.id,
      sourceType: payload.sourceType as SourceType,
      headers: payload.headers,
      mapping: payload.mapping as CsvColumnMapping
    });
    const importBatch =
      !existingBatch.originalFileText && payload.originalFileText
        ? await db.importBatch.update({
            where: { id: existingBatch.id },
            data: {
              originalFileText: payload.originalFileText,
              originalFileMimeType: payload.originalFileMimeType ?? "text/csv",
              originalFileSize: payload.originalFileSize ?? payload.originalFileText.length
            }
          })
        : existingBatch;
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
      duplicate: true,
      importBatchId: importBatch.id,
      importBatch: serializeImportBatch(importBatch),
      csvTemplate: serializeCsvTemplate(csvTemplate),
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
  const vendors = await db.vendor.findMany({
    where: { companyId: company.id },
    include: { defaultAccount: true },
    orderBy: [{ name: "asc" }]
  });
  const appRules = classificationRules.map((rule) => serializeClassificationRule(rule, accountByCode));
  const appVendors = vendors.map(serializeVendor);
  const classified = normalized.map((transaction) => applyClassificationRules(applyVendorDefaults(transaction, appVendors), appRules, appAccounts));

  const importBatch = await db.importBatch.create({
    data: {
      companyId: company.id,
      sourceType: payload.sourceType,
      originalFileName: payload.originalFileName,
      originalFileHash,
      originalFileText: payload.originalFileText ?? null,
      originalFileMimeType: payload.originalFileMimeType ?? (payload.originalFileText ? "text/csv" : null),
      originalFileSize: payload.originalFileSize ?? payload.originalFileText?.length ?? null,
      rowCount: classified.length,
      mapping: payload.mapping
    }
  });

  const accountIdByCode = new Map(accounts.map((account) => [account.code, account.id]));
  const csvTemplate = await saveCsvTemplate(db, {
    companyId: company.id,
    sourceType: payload.sourceType as SourceType,
    headers: payload.headers,
    mapping: payload.mapping as CsvColumnMapping
  });

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
  await recordAuditEvent(db, {
    companyId: company.id,
    action: "IMPORT_CREATE",
    entityType: "IMPORT_BATCH",
    entityId: importBatch.id,
    summary: `${payload.originalFileName} 파일에서 거래 ${classified.length}건을 가져왔습니다.`,
    metadata: {
      sourceType: payload.sourceType,
      rowCount: classified.length,
      hasOriginalFile: Boolean(payload.originalFileText),
      originalFileHash
    }
  });

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
    csvTemplate: serializeCsvTemplate(csvTemplate),
    originalFileHash,
    transactions: serialized,
    summary: summarizeTransactions(serialized)
  });
}

async function saveCsvTemplate(
  db: PrismaClient,
  input: {
    companyId: string;
    sourceType: SourceType;
    headers: string[];
    mapping: CsvColumnMapping;
  }
) {
  const headerSignature = input.headers.join("|");
  const existingTemplate = await db.csvTemplate.findFirst({
    where: {
      companyId: input.companyId,
      sourceType: input.sourceType,
      headerSignature
    }
  });

  if (existingTemplate) {
    return db.csvTemplate.update({
      where: { id: existingTemplate.id },
      data: {
        headerSignature,
        mapping: input.mapping
      }
    });
  }

  const sourceTemplateCount = await db.csvTemplate.count({
    where: {
      companyId: input.companyId,
      sourceType: input.sourceType
    }
  });
  const templateName =
    sourceTemplateCount === 0
      ? `${SOURCE_TYPE_LABELS[input.sourceType]} 기본 템플릿`
      : `${SOURCE_TYPE_LABELS[input.sourceType]} 템플릿 ${sourceTemplateCount + 1}`;

  return db.csvTemplate.create({
    data: {
      companyId: input.companyId,
      sourceType: input.sourceType,
      name: templateName,
      headerSignature,
      mapping: input.mapping
    }
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
