import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Papa from "papaparse";
import { generateJournalDraft, inferMapping, summarizeTransactions } from "../src/lib/accounting";
import { DEFAULT_COMPANY_ID } from "../src/lib/defaults";
import type { AppAccount, AppClassificationRule, AppJournalEntry, AppTransaction, CsvColumnMapping, CsvTemplate, ParsedCsvRow, ReviewItem, SourceType } from "../src/types";

const evidenceAmountMismatchReason = "연결 증빙 합계가 거래금액과 일치하지 않습니다.";

const baseUrl = (process.env.VERIFY_DB_WORKFLOW_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const marker = `verify-db-workflow-${Date.now()}`;
const cleanup = {
  importBatchIds: [] as string[],
  csvTemplateIds: [] as string[],
  evidenceIds: [] as string[],
  journalEntryIds: [] as string[],
  taxReportIds: [] as string[],
  closingPeriods: [] as string[],
  classificationRuleIds: [] as string[]
};

if (baseUrl.includes("honzang-production.up.railway.app") && process.env.VERIFY_DB_WORKFLOW_ALLOW_PRODUCTION !== "1") {
  throw new Error("Refusing to mutate the production Railway URL. Use a local or staging DB, or set VERIFY_DB_WORKFLOW_ALLOW_PRODUCTION=1 explicitly.");
}

try {
  const companyPayload = await requestJson<{
    mode?: string;
    company?: { id?: string };
    accounts?: AppAccount[];
  }>("/api/companies");
  assert.equal(companyPayload.mode, "database", "verify:db-workflow requires database mode");
  const companyId = companyPayload.company?.id ?? DEFAULT_COMPANY_ID;
  const verificationAccount = companyPayload.accounts?.find((account) => account.code === "599") ?? companyPayload.accounts?.[0];
  assert.ok(verificationAccount?.id, "company accounts should include an account for transaction patch verification");
  const alternateVerificationAccountId = companyPayload.accounts?.find((account) => account.id && account.id !== verificationAccount.id)?.id;
  assert.ok(alternateVerificationAccountId, "company accounts should include a second account for approved journal account guard verification");

  const bankTransactions = await importSample(companyId, "BANK", "public/samples/bank-transactions.csv", 1, "primary");
  const alternateBankTransactions = await importSample(companyId, "BANK", "public/samples/bank-transactions.csv", 1, "alternate");
  const importedTransactions = [
    ...bankTransactions,
    ...(await importSample(companyId, "CARD", "public/samples/card-transactions.csv", 1, "primary"))
  ];
  assert.equal(importedTransactions.length, 2, "workflow should import two sample transactions");
  const companyAfterTemplateVariants = await requestJson<{ csvTemplates?: CsvTemplate[] }>("/api/companies");
  const verifiedBankTemplateCount =
    companyAfterTemplateVariants.csvTemplates?.filter((template) => template.sourceType === "BANK" && template.headerSignature?.includes(marker)).length ?? 0;
  assert.ok(verifiedBankTemplateCount >= 2, "BANK imports with different header signatures should preserve multiple CSV templates");

  const classificationRulePayload = await requestJson<{ ok?: boolean; mode?: string; classificationRule?: AppClassificationRule }>("/api/classification-rules", {
    method: "POST",
    body: {
      companyId,
      name: `${marker} classification rule`,
      keyword: marker,
      accountCode: verificationAccount.code,
      sourceType: "BANK",
      priority: 10,
      isActive: true
    }
  });
  assert.equal(classificationRulePayload.ok, true, "classification rule create should succeed");
  assert.equal(classificationRulePayload.mode, "database", "classification rule create should use database mode");
  assert.ok(classificationRulePayload.classificationRule?.id, "classification rule create should return an id");
  cleanup.classificationRuleIds.push(classificationRulePayload.classificationRule.id);

  const invalidClassificationRulePatchPayload = await requestJson<{ ok?: boolean; message?: string }>("/api/classification-rules", {
    method: "PATCH",
    expectedStatus: 404,
    body: {
      companyId,
      id: classificationRulePayload.classificationRule.id,
      accountCode: `${marker}-missing-account`
    }
  });
  assert.equal(invalidClassificationRulePatchPayload.ok, false, "classification rule patch with a missing account should fail");
  assert.match(invalidClassificationRulePatchPayload.message ?? "", /계정과목/, "classification rule patch should report a missing account");

  const missingClassificationRulePatchPayload = await requestJson<{ ok?: boolean; message?: string }>("/api/classification-rules", {
    method: "PATCH",
    expectedStatus: 404,
    body: {
      companyId,
      id: `${marker}-missing-rule`,
      isActive: false
    }
  });
  assert.equal(missingClassificationRulePatchPayload.ok, false, "missing classification rule patch should fail");
  assert.match(missingClassificationRulePatchPayload.message ?? "", /자동 분류 규칙/, "missing classification rule patch should report a missing rule");

  const missingClassificationRuleDeletePayload = await requestJson<{ ok?: boolean; message?: string }>("/api/classification-rules", {
    method: "DELETE",
    expectedStatus: 404,
    body: {
      companyId,
      id: `${marker}-missing-rule`
    }
  });
  assert.equal(missingClassificationRuleDeletePayload.ok, false, "missing classification rule delete should fail");
  assert.match(missingClassificationRuleDeletePayload.message ?? "", /자동 분류 규칙/, "missing classification rule delete should report a missing rule");

  await requestJson<{ ok?: boolean; mode?: string; transaction?: AppTransaction }>("/api/transactions", {
    method: "PATCH",
    body: {
      id: importedTransactions[0]?.id,
      confirmedAccountId: verificationAccount.id
    }
  });
  await requestJson<{ ok?: boolean; mode?: string; transaction?: AppTransaction }>("/api/transactions", {
    method: "PATCH",
    body: {
      id: importedTransactions[0]?.id,
      evidenceStatus: "MISSING"
    }
  });
  const transactionPatchList = await requestJson<{ transactions?: AppTransaction[] }>("/api/transactions");
  const patchedTransaction = transactionPatchList.transactions?.find((transaction) => transaction.id === importedTransactions[0]?.id);
  assert.equal(patchedTransaction?.confirmedAccount?.id, verificationAccount.id, "evidence-only transaction patch should preserve confirmed account");
  assert.equal(patchedTransaction?.evidenceStatus, "MISSING", "evidence-only transaction patch should update evidence status");

  const crossPeriodTransaction = alternateBankTransactions[0];
  assert.ok(crossPeriodTransaction?.id, "workflow should import an alternate transaction for linked period lock verification");
  const crossPeriodDraft = generateJournalDraft(crossPeriodTransaction);
  assert.ok(isBalanced(crossPeriodDraft), "cross-period linked journal draft should be balanced");
  const crossPeriodJournalPayload = await requestJson<{ ok?: boolean; mode?: string; journalEntry?: AppJournalEntry }>("/api/journals", {
    method: "POST",
    body: {
      companyId,
      transactionId: crossPeriodDraft.transactionId,
      entryDate: "2026-07-01",
      memo: `${marker} linked transaction lock verification`,
      status: "APPROVED",
      lines: crossPeriodDraft.lines
    }
  });
  assert.equal(crossPeriodJournalPayload.ok, true, "cross-period linked journal should be created before closing the transaction period");
  assert.equal(crossPeriodJournalPayload.mode, "database", "cross-period linked journal should use database mode");
  const crossPeriodJournalId = crossPeriodJournalPayload.journalEntry?.id;
  assert.ok(crossPeriodJournalId, "cross-period linked journal should return an id");
  cleanup.journalEntryIds.push(crossPeriodJournalId);

  const evidencePayload = await requestJson<{
    ok?: boolean;
    mode?: string;
    evidence?: { id?: string; transactionId?: string | null };
  }>("/api/evidences", {
    method: "POST",
    body: {
      companyId,
      evidenceType: "검증 영수증",
      issueDate: "2026-06-17",
      counterparty: `${marker} 증빙`,
      supplyAmount: 1000,
      vatAmount: 100,
      totalAmount: 1100,
      fileName: `${marker}.txt`,
      fileDataUrl: `data:text/plain;base64,${Buffer.from(marker).toString("base64")}`,
      fileMimeType: "text/plain",
      fileSize: Buffer.byteLength(marker),
      transactionId: importedTransactions[0]?.id
    }
  });
  assert.equal(evidencePayload.ok, true, "evidence create should succeed");
  assert.equal(evidencePayload.mode, "database", "evidence create should use database mode");
  assert.ok(evidencePayload.evidence?.id, "evidence create should return an id");
  cleanup.evidenceIds.push(evidencePayload.evidence.id);

  const transactionAfterEvidence = await requestJson<{ transactions?: AppTransaction[] }>("/api/transactions");
  const attachedTransaction = transactionAfterEvidence.transactions?.find((transaction) => transaction.id === importedTransactions[0]?.id);
  assert.equal(attachedTransaction?.evidenceStatus, "ATTACHED", "mismatched evidence amount should mark linked transaction as attached");

  const reviewPayload = await requestJson<{ reviewItems?: ReviewItem[] }>("/api/reviews");
  const workflowReviews = reviewPayload.reviewItems?.filter((item) => item.transaction?.description.includes(marker)) ?? [];
  const mismatchReview = workflowReviews.find((item) => item.reason.includes(evidenceAmountMismatchReason));
  assert.ok(mismatchReview, "mismatched evidence amount should create a review item");
  const mismatchReviewId = mismatchReview.id;
  assert.ok(mismatchReviewId, "mismatched evidence amount review should include an id");
  assert.equal(mismatchReview?.severity, "DANGER", "large evidence amount mismatch should create a danger review");
  assert.match(mismatchReview?.recommendation ?? "", /차이/, "mismatch review should explain the amount difference");
  const reviewSnapshotRows = buildReviewSnapshotRows(workflowReviews);
  assert.ok(
    reviewSnapshotRows.some((row) => String(row.사유).includes(evidenceAmountMismatchReason)),
    "review snapshot rows should preserve the evidence mismatch reason"
  );

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

  const draftReplacementPayload = await requestJson<{ ok?: boolean; code?: string; approvedJournalId?: string }>("/api/journals", {
    method: "POST",
    expectedStatus: 409,
    body: {
      companyId,
      transactionId: approvedEntries[0]?.transactionId,
      entryDate: approvedEntries[0]?.entryDate,
      memo: `${marker} approved replacement should fail`,
      status: "DRAFT",
      lines: approvedEntries[0]?.lines.map((line) => ({
        accountCode: line.accountCode,
        accountName: line.accountName,
        accountType: line.accountType,
        debitAmount: line.debitAmount,
        creditAmount: line.creditAmount,
        vatType: line.vatType,
        memo: line.memo
      }))
    }
  });
  assert.equal(draftReplacementPayload.ok, false, "DRAFT replacement of an approved journal should fail");
  assert.equal(
    draftReplacementPayload.code,
    "APPROVED_JOURNAL_REPLACEMENT_BLOCKED",
    "DRAFT replacement of an approved journal should return a replacement guard code"
  );
  assert.equal(draftReplacementPayload.approvedJournalId, approvedEntries[0]?.id, "replacement guard should identify the existing approved journal");

  const approvedReplacementPayload = await requestJson<{ ok?: boolean; code?: string; approvedJournalId?: string }>("/api/journals", {
    method: "POST",
    expectedStatus: 409,
    body: {
      companyId,
      transactionId: approvedEntries[0]?.transactionId,
      entryDate: approvedEntries[0]?.entryDate,
      memo: `${marker} approved-to-approved replacement should fail`,
      status: "APPROVED",
      lines: approvedEntries[0]?.lines.map((line) => ({
        accountCode: line.accountCode,
        accountName: line.accountName,
        accountType: line.accountType,
        debitAmount: line.debitAmount,
        creditAmount: line.creditAmount,
        vatType: line.vatType,
        memo: line.memo
      }))
    }
  });
  assert.equal(approvedReplacementPayload.ok, false, "APPROVED replacement of an approved journal should fail");
  assert.equal(
    approvedReplacementPayload.code,
    "APPROVED_JOURNAL_REPLACEMENT_BLOCKED",
    "APPROVED replacement of an approved journal should return a replacement guard code"
  );
  assert.equal(approvedReplacementPayload.approvedJournalId, approvedEntries[0]?.id, "APPROVED replacement guard should identify the existing approved journal");

  const approvedAccountPatchPayload = await requestJson<{ ok?: boolean; code?: string; approvedJournalId?: string }>("/api/transactions", {
    method: "PATCH",
    expectedStatus: 409,
    body: {
      id: importedTransactions[0]?.id,
      confirmedAccountId: alternateVerificationAccountId
    }
  });
  assert.equal(approvedAccountPatchPayload.ok, false, "account change on a transaction with an approved journal should fail");
  assert.equal(
    approvedAccountPatchPayload.code,
    "APPROVED_JOURNAL_ACCOUNT_CHANGE_BLOCKED",
    "account change on a transaction with an approved journal should return an account guard code"
  );
  assert.equal(approvedAccountPatchPayload.approvedJournalId, approvedEntries[0]?.id, "account guard should identify the existing approved journal");

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
        reviewItems: reviewSnapshotRows,
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
  const savedReport = reports.taxReports?.find((report) => report.id === reportPayload.taxReport?.id);
  assert.ok(savedReport, "saved report should be listed");
  assertSnapshotReviewItemsContainMismatch(savedReport?.calculatedPayload, "saved report payload");

  const closingPeriod = transactionDates[0]?.slice(0, 7);
  assert.equal(closingPeriod, "2026-06", "workflow fixture should run in the June 2026 period");
  const mismatchedClosePayload = await requestJson<{ ok?: boolean; code?: string; issues?: string[] }>("/api/closing-periods", {
    method: "POST",
    expectedStatus: 400,
    body: {
      companyId,
      period: closingPeriod,
      summaryPayload: {
        periodRange: {
          start: "2026-05-01",
          end: "2026-05-31"
        },
        report: {
          period: "2026-05",
          filingReadinessRows: [
            { 점검: "법인 기본정보", 톤: "green" },
            { 점검: "자료 수집", 톤: "green" }
          ]
        }
      }
    }
  });
  assert.equal(mismatchedClosePayload.ok, false, "mismatched closing payload should fail");
  assert.equal(mismatchedClosePayload.code, "CLOSING_PERIOD_PAYLOAD_MISMATCH", "mismatched closing payload should return a period mismatch code");
  assert.ok(mismatchedClosePayload.issues?.length, "mismatched closing payload should report period mismatch issues");

  const closeSummaryPayload = {
    marker,
    taxReportId: reportPayload.taxReport.id,
    transactionCount: importedTransactions.length,
    journalEntryCount: approvedEntries.length,
    report: {
      reviewItems: reviewSnapshotRows,
      filingReadinessRows: [
        { 점검: "법인 기본정보", 톤: "green" },
        { 점검: "자료 수집", 톤: "green" },
        { 점검: "증빙", 톤: "green" },
        { 점검: "자동분개/원장", 톤: "green" }
      ]
    }
  };
  const closePayload = await requestJson<{ ok?: boolean; mode?: string; closingPeriod?: { period?: string } }>("/api/closing-periods", {
    method: "POST",
    body: {
      companyId,
      period: closingPeriod,
      summaryPayload: closeSummaryPayload
    }
  });
  cleanup.closingPeriods.push(closingPeriod);
  assert.equal(closePayload.ok, true, "closing period lock should be created");
  assert.equal(closePayload.mode, "database", "closing period lock should use database mode");
  assert.equal(closePayload.closingPeriod?.period, closingPeriod, "closing period lock should return the requested period");

  const duplicateClosePayload = await requestJson<{ ok?: boolean; code?: string; message?: string }>("/api/closing-periods", {
    method: "POST",
    expectedStatus: 409,
    body: {
      companyId,
      period: closingPeriod,
      summaryPayload: closeSummaryPayload
    }
  });
  assert.equal(duplicateClosePayload.ok, false, "duplicate closing period lock should fail");
  assert.equal(duplicateClosePayload.code, "PERIOD_ALREADY_CLOSED", "duplicate closing period lock should return PERIOD_ALREADY_CLOSED");

  const closingPeriods = await requestJson<{ closingPeriods?: Array<{ period: string; summaryPayload?: unknown }> }>("/api/closing-periods");
  const savedClosingPeriod = closingPeriods.closingPeriods?.find((period) => period.period === closingPeriod);
  assert.ok(savedClosingPeriod, "closing period snapshot should be listed");
  assertSnapshotReviewItemsContainMismatch(savedClosingPeriod?.summaryPayload, "closing period summary payload");

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

  const lockedReviewPatchPayload = await requestJson<{ ok?: boolean; code?: string; message?: string }>("/api/reviews", {
    method: "PATCH",
    expectedStatus: 409,
    body: {
      id: mismatchReviewId,
      status: "RESOLVED"
    }
  });
  assert.equal(lockedReviewPatchPayload.ok, false, "locked period review status update should fail");
  assert.equal(lockedReviewPatchPayload.code, "PERIOD_CLOSED", "locked period review status update should return PERIOD_CLOSED");

  const lockedLinkedJournalPayload = await requestJson<{ ok?: boolean; code?: string; message?: string }>("/api/journals", {
    method: "PATCH",
    expectedStatus: 409,
    body: {
      id: crossPeriodJournalId,
      status: "VOID"
    }
  });
  assert.equal(lockedLinkedJournalPayload.ok, false, "journal status change linked to a locked transaction period should fail");
  assert.equal(lockedLinkedJournalPayload.code, "PERIOD_CLOSED", "locked linked transaction journal status update should return PERIOD_CLOSED");

  const lockedReportDeletePayload = await requestJson<{ ok?: boolean; code?: string; message?: string }>("/api/reports", {
    method: "DELETE",
    expectedStatus: 409,
    body: { id: reportPayload.taxReport.id }
  });
  assert.equal(lockedReportDeletePayload.ok, false, "locked period report delete should fail");
  assert.equal(lockedReportDeletePayload.code, "PERIOD_CLOSED", "locked period report delete should return PERIOD_CLOSED");

  const lockedEvidenceDeletePayload = await requestJson<{ ok?: boolean; code?: string; message?: string }>("/api/evidences", {
    method: "DELETE",
    expectedStatus: 409,
    body: { id: evidencePayload.evidence.id }
  });
  assert.equal(lockedEvidenceDeletePayload.ok, false, "locked period evidence delete should fail");
  assert.equal(lockedEvidenceDeletePayload.code, "PERIOD_CLOSED", "locked period evidence delete should return PERIOD_CLOSED");

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

  const evidenceDeletePayload = await requestJson<{
    ok?: boolean;
    mode?: string;
    deletedEvidenceId?: string;
    transactionId?: string | null;
    evidenceStatus?: string | null;
  }>("/api/evidences", {
    method: "DELETE",
    body: { id: evidencePayload.evidence.id }
  });
  assert.equal(evidenceDeletePayload.ok, true, "evidence delete should succeed after reopening period");
  assert.equal(evidenceDeletePayload.mode, "database", "evidence delete should use database mode");
  assert.equal(evidenceDeletePayload.deletedEvidenceId, evidencePayload.evidence.id, "evidence delete should return deleted id");
  assert.equal(evidenceDeletePayload.transactionId, importedTransactions[0]?.id, "evidence delete should report linked transaction");
  assert.equal(evidenceDeletePayload.evidenceStatus, "UNCHECKED", "deleting the only linked evidence should restore unchecked status for deposit transactions");
  cleanup.evidenceIds = cleanup.evidenceIds.filter((id) => id !== evidencePayload.evidence?.id);

  const auditEvents = await requestJson<{ auditEvents?: Array<{ action: string; entityId?: string | null }> }>("/api/audit-events");
  const auditActions = new Set(auditEvents.auditEvents?.map((event) => event.action));
  assert.ok(auditActions.has("IMPORT_CREATE"), "audit log should include import creation");
  assert.ok(auditActions.has("EVIDENCE_CREATE"), "audit log should include evidence creation");
  assert.ok(auditActions.has("EVIDENCE_DELETE"), "audit log should include evidence deletion");
  assert.ok(auditActions.has("JOURNAL_CREATE"), "audit log should include journal creation");
  assert.ok(auditActions.has("REPORT_CREATE"), "audit log should include report creation");
  assert.ok(auditActions.has("PERIOD_CLOSE"), "audit log should include closing period lock");
  assert.ok(auditActions.has("PERIOD_REOPEN"), "audit log should include closing period reopen");

  console.log(`DB workflow verification passed at ${baseUrl}`);
} finally {
  await cleanupCreatedData();
}

async function importSample(companyId: string, sourceType: SourceType, filePath: string, rowCount: number, templateVariant: string) {
  const csv = readFileSync(resolve(filePath), "utf8");
  const parsed = Papa.parse<ParsedCsvRow>(csv, {
    header: true,
    skipEmptyLines: true
  });
  assert.deepEqual(parsed.errors, [], `${filePath} should parse without errors`);
  const sourceHeaders = parsed.meta.fields ?? [];
  const headerMap = new Map(sourceHeaders.map((header) => [header, `${header} ${marker}-${templateVariant}`]));
  const headers = sourceHeaders.map((header) => headerMap.get(header) ?? header);
  const mapping = inferMapping(headers, sourceType);
  assert.ok(mapping.transactionDate, `${sourceType} should infer transactionDate`);
  assert.ok(mapping.description, `${sourceType} should infer description`);
  const rows = parsed.data
    .slice(0, rowCount)
    .map((row) => remapRowHeaders(row, headerMap))
    .map((row, index) => uniqueRow(row, mapping.description, mapping.transactionDate, index));
  const originalFileText = Papa.unparse(rows, { columns: headers });
  const importBody = {
    companyId,
    sourceType,
    originalFileName: `${marker}-${sourceType}.csv`,
    originalFileText,
    originalFileMimeType: "text/csv",
    originalFileSize: Buffer.byteLength(originalFileText, "utf8"),
    mapping,
    headers,
    rows
  };
  type ImportSampleResponse = {
    ok?: boolean;
    mode?: string;
    duplicate?: boolean;
    importBatchId?: string;
    importBatch?: { hasOriginalFile?: boolean; originalFileName?: string };
    csvTemplate?: CsvTemplate;
    transactions?: AppTransaction[];
  };

  const payload = await requestJson<ImportSampleResponse>("/api/imports", {
    method: "POST",
    body: importBody
  });

  assert.equal(payload.ok, true, `${sourceType} import should succeed`);
  assert.equal(payload.mode, "database", `${sourceType} import should use database mode`);
  assert.equal(payload.duplicate, false, `${sourceType} import should create a fresh batch`);
  assert.ok(payload.importBatchId, `${sourceType} import should return an import batch id`);
  assert.equal(payload.importBatch?.hasOriginalFile, true, `${sourceType} import should preserve original CSV`);
  assert.equal(payload.csvTemplate?.sourceType, sourceType, `${sourceType} import should return saved CSV template`);
  assert.equal(payload.csvTemplate?.headerSignature, headers.join("|"), `${sourceType} template should track the imported header signature`);
  assert.deepEqual(payload.csvTemplate?.mapping, mapping, `${sourceType} template should preserve the submitted mapping`);
  assert.equal(payload.transactions?.length, rowCount, `${sourceType} import should return imported transactions`);

  const duplicatePayload = await requestJson<ImportSampleResponse>("/api/imports", {
    method: "POST",
    body: importBody
  });
  assert.equal(duplicatePayload.ok, true, `${sourceType} duplicate import should succeed`);
  assert.equal(duplicatePayload.mode, "database", `${sourceType} duplicate import should use database mode`);
  assert.equal(duplicatePayload.duplicate, true, `${sourceType} duplicate import should be flagged`);
  assert.equal(duplicatePayload.importBatchId, payload.importBatchId, `${sourceType} duplicate import should reuse the existing batch`);
  assert.equal(duplicatePayload.importBatch?.hasOriginalFile, true, `${sourceType} duplicate import should preserve the original CSV`);
  assert.equal(duplicatePayload.transactions?.length, rowCount, `${sourceType} duplicate import should return existing transactions`);

  const companyAfterImport = await requestJson<{ csvTemplates?: CsvTemplate[] }>("/api/companies");
  assert.ok(
    companyAfterImport.csvTemplates?.some((template) => isSameCsvTemplate(template, sourceType, headers, mapping)),
    `${sourceType} saved CSV template should be listed from company settings`
  );
  const originalFilePayload = await requestJson<{
    ok?: boolean;
    originalFileName?: string;
    originalFileText?: string;
  }>(`/api/imports?importBatchId=${payload.importBatchId}`);
  assert.equal(originalFilePayload.ok, true, `${sourceType} original CSV download should succeed`);
  assert.equal(originalFilePayload.originalFileName, `${marker}-${sourceType}.csv`, `${sourceType} original CSV filename`);
  assert.ok(originalFilePayload.originalFileText?.includes(headers[0] ?? ""), `${sourceType} original CSV should include header`);
  cleanup.importBatchIds.push(payload.importBatchId);
  if (payload.csvTemplate?.id && payload.csvTemplate.headerSignature?.includes(marker)) {
    cleanup.csvTemplateIds.push(payload.csvTemplate.id);
  }
  return payload.transactions ?? [];
}

function isSameCsvTemplate(template: CsvTemplate, sourceType: SourceType, headers: string[], mapping: CsvColumnMapping) {
  return template.sourceType === sourceType && template.headerSignature === headers.join("|") && JSON.stringify(template.mapping) === JSON.stringify(mapping);
}

function remapRowHeaders(row: ParsedCsvRow, headerMap: Map<string, string>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [headerMap.get(key) ?? key, value]));
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

function buildReviewSnapshotRows(items: ReviewItem[]) {
  return items.map((item) => ({
    심각도: item.severity,
    사유: item.reason,
    거래일: item.transaction?.transactionDate ?? "",
    적요: item.transaction?.description ?? "",
    거래처: item.transaction?.counterparty ?? "",
    금액: item.transaction?.withdrawalAmount || item.transaction?.depositAmount || 0
  }));
}

function assertSnapshotReviewItemsContainMismatch(payload: unknown, label: string) {
  const reviewItems = extractSnapshotReviewItems(payload);
  assert.ok(Array.isArray(reviewItems), `${label} should include reviewItems`);
  assert.ok(
    reviewItems.some((item) => isRecord(item) && typeof item.사유 === "string" && item.사유.includes(evidenceAmountMismatchReason)),
    `${label} should preserve evidence mismatch review rows`
  );
}

function extractSnapshotReviewItems(payload: unknown): unknown[] {
  if (!isRecord(payload)) return [];
  if (Array.isArray(payload.reviewItems)) return payload.reviewItems;
  const report = payload.report;
  if (isRecord(report) && Array.isArray(report.reviewItems)) return report.reviewItems;
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

  for (const evidenceId of cleanup.evidenceIds.reverse()) {
    await requestJson("/api/evidences", {
      method: "DELETE",
      body: { id: evidenceId },
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

  for (const csvTemplateId of cleanup.csvTemplateIds.reverse()) {
    await requestJson("/api/csv-templates", {
      method: "DELETE",
      body: { id: csvTemplateId },
      allowFailure: true
    });
  }

  for (const classificationRuleId of cleanup.classificationRuleIds.reverse()) {
    await requestJson("/api/classification-rules", {
      method: "DELETE",
      body: { id: classificationRuleId },
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
