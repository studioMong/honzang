import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_ACCOUNTS } from "@/lib/defaults";
import { getPrisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/server/audit";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { periodRangeFromMonth } from "@/lib/server/closing-periods";
import { dateFromStrictDate, parseStrictDate, parseStrictDateTime } from "@/lib/server/date-validation";
import {
  MAX_EVIDENCE_FILE_DATA_URL_LENGTH,
  MAX_EVIDENCE_FILE_SIZE,
  normalizeEvidenceFileUrl,
  parseStrictEvidenceDate,
  validateEvidenceAmounts,
  validateEvidenceFile,
  validateEvidenceFileUrl
} from "@/lib/server/evidence-validation";
import { MAX_ORIGINAL_FILE_TEXT_SIZE, validateOriginalFileText } from "@/lib/server/source-file-validation";
import { validateTransactionAmounts } from "@/lib/server/transaction-validation";

const sourceTypeSchema = z.enum(["BANK", "CARD", "HOMETAX_SALES", "HOMETAX_PURCHASES", "CASH_RECEIPT", "PG", "MANUAL"]);
const accountTypeSchema = z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]);
const billingModelSchema = z.enum(["INTERNAL_PER_USE", "SAAS_MONTHLY", "SAAS_ANNUAL"]);
const evidenceStatusSchema = z.enum(["UNCHECKED", "MISSING", "ATTACHED", "MATCHED", "NOT_REQUIRED"]);
const transactionDirectionSchema = z.enum(["DEPOSIT", "WITHDRAWAL", "TRANSFER", "UNKNOWN"]);
const journalStatusSchema = z.enum(["DRAFT", "APPROVED", "VOID"]);
const taxReportTypeSchema = z.enum(["MONTHLY_PROFIT", "VAT_PREP", "WITHHOLDING_CHECKLIST", "CORPORATE_TAX_PREP", "RISK_REVIEW"]);
const reviewSeveritySchema = z.enum(["INFO", "WARNING", "DANGER"]);
const reviewStatusSchema = z.enum(["OPEN", "RESOLVED", "IGNORED"]);

const accountSchema = z
  .object({
    id: z.string().optional().nullable(),
    code: z.string().min(1).max(30),
    name: z.string().min(1).max(120),
    type: accountTypeSchema,
    taxCategory: z.string().max(80).optional().nullable()
  })
  .passthrough();

const companySchema = z
  .object({
    name: z.string().min(1).max(100),
    businessRegistrationNumber: z.string().max(40).optional().nullable(),
    industry: z.string().max(120).optional().nullable(),
    vatType: z.string().min(1).max(40).default("GENERAL"),
    fiscalYearEndMonth: z.coerce.number().int().min(1).max(12).default(12),
    representativeSalaryEnabled: z.boolean().default(false),
    employeePayrollEnabled: z.boolean().default(false),
    contractorPaymentEnabled: z.boolean().default(false),
    billingModel: billingModelSchema.default("INTERNAL_PER_USE"),
    perUseUnitPrice: z.coerce.number().int().nonnegative().default(0),
    monthlySubscriptionPrice: z.coerce.number().int().nonnegative().default(0),
    annualSubscriptionPrice: z.coerce.number().int().nonnegative().default(0)
  })
  .passthrough();

const csvTemplateSchema = z
  .object({
    id: z.string().min(1).max(128).optional().nullable(),
    name: z.string().min(1).max(120),
    sourceType: sourceTypeSchema,
    headerSignature: z.string().optional().nullable(),
    mapping: z.record(z.string(), z.unknown()).default({})
  })
  .passthrough();

const importBatchSchema = z
  .object({
    id: z.string().min(1).max(128),
    sourceType: sourceTypeSchema,
    originalFileName: z.string().min(1).max(240),
    originalFileHash: z.string().optional().nullable(),
    originalFileMimeType: z.string().optional().nullable(),
    originalFileSize: z.coerce.number().int().nonnegative().optional().nullable(),
    rowCount: z.coerce.number().int().nonnegative().default(0),
    importedAt: z.string().optional().nullable()
  })
  .passthrough();

const originalImportFileSchema = z
  .object({
    importBatchId: z.string().min(1).max(128),
    originalFileName: z.string().min(1).max(240),
    originalFileHash: z.string().optional().nullable(),
    originalFileMimeType: z.string().max(120).optional().nullable(),
    originalFileSize: z.coerce.number().int().nonnegative().max(MAX_ORIGINAL_FILE_TEXT_SIZE).optional().nullable(),
    originalFileText: z.string().max(MAX_ORIGINAL_FILE_TEXT_SIZE)
  })
  .passthrough();

const transactionSchema = z
  .object({
    id: z.string().min(1).max(128),
    importBatchId: z.string().optional().nullable(),
    sourceRowNumber: z.coerce.number().int().positive().optional().nullable(),
    sourceType: sourceTypeSchema,
    transactionDate: z.string().min(1),
    description: z.string().min(1).max(240),
    counterparty: z.string().max(120).optional().nullable(),
    direction: transactionDirectionSchema.default("UNKNOWN"),
    depositAmount: z.coerce.number().nonnegative().default(0),
    withdrawalAmount: z.coerce.number().nonnegative().default(0),
    supplyAmount: z.coerce.number().nonnegative().optional().nullable(),
    vatAmount: z.coerce.number().nonnegative().optional().nullable(),
    balance: z.coerce.number().optional().nullable(),
    approvalNumber: z.string().max(120).optional().nullable(),
    suggestedAccount: accountSchema.optional().nullable(),
    confirmedAccount: accountSchema.optional().nullable(),
    evidenceStatus: evidenceStatusSchema.default("UNCHECKED"),
    memo: z.string().max(500).optional().nullable(),
    reviewReasons: z.array(z.string().max(500)).optional().default([])
  })
  .passthrough();

const evidenceSchema = z
  .object({
    id: z.string().min(1).max(128),
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
  })
  .passthrough();

const journalLineSchema = z
  .object({
    accountCode: z.string().min(1).max(30),
    accountName: z.string().min(1).max(120),
    accountType: accountTypeSchema.optional(),
    debitAmount: z.coerce.number().nonnegative(),
    creditAmount: z.coerce.number().nonnegative(),
    vatType: z.string().optional().nullable(),
    memo: z.string().max(500).optional().nullable()
  })
  .passthrough();

const journalEntrySchema = z
  .object({
    id: z.string().min(1).max(128),
    transactionId: z.string().optional().nullable(),
    entryDate: z.string().min(1),
    memo: z.string().min(1).max(300),
    status: journalStatusSchema.default("DRAFT"),
    lines: z.array(journalLineSchema).min(1).max(40)
  })
  .passthrough();

const taxReportSchema = z
  .object({
    id: z.string().min(1).max(128),
    reportType: taxReportTypeSchema,
    periodStart: z.string().min(1),
    periodEnd: z.string().min(1),
    calculatedPayload: z.unknown(),
    createdAt: z.string().optional().nullable()
  })
  .passthrough();

const closingPeriodSchema = z
  .object({
    id: z.string().min(1).max(128).optional().nullable(),
    period: z.string().regex(/^\d{4}-\d{2}$/),
    periodStart: z.string().optional().nullable(),
    periodEnd: z.string().optional().nullable(),
    summaryPayload: z.unknown().optional().nullable(),
    closedAt: z.string().optional().nullable(),
    createdAt: z.string().optional().nullable()
  })
  .passthrough();

const vendorSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(120),
    businessRegistrationNumber: z.string().max(40).optional().nullable(),
    defaultAccount: accountSchema.optional().nullable(),
    withholdingType: z.string().max(80).optional().nullable(),
    memo: z.string().max(500).optional().nullable()
  })
  .passthrough();

const classificationRuleSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(80),
    keyword: z.string().min(1).max(120),
    accountCode: z.string().min(1).max(30),
    sourceType: sourceTypeSchema.optional().nullable(),
    priority: z.coerce.number().int().min(1).max(999).default(100),
    isActive: z.boolean().default(true)
  })
  .passthrough();

const reviewItemSchema = z
  .object({
    id: z.string().min(1).max(160),
    severity: reviewSeveritySchema,
    reason: z.string().min(1).max(500),
    recommendation: z.string().max(500).optional().nullable(),
    status: reviewStatusSchema.default("OPEN"),
    transaction: transactionSchema.optional().nullable()
  })
  .passthrough();

const auditEventSchema = z
  .object({
    id: z.string().min(1).max(160),
    action: z.string().min(1).max(120),
    entityType: z.string().min(1).max(120),
    entityId: z.string().max(160).optional().nullable(),
    summary: z.string().min(1).max(500),
    metadata: z.unknown().optional().nullable(),
    createdAt: z.string().optional().nullable()
  })
  .passthrough();

const workspaceBackupSchema = z
  .object({
    app: z.literal("혼자장부"),
    backupVersion: z.literal(1),
    company: companySchema,
    accounts: z.array(accountSchema).default([]),
    csvTemplates: z.array(csvTemplateSchema).default([]),
    importBatches: z.array(importBatchSchema).default([]),
    originalImportFiles: z.array(originalImportFileSchema).default([]),
    transactions: z.array(transactionSchema).default([]),
    evidences: z.array(evidenceSchema).default([]),
    journalEntries: z.array(journalEntrySchema).default([]),
    taxReports: z.array(taxReportSchema).default([]),
    closingPeriods: z.array(closingPeriodSchema).default([]),
    vendors: z.array(vendorSchema).default([]),
    classificationRules: z.array(classificationRuleSchema).default([]),
    auditEvents: z.array(auditEventSchema).default([]),
    reviewItems: z.array(reviewItemSchema).default([])
  })
  .passthrough();

type WorkspaceBackup = z.infer<typeof workspaceBackupSchema>;
type RestoreDb = NonNullable<ReturnType<typeof getPrisma>>;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "백업 JSON 요청 본문을 읽을 수 없습니다." }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ ok: false, message: "백업 복원 요청 형식이 아닙니다." }, { status: 400 });
  }

  const candidate = "backup" in body ? body.backup : body;
  const parsed = workspaceBackupSchema.safeParse(candidate);

  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "혼자장부 백업 JSON 형식이 아닙니다.", errors: parsed.error.flatten() }, { status: 400 });
  }

  const dateIssues = validateBackupDates(parsed.data);
  if (dateIssues.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_BACKUP_DATES",
        message: "백업 날짜 데이터가 올바르지 않습니다.",
        issues: dateIssues
      },
      { status: 400 }
    );
  }

  const transactionIssues = validateBackupTransactions(parsed.data);
  if (transactionIssues.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_BACKUP_TRANSACTIONS",
        message: "백업 거래 데이터가 올바르지 않습니다.",
        issues: transactionIssues
      },
      { status: 400 }
    );
  }

  const evidenceIssues = validateBackupEvidences(parsed.data);
  if (evidenceIssues.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_BACKUP_EVIDENCE",
        message: "백업 증빙 데이터가 올바르지 않습니다.",
        issues: evidenceIssues
      },
      { status: 400 }
    );
  }

  const journalIssues = validateBackupJournalEntries(parsed.data);
  if (journalIssues.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_BACKUP_JOURNALS",
        message: "백업 분개 데이터가 올바르지 않습니다.",
        issues: journalIssues
      },
      { status: 400 }
    );
  }

  const originalFileIssues = validateBackupOriginalImportFiles(parsed.data.originalImportFiles);
  if (originalFileIssues.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_BACKUP_ORIGINAL_FILES",
        message: "백업 원본 CSV 데이터가 올바르지 않습니다.",
        issues: originalFileIssues
      },
      { status: 400 }
    );
  }

  if (body.dryRun === true) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      mode: getPrisma() ? "database" : "sample",
      restoredCounts: buildRestoreCounts(parsed.data)
    });
  }

  if (body.confirmReplace !== true) {
    return NextResponse.json({ ok: false, message: "복원하려면 confirmReplace 값을 true로 보내야 합니다." }, { status: 400 });
  }

  const db = getPrisma();
  if (!db) {
    return NextResponse.json({ ok: false, message: "백업 복원은 Postgres DB 모드에서만 실행할 수 있습니다.", mode: "sample" }, { status: 409 });
  }

  const result = await restoreWorkspace(db, parsed.data);
  return NextResponse.json({ ok: true, mode: "database", ...result });
}

async function restoreWorkspace(db: RestoreDb, backup: WorkspaceBackup) {
  const company = await ensureDefaultCompany(db);

  return db.$transaction(async (tx) => {
    await clearCompanyData(tx, company.id);

    const restoredCompany = await tx.company.update({
      where: { id: company.id },
      data: {
        name: backup.company.name,
        businessRegistrationNumber: emptyToNull(backup.company.businessRegistrationNumber),
        industry: emptyToNull(backup.company.industry),
        vatType: backup.company.vatType,
        fiscalYearEndMonth: backup.company.fiscalYearEndMonth,
        representativeSalaryEnabled: backup.company.representativeSalaryEnabled,
        employeePayrollEnabled: backup.company.employeePayrollEnabled,
        contractorPaymentEnabled: backup.company.contractorPaymentEnabled,
        billingModel: backup.company.billingModel,
        perUseUnitPrice: backup.company.perUseUnitPrice,
        monthlySubscriptionPrice: backup.company.monthlySubscriptionPrice,
        annualSubscriptionPrice: backup.company.annualSubscriptionPrice
      }
    });

    const accountByCode = await restoreAccounts(tx, company.id, backup.accounts);
    const importBatchIds = await restoreImportBatches(tx, company.id, backup.importBatches, backup.originalImportFiles);
    const transactionIdMap = await restoreTransactions(tx, company.id, backup.transactions, accountByCode, importBatchIds);
    await restoreCsvTemplates(tx, company.id, backup.csvTemplates);
    await restoreEvidences(tx, company.id, backup.evidences, transactionIdMap);
    await restoreJournalEntries(tx, company.id, backup.journalEntries, transactionIdMap, accountByCode);
    await restoreTaxReports(tx, company.id, backup.taxReports);
    await restoreClosingPeriods(tx, company.id, backup.closingPeriods);
    await restoreVendors(tx, company.id, backup.vendors, accountByCode);
    await restoreClassificationRules(tx, company.id, backup.classificationRules, accountByCode);
    await restoreReviewItems(tx, company.id, backup.reviewItems, transactionIdMap);
    await restoreAuditEvents(tx, company.id, backup.auditEvents);
    await recordAuditEvent(tx, {
      companyId: company.id,
      action: "BACKUP_RESTORE",
      entityType: "WORKSPACE_BACKUP",
      entityId: null,
      summary: "워크스페이스 백업을 복원했습니다.",
      metadata: buildRestoreCounts(backup)
    });

    return {
      company: restoredCompany,
      restoredCounts: { ...buildRestoreCounts(backup), accounts: accountByCode.size }
    };
  });
}

async function clearCompanyData(tx: Prisma.TransactionClient, companyId: string) {
  const journalEntryIds = await tx.journalEntry.findMany({
    where: { companyId },
    select: { id: true }
  });
  const ids = journalEntryIds.map((entry) => entry.id);

  await tx.reviewItem.deleteMany({ where: { companyId } });
  if (ids.length > 0) {
    await tx.journalLine.deleteMany({ where: { journalEntryId: { in: ids } } });
  }
  await tx.journalEntry.deleteMany({ where: { companyId } });
  await tx.evidence.deleteMany({ where: { companyId } });
  await tx.transaction.deleteMany({ where: { companyId } });
  await tx.importBatch.deleteMany({ where: { companyId } });
  await tx.taxReport.deleteMany({ where: { companyId } });
  await tx.closingPeriod.deleteMany({ where: { companyId } });
  await tx.vendor.deleteMany({ where: { companyId } });
  await tx.classificationRule.deleteMany({ where: { companyId } });
  await tx.csvTemplate.deleteMany({ where: { companyId } });
  await tx.auditEvent.deleteMany({ where: { companyId } });
}

async function restoreAccounts(tx: Prisma.TransactionClient, companyId: string, backupAccounts: WorkspaceBackup["accounts"]) {
  const accountByCode = new Map<string, { id: string; code: string; name: string; type: string; taxCategory: string | null }>();
  const mergedAccounts = uniqueByCode([...DEFAULT_ACCOUNTS, ...backupAccounts]);

  for (const account of mergedAccounts) {
    const restored = await tx.account.upsert({
      where: {
        companyId_code: {
          companyId,
          code: account.code
        }
      },
      update: {
        name: account.name,
        type: account.type,
        taxCategory: account.taxCategory ?? null,
        isActive: true
      },
      create: {
        companyId,
        code: account.code,
        name: account.name,
        type: account.type,
        taxCategory: account.taxCategory ?? null,
        isDefault: DEFAULT_ACCOUNTS.some((item) => item.code === account.code),
        isActive: true
      }
    });
    accountByCode.set(restored.code, {
      id: restored.id,
      code: restored.code,
      name: restored.name,
      type: restored.type,
      taxCategory: restored.taxCategory
    });
  }

  return accountByCode;
}

async function restoreCsvTemplates(tx: Prisma.TransactionClient, companyId: string, templates: WorkspaceBackup["csvTemplates"]) {
  for (const template of uniqueById(templates)) {
    await tx.csvTemplate.create({
      data: {
        id: template.id ?? undefined,
        companyId,
        name: template.name,
        sourceType: template.sourceType,
        headerSignature: template.headerSignature ?? null,
        mapping: template.mapping as Prisma.InputJsonValue
      }
    });
  }
}

async function restoreImportBatches(
  tx: Prisma.TransactionClient,
  companyId: string,
  importBatches: WorkspaceBackup["importBatches"],
  originalImportFiles: WorkspaceBackup["originalImportFiles"]
) {
  const importBatchIds = new Set<string>();
  const originalFileByBatchId = new Map(uniqueByImportBatchId(originalImportFiles).map((file) => [file.importBatchId, file]));

  for (const batch of uniqueById(importBatches)) {
    const originalFile = originalFileByBatchId.get(batch.id);
    await tx.importBatch.create({
      data: {
        id: batch.id,
        companyId,
        sourceType: batch.sourceType,
        originalFileName: originalFile?.originalFileName ?? batch.originalFileName,
        originalFileHash: originalFile?.originalFileHash ?? batch.originalFileHash ?? null,
        originalFileMimeType: originalFile?.originalFileMimeType ?? batch.originalFileMimeType ?? null,
        originalFileSize: originalFile?.originalFileSize ?? batch.originalFileSize ?? originalFile?.originalFileText.length ?? null,
        originalFileText: originalFile?.originalFileText ?? null,
        rowCount: batch.rowCount,
        mapping: Prisma.JsonNull,
        importedAt: dateTimeOrNow(batch.importedAt)
      }
    });
    importBatchIds.add(batch.id);
  }

  return importBatchIds;
}

async function restoreTransactions(
  tx: Prisma.TransactionClient,
  companyId: string,
  transactions: WorkspaceBackup["transactions"],
  accountByCode: Map<string, { id: string }>,
  importBatchIds: Set<string>
) {
  const transactionIdMap = new Map<string, string>();

  for (const transaction of uniqueById(transactions)) {
    const suggestedAccountId = accountByCode.get(transaction.suggestedAccount?.code ?? "")?.id ?? null;
    const confirmedAccountId = accountByCode.get(transaction.confirmedAccount?.code ?? "")?.id ?? null;
    const restored = await tx.transaction.create({
      data: {
        id: transaction.id,
        companyId,
        importBatchId: transaction.importBatchId && importBatchIds.has(transaction.importBatchId) ? transaction.importBatchId : null,
        sourceType: transaction.sourceType,
        sourceRowNumber: transaction.sourceRowNumber ?? null,
        transactionDate: requiredDate(transaction.transactionDate),
        description: transaction.description,
        counterparty: emptyToNull(transaction.counterparty),
        direction: transaction.direction,
        depositAmount: transaction.depositAmount,
        withdrawalAmount: transaction.withdrawalAmount,
        supplyAmount: transaction.supplyAmount ?? null,
        vatAmount: transaction.vatAmount ?? null,
        balance: transaction.balance ?? null,
        approvalNumber: emptyToNull(transaction.approvalNumber),
        rawPayload: {
          restoredFromBackup: true,
          reviewReasons: transaction.reviewReasons
        },
        suggestedAccountId,
        confirmedAccountId,
        evidenceStatus: transaction.evidenceStatus,
        memo: emptyToNull(transaction.memo)
      }
    });
    transactionIdMap.set(transaction.id, restored.id);
  }

  return transactionIdMap;
}

async function restoreEvidences(
  tx: Prisma.TransactionClient,
  companyId: string,
  evidences: WorkspaceBackup["evidences"],
  transactionIdMap: Map<string, string>
) {
  for (const evidence of uniqueById(evidences)) {
    const issueDate = parseStrictEvidenceDate(evidence.issueDate);
    const fileUrl = normalizeEvidenceFileUrl(evidence.fileUrl);
    await tx.evidence.create({
      data: {
        id: evidence.id,
        companyId,
        transactionId: evidence.transactionId ? transactionIdMap.get(evidence.transactionId) ?? null : null,
        evidenceType: evidence.evidenceType,
        issueDate: issueDate ? new Date(issueDate) : null,
        counterparty: emptyToNull(evidence.counterparty),
        businessRegistrationNumber: emptyToNull(evidence.businessRegistrationNumber),
        supplyAmount: evidence.supplyAmount ?? null,
        vatAmount: evidence.vatAmount ?? null,
        totalAmount: evidence.totalAmount ?? null,
        fileName: emptyToNull(evidence.fileName),
        fileUrl,
        rawPayload: {
          restoredFromBackup: true,
          fileDataUrl: evidence.fileDataUrl ?? null,
          fileMimeType: evidence.fileMimeType ?? null,
          fileSize: evidence.fileSize ?? null
        }
      }
    });
  }
}

async function restoreJournalEntries(
  tx: Prisma.TransactionClient,
  companyId: string,
  journalEntries: WorkspaceBackup["journalEntries"],
  transactionIdMap: Map<string, string>,
  accountByCode: Map<string, { id: string }>
) {
  for (const entry of uniqueById(journalEntries)) {
    const lines = entry.lines.flatMap((line) => {
      const accountId = accountByCode.get(line.accountCode)?.id;
      if (!accountId) return [];
      return [
        {
          accountId,
          debitAmount: line.debitAmount,
          creditAmount: line.creditAmount,
          vatType: line.vatType ?? null,
          memo: line.memo ?? null
        }
      ];
    });
    if (lines.length === 0) continue;

    await tx.journalEntry.create({
      data: {
        id: entry.id,
        companyId,
        transactionId: entry.transactionId ? transactionIdMap.get(entry.transactionId) ?? null : null,
        entryDate: requiredDate(entry.entryDate),
        memo: entry.memo,
        status: entry.status,
        lines: {
          create: lines
        }
      }
    });
  }
}

async function restoreTaxReports(tx: Prisma.TransactionClient, companyId: string, taxReports: WorkspaceBackup["taxReports"]) {
  for (const report of uniqueById(taxReports)) {
    await tx.taxReport.create({
      data: {
        id: report.id,
        companyId,
        reportType: report.reportType,
        periodStart: requiredDate(report.periodStart),
        periodEnd: requiredDate(report.periodEnd),
        calculatedPayload: report.calculatedPayload as Prisma.InputJsonValue,
        createdAt: dateTimeOrNow(report.createdAt ?? report.periodEnd)
      }
    });
  }
}

async function restoreClosingPeriods(tx: Prisma.TransactionClient, companyId: string, closingPeriods: WorkspaceBackup["closingPeriods"]) {
  for (const closingPeriod of uniqueByPeriod(closingPeriods)) {
    const range = periodRangeFromMonth(closingPeriod.period);
    if (!range) continue;
    await tx.closingPeriod.create({
      data: {
        id: closingPeriod.id ?? undefined,
        companyId,
        period: closingPeriod.period,
        periodStart: requiredDate(closingPeriod.periodStart ?? range.start.toISOString()),
        periodEnd: requiredDate(closingPeriod.periodEnd ?? range.end.toISOString()),
        summaryPayload: closingPeriod.summaryPayload === undefined ? undefined : toJsonInput(closingPeriod.summaryPayload),
        closedAt: dateTimeOrNow(closingPeriod.closedAt ?? closingPeriod.periodEnd ?? range.end.toISOString()),
        createdAt: dateTimeOrNow(closingPeriod.createdAt ?? closingPeriod.closedAt ?? range.end.toISOString())
      }
    });
  }
}

async function restoreVendors(
  tx: Prisma.TransactionClient,
  companyId: string,
  vendors: WorkspaceBackup["vendors"],
  accountByCode: Map<string, { id: string }>
) {
  for (const vendor of uniqueById(vendors)) {
    await tx.vendor.create({
      data: {
        id: vendor.id,
        companyId,
        name: vendor.name,
        businessRegistrationNumber: emptyToNull(vendor.businessRegistrationNumber),
        defaultAccountId: accountByCode.get(vendor.defaultAccount?.code ?? "")?.id ?? null,
        withholdingType: vendor.withholdingType ?? "NONE",
        memo: emptyToNull(vendor.memo)
      }
    });
  }
}

async function restoreClassificationRules(
  tx: Prisma.TransactionClient,
  companyId: string,
  classificationRules: WorkspaceBackup["classificationRules"],
  accountByCode: Map<string, { id: string }>
) {
  for (const rule of uniqueById(classificationRules)) {
    if (!accountByCode.has(rule.accountCode)) continue;
    await tx.classificationRule.create({
      data: {
        id: rule.id,
        companyId,
        name: rule.name,
        sourceType: rule.sourceType ?? null,
        condition: { keyword: rule.keyword },
        action: { accountCode: rule.accountCode },
        priority: rule.priority,
        isActive: rule.isActive
      }
    });
  }
}

async function restoreReviewItems(
  tx: Prisma.TransactionClient,
  companyId: string,
  reviewItems: WorkspaceBackup["reviewItems"],
  transactionIdMap: Map<string, string>
) {
  for (const item of uniqueById(reviewItems)) {
    const oldTransactionId = item.transaction?.id;
    const transactionId = oldTransactionId ? transactionIdMap.get(oldTransactionId) ?? null : null;
    if (!transactionId) continue;

    await tx.reviewItem.create({
      data: {
        id: item.id,
        companyId,
        transactionId,
        targetType: "TRANSACTION",
        targetId: transactionId,
        severity: item.severity,
        reason: item.reason,
        recommendation: item.recommendation ?? null,
        status: item.status
      }
    });
  }
}

async function restoreAuditEvents(tx: Prisma.TransactionClient, companyId: string, auditEvents: WorkspaceBackup["auditEvents"]) {
  for (const event of uniqueById(auditEvents)) {
    await tx.auditEvent.create({
      data: {
        id: event.id,
        companyId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId ?? null,
        summary: event.summary,
        metadata: event.metadata === null || event.metadata === undefined ? undefined : (event.metadata as Prisma.InputJsonValue),
        createdAt: dateTimeOrNow(event.createdAt)
      }
    });
  }
}

function uniqueByCode<T extends { code: string }>(items: T[]) {
  const byCode = new Map<string, T>();
  for (const item of items) {
    byCode.set(item.code, item);
  }
  return [...byCode.values()];
}

function buildRestoreCounts(backup: WorkspaceBackup) {
  const transactionIds = new Set(uniqueById(backup.transactions).map((transaction) => transaction.id));

  return {
    accounts: uniqueByCode([...DEFAULT_ACCOUNTS, ...backup.accounts]).length,
    csvTemplates: uniqueById(backup.csvTemplates).length,
    importBatches: uniqueById(backup.importBatches).length,
    originalImportFiles: uniqueByImportBatchId(backup.originalImportFiles).length,
    transactions: uniqueById(backup.transactions).length,
    evidences: uniqueById(backup.evidences).length,
    journalEntries: uniqueById(backup.journalEntries).length,
    taxReports: uniqueById(backup.taxReports).length,
    closingPeriods: uniqueByPeriod(backup.closingPeriods).length,
    vendors: uniqueById(backup.vendors).length,
    classificationRules: uniqueById(backup.classificationRules).length,
    auditEvents: uniqueById(backup.auditEvents).length,
    reviewItems: uniqueById(backup.reviewItems).filter((item) => item.transaction?.id && transactionIds.has(item.transaction.id)).length
  };
}

function validateBackupEvidences(backup: WorkspaceBackup) {
  const issues: string[] = [];
  const transactionIds = new Set(uniqueById(backup.transactions).map((transaction) => transaction.id));

  for (const [index, evidence] of uniqueById(backup.evidences).entries()) {
    const label = evidence.id ? `증빙 ${evidence.id}` : `${index + 1}번째 증빙`;
    if (evidence.transactionId && !transactionIds.has(evidence.transactionId)) {
      issues.push(`${label}: 연결 거래 ${evidence.transactionId}를 백업 거래 목록에서 찾을 수 없습니다.`);
    }

    if (evidence.issueDate && !parseStrictEvidenceDate(evidence.issueDate)) {
      issues.push(`${label}: 증빙 발행일은 유효한 날짜여야 합니다.`);
    }

    const fileIssue = validateEvidenceFile(evidence);
    if (fileIssue) issues.push(`${label}: ${fileIssue}`);

    const fileUrlIssue = validateEvidenceFileUrl(evidence.fileUrl);
    if (fileUrlIssue) issues.push(`${label}: ${fileUrlIssue}`);

    const amountIssue = validateEvidenceAmounts(evidence);
    if (amountIssue) issues.push(`${label}: ${amountIssue}`);
  }

  return issues;
}

function validateBackupTransactions(backup: WorkspaceBackup) {
  const issues: string[] = [];
  const importBatchById = new Map(uniqueById(backup.importBatches).map((batch) => [batch.id, batch]));

  for (const transaction of uniqueById(backup.transactions)) {
    const label = `거래 ${transaction.id}`;
    const amountIssue = validateTransactionAmounts(transaction);
    if (amountIssue) issues.push(`${label}: ${amountIssue}`);

    if (!transaction.importBatchId) continue;

    const importBatch = importBatchById.get(transaction.importBatchId);
    if (!importBatch) {
      issues.push(`${label}: 연결 가져오기 ${transaction.importBatchId}를 백업 가져오기 목록에서 찾을 수 없습니다.`);
    } else if (importBatch.sourceType !== transaction.sourceType) {
      issues.push(`${label}: 거래 출처와 연결 가져오기 출처가 일치하지 않습니다.`);
    }
  }

  return issues;
}

function validateBackupDates(backup: WorkspaceBackup) {
  const issues: string[] = [];

  for (const batch of uniqueById(backup.importBatches)) {
    optionalTimestamp(batch.importedAt, `가져오기 ${batch.id} importedAt`, issues);
  }
  for (const transaction of uniqueById(backup.transactions)) {
    requiredDateField(transaction.transactionDate, `거래 ${transaction.id} transactionDate`, issues);
  }
  for (const entry of uniqueById(backup.journalEntries)) {
    requiredDateField(entry.entryDate, `분개 ${entry.id} entryDate`, issues);
  }
  for (const report of uniqueById(backup.taxReports)) {
    requiredDateField(report.periodStart, `리포트 ${report.id} periodStart`, issues);
    requiredDateField(report.periodEnd, `리포트 ${report.id} periodEnd`, issues);
    optionalTimestamp(report.createdAt, `리포트 ${report.id} createdAt`, issues);
  }
  for (const closingPeriod of uniqueByPeriod(backup.closingPeriods)) {
    if (!periodRangeFromMonth(closingPeriod.period)) {
      issues.push(`마감 ${closingPeriod.period}: period는 유효한 YYYY-MM 월이어야 합니다.`);
    }
    optionalDate(closingPeriod.periodStart, `마감 ${closingPeriod.period} periodStart`, issues);
    optionalDate(closingPeriod.periodEnd, `마감 ${closingPeriod.period} periodEnd`, issues);
    optionalTimestamp(closingPeriod.closedAt, `마감 ${closingPeriod.period} closedAt`, issues);
    optionalTimestamp(closingPeriod.createdAt, `마감 ${closingPeriod.period} createdAt`, issues);
  }
  for (const event of uniqueById(backup.auditEvents)) {
    optionalTimestamp(event.createdAt, `활동 로그 ${event.id} createdAt`, issues);
  }

  return issues;
}

function validateBackupJournalEntries(backup: WorkspaceBackup) {
  const issues: string[] = [];
  const accountCodes = new Set(uniqueByCode([...DEFAULT_ACCOUNTS, ...backup.accounts]).map((account) => account.code));
  const transactionIds = new Set(uniqueById(backup.transactions).map((transaction) => transaction.id));

  for (const entry of uniqueById(backup.journalEntries)) {
    const label = `분개 ${entry.id}`;
    if (entry.transactionId && !transactionIds.has(entry.transactionId)) {
      issues.push(`${label}: 연결 거래 ${entry.transactionId}를 백업 거래 목록에서 찾을 수 없습니다.`);
    }

    const debit = entry.lines.reduce((sum, line) => sum + line.debitAmount, 0);
    const credit = entry.lines.reduce((sum, line) => sum + line.creditAmount, 0);
    if (Math.round(debit) !== Math.round(credit)) {
      issues.push(`${label}: 차변과 대변이 일치하지 않습니다.`);
    }

    for (const [index, line] of entry.lines.entries()) {
      const lineLabel = `${label} ${index + 1}번째 라인`;
      if (!accountCodes.has(line.accountCode)) {
        issues.push(`${lineLabel}: ${line.accountCode} 계정과목을 백업 계정 목록에서 찾을 수 없습니다.`);
      }

      const debitPositive = line.debitAmount > 0;
      const creditPositive = line.creditAmount > 0;
      if (debitPositive === creditPositive) {
        issues.push(`${lineLabel}: 차변 또는 대변 중 한쪽만 0보다 커야 합니다.`);
      }
    }
  }

  return issues;
}

function validateBackupOriginalImportFiles(originalImportFiles: WorkspaceBackup["originalImportFiles"]) {
  return uniqueByImportBatchId(originalImportFiles).flatMap((file) => {
    const issue = validateOriginalFileText(file);
    return issue ? [`원본 CSV ${file.importBatchId}: ${issue}`] : [];
  });
}

function requiredDateField(value: string | null | undefined, label: string, issues: string[]) {
  if (!parseStrictDate(value)) issues.push(`${label}는 유효한 날짜여야 합니다.`);
}

function optionalDate(value: string | null | undefined, label: string, issues: string[]) {
  if (value && !parseStrictDate(value)) issues.push(`${label}는 유효한 날짜여야 합니다.`);
}

function optionalTimestamp(value: string | null | undefined, label: string, issues: string[]) {
  if (value && !parseStrictDateTime(value)) issues.push(`${label}는 유효한 일시여야 합니다.`);
}

function uniqueByPeriod<T extends { period: string }>(items: T[]) {
  const byPeriod = new Map<string, T>();
  for (const item of items) {
    byPeriod.set(item.period, item);
  }
  return [...byPeriod.values()];
}

function uniqueById<T extends { id?: string | null }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.id) return true;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function uniqueByImportBatchId<T extends { importBatchId: string }>(items: T[]) {
  const byBatchId = new Map<string, T>();
  for (const item of items) {
    byBatchId.set(item.importBatchId, item);
  }
  return [...byBatchId.values()];
}

function requiredDate(value: string) {
  return dateFromStrictDate(value) ?? new Date(value);
}

function dateTimeOrNow(value?: string | null) {
  return parseStrictDateTime(value) ?? new Date();
}

function emptyToNull(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function toJsonInput(value: unknown) {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
