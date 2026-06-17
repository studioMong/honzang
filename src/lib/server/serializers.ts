import type {
  Account,
  AuditEvent,
  ClassificationRule,
  ClosingPeriod,
  CsvTemplate as PrismaCsvTemplate,
  Evidence,
  ImportBatch,
  JournalEntry,
  JournalLine,
  ReviewItem,
  TaxReport,
  Transaction,
  Vendor
} from "@prisma/client";
import type {
  AppAccount,
  AppAuditEvent,
  AppClassificationRule,
  AppClosingPeriod,
  AppEvidence,
  AppImportBatch,
  AppJournalEntry,
  AppVendor,
  CsvTemplate as AppCsvTemplate,
  ReviewItem as AppReviewItem,
  AppTaxReport,
  AppTransaction
} from "@/types";

type TransactionWithAccounts = Transaction & {
  suggestedAccount?: Account | null;
  confirmedAccount?: Account | null;
};

export function serializeAccount(account: Account | null | undefined): AppAccount | null {
  if (!account) return null;
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    taxCategory: account.taxCategory
  };
}

export function serializeClassificationRule(
  rule: ClassificationRule,
  accountByCode = new Map<string, Account>()
): AppClassificationRule {
  const condition = isRecord(rule.condition) ? rule.condition : {};
  const action = isRecord(rule.action) ? rule.action : {};
  const keyword = typeof condition.keyword === "string" ? condition.keyword : "";
  const accountCode = typeof action.accountCode === "string" ? action.accountCode : "";
  const account = accountByCode.get(accountCode);

  return {
    id: rule.id,
    name: rule.name,
    keyword,
    accountCode,
    accountName: account?.name ?? null,
    sourceType: rule.sourceType,
    priority: rule.priority,
    isActive: rule.isActive
  };
}

export function serializeImportBatch(importBatch: ImportBatch): AppImportBatch {
  return {
    id: importBatch.id,
    sourceType: importBatch.sourceType,
    originalFileName: importBatch.originalFileName,
    originalFileHash: importBatch.originalFileHash,
    originalFileMimeType: importBatch.originalFileMimeType,
    originalFileSize: importBatch.originalFileSize,
    hasOriginalFile: Boolean(importBatch.originalFileText),
    rowCount: importBatch.rowCount,
    importedAt: importBatch.importedAt.toISOString()
  };
}

export function serializeCsvTemplate(template: PrismaCsvTemplate): AppCsvTemplate {
  return {
    id: template.id,
    name: template.name,
    sourceType: template.sourceType,
    headerSignature: template.headerSignature,
    mapping: isRecord(template.mapping) ? (template.mapping as AppCsvTemplate["mapping"]) : {},
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString()
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function serializeTransaction(transaction: TransactionWithAccounts): AppTransaction {
  return {
    id: transaction.id,
    importBatchId: transaction.importBatchId,
    sourceRowNumber: transaction.sourceRowNumber,
    sourceType: transaction.sourceType,
    transactionDate: transaction.transactionDate.toISOString().slice(0, 10),
    description: transaction.description,
    counterparty: transaction.counterparty,
    direction: transaction.direction,
    depositAmount: Number(transaction.depositAmount),
    withdrawalAmount: Number(transaction.withdrawalAmount),
    supplyAmount: transaction.supplyAmount === null ? null : Number(transaction.supplyAmount),
    vatAmount: transaction.vatAmount === null ? null : Number(transaction.vatAmount),
    balance: transaction.balance === null ? null : Number(transaction.balance),
    approvalNumber: transaction.approvalNumber,
    suggestedAccount: serializeAccount(transaction.suggestedAccount),
    confirmedAccount: serializeAccount(transaction.confirmedAccount),
    evidenceStatus: transaction.evidenceStatus,
    memo: transaction.memo,
    reviewReasons: readReviewReasons(transaction.rawPayload)
  };
}

function readReviewReasons(rawPayload: unknown) {
  if (!isRecord(rawPayload)) return undefined;
  if (Array.isArray(rawPayload.reviewReasons)) {
    return rawPayload.reviewReasons.filter((item): item is string => typeof item === "string");
  }
  return typeof rawPayload.reviewReason === "string" ? [rawPayload.reviewReason] : undefined;
}

function readEvidenceFile(rawPayload: unknown) {
  if (!isRecord(rawPayload)) return {};
  return {
    fileDataUrl: typeof rawPayload.fileDataUrl === "string" ? rawPayload.fileDataUrl : null,
    fileMimeType: typeof rawPayload.fileMimeType === "string" ? rawPayload.fileMimeType : null,
    fileSize: typeof rawPayload.fileSize === "number" ? rawPayload.fileSize : null
  };
}

export function serializeEvidence(evidence: Evidence & { transaction?: TransactionWithAccounts | null }): AppEvidence {
  const file = readEvidenceFile(evidence.rawPayload);
  return {
    id: evidence.id,
    evidenceType: evidence.evidenceType,
    issueDate: evidence.issueDate?.toISOString().slice(0, 10) ?? null,
    counterparty: evidence.counterparty,
    businessRegistrationNumber: evidence.businessRegistrationNumber,
    supplyAmount: evidence.supplyAmount === null ? null : Number(evidence.supplyAmount),
    vatAmount: evidence.vatAmount === null ? null : Number(evidence.vatAmount),
    totalAmount: evidence.totalAmount === null ? null : Number(evidence.totalAmount),
    fileName: evidence.fileName,
    fileUrl: evidence.fileUrl,
    fileDataUrl: file.fileDataUrl,
    fileMimeType: file.fileMimeType,
    fileSize: file.fileSize,
    transactionId: evidence.transactionId,
    transaction: evidence.transaction ? serializeTransaction(evidence.transaction) : null
  };
}

export function serializeReviewItem(reviewItem: ReviewItem & { transaction?: TransactionWithAccounts | null }): AppReviewItem {
  return {
    id: reviewItem.id,
    severity: reviewItem.severity,
    reason: reviewItem.reason,
    recommendation: reviewItem.recommendation,
    status: reviewItem.status,
    transaction: reviewItem.transaction ? serializeTransaction(reviewItem.transaction) : null
  };
}

export function serializeVendor(vendor: Vendor & { defaultAccount?: Account | null }): AppVendor {
  return {
    id: vendor.id,
    name: vendor.name,
    businessRegistrationNumber: vendor.businessRegistrationNumber,
    defaultAccount: serializeAccount(vendor.defaultAccount),
    withholdingType: vendor.withholdingType,
    memo: vendor.memo
  };
}

export function serializeJournalEntry(
  journalEntry: JournalEntry & {
    lines: Array<JournalLine & { account: Account }>;
    transaction?: TransactionWithAccounts | null;
  }
): AppJournalEntry {
  return {
    id: journalEntry.id,
    transactionId: journalEntry.transactionId,
    entryDate: journalEntry.entryDate.toISOString().slice(0, 10),
    memo: journalEntry.memo,
    status: journalEntry.status,
    transaction: journalEntry.transaction ? serializeTransaction(journalEntry.transaction) : null,
    lines: journalEntry.lines.map((line) => ({
      accountCode: line.account.code,
      accountName: line.account.name,
      accountType: line.account.type,
      debitAmount: Number(line.debitAmount),
      creditAmount: Number(line.creditAmount),
      vatType: line.vatType,
      memo: line.memo ?? undefined
    }))
  };
}

export function serializeTaxReport(taxReport: TaxReport): AppTaxReport {
  return {
    id: taxReport.id,
    reportType: taxReport.reportType,
    periodStart: taxReport.periodStart.toISOString().slice(0, 10),
    periodEnd: taxReport.periodEnd.toISOString().slice(0, 10),
    calculatedPayload: taxReport.calculatedPayload,
    createdAt: taxReport.createdAt.toISOString(),
    updatedAt: taxReport.updatedAt.toISOString()
  };
}

export function serializeAuditEvent(auditEvent: AuditEvent): AppAuditEvent {
  return {
    id: auditEvent.id,
    action: auditEvent.action,
    entityType: auditEvent.entityType,
    entityId: auditEvent.entityId,
    summary: auditEvent.summary,
    metadata: auditEvent.metadata,
    createdAt: auditEvent.createdAt.toISOString()
  };
}

export function serializeClosingPeriod(closingPeriod: ClosingPeriod): AppClosingPeriod {
  return {
    id: closingPeriod.id,
    period: closingPeriod.period,
    periodStart: closingPeriod.periodStart.toISOString().slice(0, 10),
    periodEnd: closingPeriod.periodEnd.toISOString().slice(0, 10),
    summaryPayload: closingPeriod.summaryPayload,
    closedAt: closingPeriod.closedAt.toISOString(),
    createdAt: closingPeriod.createdAt.toISOString(),
    updatedAt: closingPeriod.updatedAt.toISOString()
  };
}
