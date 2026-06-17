import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const port = process.env.BACKUP_RESTORE_VERIFY_PORT ?? "3103";
const baseUrl = `http://127.0.0.1:${port}`;
const startupTimeoutMs = Number(process.env.BACKUP_RESTORE_VERIFY_TIMEOUT_MS ?? 20_000);
const serverPath = ".next/standalone/server.js";
const evidenceFileText = "dry-run-evidence";
const originalCsvText = "거래일,적요,입금\n2026-06-17,dry run,1000\n";

if (!existsSync(serverPath)) {
  console.error(`${serverPath} not found. Run npm run build before npm run verify:backup-restore.`);
  process.exit(1);
}

const backup = {
  app: "혼자장부",
  backupVersion: 1,
  company: {
    name: "Dry Run 법인",
    vatType: "GENERAL",
    fiscalYearEndMonth: 12,
    representativeSalaryEnabled: true,
    employeePayrollEnabled: false,
    contractorPaymentEnabled: true,
    billingModel: "INTERNAL_PER_USE",
    perUseUnitPrice: 110000,
    monthlySubscriptionPrice: 33000,
    annualSubscriptionPrice: 330000
  },
  accounts: [],
  csvTemplates: [
    {
      id: "csv-template-bank-primary",
      name: "은행 기본 템플릿",
      sourceType: "BANK",
      headerSignature: "거래일|적요|입금|출금|잔액",
      mapping: {
        transactionDate: "거래일",
        description: "적요",
        depositAmount: "입금",
        withdrawalAmount: "출금",
        balance: "잔액"
      }
    },
    {
      id: "csv-template-bank-secondary",
      name: "은행 템플릿 2",
      sourceType: "BANK",
      headerSignature: "일자|거래내용|맡기신금액|찾으신금액|거래후잔액",
      mapping: {
        transactionDate: "일자",
        description: "거래내용",
        depositAmount: "맡기신금액",
        withdrawalAmount: "찾으신금액",
        balance: "거래후잔액"
      }
    }
  ],
  importBatches: [
    {
      id: "import-dry-run-1",
      sourceType: "BANK",
      originalFileName: "dry-run-bank.csv",
      originalFileHash: "dry-run-hash",
      originalFileMimeType: "text/csv",
      originalFileSize: Buffer.byteLength(originalCsvText),
      rowCount: 1,
      importedAt: "2026-06-17T00:00:00.000Z"
    }
  ],
  originalImportFiles: [
    {
      importBatchId: "import-dry-run-1",
      originalFileName: "dry-run-bank.csv",
      originalFileHash: "dry-run-hash",
      originalFileMimeType: "text/csv",
      originalFileSize: Buffer.byteLength(originalCsvText),
      originalFileText: originalCsvText
    }
  ],
  transactions: [
    {
      id: "tx-dry-run-1",
      importBatchId: "import-dry-run-1",
      sourceRowNumber: 1,
      sourceType: "BANK",
      transactionDate: "2026-06-17",
      description: "dry run",
      direction: "DEPOSIT",
      depositAmount: 1000,
      withdrawalAmount: 0,
      evidenceStatus: "UNCHECKED"
    }
  ],
  evidences: [
    {
      id: "evidence-dry-run-1",
      evidenceType: "검증 영수증",
      issueDate: "2026-06-17",
      counterparty: "Dry Run 거래처",
      supplyAmount: 1000,
      vatAmount: 100,
      totalAmount: 1100,
      fileName: "dry-run-evidence.txt",
      fileDataUrl: `data:text/plain;base64,${Buffer.from(evidenceFileText).toString("base64")}`,
      fileMimeType: "text/plain",
      fileSize: Buffer.byteLength(evidenceFileText),
      transactionId: "tx-dry-run-1"
    }
  ],
  journalEntries: [],
  taxReports: [],
  closingPeriods: [
    {
      id: "closing-dry-run-1",
      period: "2026-06",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      summaryPayload: { transactionCount: 1 },
      closedAt: "2026-06-17T00:00:00.000Z",
      createdAt: "2026-06-17T00:00:00.000Z"
    }
  ],
  vendors: [],
  classificationRules: [],
  auditEvents: [
    {
      id: "audit-dry-run-1",
      action: "IMPORT_CREATE",
      entityType: "IMPORT_BATCH",
      entityId: "import-dry-run-1",
      summary: "dry run audit event",
      createdAt: "2026-06-17T00:00:00.000Z"
    }
  ],
  reviewItems: []
};

const logs = [];
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
  await verifySettingsUi();
  await verifyDryRun();
  await verifyInvalidDateBackup();
  await verifyInvalidTransactionAmountBackup();
  await verifyInvalidTransactionImportBatchBackup();
  await verifyInvalidEvidenceBackup();
  await verifyInvalidEvidenceAmountBackup();
  await verifyInvalidEvidenceTransactionBackup();
  await verifyInvalidJournalBackup();
  await verifyInvalidOriginalImportFileBackup();
  await verifyConfirmGuard();
  console.log(`Backup restore verification passed at ${baseUrl}`);
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

async function verifySettingsUi() {
  const response = await fetch(`${baseUrl}/?view=settings`, { cache: "no-store" });
  const body = await response.text();
  assert.equal(response.status, 200, "settings page should return HTTP 200");
  assert.match(body, /전체 백업/, "settings page should expose backup section");
  assert.match(body, /백업 JSON/, "settings page should expose JSON backup action");
  assert.match(body, /백업 ZIP/, "settings page should expose ZIP backup action");
  assert.match(body, /백업 복원/, "settings page should expose restore action");
  assert.match(body, /백업 점검/, "settings page should expose backup readiness table");
  assert.match(body, /데이터 보관\/삭제 기준/, "settings page should expose data retention policy");
  assert.match(body, /CSV 매핑 템플릿/, "settings page should expose CSV mapping template section");
  assert.match(body, /원본 CSV/, "settings page should expose original CSV backup status");
  assert.match(body, /증빙 파일/, "settings page should expose evidence file backup status");
  assert.match(body, /활동 로그/, "settings page should expose audit log section");
  assert.match(body, /마감/, "settings page should expose closing period backup count");
}

async function verifyDryRun() {
  const body = await postJson("/api/backups/restore", { backup, dryRun: true }, 200);
  assert.equal(body.ok, true, "dry-run should succeed");
  assert.equal(body.dryRun, true, "dry-run response should be marked");
  assert.equal(body.restoredCounts?.transactions, 1, "dry-run should count transactions");
  assert.equal(body.restoredCounts?.csvTemplates, 2, "dry-run should count CSV templates");
  assert.equal(body.restoredCounts?.importBatches, 1, "dry-run should count import batches");
  assert.equal(body.restoredCounts?.originalImportFiles, 1, "dry-run should count original CSV files");
  assert.equal(body.restoredCounts?.auditEvents, 1, "dry-run should count audit events");
  assert.equal(body.restoredCounts?.closingPeriods, 1, "dry-run should count closing periods");
  assert.equal(body.restoredCounts?.evidences, 1, "dry-run should count evidences");
}

async function verifyInvalidEvidenceBackup() {
  const invalidBackup = structuredClone(backup);
  invalidBackup.evidences = [
    {
      ...backup.evidences[0],
      id: "evidence-invalid-1",
      issueDate: "2026-02-31",
      fileUrl: "javascript:alert(1)",
      fileSize: 999
    }
  ];

  const body = await postJson("/api/backups/restore", { backup: invalidBackup, dryRun: true }, 400);
  assert.equal(body.ok, false, "restore should reject invalid evidence backup data");
  assert.equal(body.code, "INVALID_BACKUP_EVIDENCE", "restore should return evidence validation code");
  assert.ok(Array.isArray(body.issues), "restore should return evidence validation issues");
  assert.ok(body.issues.length >= 3, "restore should report invalid date, file, and URL issues");
}

async function verifyInvalidEvidenceAmountBackup() {
  const invalidBackup = structuredClone(backup);
  invalidBackup.evidences = [
    {
      ...backup.evidences[0],
      id: "evidence-invalid-amount-1",
      totalAmount: 1000
    }
  ];

  const body = await postJson("/api/backups/restore", { backup: invalidBackup, dryRun: true }, 400);
  assert.equal(body.ok, false, "restore should reject invalid evidence amount backup data");
  assert.equal(body.code, "INVALID_BACKUP_EVIDENCE", "restore should return evidence validation code");
  assert.ok(Array.isArray(body.issues), "restore should return evidence validation issues");
  assert.ok(body.issues.some((issue) => issue.includes("합계")), "restore should report inconsistent evidence totals");
}

async function verifyInvalidEvidenceTransactionBackup() {
  const invalidBackup = structuredClone(backup);
  invalidBackup.evidences = [
    {
      ...backup.evidences[0],
      id: "evidence-missing-transaction-1",
      transactionId: "missing-transaction"
    }
  ];

  const body = await postJson("/api/backups/restore", { backup: invalidBackup, dryRun: true }, 400);
  assert.equal(body.ok, false, "restore should reject evidence linked to missing transaction");
  assert.equal(body.code, "INVALID_BACKUP_EVIDENCE", "restore should return evidence validation code");
  assert.ok(Array.isArray(body.issues), "restore should return evidence validation issues");
  assert.ok(body.issues.some((issue) => issue.includes("연결 거래 missing-transaction")), "restore should report missing evidence transaction");
}

async function verifyInvalidDateBackup() {
  const invalidBackup = structuredClone(backup);
  invalidBackup.transactions = [
    {
      ...backup.transactions[0],
      transactionDate: "2026-02-31"
    }
  ];
  invalidBackup.auditEvents = [
    {
      ...backup.auditEvents[0],
      createdAt: "2026-02-31T00:00:00.000Z"
    }
  ];

  const body = await postJson("/api/backups/restore", { backup: invalidBackup, dryRun: true }, 400);
  assert.equal(body.ok, false, "restore should reject invalid backup dates");
  assert.equal(body.code, "INVALID_BACKUP_DATES", "restore should return date validation code");
  assert.ok(Array.isArray(body.issues), "restore should return date validation issues");
  assert.ok(body.issues.length >= 2, "restore should report invalid date and timestamp issues");
}

async function verifyInvalidTransactionAmountBackup() {
  const invalidBackup = structuredClone(backup);
  invalidBackup.transactions = [
    {
      ...backup.transactions[0],
      depositAmount: 1000,
      withdrawalAmount: 1000
    }
  ];

  const body = await postJson("/api/backups/restore", { backup: invalidBackup, dryRun: true }, 400);
  assert.equal(body.ok, false, "restore should reject invalid transaction amount backup data");
  assert.equal(body.code, "INVALID_BACKUP_TRANSACTIONS", "restore should return transaction validation code");
  assert.ok(Array.isArray(body.issues), "restore should return transaction validation issues");
  assert.ok(body.issues.some((issue) => issue.includes("입금과 출금")), "restore should report inconsistent transaction amounts");
}

async function verifyInvalidTransactionImportBatchBackup() {
  const invalidBackup = structuredClone(backup);
  invalidBackup.transactions = [
    {
      ...backup.transactions[0],
      importBatchId: "missing-import-batch"
    }
  ];

  const body = await postJson("/api/backups/restore", { backup: invalidBackup, dryRun: true }, 400);
  assert.equal(body.ok, false, "restore should reject transactions linked to missing import batches");
  assert.equal(body.code, "INVALID_BACKUP_TRANSACTIONS", "restore should return transaction validation code");
  assert.ok(Array.isArray(body.issues), "restore should return transaction validation issues");
  assert.ok(body.issues.some((issue) => issue.includes("연결 가져오기 missing-import-batch")), "restore should report missing import batch");
}

async function verifyInvalidJournalBackup() {
  const invalidBackup = structuredClone(backup);
  invalidBackup.journalEntries = [
    {
      id: "journal-invalid-1",
      transactionId: "missing-transaction",
      entryDate: "2026-06-17",
      memo: "invalid journal backup",
      status: "APPROVED",
      lines: [
        {
          accountCode: "NO_ACCOUNT",
          accountName: "없는 계정",
          debitAmount: 1000,
          creditAmount: 1000
        },
        {
          accountCode: "401",
          accountName: "매출",
          debitAmount: 0,
          creditAmount: 0
        }
      ]
    }
  ];

  const body = await postJson("/api/backups/restore", { backup: invalidBackup, dryRun: true }, 400);
  assert.equal(body.ok, false, "restore should reject invalid journal backup data");
  assert.equal(body.code, "INVALID_BACKUP_JOURNALS", "restore should return journal validation code");
  assert.ok(Array.isArray(body.issues), "restore should return journal validation issues");
  assert.ok(body.issues.length >= 4, "restore should report missing transaction, missing account, and invalid line issues");
}

async function verifyInvalidOriginalImportFileBackup() {
  const invalidBackup = structuredClone(backup);
  invalidBackup.originalImportFiles = [
    {
      ...backup.originalImportFiles[0],
      originalFileSize: 1
    }
  ];

  const body = await postJson("/api/backups/restore", { backup: invalidBackup, dryRun: true }, 400);
  assert.equal(body.ok, false, "restore should reject invalid original CSV backup data");
  assert.equal(body.code, "INVALID_BACKUP_ORIGINAL_FILES", "restore should return original file validation code");
  assert.ok(Array.isArray(body.issues), "restore should return original file validation issues");
  assert.ok(body.issues.length >= 1, "restore should report inconsistent original CSV file metadata");
}

async function verifyConfirmGuard() {
  const body = await postJson("/api/backups/restore", { backup }, 400);
  assert.equal(body.ok, false, "restore without confirmReplace should fail");
  assert.match(body.message ?? "", /confirmReplace/, "restore should require confirmReplace");
}

async function postJson(path, payload, expectedStatus) {
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
