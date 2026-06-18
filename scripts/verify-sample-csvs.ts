import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Papa from "papaparse";
import {
  applyClassificationRules,
  applyVendorDefaults,
  generateJournalDraft,
  inferMapping,
  isValidMoneyValue,
  normalizeCsvRow,
  parseDate,
  parseMoney,
  parseOptionalMoney,
  parseOptionalSignedMoney,
  parseSignedMoney,
  summarizeTransactions
} from "../src/lib/accounting";
import { DEFAULT_ACCOUNTS } from "../src/lib/defaults";
import { sanitizeCsvCellValue } from "../src/lib/export-safety";
import { moneyToMinorUnits } from "../src/lib/money";
import { parseStrictDate } from "../src/lib/server/date-validation";
import { normalizeZipPath } from "../src/lib/zip";
import { buildEvidenceAmountReviewItems, resolveTransactionEvidenceStatus, type EvidenceAmountReviewTransaction } from "../src/lib/server/evidence-amount-reviews";
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
    filePath: "public/samples/cash-receipts.csv",
    expectedRows: 2,
    expectedDeposit: 0,
    expectedWithdrawal: 69_500
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

assert.equal(parseMoney("(1,234원)"), 1_234, "parenthesized money should parse as an absolute amount");
assert.equal(parseMoney("1,234-"), 1_234, "trailing negative money should parse as an absolute amount");
assert.equal(parseMoney("-1,234"), 1_234, "leading negative money should parse as an absolute amount");
assert.equal(parseSignedMoney("(1,234원)"), -1_234, "parenthesized signed money should preserve negative amounts");
assert.equal(parseSignedMoney("1,234-"), -1_234, "trailing negative signed money should preserve negative amounts");
assert.equal(parseSignedMoney("-1,234.56"), -1_234.56, "leading negative signed money should preserve decimal negative amounts");
assert.equal(parseSignedMoney("1,234.56"), 1_234.56, "signed money should preserve positive decimal amounts");
assert.equal(parseOptionalMoney(""), null, "optional blank money should remain null");
assert.equal(parseOptionalMoney("숫자아님"), null, "optional invalid money should remain null");
assert.equal(parseOptionalSignedMoney("-1,234"), -1_234, "optional signed money should preserve negative amounts");
assert.equal(isValidMoneyValue(""), true, "blank money values should be valid for optional mapped cells");
assert.equal(isValidMoneyValue("숫자아님"), false, "non-empty invalid money values should be rejected");
assert.equal(isValidMoneyValue("1,234원"), true, "localized money values should be valid");
assert.equal(parseDate("2026.6.7"), "2026-06-07", "dotted dates should normalize");
assert.equal(parseDate("20260607"), "2026-06-07", "compact dates should normalize");
assert.equal(parseDate("2026.6.7 13:20"), "2026-06-07", "dates with common time suffixes should normalize");
assert.equal(parseDate("2026-06-07T13:20:00+09:00"), "2026-06-07", "ISO datetime suffixes should normalize");
assert.equal(parseDate("2026-02-31"), "2026-02-31", "invalid calendar dates should not become today's date");
assert.equal(parseDate("날짜아님"), "날짜아님", "invalid date text should be preserved for preview and validation");
assert.equal(parseDate("2026-06-07Tgarbage"), "2026-06-07Tgarbage", "invalid datetime suffixes should be preserved for validation");
assert.equal(parseStrictDate("2026.6.7 13:20"), "2026-06-07", "strict dates should allow common time suffixes");
assert.equal(parseStrictDate("2026-06-07T13:20:00+09:00"), "2026-06-07", "strict dates should allow ISO datetime suffixes");
assert.equal(parseStrictDate("2026-06-07Tgarbage"), null, "strict dates should reject arbitrary datetime suffixes");
assert.equal(parseStrictDate("2026-06-07 25:00"), null, "strict dates should reject invalid time suffixes");
assert.equal(sanitizeCsvCellValue("=IMPORTXML(\"https://example.com\")"), "'=IMPORTXML(\"https://example.com\")", "CSV exports should neutralize formula-like text");
assert.equal(sanitizeCsvCellValue("  +1+1"), "'  +1+1", "CSV exports should neutralize formula-like text after leading spaces");
assert.equal(sanitizeCsvCellValue(-1234), "-1234", "CSV exports should preserve numeric negative amounts");
assert.equal(sanitizeCsvCellValue("정상 거래처"), "정상 거래처", "CSV exports should preserve ordinary text");
assert.equal(normalizeZipPath("../evil.csv"), "evil.csv", "ZIP exports should remove parent traversal segments");
assert.equal(normalizeZipPath("evidences/../../invoice.pdf"), "evidences/invoice.pdf", "ZIP exports should keep safe folders without traversal");
assert.equal(normalizeZipPath("/absolute/path.txt"), "absolute/path.txt", "ZIP exports should be relative");
assert.equal(normalizeZipPath(""), "file", "ZIP exports should use a fallback for empty paths");

const negativeBalanceTransaction = normalizeCsvRow(
  {
    거래일: "2026-06-17",
    적요: "마이너스 통장 잔액",
    거래처: "은행",
    입금: "0",
    출금: "1000",
    잔액: "-1,234.56"
  },
  {
    transactionDate: "거래일",
    description: "적요",
    counterparty: "거래처",
    depositAmount: "입금",
    withdrawalAmount: "출금",
    balance: "잔액"
  },
  "BANK",
  0
);
assert.equal(negativeBalanceTransaction.withdrawalAmount, 1_000, "negative-style bank withdrawal should remain an absolute transaction amount");
assert.equal(negativeBalanceTransaction.balance, -1_234.56, "bank balance should preserve negative signed amounts");

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
  if (caseItem.sourceType === "CASH_RECEIPT") {
    assert.ok(mapping.approvalNumber, "CASH_RECEIPT should infer approvalNumber");
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
  if (caseItem.sourceType === "CASH_RECEIPT") {
    assert.equal(transactions[0]?.approvalNumber, "CR-20260607-001", "cash receipt should preserve approval number");
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

const businessIncomeContractor = applyVendorDefaults(contractorBase, [
  {
    id: "vendor-kim-design",
    name: "김디자인",
    defaultAccount: contractorAccount,
    withholdingType: "BUSINESS_INCOME"
  }
]);
const businessIncomeDraft = generateJournalDraft(businessIncomeContractor);
assertBalancedDraft(businessIncomeDraft, "contractor business-income withholding draft");
assert.equal(businessIncomeDraft.lines.find((line) => line.accountCode === "502")?.debitAmount, 341_262, "business-income withholding should gross up expense");
assert.equal(businessIncomeDraft.lines.find((line) => line.accountCode === "253")?.creditAmount, 11_262, "business-income withholding should create withholding payable");
assert.ok(businessIncomeDraft.warnings.some((warning) => warning.includes("3.3%")), "business-income withholding should keep review warning");
console.log("Verified contractor withholding journal draft.");

const evidenceMismatchTransaction: EvidenceAmountReviewTransaction = {
  ...contractorBase,
  id: "contractor-evidence-amount-review",
  evidenceStatus: "MATCHED",
  evidences: [
    {
      id: "contractor-evidence-short",
      supplyAmount: 272_727,
      vatAmount: 27_273,
      totalAmount: 300_000
    }
  ]
};
const evidenceAmountReviews = buildEvidenceAmountReviewItems([evidenceMismatchTransaction]);
assert.equal(evidenceAmountReviews.length, 1, "evidence amount mismatch should create a review item");
assert.equal(evidenceAmountReviews[0]?.severity, "DANGER", "large evidence amount mismatch should be dangerous");
assert.match(evidenceAmountReviews[0]?.reason ?? "", /연결 증빙 합계/, "evidence amount review should explain the mismatch");
assert.match(evidenceAmountReviews[0]?.recommendation ?? "", /30,000원/, "evidence amount review should include the amount difference");

const evidenceMatchedReviews = buildEvidenceAmountReviewItems([
  {
    ...evidenceMismatchTransaction,
    evidences: [
      {
        id: "contractor-evidence-matched",
        supplyAmount: 300_000,
        vatAmount: 30_000,
        totalAmount: 330_000
      }
    ]
  }
]);
assert.equal(evidenceMatchedReviews.length, 0, "matching evidence amount should not create a review item");
assert.equal(resolveTransactionEvidenceStatus(contractorBase, []), "MISSING", "withdrawal without evidence should be missing");
assert.equal(
  resolveTransactionEvidenceStatus({ depositAmount: 330_000, withdrawalAmount: 0 }, []),
  "UNCHECKED",
  "deposit without evidence should stay unchecked"
);
assert.equal(
  resolveTransactionEvidenceStatus(contractorBase, [{ supplyAmount: 300_000, vatAmount: 30_000, totalAmount: 330_000 }]),
  "MATCHED",
  "matching evidence amount should mark the transaction matched"
);
assert.equal(
  resolveTransactionEvidenceStatus(contractorBase, [{ supplyAmount: 272_727, vatAmount: 27_273, totalAmount: 300_000 }]),
  "ATTACHED",
  "mismatched evidence amount should only mark the transaction attached"
);
console.log("Verified evidence amount review generation.");

console.log("Sample CSV verification passed.");

function assertBalancedDraft(draft: ReturnType<typeof generateJournalDraft>, label: string) {
  const debit = draft.lines.reduce((sum, line) => sum + moneyToMinorUnits(line.debitAmount), 0);
  const credit = draft.lines.reduce((sum, line) => sum + moneyToMinorUnits(line.creditAmount), 0);
  assert.equal(debit, credit, `${label} should be balanced to 1/100 unit precision`);
}
