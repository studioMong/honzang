import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Papa from "papaparse";
import { applyClassificationRules, applyVendorDefaults, generateJournalDraft, inferMapping, normalizeCsvRow, summarizeTransactions } from "../src/lib/accounting";
import { DEFAULT_ACCOUNTS } from "../src/lib/defaults";
import type { AppClassificationRule, AppTransaction, ParsedCsvRow, SourceType } from "../src/types";

type SampleCase = {
  sourceType: SourceType;
  filePath: string;
  expectedRows: number;
  expectedDeposit: number;
  expectedWithdrawal: number;
  expectedRevenue?: number;
  expectedVatOutput?: number;
  expectedFirstAccountCode?: string;
};

const sampleCases: SampleCase[] = [
  {
    sourceType: "BANK",
    filePath: "public/samples/bank-transactions.csv",
    expectedRows: 3,
    expectedDeposit: 4_100_000,
    expectedWithdrawal: 330_000
  },
  {
    sourceType: "CARD",
    filePath: "public/samples/card-transactions.csv",
    expectedRows: 2,
    expectedDeposit: 0,
    expectedWithdrawal: 152_000
  },
  {
    sourceType: "HOMETAX_SALES",
    filePath: "public/samples/hometax-sales.csv",
    expectedRows: 1,
    expectedDeposit: 1_100_000,
    expectedWithdrawal: 0,
    expectedRevenue: 1_000_000,
    expectedVatOutput: 100_000,
    expectedFirstAccountCode: "401"
  },
  {
    sourceType: "HOMETAX_PURCHASES",
    filePath: "public/samples/hometax-purchases.csv",
    expectedRows: 2,
    expectedDeposit: 0,
    expectedWithdrawal: 440_000
  },
  {
    sourceType: "CASH_RECEIPT",
    filePath: "public/samples/hometax-purchases.csv",
    expectedRows: 2,
    expectedDeposit: 0,
    expectedWithdrawal: 440_000
  },
  {
    sourceType: "PG",
    filePath: "public/samples/pg-settlements.csv",
    expectedRows: 1,
    expectedDeposit: 550_000,
    expectedWithdrawal: 0,
    expectedRevenue: 500_000,
    expectedVatOutput: 50_000,
    expectedFirstAccountCode: "401"
  }
];

function parseSampleCsv(filePath: string) {
  const csv = readFileSync(resolve(filePath), "utf8");
  const parsed = Papa.parse<ParsedCsvRow>(csv, {
    header: true,
    skipEmptyLines: true
  });

  assert.deepEqual(parsed.errors, [], `${filePath} should parse without CSV errors`);
  assert.ok(parsed.meta.fields?.length, `${filePath} should expose CSV headers`);

  return {
    headers: parsed.meta.fields ?? [],
    rows: parsed.data
  };
}

function requireMapping(caseItem: SampleCase, headers: string[]) {
  const mapping = inferMapping(headers, caseItem.sourceType);

  assert.ok(mapping.transactionDate, `${caseItem.sourceType} should infer transactionDate`);
  assert.ok(mapping.description, `${caseItem.sourceType} should infer description`);
  if (caseItem.sourceType === "BANK") {
    assert.ok(mapping.depositAmount, "BANK should infer depositAmount");
    assert.ok(mapping.withdrawalAmount, "BANK should infer withdrawalAmount");
  } else {
    assert.ok(mapping.amount, `${caseItem.sourceType} should infer amount`);
  }

  return mapping;
}

for (const caseItem of sampleCases) {
  const { headers, rows } = parseSampleCsv(caseItem.filePath);
  const mapping = requireMapping(caseItem, headers);
  const transactions: AppTransaction[] = rows.map((row, index) => ({
    id: `${caseItem.sourceType}-${index}`,
    ...normalizeCsvRow(row, mapping, caseItem.sourceType, index)
  }));
  const depositTotal = transactions.reduce((sum, transaction) => sum + transaction.depositAmount, 0);
  const withdrawalTotal = transactions.reduce((sum, transaction) => sum + transaction.withdrawalAmount, 0);
  const summary = summarizeTransactions(transactions);

  assert.equal(transactions.length, caseItem.expectedRows, `${caseItem.sourceType} row count`);
  assert.equal(depositTotal, caseItem.expectedDeposit, `${caseItem.sourceType} deposit total`);
  assert.equal(withdrawalTotal, caseItem.expectedWithdrawal, `${caseItem.sourceType} withdrawal total`);

  if (caseItem.expectedRevenue !== undefined) {
    assert.equal(summary.revenue, caseItem.expectedRevenue, `${caseItem.sourceType} revenue`);
  }
  if (caseItem.expectedVatOutput !== undefined) {
    assert.equal(summary.vatOutput, caseItem.expectedVatOutput, `${caseItem.sourceType} output VAT`);
  }
  if (caseItem.expectedFirstAccountCode) {
    assert.equal(transactions[0]?.suggestedAccount?.code, caseItem.expectedFirstAccountCode, `${caseItem.sourceType} first account`);
  }
  if (caseItem.sourceType === "BANK") {
    const ownerTransaction = transactions.find((transaction) => transaction.description.includes("대표자"));
    assert.equal(ownerTransaction?.suggestedAccount?.code, "281", "owner deposit should be classified as owner loan");
  }

  console.log(`Verified ${caseItem.sourceType} ${caseItem.filePath} (${transactions.length} rows)`);
}

const cardSample = sampleCases.find((caseItem) => caseItem.sourceType === "CARD");
assert.ok(cardSample, "CARD sample case should exist");
const { headers: cardHeaders, rows: cardRows } = parseSampleCsv(cardSample.filePath);
const cardMapping = requireMapping(cardSample, cardHeaders);
const openAiRow = cardRows.find((row) => String(row["가맹점"] ?? "").toLowerCase().includes("openai"));
assert.ok(openAiRow, "CARD sample should include OpenAI row");

const customRules: AppClassificationRule[] = [
  {
    id: "rule-openai-education",
    name: "OpenAI 교육비",
    keyword: "openai",
    accountCode: "508",
    accountName: "소모품비",
    sourceType: "CARD",
    priority: 1,
    isActive: true
  }
];
const classified = applyClassificationRules(
  applyVendorDefaults(
    {
    id: "card-openai-rule",
    ...normalizeCsvRow(openAiRow, cardMapping, "CARD", 0)
    },
    [
      {
        id: "vendor-openai",
        name: "OpenAI",
        defaultAccount: DEFAULT_ACCOUNTS.find((account) => account.code === "506") ?? null,
        withholdingType: "NONE"
      }
    ]
  ),
  customRules,
  DEFAULT_ACCOUNTS
);

assert.equal(classified.suggestedAccount?.code, "508", "custom classification rule should override default account");
assert.ok(classified.reviewReasons?.some((reason) => reason.includes("거래처 기본 계정 적용")), "vendor default reason should be recorded");
assert.ok(classified.reviewReasons?.some((reason) => reason.includes("OpenAI 교육비")), "custom classification rule reason should be recorded");
console.log("Verified custom classification rule override.");

const contractorAccount = DEFAULT_ACCOUNTS.find((account) => account.code === "502");
assert.ok(contractorAccount, "contractor account should exist");

const contractorBase: AppTransaction = {
  id: "contractor-journal-check",
  sourceType: "BANK",
  transactionDate: "2026-06-12",
  description: "프리랜서 디자인 외주비",
  counterparty: "김디자인",
  direction: "WITHDRAWAL",
  depositAmount: 0,
  withdrawalAmount: 330_000,
  suggestedAccount: contractorAccount,
  confirmedAccount: contractorAccount,
  evidenceStatus: "UNCHECKED",
  reviewReasons: ["외주비는 원천세 또는 세금계산서 수취 여부 확인이 필요합니다."]
};

const grossContractorDraft = generateJournalDraft(contractorBase);
assertBalancedDraft(grossContractorDraft, "contractor gross expense draft");
assert.equal(grossContractorDraft.lines.find((line) => line.accountCode === "502")?.debitAmount, 330_000, "contractor expense without VAT breakdown should use gross expense");
assert.equal(grossContractorDraft.lines.some((line) => line.accountCode === "135"), false, "contractor expense without VAT breakdown should not create input VAT");

const taxInvoiceContractorDraft = generateJournalDraft({
  ...contractorBase,
  id: "contractor-tax-invoice-journal-check",
  supplyAmount: 300_000,
  vatAmount: 30_000,
  evidenceStatus: "MATCHED"
});
assertBalancedDraft(taxInvoiceContractorDraft, "contractor tax invoice draft");
assert.equal(taxInvoiceContractorDraft.lines.find((line) => line.accountCode === "502")?.debitAmount, 300_000, "contractor tax invoice should use supply amount");
assert.equal(taxInvoiceContractorDraft.lines.find((line) => line.accountCode === "135")?.debitAmount, 30_000, "contractor tax invoice should create input VAT");
console.log("Verified contractor journal draft VAT handling.");

console.log("Sample CSV verification passed.");

function assertBalancedDraft(draft: ReturnType<typeof generateJournalDraft>, label: string) {
  const debit = draft.lines.reduce((sum, line) => sum + line.debitAmount, 0);
  const credit = draft.lines.reduce((sum, line) => sum + line.creditAmount, 0);
  assert.equal(Math.round(debit), Math.round(credit), `${label} should be balanced`);
}
