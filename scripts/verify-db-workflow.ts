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
  taxReportIds: [] as string[]
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
    transactions?: AppTransaction[];
  }>("/api/imports", {
    method: "POST",
    body: {
      companyId,
      sourceType,
      originalFileName: `${marker}-${sourceType}.csv`,
      mapping,
      headers,
      rows
    }
  });

  assert.equal(payload.ok, true, `${sourceType} import should succeed`);
  assert.equal(payload.mode, "database", `${sourceType} import should use database mode`);
  assert.equal(payload.duplicate, false, `${sourceType} import should create a fresh batch`);
  assert.ok(payload.importBatchId, `${sourceType} import should return an import batch id`);
  assert.equal(payload.transactions?.length, rowCount, `${sourceType} import should return imported transactions`);
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
  if (!response.ok && !options.allowFailure) {
    throw new Error(`${options.method ?? "GET"} ${path} returned HTTP ${response.status}: ${text}`);
  }
  return body as T;
}
