import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Papa from "papaparse";
import { generateJournalDraft, inferMapping, summarizeTransactions } from "../src/lib/accounting";
import { DEFAULT_COMPANY_ID } from "../src/lib/defaults";
import type { AppJournalEntry, AppTransaction, ParsedCsvRow, SourceType } from "../src/types";

const baseUrl = (process.env.VERIFY_DB_WORKFLOW_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const marker = `verify-db-workflow-${Date.now()}`;
const cleanup = {
  importBatchIds: [] as string[],
  journalEntryIds: [] as string[],
  taxReportIds: [] as string[],
  closingPeriods: [] as string[]
};

if (baseUrl.includes("honzang-production.up.railway.app") && process.env.VERIFY_DB_WORKFLOW_ALLOW_PRODUCTION !== "1") {
  throw new Error("Refusing to mutate the production Railway URL. Use a local or staging DB, or set VERIFY_DB_WORKFLOW_ALLOW_PRODUCTION=1 explicitly.");
}

try {
  const companyPayload = await requestJson<{
    mode?: string;
    company?: { id?: string };
  }>("/api/companies");
  assert.equal(companyPayload.mode, "database", "verify:db-workflow requires database mode");
  const companyId = companyPayload.company?.id ?? DEFAULT_COMPANY_ID;

  const importedTransactions = [
    ...(await importSample(companyId, "BANK", "public/samples/bank-transactions.csv", 1)),
    ...(await importSample(companyId, "CARD", "public/samples/card-transactions.csv", 1))
  ];
  assert.equal(importedTransactions.length, 2, "workflow should import two sample transactions");

  const approvedEntries: AppJournalEntry[] = [];
  for (const transaction of importedTransactions) {
    const draft = generateJournalDraft(transaction);
    assert.ok(isBalanced(draft), `journal draft should be balanced for ${transaction.description}`);
    const journalPayload = await requestJson<{ ok?: boolean; mode?: string; journalEntry?: AppJournalEntry }>("/api/journals", {
      method: "POST",
      body: {
        companyId,
        transactionId: draft.transactionId,
        entryDate: draft.entryDate,
        memo: draft.memo,
        status: "APPROVED",
        lines: draft.lines
      }
    });
    assert.equal(journalPayload.ok, true, "journal approval should succeed");
    assert.equal(journalPayload.mode, "database", "journal approval should use database mode");
    assert.ok(journalPayload.journalEntry?.id, "journal approval should return an entry");
    cleanup.journalEntryIds.push(journalPayload.journalEntry.id);
    approvedEntries.push(journalPayload.journalEntry);
  }

  const journalList = await requestJson<{ journalEntries?: AppJournalEntry[] }>("/api/journals");
  const approvedIds = new Set(journalList.journalEntries?.filter((entry) => entry.status === "APPROVED").map((entry) => entry.id));
  approvedEntries.forEach((entry) => assert.ok(approvedIds.has(entry.id), `approved journal should be listed: ${entry.id}`));

  const transactionDates = importedTransactions.map((transaction) => transaction.transactionDate).sort();
  const reportPayload = await requestJson<{ ok?: boolean; mode?: string; taxReport?: { id?: string } }>("/api/reports", {
    method: "POST",
    body: {
      companyId,
      reportType: "CORPORATE_TAX_PREP",
      periodStart: transactionDates[0],
      periodEnd: transactionDates.at(-1),
      calculatedPayload: {
        marker,
        summary: summarizeTransactions(importedTransactions),
        transactionCount: importedTransactions.length,
        journalEntryCount: approvedEntries.length,
        approvedJournalEntryIds: approvedEntries.map((entry) => entry.id)
      }
    }
  });
  assert.equal(reportPayload.ok, true, "tax report snapshot should be saved");
  assert.equal(reportPayload.mode, "database", "tax report snapshot should use database mode");
  assert.ok(reportPayload.taxReport?.id, "tax report snapshot should return an id");
  cleanup.taxReportIds.push(reportPayload.taxReport.id);

  const reports = await requestJson<{ taxReports?: Array<{ id: string; calculatedPayload?: unknown }> }>("/api/reports");
  assert.ok(reports.taxReports?.some((report) => report.id === reportPayload.taxReport?.id), "saved report should be listed");

  const closingPeriod = transactionDates[0]?.slice(0, 7);
  assert.equal(closingPeriod, "2026-06", "workflow fixture should run in the June 2026 period");
  const closePayload = await requestJson<{ ok?: boolean; mode?: string; closingPeriod?: { period?: string } }>("/api/closing-periods", {
    method: "POST",
    body: {
      companyId,
      period: closingPeriod,
      summaryPayload: {
        marker,
        taxReportId: reportPayload.taxReport.id,
        transactionCount: importedTransactions.length,
        journalEntryCount: approvedEntries.length
      }
    }
  });
  cleanup.closingPeriods.push(closingPeriod);
  assert.equal(closePayload.ok, true, "closing period lock should be created");
  assert.equal(closePayload.mode, "database", "closing period lock should use database mode");
  assert.equal(closePayload.closingPeriod?.period, closingPeriod, "closing period lock should return the requested period");

  const lockedTransactionPayload = await requestJson<{ ok?: boolean; code?: string; message?: string }>("/api/transactions", {
    method: "POST",
    expectedStatus: 409,
    body: {
      transactionDate: "2026-06-18",
      description: `${marker} locked transaction should fail`,
      counterparty: "잠금 검증",
      depositAmount: 1000,
      withdrawalAmount: 0,
      evidenceStatus: "UNCHECKED"
    }
  });
  assert.equal(lockedTransactionPayload.ok, false, "locked period transaction create should fail");
  assert.equal(lockedTransactionPayload.code, "PERIOD_CLOSED", "locked period transaction create should return PERIOD_CLOSED");

  const lockedReportDeletePayload = await requestJson<{ ok?: boolean; code?: string; message?: string }>("/api/reports", {
    method: "DELETE",
    expectedStatus: 409,
    body: { id: reportPayload.taxReport.id }
  });
  assert.equal(lockedReportDeletePayload.ok, false, "locked period report delete should fail");
  assert.equal(lockedReportDeletePayload.code, "PERIOD_CLOSED", "locked period report delete should return PERIOD_CLOSED");

  const reopenPayload = await requestJson<{ ok?: boolean; mode?: string; period?: string }>("/api/closing-periods", {
    method: "DELETE",
    body: {
      companyId,
      period: closingPeriod
    }
  });
  assert.equal(reopenPayload.ok, true, "closing period lock should reopen");
  assert.equal(reopenPayload.mode, "database", "closing period reopen should use database mode");
  assert.equal(reopenPayload.period, closingPeriod, "closing period reopen should return the requested period");
  cleanup.closingPeriods = cleanup.closingPeriods.filter((period) => period !== closingPeriod);

  const auditEvents = await requestJson<{ auditEvents?: Array<{ action: string; entityId?: string | null }> }>("/api/audit-events");
  const auditActions = new Set(auditEvents.auditEvents?.map((event) => event.action));
  assert.ok(auditActions.has("IMPORT_CREATE"), "audit log should include import creation");
  assert.ok(auditActions.has("JOURNAL_CREATE"), "audit log should include journal creation");
  assert.ok(auditActions.has("REPORT_CREATE"), "audit log should include report creation");
  assert.ok(auditActions.has("PERIOD_CLOSE"), "audit log should include closing period lock");
  assert.ok(auditActions.has("PERIOD_REOPEN"), "audit log should include closing period reopen");

  console.log(`DB workflow verification passed at ${baseUrl}`);
} finally {
  await cleanupCreatedData();
}

async function importSample(companyId: string, sourceType: SourceType, filePath: string, rowCount: number) {
  const csv = readFileSync(resolve(filePath), "utf8");
  const parsed = Papa.parse<ParsedCsvRow>(csv, {
    header: true,
    skipEmptyLines: true
  });
  assert.deepEqual(parsed.errors, [], `${filePath} should parse without errors`);
  const headers = parsed.meta.fields ?? [];
  const mapping = inferMapping(headers, sourceType);
  assert.ok(mapping.transactionDate, `${sourceType} should infer transactionDate`);
  assert.ok(mapping.description, `${sourceType} should infer description`);
  const rows = parsed.data.slice(0, rowCount).map((row, index) => uniqueRow(row, mapping.description, mapping.transactionDate, index));

  const payload = await requestJson<{
    ok?: boolean;
    mode?: string;
    duplicate?: boolean;
    importBatchId?: string;
    importBatch?: { hasOriginalFile?: boolean; originalFileName?: string };
    transactions?: AppTransaction[];
  }>("/api/imports", {
    method: "POST",
    body: {
      companyId,
      sourceType,
      originalFileName: `${marker}-${sourceType}.csv`,
      originalFileText: csv,
      originalFileMimeType: "text/csv",
      originalFileSize: Buffer.byteLength(csv, "utf8"),
      mapping,
      headers,
      rows
    }
  });

  assert.equal(payload.ok, true, `${sourceType} import should succeed`);
  assert.equal(payload.mode, "database", `${sourceType} import should use database mode`);
  assert.equal(payload.duplicate, false, `${sourceType} import should create a fresh batch`);
  assert.ok(payload.importBatchId, `${sourceType} import should return an import batch id`);
  assert.equal(payload.importBatch?.hasOriginalFile, true, `${sourceType} import should preserve original CSV`);
  assert.equal(payload.transactions?.length, rowCount, `${sourceType} import should return imported transactions`);
  const originalFilePayload = await requestJson<{
    ok?: boolean;
    originalFileName?: string;
    originalFileText?: string;
  }>(`/api/imports?importBatchId=${payload.importBatchId}`);
  assert.equal(originalFilePayload.ok, true, `${sourceType} original CSV download should succeed`);
  assert.equal(originalFilePayload.originalFileName, `${marker}-${sourceType}.csv`, `${sourceType} original CSV filename`);
  assert.ok(originalFilePayload.originalFileText?.includes(headers[0] ?? ""), `${sourceType} original CSV should include header`);
  cleanup.importBatchIds.push(payload.importBatchId);
  return payload.transactions ?? [];
}

function uniqueRow(row: ParsedCsvRow, descriptionColumn: string | undefined, dateColumn: string | undefined, index: number) {
  const next = { ...row };
  if (descriptionColumn) {
    next[descriptionColumn] = `${String(next[descriptionColumn] ?? "workflow transaction")} ${marker}-${index + 1}`;
  }
  if (dateColumn) {
    next[dateColumn] = "2026-06-17";
  }
  return next;
}

function isBalanced(draft: ReturnType<typeof generateJournalDraft>) {
  const debit = draft.lines.reduce((sum, line) => sum + line.debitAmount, 0);
  const credit = draft.lines.reduce((sum, line) => sum + line.creditAmount, 0);
  return draft.lines.length > 0 && Math.round(debit) === Math.round(credit);
}

async function cleanupCreatedData() {
  for (const period of cleanup.closingPeriods.reverse()) {
    await requestJson("/api/closing-periods", {
      method: "DELETE",
      body: { period },
      allowFailure: true
    });
  }

  for (const taxReportId of cleanup.taxReportIds.reverse()) {
    await requestJson("/api/reports", {
      method: "DELETE",
      body: { id: taxReportId },
      allowFailure: true
    });
  }

  for (const journalEntryId of cleanup.journalEntryIds.reverse()) {
    await requestJson("/api/journals", {
      method: "PATCH",
      body: { id: journalEntryId, status: "VOID" },
      allowFailure: true
    });
  }

  for (const importBatchId of cleanup.importBatchIds.reverse()) {
    await requestJson("/api/imports", {
      method: "DELETE",
      body: { importBatchId },
      allowFailure: true
    });
  }
}

async function requestJson<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    allowFailure?: boolean;
    expectedStatus?: number;
  } = {}
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store"
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (options.expectedStatus !== undefined) {
    assert.equal(response.status, options.expectedStatus, `${options.method ?? "GET"} ${path} should return HTTP ${options.expectedStatus}: ${text}`);
    return body as T;
  }
  if (!response.ok && !options.allowFailure) {
    throw new Error(`${options.method ?? "GET"} ${path} returned HTTP ${response.status}: ${text}`);
  }
  return body as T;
}
