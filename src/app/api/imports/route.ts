import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { DEFAULT_COMPANY_ID, SOURCE_TYPE_LABELS } from "@/lib/defaults";
import { getPrisma } from "@/lib/db";
import { applyClassificationRules, applyVendorDefaults, normalizeCsvRow, parseMoney, summarizeTransactions } from "@/lib/accounting";
import { recordAuditEvent } from "@/lib/server/audit";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { closedPeriodResponse, findClosedPeriodForDates } from "@/lib/server/closing-periods";
import { parseStrictDate } from "@/lib/server/date-validation";
import { parseJsonRequest } from "@/lib/server/request-json";
import { MAX_ORIGINAL_FILE_TEXT_SIZE, validateOriginalFileText } from "@/lib/server/source-file-validation";
import { validateTransactionTaxAmounts } from "@/lib/server/transaction-validation";
import {
  serializeAccount,
  serializeClassificationRule,
  serializeCsvTemplate,
  serializeImportBatch,
  serializeTransaction,
  serializeVendor
} from "@/lib/server/serializers";
import type { CsvColumnMapping, ParsedCsvRow, SourceType } from "@/types";

const MAX_IMPORT_VALIDATION_ISSUES = 25;
const MAX_IMPORT_REQUEST_BYTES = MAX_ORIGINAL_FILE_TEXT_SIZE + 3_000_000;

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
  originalFileSize: z.coerce.number().int().nonnegative().max(MAX_ORIGINAL_FILE_TEXT_SIZE).optional().nullable(),
  originalFileText: z.string().max(MAX_ORIGINAL_FILE_TEXT_SIZE).optional().nullable(),
  mapping: mappingSchema,
  headers: z.array(z.string()).optional().default([]),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).min(1).max(2000)
});

const deleteImportSchema = z.object({
  companyId: z.string().default(DEFAULT_COMPANY_ID),
  importBatchId: z.string().min(1)
});

type ImportPayloadData = z.infer<typeof importSchema>;

const mappingFieldLabels: Array<[keyof CsvColumnMapping, string]> = [
  ["transactionDate", "거래일"],
  ["description", "내용/적요"],
  ["counterparty", "거래처"],
  ["depositAmount", "입금"],
  ["withdrawalAmount", "출금"],
  ["amount", "금액"],
  ["supplyAmount", "공급가액"],
  ["vatAmount", "부가세"],
  ["balance", "잔액"],
  ["approvalNumber", "승인번호"]
];

function validateImportMapping(payload: ImportPayloadData) {
  const mapping = payload.mapping as CsvColumnMapping;
  const issues: string[] = [];
  const hasMappedColumn = (column?: string) => Boolean(column?.trim());

  if (!hasMappedColumn(mapping.transactionDate)) issues.push("거래일 컬럼을 매핑해야 합니다.");
  if (!hasMappedColumn(mapping.description)) issues.push("내용/적요 컬럼을 매핑해야 합니다.");
  if (!hasMappedColumn(mapping.amount) && !hasMappedColumn(mapping.depositAmount) && !hasMappedColumn(mapping.withdrawalAmount)) {
    issues.push("금액 또는 입금/출금 컬럼 중 하나를 매핑해야 합니다.");
  }

  if (payload.headers.length > 0) {
    const headerSet = new Set(payload.headers);
    for (const [key, label] of mappingFieldLabels) {
      const mappedColumn = mapping[key]?.trim();
      if (mappedColumn && !headerSet.has(mappedColumn)) {
        issues.push(`${label} 매핑 컬럼(${mappedColumn})이 CSV 헤더에 없습니다.`);
      }
    }
  }

  return issues;
}

function validateImportRows(payload: ImportPayloadData) {
  const mapping = payload.mapping as CsvColumnMapping;
  const issues: string[] = [];
  let hiddenIssueCount = 0;
  const pushIssue = (issue: string) => {
    if (issues.length < MAX_IMPORT_VALIDATION_ISSUES) {
      issues.push(issue);
    } else {
      hiddenIssueCount += 1;
    }
  };

  payload.rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const sourceRow = row as ParsedCsvRow;
    const transactionDate = getMappedCsvValue(sourceRow, mapping.transactionDate);
    const description = getMappedCsvValue(sourceRow, mapping.description);
    const amount = parseMoney(getMappedCsvValue(sourceRow, mapping.amount));
    const depositAmount = parseMoney(getMappedCsvValue(sourceRow, mapping.depositAmount));
    const withdrawalAmount = parseMoney(getMappedCsvValue(sourceRow, mapping.withdrawalAmount));
    const supplyAmount = mapping.supplyAmount ? parseMoney(getMappedCsvValue(sourceRow, mapping.supplyAmount)) : null;
    const vatAmount = mapping.vatAmount ? parseMoney(getMappedCsvValue(sourceRow, mapping.vatAmount)) : null;

    if (!parseStrictDate(String(transactionDate ?? ""))) {
      pushIssue(`${rowNumber}행 거래일 값이 비어 있거나 날짜 형식이 아닙니다.`);
    }
    if (!String(description ?? "").trim()) {
      pushIssue(`${rowNumber}행 내용/적요 값이 비어 있습니다.`);
    }
    if (amount <= 0 && depositAmount <= 0 && withdrawalAmount <= 0) {
      pushIssue(`${rowNumber}행 금액 또는 입금/출금 값이 0보다 커야 합니다.`);
    }
    if (depositAmount > 0 && withdrawalAmount > 0) {
      pushIssue(`${rowNumber}행 입금과 출금이 동시에 입력됐습니다.`);
    }
    const taxIssue = validateTransactionTaxAmounts({
      grossAmount: amount > 0 ? amount : depositAmount > 0 ? depositAmount : withdrawalAmount,
      supplyAmount,
      vatAmount
    });
    if (taxIssue) {
      pushIssue(`${rowNumber}행 ${taxIssue}`);
    }
  });

  if (hiddenIssueCount > 0) {
    issues.push(`추가 ${hiddenIssueCount}개 행 오류가 있습니다. 앞 오류를 수정한 뒤 다시 확인하세요.`);
  }

  return issues;
}

function getMappedCsvValue(row: ParsedCsvRow, column?: string) {
  return column?.trim() ? row[column.trim()] : undefined;
}

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
  const parsed = await parseJsonRequest(request, deleteImportSchema, { label: "가져오기 삭제 요청" });
  if (!parsed.ok) return parsed.response;

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
  const parsed = await parseJsonRequest(request, importSchema, { label: "CSV 가져오기 요청", maxBytes: MAX_IMPORT_REQUEST_BYTES });
  if (!parsed.ok) return parsed.response;

  const payload = parsed.data;
  const originalFileIssue = validateOriginalFileText(payload);
  if (originalFileIssue) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_ORIGINAL_FILE",
        message: originalFileIssue
      },
      { status: 400 }
    );
  }

  const mappingIssues = validateImportMapping(payload);
  if (mappingIssues.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_CSV_MAPPING",
        message: "CSV 매핑을 확인해야 합니다.",
        issues: mappingIssues
      },
      { status: 400 }
    );
  }
  const rowIssues = validateImportRows(payload);
  if (rowIssues.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_CSV_ROWS",
        message: "CSV 행 데이터를 확인해야 합니다.",
        issues: rowIssues
      },
      { status: 400 }
    );
  }

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
    const duplicateImport = await db.$transaction(async (tx) => {
      const csvTemplate = await saveCsvTemplate(tx, {
        companyId: company.id,
        sourceType: payload.sourceType as SourceType,
        headers: payload.headers,
        mapping: payload.mapping as CsvColumnMapping
      });
      const importBatch =
        !existingBatch.originalFileText && payload.originalFileText
          ? await tx.importBatch.update({
              where: { id: existingBatch.id },
              data: {
                originalFileText: payload.originalFileText,
                originalFileMimeType: payload.originalFileMimeType ?? "text/csv",
                originalFileSize: payload.originalFileSize ?? payload.originalFileText.length
              }
            })
          : existingBatch;
      return { csvTemplate, importBatch };
    });
    const saved = await db.transaction.findMany({
      where: { importBatchId: duplicateImport.importBatch.id },
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
      importBatchId: duplicateImport.importBatch.id,
      importBatch: serializeImportBatch(duplicateImport.importBatch),
      csvTemplate: serializeCsvTemplate(duplicateImport.csvTemplate),
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

  const accountIdByCode = new Map(accounts.map((account) => [account.code, account.id]));

  const createdImport = await db.$transaction(async (tx) => {
    const importBatch = await tx.importBatch.create({
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
    const csvTemplate = await saveCsvTemplate(tx, {
      companyId: company.id,
      sourceType: payload.sourceType as SourceType,
      headers: payload.headers,
      mapping: payload.mapping as CsvColumnMapping
    });

    for (const [index, transaction] of classified.entries()) {
      await tx.transaction.create({
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
      });
    }

    await recordAuditEvent(tx, {
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

    return { csvTemplate, importBatch };
  });

  const saved = await db.transaction.findMany({
    where: { importBatchId: createdImport.importBatch.id },
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
    importBatchId: createdImport.importBatch.id,
    importBatch: serializeImportBatch(createdImport.importBatch),
    csvTemplate: serializeCsvTemplate(createdImport.csvTemplate),
    originalFileHash,
    transactions: serialized,
    summary: summarizeTransactions(serialized)
  });
}

async function saveCsvTemplate(
  db: PrismaClient | Prisma.TransactionClient,
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
