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
const oversizedJsonText = "x".repeat(500_001);
const restoreConfirmationText = "혼자장부 전체교체";
const filingInputSummaryRows = [
  {
    신고: "부가세",
    "입력 항목": "과세 매출 공급가액",
    값: "₩1,000",
    근거: "과세 매출 거래 공급가액 합계",
    상태: "집계됨",
    톤: "green",
    "최종 확인": "홈택스 매출 세금계산서와 통장 입금 대조"
  },
  {
    신고: "법인세",
    "입력 항목": "승인 분개/원장",
    값: "1개 / 2행",
    근거: "승인된 자동분개와 계정별 원장 행 수",
    상태: "원장 있음",
    톤: "green",
    "최종 확인": "차변/대변과 계정별 원장 대조"
  }
];

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
  taxReports: [
    {
      id: "report-dry-run-1",
      reportType: "CORPORATE_TAX_PREP",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      calculatedPayload: {
        period: "2026-06",
        periodLabel: "2026년 6월",
        filingInputSummaryRows,
        summary: {
          revenue: 1000,
          expense: 0,
          profit: 1000,
          vatOutput: 100,
          vatInput: 0,
          vatPayable: 100,
          missingEvidenceAmount: 0,
          reviewCount: 0,
          riskCount: 0
        }
      },
      createdAt: "2026-06-17T00:00:00.000Z"
    }
  ],
  closingPeriods: [
    {
      id: "closing-dry-run-1",
      period: "2026-06",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      summaryPayload: {
        transactionCount: 1,
        report: {
          filingInputSummaryRows
        }
      },
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
  await verifyMalformedJson();
  await verifyInvalidDateBackup();
  await verifyInvalidCsvTemplateBackup();
  await verifyInvalidJsonPayloadBackup();
  await verifyInvalidTransactionAmountBackup();
  await verifyInvalidTransactionTaxBackup();
  await verifyInvalidTransactionImportBatchBackup();
  await verifyInvalidTransactionAccountBackup();
  await verifyInvalidEvidenceBackup();
  await verifyInvalidEvidenceAmountBackup();
  await verifyInvalidEvidenceTransactionBackup();
  await verifyInvalidAccountReferenceBackup();
  await verifyInvalidReviewItemBackup();
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
  assert.equal(body.restoredCounts?.taxReports, 1, "dry-run should count tax report snapshots");
  assert.equal(body.restoredCounts?.closingPeriods, 1, "dry-run should count closing periods");
  assert.equal(body.restoredCounts?.evidences, 1, "dry-run should count evidences");
}

async function verifyMalformedJson() {
  const response = await fetch(`${baseUrl}/api/backups/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
    cache: "no-store"
  });
  const text = await response.text();
  assert.equal(response.status, 400, `/api/backups/restore should reject malformed JSON: ${text}`);
  const body = JSON.parse(text);
  assert.equal(body.code, "INVALID_JSON_PAYLOAD", "backup restore should use the shared malformed JSON error code");
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

async function verifyInvalidAccountReferenceBackup() {
  const invalidBackup = structuredClone(backup);
  invalidBackup.vendors = [
    {
      id: "vendor-invalid-account-1",
      name: "없는 계정 거래처",
      defaultAccount: {
        code: "NO_VENDOR_ACCOUNT",
        name: "없는 거래처 기본 계정",
        type: "EXPENSE"
      }
    }
  ];
  invalidBackup.classificationRules = [
    {
      id: "rule-invalid-account-1",
      name: "없는 계정 규칙",
      keyword: "없는계정",
      accountCode: "NO_RULE_ACCOUNT",
      priority: 10,
      isActive: true
    }
  ];

  const body = await postJson("/api/backups/restore", { backup: invalidBackup, dryRun: true }, 400);
  assert.equal(body.ok, false, "restore should reject missing account references");
  assert.equal(body.code, "INVALID_BACKUP_ACCOUNT_REFERENCES", "restore should return account reference validation code");
  assert.ok(Array.isArray(body.issues), "restore should return account reference validation issues");
  assert.ok(body.issues.some((issue) => issue.includes("기본 계정과목 NO_VENDOR_ACCOUNT")), "restore should report missing vendor account");
  assert.ok(body.issues.some((issue) => issue.includes("계정과목 NO_RULE_ACCOUNT")), "restore should report missing classification account");
}

async function verifyInvalidReviewItemBackup() {
  const invalidBackup = structuredClone(backup);
  invalidBackup.reviewItems = [
    {
      id: "review-missing-transaction-1",
      severity: "WARNING",
      reason: "missing transaction review",
      recommendation: "거래 연결을 확인하세요.",
      status: "OPEN",
      transaction: {
        ...backup.transactions[0],
        id: "missing-transaction"
      }
    }
  ];

  const body = await postJson("/api/backups/restore", { backup: invalidBackup, dryRun: true }, 400);
  assert.equal(body.ok, false, "restore should reject review items linked to missing transactions");
  assert.equal(body.code, "INVALID_BACKUP_REVIEW_ITEMS", "restore should return review item validation code");
  assert.ok(Array.isArray(body.issues), "restore should return review item validation issues");
  assert.ok(body.issues.some((issue) => issue.includes("연결 거래 missing-transaction")), "restore should report missing review transaction");
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
  invalidBackup.taxReports = [
    {
      id: "report-invalid-period-1",
      reportType: "CORPORATE_TAX_PREP",
      periodStart: "2026-12-31",
      periodEnd: "2026-01-01",
      calculatedPayload: {}
    }
  ];
  invalidBackup.closingPeriods = [
    {
      ...backup.closingPeriods[0],
      periodStart: "2026-06-02",
      periodEnd: "2026-06-29"
    }
  ];

  const body = await postJson("/api/backups/restore", { backup: invalidBackup, dryRun: true }, 400);
  assert.equal(body.ok, false, "restore should reject invalid backup dates");
  assert.equal(body.code, "INVALID_BACKUP_DATES", "restore should return date validation code");
  assert.ok(Array.isArray(body.issues), "restore should return date validation issues");
  assert.ok(body.issues.length >= 5, "restore should report invalid date, timestamp, report period, and closing period issues");
  assert.ok(body.issues.some((issue) => issue.includes("report-invalid-period-1")), "restore should report reversed report periods");
  assert.ok(body.issues.some((issue) => issue.includes("periodStart는 2026-06-01")), "restore should report mismatched closing period start");
  assert.ok(body.issues.some((issue) => issue.includes("periodEnd는 2026-06-30")), "restore should report mismatched closing period end");
}

async function verifyInvalidCsvTemplateBackup() {
  const invalidBackup = structuredClone(backup);
  invalidBackup.csvTemplates = [
    {
      id: "csv-template-invalid-1",
      name: "깨진 매핑 템플릿",
      sourceType: "BANK",
      headerSignature: "거래일|적요|입금",
      mapping: {
        transactionDate: "없는거래일",
        description: 123,
        depositAmount: "입금"
      }
    }
  ];

  const body = await postJson("/api/backups/restore", { backup: invalidBackup, dryRun: true }, 400);
  assert.equal(body.ok, false, "restore should reject invalid CSV template mappings");
  assert.equal(body.code, "INVALID_BACKUP_CSV_TEMPLATES", "restore should return CSV template validation code");
  assert.ok(Array.isArray(body.issues), "restore should return CSV template validation issues");
  assert.ok(body.issues.some((issue) => issue.includes("내용/적요 매핑 값은 문자열")), "restore should report non-string mapping values");
  assert.ok(body.issues.some((issue) => issue.includes("내용/적요 컬럼을 매핑")), "restore should report missing required description mapping");
  assert.ok(body.issues.some((issue) => issue.includes("거래일 매핑 컬럼(없는거래일)")), "restore should report mapping columns absent from header signature");
}

async function verifyInvalidJsonPayloadBackup() {
  const invalidBackup = structuredClone(backup);
  invalidBackup.taxReports = [
    {
      id: "report-oversized-payload-1",
      reportType: "CORPORATE_TAX_PREP",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      calculatedPayload: { text: oversizedJsonText }
    }
  ];
  invalidBackup.closingPeriods = [
    {
      ...backup.closingPeriods[0],
      summaryPayload: { text: oversizedJsonText }
    }
  ];
  invalidBackup.auditEvents = [
    {
      ...backup.auditEvents[0],
      metadata: { text: oversizedJsonText }
    }
  ];

  const body = await postJson("/api/backups/restore", { backup: invalidBackup, dryRun: true }, 400);
  assert.equal(body.ok, false, "restore should reject oversized JSON payloads");
  assert.equal(body.code, "INVALID_BACKUP_JSON_PAYLOADS", "restore should return JSON payload validation code");
  assert.ok(Array.isArray(body.issues), "restore should return JSON payload validation issues");
  assert.ok(body.issues.some((issue) => issue.includes("calculatedPayload")), "restore should report oversized report payloads");
  assert.ok(body.issues.some((issue) => issue.includes("summaryPayload")), "restore should report oversized closing payloads");
  assert.ok(body.issues.some((issue) => issue.includes("metadata")), "restore should report oversized audit metadata");
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

async function verifyInvalidTransactionTaxBackup() {
  const invalidBackup = structuredClone(backup);
  invalidBackup.transactions = [
    {
      ...backup.transactions[0],
      supplyAmount: 1000,
      vatAmount: 100
    }
  ];

  const body = await postJson("/api/backups/restore", { backup: invalidBackup, dryRun: true }, 400);
  assert.equal(body.ok, false, "restore should reject invalid transaction tax backup data");
  assert.equal(body.code, "INVALID_BACKUP_TRANSACTIONS", "restore should return transaction validation code");
  assert.ok(Array.isArray(body.issues), "restore should return transaction validation issues");
  assert.ok(body.issues.some((issue) => issue.includes("공급가액과 부가세")), "restore should report inconsistent transaction tax amounts");
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

async function verifyInvalidTransactionAccountBackup() {
  const invalidBackup = structuredClone(backup);
  invalidBackup.transactions = [
    {
      ...backup.transactions[0],
      confirmedAccount: {
        code: "NO_ACCOUNT",
        name: "없는 계정",
        type: "EXPENSE"
      }
    }
  ];

  const body = await postJson("/api/backups/restore", { backup: invalidBackup, dryRun: true }, 400);
  assert.equal(body.ok, false, "restore should reject transactions linked to missing accounts");
  assert.equal(body.code, "INVALID_BACKUP_TRANSACTIONS", "restore should return transaction validation code");
  assert.ok(Array.isArray(body.issues), "restore should return transaction validation issues");
  assert.ok(body.issues.some((issue) => issue.includes("확정 계정과목 NO_ACCOUNT")), "restore should report missing confirmed account");
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
    },
    {
      ...backup.originalImportFiles[0],
      importBatchId: "missing-import-batch"
    }
  ];

  const body = await postJson("/api/backups/restore", { backup: invalidBackup, dryRun: true }, 400);
  assert.equal(body.ok, false, "restore should reject invalid original CSV backup data");
  assert.equal(body.code, "INVALID_BACKUP_ORIGINAL_FILES", "restore should return original file validation code");
  assert.ok(Array.isArray(body.issues), "restore should return original file validation issues");
  assert.ok(body.issues.length >= 2, "restore should report inconsistent original CSV file metadata and missing import batches");
  assert.ok(body.issues.some((issue) => issue.includes("연결 가져오기")), "restore should report original CSV files linked to missing import batches");
}

async function verifyConfirmGuard() {
  const body = await postJson("/api/backups/restore", { backup }, 400);
  assert.equal(body.ok, false, "restore without confirmReplace should fail");
  assert.equal(body.code, "RESTORE_CONFIRMATION_REQUIRED", "restore should require an explicit confirmation code");
  assert.match(body.message ?? "", /confirmReplace/, "restore should require confirmReplace");
  assert.match(body.message ?? "", /restoreConfirmation/, "restore should require restoreConfirmation text");

  const wrongConfirmationBody = await postJson("/api/backups/restore", { backup, confirmReplace: true, restoreConfirmation: "wrong" }, 400);
  assert.equal(wrongConfirmationBody.ok, false, "restore with wrong confirmation text should fail");
  assert.equal(wrongConfirmationBody.code, "RESTORE_CONFIRMATION_REQUIRED", "restore should reject wrong confirmation text");

  const sampleModeBody = await postJson(
    "/api/backups/restore",
    { backup, confirmReplace: true, restoreConfirmation: restoreConfirmationText },
    409
  );
  assert.equal(sampleModeBody.ok, false, "restore with valid confirmation should reach sample-mode DB guard");
  assert.equal(sampleModeBody.mode, "sample", "restore should still be blocked without Postgres");
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
