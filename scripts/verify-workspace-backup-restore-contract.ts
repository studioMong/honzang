import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";
import {
  buildWorkspaceBackupPayload,
  buildWorkspaceBackupZipFiles,
  type OriginalImportFile,
  type WorkspaceBackupPayload
} from "../src/lib/workspace-backup-export";
import { DEFAULT_ACCOUNTS } from "../src/lib/defaults";
import { sampleClosingPeriods, sampleCompany, sampleTransactions } from "../src/lib/sample-data";
import type {
  AppAuditEvent,
  AppClassificationRule,
  AppEvidence,
  AppImportBatch,
  AppJournalEntry,
  AppTaxReport,
  AppVendor,
  CsvTemplate,
  ReviewItem
} from "../src/types";

const port = process.env.WORKSPACE_BACKUP_RESTORE_VERIFY_PORT ?? "3108";
const baseUrl = `http://127.0.0.1:${port}`;
const startupTimeoutMs = Number(process.env.WORKSPACE_BACKUP_RESTORE_VERIFY_TIMEOUT_MS ?? 20_000);
const serverPath = ".next/standalone/server.js";
const generatedAt = "2026-06-18T00:00:00.000Z";
const originalCsvText = "거래일,적요,입금\n2026-06-03,고객사 프로젝트 대금 입금,1100000\n";
const evidenceText = "restore-contract-evidence";

if (!existsSync(serverPath)) {
  console.error(`${serverPath} not found. Run npm run build before npm run verify:workspace-backup-restore-contract.`);
  process.exit(1);
}

const importBatches: AppImportBatch[] = [
  {
    id: "restore-contract-import-1",
    sourceType: "BANK",
    originalFileName: "restore-contract-bank.csv",
    originalFileHash: "restore-contract-hash",
    originalFileMimeType: "text/csv",
    originalFileSize: Buffer.byteLength(originalCsvText),
    hasOriginalFile: true,
    rowCount: 1,
    importedAt: generatedAt
  }
];

const originalImportFiles: OriginalImportFile[] = [
  {
    importBatchId: "restore-contract-import-1",
    originalFileName: "restore-contract-bank.csv",
    originalFileHash: "restore-contract-hash",
    originalFileMimeType: "text/csv",
    originalFileSize: Buffer.byteLength(originalCsvText),
    originalFileText: originalCsvText
  }
];

const evidences: AppEvidence[] = [
  {
    id: "restore-contract-evidence-1",
    evidenceType: "카드전표",
    issueDate: "2026-06-05",
    counterparty: "복원 검증 거래처",
    supplyAmount: 1000,
    vatAmount: 100,
    totalAmount: 1100,
    fileName: "restore-contract-evidence.txt",
    fileDataUrl: `data:text/plain;base64,${Buffer.from(evidenceText).toString("base64")}`,
    fileMimeType: "text/plain",
    fileSize: Buffer.byteLength(evidenceText),
    transactionId: "tx-sample-1"
  }
];

const csvTemplates: CsvTemplate[] = [
  {
    id: "restore-contract-template-1",
    name: "복원 검증 은행 템플릿",
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
    id: "restore-contract-journal-1",
    transactionId: "tx-sample-1",
    entryDate: "2026-06-03",
    memo: "복원 검증 승인 분개",
    status: "APPROVED",
    lines: [
      { accountCode: "101", accountName: "보통예금", accountType: "ASSET", debitAmount: 1100000, creditAmount: 0 },
      { accountCode: "401", accountName: "서비스매출", accountType: "REVENUE", debitAmount: 0, creditAmount: 1100000 }
    ]
  }
];

const taxReports: AppTaxReport[] = [
  {
    id: "restore-contract-report-1",
    reportType: "CORPORATE_TAX_PREP",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    calculatedPayload: { source: "workspace-backup-restore-contract" },
    createdAt: generatedAt,
    updatedAt: generatedAt
  }
];

const vendors: AppVendor[] = [
  {
    id: "restore-contract-vendor-1",
    name: "복원 검증 거래처",
    defaultAccount: DEFAULT_ACCOUNTS.find((account) => account.code === "502") ?? null,
    withholdingType: "NONE"
  }
];

const classificationRules: AppClassificationRule[] = [
  {
    id: "restore-contract-rule-1",
    name: "복원 검증 규칙",
    keyword: "프로젝트",
    accountCode: "401",
    accountName: "서비스매출",
    priority: 100,
    isActive: true
  }
];

const auditEvents: AppAuditEvent[] = [
  {
    id: "restore-contract-audit-1",
    action: "WORKSPACE_BACKUP_EXPORT",
    entityType: "WORKSPACE",
    entityId: "restore-contract",
    summary: "워크스페이스 백업 export 복원 계약 검증",
    metadata: { generatedAt },
    createdAt: generatedAt
  }
];

const reviewItems: ReviewItem[] = [
  {
    id: "restore-contract-review-1",
    severity: "WARNING",
    reason: "복원 계약 검토 항목",
    status: "OPEN",
    transaction: sampleTransactions[0]
  }
];

const backupPayload = buildWorkspaceBackupPayload(
  {
    mode: "database",
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
  },
  generatedAt
);

const logs: string[] = [];
const server = spawn("npm", ["run", "start"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: port
  },
  stdio: ["ignore", "pipe", "pipe"]
});

server.stdout.on("data", (chunk) => logs.push(chunk.toString()));
server.stderr.on("data", (chunk) => logs.push(chunk.toString()));

let serverExited = false;
server.on("exit", (code, signal) => {
  serverExited = true;
  logs.push(`server exited code=${code ?? "null"} signal=${signal ?? "null"}\n`);
});

try {
  await waitForServer();
  await verifyExportedPayloadDryRun(backupPayload, "direct export payload");
  await verifyBareExportPayloadReachesConfirmationGuard(backupPayload);

  const backupJsonFile = buildWorkspaceBackupZipFiles(backupPayload, evidences).find((file) => file.path === "workspace-backup.json");
  assert.ok(backupJsonFile && typeof backupJsonFile.content === "string", "workspace backup ZIP should include workspace-backup.json");
  await verifyExportedPayloadDryRun(JSON.parse(backupJsonFile.content), "ZIP workspace-backup.json");

  console.log(`Workspace backup restore contract verification passed at ${baseUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("--- server logs ---");
  console.error(logs.join("").trim());
  process.exitCode = 1;
} finally {
  if (!serverExited) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    if (serverExited) break;
    try {
      const response = await fetch(`${baseUrl}/api/version`, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(250);
  }
  throw new Error(`Server did not become ready within ${startupTimeoutMs}ms.`);
}

async function verifyExportedPayloadDryRun(payload: WorkspaceBackupPayload, label: string) {
  const body = await postJson("/api/backups/restore", { backup: payload, dryRun: true }, 200);
  assert.equal(body.ok, true, `${label} should pass restore dry-run`);
  assert.equal(body.dryRun, true, `${label} dry-run response should be marked`);
  assert.ok(body.mode === "sample" || body.mode === "database", `${label} dry-run should report a known runtime mode`);
  assert.equal(body.restoredCounts?.accounts, payload.accounts.length, `${label} should count accounts`);
  assert.equal(body.restoredCounts?.csvTemplates, payload.csvTemplates.length, `${label} should count CSV templates`);
  assert.equal(body.restoredCounts?.importBatches, payload.importBatches.length, `${label} should count import batches`);
  assert.equal(body.restoredCounts?.originalImportFiles, payload.originalImportFiles.length, `${label} should count original CSV files`);
  assert.equal(body.restoredCounts?.transactions, payload.transactions.length, `${label} should count transactions`);
  assert.equal(body.restoredCounts?.evidences, payload.evidences.length, `${label} should count evidences`);
  assert.equal(body.restoredCounts?.journalEntries, payload.journalEntries.length, `${label} should count journal entries`);
  assert.equal(body.restoredCounts?.taxReports, payload.taxReports.length, `${label} should count tax reports`);
  assert.equal(body.restoredCounts?.closingPeriods, payload.closingPeriods.length, `${label} should count closing periods`);
  assert.equal(body.restoredCounts?.vendors, payload.vendors.length, `${label} should count vendors`);
  assert.equal(body.restoredCounts?.classificationRules, payload.classificationRules.length, `${label} should count classification rules`);
  assert.equal(body.restoredCounts?.auditEvents, payload.auditEvents.length, `${label} should count audit events`);
  assert.equal(body.restoredCounts?.reviewItems, payload.reviewItems.length, `${label} should count review items`);
}

async function verifyBareExportPayloadReachesConfirmationGuard(payload: WorkspaceBackupPayload) {
  const body = await postJson("/api/backups/restore", payload, 400);
  assert.equal(body.ok, false, "bare exported JSON without dryRun should not be restored immediately");
  assert.equal(body.code, "RESTORE_CONFIRMATION_REQUIRED", "bare exported JSON should pass schema validation and reach the confirmation guard");
  assert.match(body.message ?? "", /restoreConfirmation/, "bare exported JSON should require the restore confirmation text");
}

async function postJson(path: string, payload: unknown, expectedStatus: number) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  const text = await response.text();
  assert.equal(response.status, expectedStatus, `${path} should return HTTP ${expectedStatus}: ${text}`);
  return text ? JSON.parse(text) : {};
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
