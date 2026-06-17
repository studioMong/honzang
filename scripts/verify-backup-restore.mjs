import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const port = process.env.BACKUP_RESTORE_VERIFY_PORT ?? "3103";
const baseUrl = `http://127.0.0.1:${port}`;
const startupTimeoutMs = Number(process.env.BACKUP_RESTORE_VERIFY_TIMEOUT_MS ?? 20_000);
const serverPath = ".next/standalone/server.js";

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
    billingModel: "INTERNAL_PER_USE"
  },
  accounts: [],
  csvTemplates: [],
  importBatches: [
    {
      id: "import-dry-run-1",
      sourceType: "BANK",
      originalFileName: "dry-run-bank.csv",
      originalFileHash: "dry-run-hash",
      originalFileMimeType: "text/csv",
      originalFileSize: 42,
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
      originalFileSize: 42,
      originalFileText: "거래일,적요,입금\n2026-06-17,dry run,1000\n"
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
  evidences: [],
  journalEntries: [],
  taxReports: [],
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
  assert.match(body, /활동 로그/, "settings page should expose audit log section");
}

async function verifyDryRun() {
  const body = await postJson("/api/backups/restore", { backup, dryRun: true }, 200);
  assert.equal(body.ok, true, "dry-run should succeed");
  assert.equal(body.dryRun, true, "dry-run response should be marked");
  assert.equal(body.restoredCounts?.transactions, 1, "dry-run should count transactions");
  assert.equal(body.restoredCounts?.importBatches, 1, "dry-run should count import batches");
  assert.equal(body.restoredCounts?.originalImportFiles, 1, "dry-run should count original CSV files");
  assert.equal(body.restoredCounts?.auditEvents, 1, "dry-run should count audit events");
  assert.equal(body.restoredCounts?.evidences, 0, "dry-run should count evidences");
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
