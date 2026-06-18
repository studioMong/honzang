import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  buildBackupExportMessage,
  buildBackupReadinessRows,
  buildDataRetentionRows,
  buildWorkspaceBackupPayload,
  buildWorkspaceBackupZipFiles,
  type OriginalImportFile
} from "../src/lib/workspace-backup-export";
import { DEFAULT_ACCOUNTS } from "../src/lib/defaults";
import { sampleCompany, sampleClosingPeriods, sampleTransactions } from "../src/lib/sample-data";
import { createZipBytes } from "../src/lib/zip";
import type { AppAuditEvent, AppClassificationRule, AppEvidence, AppImportBatch, AppJournalEntry, AppTaxReport, AppVendor, CsvTemplate, ReviewItem } from "../src/types";

const GENERATED_AT = "2026-06-18T00:00:00.000Z";
const originalCsvText = "거래일,적요,입금\n2026-06-03,고객사 프로젝트 대금 입금,1100000\n";
const evidenceText = "backup-evidence-file";
const evidenceDataUrl = `data:text/plain;base64,${Buffer.from(evidenceText).toString("base64")}`;

const importBatches: AppImportBatch[] = [
  {
    id: "backup-import-1",
    sourceType: "BANK",
    originalFileName: "../bank-main.csv",
    originalFileHash: "backup-import-hash",
    originalFileMimeType: "text/csv",
    originalFileSize: Buffer.byteLength(originalCsvText),
    hasOriginalFile: true,
    rowCount: 1,
    importedAt: GENERATED_AT
  }
];

const originalImportFiles: OriginalImportFile[] = [
  {
    importBatchId: "backup-import-1",
    originalFileName: "../bank-main.csv",
    originalFileHash: "backup-import-hash",
    originalFileMimeType: "text/csv",
    originalFileSize: Buffer.byteLength(originalCsvText),
    originalFileText: originalCsvText
  }
];

const evidences: AppEvidence[] = [
  {
    id: "backup-evidence-1",
    evidenceType: "카드전표",
    issueDate: "2026-06-05",
    counterparty: "백업 거래처",
    supplyAmount: 1000,
    vatAmount: 100,
    totalAmount: 1100,
    fileName: "../receipt.txt",
    fileDataUrl: evidenceDataUrl,
    fileMimeType: "text/plain",
    fileSize: Buffer.byteLength(evidenceText),
    transactionId: "tx-sample-1"
  }
];

const csvTemplates: CsvTemplate[] = [
  {
    id: "backup-template-1",
    name: "은행 백업 템플릿",
    sourceType: "BANK",
    headerSignature: "거래일|적요|입금|출금|잔액",
    mapping: {
      transactionDate: "거래일",
      description: "적요",
      depositAmount: "입금",
      withdrawalAmount: "출금",
      balance: "잔액"
    }
  }
];

const journalEntries: AppJournalEntry[] = [
  {
    id: "backup-journal-1",
    transactionId: "tx-sample-1",
    entryDate: "2026-06-03",
    memo: "백업 검증 승인 분개",
    status: "APPROVED",
    lines: [
      { accountCode: "101", accountName: "보통예금", accountType: "ASSET", debitAmount: 1100000, creditAmount: 0 },
      { accountCode: "401", accountName: "서비스매출", accountType: "REVENUE", debitAmount: 0, creditAmount: 1100000 }
    ]
  }
];

const taxReports: AppTaxReport[] = [
  {
    id: "backup-report-1",
    reportType: "CORPORATE_TAX_PREP",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    calculatedPayload: { report: "backup" },
    createdAt: GENERATED_AT,
    updatedAt: GENERATED_AT
  }
];

const vendors: AppVendor[] = [
  {
    id: "backup-vendor-1",
    name: "백업 거래처",
    withholdingType: "NONE"
  }
];

const classificationRules: AppClassificationRule[] = [
  {
    id: "backup-rule-1",
    name: "백업 규칙",
    keyword: "프로젝트",
    accountCode: "401",
    accountName: "서비스매출",
    priority: 100,
    isActive: true
  }
];

const auditEvents: AppAuditEvent[] = [
  {
    id: "backup-audit-1",
    action: "BACKUP_VERIFY",
    entityType: "WORKSPACE",
    entityId: "backup",
    summary: "백업 export 검증",
    metadata: { generatedAt: GENERATED_AT },
    createdAt: GENERATED_AT
  }
];

const reviewItems: ReviewItem[] = [
  {
    id: "backup-review-1",
    severity: "WARNING",
    reason: "백업 검토 항목",
    status: "OPEN",
    transaction: sampleTransactions[0]
  }
];

const input = {
  mode: "database" as const,
  company: {
    ...sampleCompany,
    businessRegistrationNumber: "123-45-67890"
  },
  accounts: DEFAULT_ACCOUNTS,
  csvTemplates,
  importBatches,
  originalImportFiles,
  transactions: sampleTransactions.slice(0, 2),
  evidences,
  journalEntries,
  taxReports,
  vendors,
  classificationRules,
  auditEvents,
  closingPeriods: sampleClosingPeriods,
  reviewItems
};

const payload = buildWorkspaceBackupPayload(input, GENERATED_AT);
assert.equal(payload.app, "혼자장부", "workspace backup should identify the app");
assert.equal(payload.backupVersion, 1, "workspace backup should preserve backup version");
assert.equal(payload.generatedAt, GENERATED_AT, "workspace backup should support deterministic generatedAt values");
assert.equal(payload.mode, "database", "workspace backup should preserve mode");
assert.equal(payload.counts.originalImportFiles, 1, "workspace backup should count original CSV files");
assert.equal(payload.counts.evidences, 1, "workspace backup should count evidences");
assert.equal(payload.counts.closingPeriods, 1, "workspace backup should count closing periods");
assert.ok(payload.notes.some((note) => note.includes("민감한 거래처")), "workspace backup should warn about sensitive content");

const retentionRows = buildDataRetentionRows(input);
assert.ok(retentionRows.some((row) => row.데이터 === "원본 CSV" && row.상태 === "보관 중"), "data retention rows should include original CSV state");
assert.ok(retentionRows.some((row) => row.데이터 === "거래내역" && row.삭제방법.includes("수기 거래")), "data retention rows should document manual transaction deletion");
assert.ok(retentionRows.some((row) => row.데이터 === "백업 파일" && row.상태 === "민감정보 포함"), "data retention rows should flag sensitive backup files");

const readinessRows = buildBackupReadinessRows(input);
assert.ok(readinessRows.some((row) => row.데이터 === "회사/계정" && row.톤 === "green"), "backup readiness should pass company/account data");
assert.ok(readinessRows.some((row) => row.데이터 === "원본 CSV" && row.상태 === "포함" && row.건수 === "1/1개"), "backup readiness should confirm original CSV inclusion");
assert.ok(readinessRows.some((row) => row.데이터 === "증빙 파일" && row.상태 === "포함"), "backup readiness should confirm DB evidence inclusion");

const okMessage = buildBackupExportMessage("ZIP", importBatches, originalImportFiles, evidences);
assert.equal(okMessage.tone, "green", "backup export message should be green when every source file is included");
assert.ok(okMessage.text.includes("원본 CSV 1/1개 포함"), "backup export message should summarize original CSV inclusion");
assert.ok(okMessage.text.includes("DB 증빙 1개 포함"), "backup export message should summarize DB evidence inclusion");

const warningMessage = buildBackupExportMessage("JSON", importBatches, [], [{ ...evidences[0], fileDataUrl: undefined, fileUrl: "https://example.com/receipt.txt" }]);
assert.equal(warningMessage.tone, "amber", "backup export message should warn when source or evidence files are missing from the download");
assert.ok(warningMessage.text.includes("원본 CSV 누락 1개"), "backup export warning should mention missing original CSV files");
assert.ok(warningMessage.text.includes("외부 증빙 1개"), "backup export warning should mention external evidence files");

const zipFiles = buildWorkspaceBackupZipFiles(payload, evidences);
assert.deepEqual(
  zipFiles.map((file) => file.path),
  ["manifest.json", "workspace-backup.json", "csv/data-retention-policy.csv", "csv/backup-readiness.csv", "imports/original-csv/bank-main.csv", "evidences/receipt.txt"],
  "workspace backup ZIP should expose stable core files, original CSV, and evidence entries"
);

const manifestFile = zipFiles.find((file) => file.path === "manifest.json");
assert.ok(manifestFile && typeof manifestFile.content === "string", "workspace backup ZIP should include a JSON manifest");
const manifest = JSON.parse(manifestFile.content);
assert.deepEqual(manifest.files, ["workspace-backup.json", "csv/data-retention-policy.csv", "csv/backup-readiness.csv"], "workspace backup manifest should list structured core files");
assert.deepEqual(manifest.originalCsvFiles, ["imports/original-csv/bank-main.csv"], "workspace backup manifest should list original CSV files");
assert.deepEqual(manifest.evidenceFiles, ["evidences/receipt.txt"], "workspace backup manifest should list DB evidence files");
assert.equal(manifest.originalCsvFileSummary.included, 1, "workspace backup manifest should count included original CSV files");
assert.equal(manifest.evidenceFileSummary.dbIncluded, 1, "workspace backup manifest should count DB evidence files");

const backupJson = zipFiles.find((file) => file.path === "workspace-backup.json");
assert.ok(backupJson && typeof backupJson.content === "string", "workspace backup ZIP should include the full JSON backup");
assert.ok(backupJson.content.includes("\"originalImportFiles\""), "workspace backup JSON should include original CSV metadata");
assert.ok(backupJson.content.includes("\"closingPeriods\""), "workspace backup JSON should include closing periods");

const retentionCsv = zipFiles.find((file) => file.path === "csv/data-retention-policy.csv");
assert.ok(retentionCsv && typeof retentionCsv.content === "string", "workspace backup ZIP should include data retention CSV");
assert.ok(retentionCsv.content.startsWith("\uFEFF"), "workspace backup CSV should include a UTF-8 BOM");
assert.ok(retentionCsv.content.includes("원본 CSV"), "workspace backup retention CSV should include original CSV rows");

const readinessCsv = zipFiles.find((file) => file.path === "csv/backup-readiness.csv");
assert.ok(readinessCsv && typeof readinessCsv.content === "string", "workspace backup ZIP should include backup readiness CSV");
assert.ok(readinessCsv.content.includes("회사/계정"), "workspace backup readiness CSV should include company/account rows");

const originalCsvEntry = zipFiles.find((file) => file.path === "imports/original-csv/bank-main.csv");
assert.ok(originalCsvEntry && originalCsvEntry.content === originalCsvText, "workspace backup ZIP should include sanitized original CSV file content");

const evidenceEntry = zipFiles.find((file) => file.path === "evidences/receipt.txt");
assert.ok(evidenceEntry && evidenceEntry.content instanceof Uint8Array, "workspace backup ZIP should include decoded DB evidence bytes");
assert.equal(new TextDecoder().decode(evidenceEntry.content), evidenceText, "workspace backup ZIP should decode evidence data URLs");

const zipText = new TextDecoder().decode(createZipBytes(zipFiles));
for (const expected of ["manifest.json", "workspace-backup.json", "csv/data-retention-policy.csv", "csv/backup-readiness.csv", "imports/original-csv/bank-main.csv", "evidences/receipt.txt"]) {
  assert.ok(zipText.includes(expected), `workspace backup ZIP bytes should include ${expected}`);
}
assert.ok(zipText.includes("혼자장부 전체 백업 파일입니다."), "workspace backup ZIP bytes should include backup notes");
assert.ok(zipText.includes("고객사 프로젝트 대금 입금"), "workspace backup ZIP bytes should include transaction descriptions");
assert.ok(zipText.includes("backup-evidence-file"), "workspace backup ZIP bytes should include evidence file bytes");

console.log("Workspace backup export verification passed.");
