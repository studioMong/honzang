import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Papa from "papaparse";
import { generateJournalDraft, inferMapping, summarizeTransactions } from "../src/lib/accounting";
import { buildDataSourceRows } from "../src/lib/data-sources";
import { DEFAULT_COMPANY_ID, SOURCE_TYPE_LABELS } from "../src/lib/defaults";
import { moneyToMinorUnits } from "../src/lib/money";
import type {
  AppAccount,
  AppEvidence,
  AppClassificationRule,
  AppImportBatch,
  AppJournalEntry,
  AppTransaction,
  AppVendor,
  CsvColumnMapping,
  CsvTemplate,
  ParsedCsvRow,
  ReviewItem,
  SourceType
} from "../src/types";

const evidenceAmountMismatchReason = "연결 증빙 합계가 거래금액과 일치하지 않습니다.";
const taxableSalesInputLabel = "과세 매출 공급가액";
const filingInputSummaryRows = [
  {
    신고: "부가세",
    "입력 항목": taxableSalesInputLabel,
    값: "1,100원",
    근거: "과세 매출 거래 공급가액 합계",
    상태: "집계됨",
    톤: "green",
    "최종 확인": "홈택스 매출 세금계산서와 통장 입금 대조"
  },
  {
    신고: "법인세",
    "입력 항목": "승인 분개/원장",
    값: "2개 / 4행",
    근거: "승인된 자동분개와 계정별 원장 행 수",
    상태: "원장 있음",
    톤: "green",
    "최종 확인": "차변/대변과 계정별 원장 대조"
  }
];

const baseUrl = (process.env.VERIFY_DB_WORKFLOW_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const marker = `verify-db-workflow-${Date.now()}`;
const cleanup = {
  importBatchIds: [] as string[],
  csvTemplateIds: [] as string[],
  transactionIds: [] as string[],
  evidenceIds: [] as string[],
  journalEntryIds: [] as string[],
  taxReportIds: [] as string[],
  closingPeriods: [] as string[],
  classificationRuleIds: [] as string[],
  vendorIds: [] as string[]
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

  const bankImport = await importSample(companyId, "BANK", "public/samples/bank-transactions.csv", 1, "primary");
  const alternateBankImport = await importSample(companyId, "BANK", "public/samples/bank-transactions.csv", 1, "alternate");
  const cardImport = await importSample(companyId, "CARD", "public/samples/card-transactions.csv", 1, "primary");
  const bankTransactions = bankImport.transactions;
  const alternateBankTransactions = alternateBankImport.transactions;
  const importedTransactions = [...bankTransactions, ...cardImport.transactions];
  assert.equal(importedTransactions.length, 2, "workflow should import two sample transactions");
  const companyAfterTemplateVariants = await requestJson<{ csvTemplates?: CsvTemplate[] }>("/api/companies");
  const verifiedBankTemplateCount =
    companyAfterTemplateVariants.csvTemplates?.filter((template) => template.sourceType === "BANK" && template.headerSignature?.includes(marker)).length ?? 0;
  assert.ok(verifiedBankTemplateCount >= 2, "BANK imports with different header signatures should preserve multiple CSV templates");
  const importBatchListPayload = await requestJson<{ mode?: string; importBatches?: AppImportBatch[] }>("/api/imports");
  assert.equal(importBatchListPayload.mode, "database", "import batch list should use database mode");
  const workflowImportBatchIds = new Set(cleanup.importBatchIds);
  const workflowImportBatches = importBatchListPayload.importBatches?.filter((batch) => workflowImportBatchIds.has(batch.id)) ?? [];
  assert.equal(workflowImportBatches.length, cleanup.importBatchIds.length, "workflow import batches should be listed after import");
  const dataSourceRows = buildDataSourceRows([...alternateBankTransactions, ...importedTransactions], workflowImportBatches);
  const bankSourceRow = dataSourceRows.find((row) => row.자료 === SOURCE_TYPE_LABELS.BANK);
  assert.equal(bankSourceRow?.상태, "반영됨", "BANK source status should be reflected");
  assert.equal(bankSourceRow?.거래, "2건", "BANK source status should count imported transactions");
  assert.equal(bankSourceRow?.업로드, "2개 업로드", "BANK source status should count import batches");
  assert.equal(bankSourceRow?.원본, "원본 CSV 2/2개", "BANK source status should count preserved original CSV files");
  const cardSourceRow = dataSourceRows.find((row) => row.자료 === SOURCE_TYPE_LABELS.CARD);
  assert.equal(cardSourceRow?.상태, "반영됨", "CARD source status should be reflected");
  assert.equal(cardSourceRow?.거래, "1건", "CARD source status should count imported transactions");
  assert.equal(cardSourceRow?.업로드, "1개 업로드", "CARD source status should count import batches");
  assert.equal(cardSourceRow?.원본, "원본 CSV 1/1개", "CARD source status should count preserved original CSV files");
  const salesSourceRow = dataSourceRows.find((row) => row.자료 === SOURCE_TYPE_LABELS.HOMETAX_SALES);
  assert.equal(salesSourceRow?.상태, "확인 필요", "missing sales source should still require upload");
  assert.equal(salesSourceRow?.업로드, "업로드 이력 없음", "missing sales source should report no upload history");
  assert.equal(salesSourceRow?.원본, "원본 CSV 없음", "missing sales source should report no original CSV");
  const pgSourceRow = dataSourceRows.find((row) => row.자료 === SOURCE_TYPE_LABELS.PG);
  assert.equal(pgSourceRow?.상태, "선택", "optional PG source should remain optional when absent");

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

  const vendorPayload = await requestJson<{ ok?: boolean; mode?: string; vendor?: AppVendor }>("/api/vendors", {
    method: "POST",
    body: {
      companyId,
      name: `${marker} vendor`,
      businessRegistrationNumber: `${Date.now()}`.slice(0, 10),
      defaultAccountId: verificationAccount.id,
      withholdingType: "BUSINESS_INCOME",
      memo: `${marker} vendor memo`
    }
  });
  assert.equal(vendorPayload.ok, true, "vendor create should succeed");
  assert.equal(vendorPayload.mode, "database", "vendor create should use database mode");
  assert.ok(vendorPayload.vendor?.id, "vendor create should return an id");
  assert.equal(vendorPayload.vendor?.defaultAccount?.id, verificationAccount.id, "vendor create should preserve default account");
  cleanup.vendorIds.push(vendorPayload.vendor.id);

  const updatedVendorPayload = await requestJson<{ ok?: boolean; mode?: string; vendor?: AppVendor }>("/api/vendors", {
    method: "PATCH",
    body: {
      companyId,
      id: vendorPayload.vendor.id,
      name: `${marker} vendor updated`,
      defaultAccountId: alternateVerificationAccountId,
      withholdingType: "OTHER_INCOME"
    }
  });
  assert.equal(updatedVendorPayload.ok, true, "vendor patch should succeed");
  assert.equal(updatedVendorPayload.mode, "database", "vendor patch should use database mode");
  assert.equal(updatedVendorPayload.vendor?.name, `${marker} vendor updated`, "vendor patch should update name");
  assert.equal(updatedVendorPayload.vendor?.defaultAccount?.id, alternateVerificationAccountId, "vendor patch should update default account");

  const missingVendorDeletePayload = await requestJson<{ ok?: boolean; message?: string }>("/api/vendors", {
    method: "DELETE",
    expectedStatus: 404,
    body: {
      companyId,
      id: `${marker}-missing-vendor`
    }
  });
  assert.equal(missingVendorDeletePayload.ok, false, "missing vendor delete should fail");
  assert.match(missingVendorDeletePayload.message ?? "", /거래처/, "missing vendor delete should report a missing vendor");

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

  const manualTaxTransactionPayload = await requestJson<{ ok?: boolean; mode?: string; transaction?: AppTransaction }>("/api/transactions", {
    method: "POST",
    body: {
      transactionDate: "2026-06-17",
      description: `${marker} 수기 매출 세액 검증`,
      counterparty: `${marker} 고객`,
      depositAmount: 1100.25,
      withdrawalAmount: 0,
      supplyAmount: 1000.2,
      vatAmount: 100.05,
      evidenceStatus: "NOT_REQUIRED"
    }
  });
  assert.equal(manualTaxTransactionPayload.ok, true, "manual taxable transaction create should succeed");
  assert.equal(manualTaxTransactionPayload.mode, "database", "manual taxable transaction create should use database mode");
  const manualTaxTransaction = manualTaxTransactionPayload.transaction;
  assert.ok(manualTaxTransaction?.id, "manual taxable transaction should return an id");
  cleanup.transactionIds.push(manualTaxTransaction.id);
  assert.equal(manualTaxTransaction.supplyAmount, 1000.2, "manual taxable transaction should preserve supply amount");
  assert.equal(manualTaxTransaction.vatAmount, 100.05, "manual taxable transaction should preserve VAT amount");
  assert.equal(manualTaxTransaction.suggestedAccount?.code, "401", "manual taxable revenue should infer revenue account");

  const manualTaxUpdatePayload = await requestJson<{ ok?: boolean; mode?: string; transaction?: AppTransaction }>("/api/transactions", {
    method: "PATCH",
    body: {
      id: manualTaxTransaction.id,
      transactionDate: "2026-06-17",
      description: `${marker} 수기 매출 세액 검증 수정`,
      counterparty: `${marker} 수정 고객`,
      depositAmount: 2200.5,
      withdrawalAmount: 0,
      supplyAmount: 2000.4,
      vatAmount: 200.1,
      evidenceStatus: "NOT_REQUIRED",
      memo: `${marker} 수기 수정 메모`
    }
  });
  assert.equal(manualTaxUpdatePayload.ok, true, "manual taxable transaction update should succeed");
  assert.equal(manualTaxUpdatePayload.mode, "database", "manual taxable transaction update should use database mode");
  const updatedManualTaxTransaction = manualTaxUpdatePayload.transaction;
  assert.ok(updatedManualTaxTransaction?.id, "manual taxable transaction update should return a transaction");
  assert.equal(updatedManualTaxTransaction.id, manualTaxTransaction.id, "manual taxable transaction update should keep the transaction id");
  assert.equal(updatedManualTaxTransaction.description, `${marker} 수기 매출 세액 검증 수정`, "manual taxable transaction update should preserve description");
  assert.equal(updatedManualTaxTransaction.depositAmount, 2200.5, "manual taxable transaction update should preserve deposit amount");
  assert.equal(updatedManualTaxTransaction.supplyAmount, 2000.4, "manual taxable transaction update should preserve supply amount");
  assert.equal(updatedManualTaxTransaction.vatAmount, 200.1, "manual taxable transaction update should preserve VAT amount");
  assert.equal(updatedManualTaxTransaction.memo, `${marker} 수기 수정 메모`, "manual taxable transaction update should preserve memo");
  assert.equal(updatedManualTaxTransaction.suggestedAccount?.code, "401", "manual taxable transaction update should keep revenue inference");

  const importedTransactionSourcePatchPayload = await requestJson<{ ok?: boolean; code?: string; message?: string }>("/api/transactions", {
    method: "PATCH",
    expectedStatus: 409,
    body: {
      id: importedTransactions[0]?.id,
      description: `${marker} imported source patch should fail`
    }
  });
  assert.equal(importedTransactionSourcePatchPayload.ok, false, "CSV imported transaction source patch should fail");
  assert.equal(importedTransactionSourcePatchPayload.code, "NON_MANUAL_TRANSACTION_PATCH_BLOCKED", "CSV imported transaction source patch should return a source guard code");

  const manualTaxDraft = generateJournalDraft(updatedManualTaxTransaction);
  assert.ok(isBalanced(manualTaxDraft), "manual taxable transaction journal draft should be balanced");
  assert.equal(manualTaxDraft.lines.find((line) => line.accountCode === "401")?.creditAmount, 2000.4, "manual taxable draft should credit updated supply amount as revenue");
  assert.equal(manualTaxDraft.lines.find((line) => line.accountCode === "255")?.creditAmount, 200.1, "manual taxable draft should credit updated VAT payable");
  const manualTaxJournalPayload = await requestJson<{ ok?: boolean; mode?: string; journalEntry?: AppJournalEntry }>("/api/journals", {
    method: "POST",
    body: {
      companyId,
      transactionId: manualTaxDraft.transactionId,
      entryDate: manualTaxDraft.entryDate,
      memo: manualTaxDraft.memo,
      status: "DRAFT",
      lines: manualTaxDraft.lines
    }
  });
  assert.equal(manualTaxJournalPayload.ok, true, "manual taxable draft journal should be saved");
  const manualTaxJournalId = manualTaxJournalPayload.journalEntry?.id;
  assert.ok(manualTaxJournalId, "manual taxable draft journal should return an id");
  cleanup.journalEntryIds.push(manualTaxJournalId);

  const importedTransactionDeletePayload = await requestJson<{ ok?: boolean; code?: string; message?: string }>("/api/transactions", {
    method: "DELETE",
    expectedStatus: 409,
    body: { id: importedTransactions[0]?.id }
  });
  assert.equal(importedTransactionDeletePayload.ok, false, "CSV imported transaction direct delete should fail");
  assert.equal(importedTransactionDeletePayload.code, "NON_MANUAL_TRANSACTION_DELETE_BLOCKED", "CSV imported transaction delete should point users to batch deletion");

  const manualTaxDeletePayload = await requestJson<{
    ok?: boolean;
    mode?: string;
    deletedTransactionId?: string;
    deletedJournalEntryCount?: number;
  }>("/api/transactions", {
    method: "DELETE",
    body: { id: updatedManualTaxTransaction.id }
  });
  assert.equal(manualTaxDeletePayload.ok, true, "manual taxable transaction delete should succeed");
  assert.equal(manualTaxDeletePayload.mode, "database", "manual taxable transaction delete should use database mode");
  assert.equal(manualTaxDeletePayload.deletedTransactionId, updatedManualTaxTransaction.id, "manual taxable transaction delete should return the deleted id");
  assert.equal(manualTaxDeletePayload.deletedJournalEntryCount, 1, "manual taxable transaction delete should remove draft journals");
  cleanup.transactionIds = cleanup.transactionIds.filter((transactionId) => transactionId !== updatedManualTaxTransaction.id);
  cleanup.journalEntryIds = cleanup.journalEntryIds.filter((journalEntryId) => journalEntryId !== manualTaxJournalId);

  const transactionsAfterManualDelete = await requestJson<{ transactions?: AppTransaction[] }>("/api/transactions");
  assert.equal(
    transactionsAfterManualDelete.transactions?.some((transaction) => transaction.id === updatedManualTaxTransaction.id),
    false,
    "manual taxable transaction should be absent after delete"
  );
  const journalsAfterManualDelete = await requestJson<{ journalEntries?: AppJournalEntry[] }>("/api/journals");
  assert.equal(
    journalsAfterManualDelete.journalEntries?.some((entry) => entry.id === manualTaxJournalId),
    false,
    "manual taxable draft journal should be absent after transaction delete"
  );

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

  const updatedEvidenceTransaction = importedTransactions[1];
  assert.ok(updatedEvidenceTransaction?.id, "workflow should include a second transaction for evidence patch verification");
  const evidencePatchPayload = await requestJson<{
    ok?: boolean;
    mode?: string;
    evidence?: AppEvidence;
    transactionUpdates?: Array<{ transactionId: string; evidenceStatus: string }>;
  }>("/api/evidences", {
    method: "PATCH",
    body: {
      id: evidencePayload.evidence.id,
      evidenceType: "검증 세금계산서 수정",
      issueDate: "2026-06-17",
      counterparty: `${marker} 수정 증빙`,
      businessRegistrationNumber: "123-45-67890",
      supplyAmount: 100000,
      vatAmount: 10000,
      totalAmount: 110000,
      transactionId: updatedEvidenceTransaction.id
    }
  });
  assert.equal(evidencePatchPayload.ok, true, "evidence patch should succeed");
  assert.equal(evidencePatchPayload.mode, "database", "evidence patch should use database mode");
  assert.equal(evidencePatchPayload.evidence?.id, evidencePayload.evidence.id, "evidence patch should keep the evidence id");
  assert.equal(evidencePatchPayload.evidence?.evidenceType, "검증 세금계산서 수정", "evidence patch should update evidence type");
  assert.equal(evidencePatchPayload.evidence?.counterparty, `${marker} 수정 증빙`, "evidence patch should update counterparty");
  assert.equal(evidencePatchPayload.evidence?.businessRegistrationNumber, "123-45-67890", "evidence patch should update business registration number");
  assert.equal(evidencePatchPayload.evidence?.supplyAmount, 100000, "evidence patch should update supply amount");
  assert.equal(evidencePatchPayload.evidence?.vatAmount, 10000, "evidence patch should update VAT amount");
  assert.equal(evidencePatchPayload.evidence?.totalAmount, 110000, "evidence patch should update total amount");
  assert.equal(evidencePatchPayload.evidence?.transactionId, updatedEvidenceTransaction.id, "evidence patch should relink to the selected transaction");
  assert.ok(
    evidencePatchPayload.transactionUpdates?.some((update) => update.transactionId === importedTransactions[0]?.id && update.evidenceStatus === "UNCHECKED"),
    "evidence patch should restore the previous linked transaction evidence status"
  );
  assert.ok(
    evidencePatchPayload.transactionUpdates?.some((update) => update.transactionId === updatedEvidenceTransaction.id && update.evidenceStatus === "MATCHED"),
    "evidence patch should update the newly linked transaction evidence status"
  );
  const transactionsAfterEvidencePatch = await requestJson<{ transactions?: AppTransaction[] }>("/api/transactions");
  const previousEvidenceTransaction = transactionsAfterEvidencePatch.transactions?.find((transaction) => transaction.id === importedTransactions[0]?.id);
  const patchedEvidenceTransaction = transactionsAfterEvidencePatch.transactions?.find((transaction) => transaction.id === updatedEvidenceTransaction.id);
  assert.equal(previousEvidenceTransaction?.evidenceStatus, "UNCHECKED", "evidence patch should persist the previous linked transaction status");
  assert.equal(patchedEvidenceTransaction?.evidenceStatus, "MATCHED", "evidence patch should persist the newly linked transaction status");

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
        filingInputSummaryRows,
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
  assertSnapshotInputSummaryRowsContainTaxableSales(savedReport?.calculatedPayload, "saved report payload");

  const yearReportPayload = await requestJson<{ ok?: boolean; mode?: string; taxReport?: { id?: string } }>("/api/reports", {
    method: "POST",
    body: {
      companyId,
      reportType: "CORPORATE_TAX_PREP",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      calculatedPayload: {
        marker,
        period: {
          start: "2026-01-01",
          end: "2026-12-31"
        },
        scope: "year-range-lock-verification"
      }
    }
  });
  assert.equal(yearReportPayload.ok, true, "cross-month tax report snapshot should be saved before closing");
  assert.equal(yearReportPayload.mode, "database", "cross-month tax report snapshot should use database mode");
  assert.ok(yearReportPayload.taxReport?.id, "cross-month tax report snapshot should return an id");
  cleanup.taxReportIds.push(yearReportPayload.taxReport.id);

  const lockedManualTransactionPayload = await requestJson<{ ok?: boolean; mode?: string; transaction?: AppTransaction }>("/api/transactions", {
    method: "POST",
    body: {
      transactionDate: "2026-06-18",
      description: `${marker} locked manual delete guard`,
      counterparty: "잠금 삭제 검증",
      depositAmount: 1200,
      withdrawalAmount: 0,
      supplyAmount: 1000,
      vatAmount: 200,
      evidenceStatus: "NOT_REQUIRED"
    }
  });
  assert.equal(lockedManualTransactionPayload.ok, true, "manual transaction for locked delete verification should be created before closing");
  const lockedManualTransactionId = lockedManualTransactionPayload.transaction?.id;
  assert.ok(lockedManualTransactionId, "manual transaction for locked delete verification should return an id");
  cleanup.transactionIds.push(lockedManualTransactionId);

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
      filingInputSummaryRows,
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
  assertSnapshotInputSummaryRowsContainTaxableSales(savedClosingPeriod?.summaryPayload, "closing period summary payload");

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

  const lockedTransactionPatchPayload = await requestJson<{ ok?: boolean; code?: string; message?: string }>("/api/transactions", {
    method: "PATCH",
    expectedStatus: 409,
    body: {
      id: lockedManualTransactionId,
      description: `${marker} locked manual patch should fail`
    }
  });
  assert.equal(lockedTransactionPatchPayload.ok, false, "locked period transaction patch should fail");
  assert.equal(lockedTransactionPatchPayload.code, "PERIOD_CLOSED", "locked period transaction patch should return PERIOD_CLOSED");

  const lockedTransactionDeletePayload = await requestJson<{ ok?: boolean; code?: string; message?: string }>("/api/transactions", {
    method: "DELETE",
    expectedStatus: 409,
    body: { id: lockedManualTransactionId }
  });
  assert.equal(lockedTransactionDeletePayload.ok, false, "locked period transaction delete should fail");
  assert.equal(lockedTransactionDeletePayload.code, "PERIOD_CLOSED", "locked period transaction delete should return PERIOD_CLOSED");

  const lockedImportCreatePayload = await requestJson<{ ok?: boolean; code?: string; message?: string }>("/api/imports", {
    method: "POST",
    expectedStatus: 409,
    body: bankImport.importBody
  });
  assert.equal(lockedImportCreatePayload.ok, false, "locked period import create should fail");
  assert.equal(lockedImportCreatePayload.code, "PERIOD_CLOSED", "locked period import create should return PERIOD_CLOSED");

  const lockedImportDeletePayload = await requestJson<{ ok?: boolean; code?: string; message?: string }>("/api/imports", {
    method: "DELETE",
    expectedStatus: 409,
    body: { importBatchId: bankImport.importBatchId }
  });
  assert.equal(lockedImportDeletePayload.ok, false, "locked period import delete should fail");
  assert.equal(lockedImportDeletePayload.code, "PERIOD_CLOSED", "locked period import delete should return PERIOD_CLOSED");

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

  const lockedRangeReportDeletePayload = await requestJson<{ ok?: boolean; code?: string; message?: string }>("/api/reports", {
    method: "DELETE",
    expectedStatus: 409,
    body: { id: yearReportPayload.taxReport.id }
  });
  assert.equal(lockedRangeReportDeletePayload.ok, false, "report delete spanning a locked period should fail");
  assert.equal(lockedRangeReportDeletePayload.code, "PERIOD_CLOSED", "report delete spanning a locked period should return PERIOD_CLOSED");

  const lockedRangeReportCreatePayload = await requestJson<{ ok?: boolean; code?: string; message?: string }>("/api/reports", {
    method: "POST",
    expectedStatus: 409,
    body: {
      companyId,
      reportType: "CORPORATE_TAX_PREP",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      calculatedPayload: {
        marker,
        period: {
          start: "2026-01-01",
          end: "2026-12-31"
        },
        scope: "locked-year-range-create-verification"
      }
    }
  });
  assert.equal(lockedRangeReportCreatePayload.ok, false, "report create spanning a locked period should fail");
  assert.equal(lockedRangeReportCreatePayload.code, "PERIOD_CLOSED", "report create spanning a locked period should return PERIOD_CLOSED");

  const lockedEvidencePatchPayload = await requestJson<{ ok?: boolean; code?: string; message?: string }>("/api/evidences", {
    method: "PATCH",
    expectedStatus: 409,
    body: {
      id: evidencePayload.evidence.id,
      counterparty: `${marker} locked evidence patch should fail`
    }
  });
  assert.equal(lockedEvidencePatchPayload.ok, false, "locked period evidence patch should fail");
  assert.equal(lockedEvidencePatchPayload.code, "PERIOD_CLOSED", "locked period evidence patch should return PERIOD_CLOSED");

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
  assert.equal(evidenceDeletePayload.transactionId, updatedEvidenceTransaction.id, "evidence delete should report linked transaction");
  assert.equal(evidenceDeletePayload.evidenceStatus, "MISSING", "deleting the only linked evidence should restore missing status for expense transactions");
  cleanup.evidenceIds = cleanup.evidenceIds.filter((id) => id !== evidencePayload.evidence?.id);

  const auditEvents = await requestJson<{ auditEvents?: Array<{ action: string; entityId?: string | null }> }>("/api/audit-events");
  const auditActions = new Set(auditEvents.auditEvents?.map((event) => event.action));
  assert.ok(auditActions.has("IMPORT_CREATE"), "audit log should include import creation");
  assert.ok(auditActions.has("TRANSACTION_CREATE"), "audit log should include manual transaction creation");
  assert.ok(auditActions.has("TRANSACTION_UPDATE"), "audit log should include manual transaction update");
  assert.ok(auditActions.has("TRANSACTION_DELETE"), "audit log should include manual transaction deletion");
  assert.ok(auditActions.has("EVIDENCE_CREATE"), "audit log should include evidence creation");
  assert.ok(auditActions.has("EVIDENCE_UPDATE"), "audit log should include evidence update");
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
  assert.ok(payload.importBatchId, `${sourceType} import should expose an import batch id for cleanup and lock verification`);
  return {
    importBatchId: payload.importBatchId,
    importBody,
    transactions: payload.transactions ?? []
  };
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
  const debit = draft.lines.reduce((sum, line) => sum + moneyToMinorUnits(line.debitAmount), 0);
  const credit = draft.lines.reduce((sum, line) => sum + moneyToMinorUnits(line.creditAmount), 0);
  return draft.lines.length > 0 && debit === credit;
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

function assertSnapshotInputSummaryRowsContainTaxableSales(payload: unknown, label: string) {
  const inputSummaryRows = extractSnapshotFilingInputSummaryRows(payload);
  assert.ok(Array.isArray(inputSummaryRows), `${label} should include filingInputSummaryRows`);
  assert.ok(
    inputSummaryRows.some((item) => isRecord(item) && item["입력 항목"] === taxableSalesInputLabel && item.상태 === "집계됨"),
    `${label} should preserve filing input summary rows`
  );
}

function extractSnapshotReviewItems(payload: unknown): unknown[] {
  if (!isRecord(payload)) return [];
  if (Array.isArray(payload.reviewItems)) return payload.reviewItems;
  const report = payload.report;
  if (isRecord(report) && Array.isArray(report.reviewItems)) return report.reviewItems;
  return [];
}

function extractSnapshotFilingInputSummaryRows(payload: unknown): unknown[] {
  if (!isRecord(payload)) return [];
  if (Array.isArray(payload.filingInputSummaryRows)) return payload.filingInputSummaryRows;
  const report = payload.report;
  if (isRecord(report) && Array.isArray(report.filingInputSummaryRows)) return report.filingInputSummaryRows;
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

  for (const transactionId of cleanup.transactionIds.reverse()) {
    await requestJson("/api/transactions", {
      method: "DELETE",
      body: { id: transactionId },
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

  for (const vendorId of cleanup.vendorIds.reverse()) {
    await requestJson("/api/vendors", {
      method: "DELETE",
      body: { id: vendorId },
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
