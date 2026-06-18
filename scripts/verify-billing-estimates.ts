import assert from "node:assert/strict";
import {
  billingActivePrice,
  billingModelLabel,
  billingSupplyAmount,
  billingUnitLabel,
  buildBillingEstimate,
  formatBillingUnits,
  isBillingRevenueTransaction
} from "../src/lib/billing";
import type { AppAccount, AppCompany, AppTransaction, BillingModel, SourceType } from "../src/types";

const revenueAccount: AppAccount = {
  id: "account-revenue",
  code: "401",
  name: "서비스매출",
  type: "REVENUE"
};

const expenseAccount: AppAccount = {
  id: "account-expense",
  code: "506",
  name: "소프트웨어비",
  type: "EXPENSE"
};

const baseCompany: AppCompany = {
  id: "billing-company",
  name: "과금 검증 법인",
  businessRegistrationNumber: "123-45-67890",
  industry: "소프트웨어",
  vatType: "GENERAL",
  fiscalYearEndMonth: 12,
  representativeSalaryEnabled: false,
  employeePayrollEnabled: false,
  contractorPaymentEnabled: false,
  billingModel: "INTERNAL_PER_USE",
  perUseUnitPrice: 110000,
  monthlySubscriptionPrice: 33000,
  annualSubscriptionPrice: 330000
};

const transactions: AppTransaction[] = [
  buildTransaction({
    id: "tx-confirmed-revenue",
    description: "프로젝트 매출 입금",
    depositAmount: 220000,
    supplyAmount: 200000,
    confirmedAccount: revenueAccount
  }),
  buildTransaction({
    id: "tx-hometax-sales",
    sourceType: "HOMETAX_SALES",
    description: "전자세금계산서 매출",
    depositAmount: 110000
  }),
  buildTransaction({
    id: "tx-subscription",
    description: "SaaS 구독 결제",
    depositAmount: 33000,
    supplyAmount: 30000
  }),
  buildTransaction({
    id: "tx-settlement",
    description: "앱스토어 정산",
    depositAmount: 550000,
    supplyAmount: 500000
  }),
  buildTransaction({
    id: "tx-expense-account-wins",
    description: "구독 환급",
    depositAmount: 110000,
    suggestedAccount: expenseAccount
  }),
  buildTransaction({
    id: "tx-withdrawal",
    description: "소프트웨어 비용",
    depositAmount: 0,
    withdrawalAmount: 110000,
    suggestedAccount: expenseAccount
  })
];

assert.equal(billingModelLabel("INTERNAL_PER_USE"), "내부 회당 정산", "internal billing model label should be stable");
assert.equal(billingModelLabel("SAAS_MONTHLY"), "SaaS 월 구독", "monthly billing model label should be stable");
assert.equal(billingModelLabel("SAAS_ANNUAL"), "SaaS 연 구독", "annual billing model label should be stable");

assert.equal(billingUnitLabel("INTERNAL_PER_USE"), "회", "internal billing unit should be per-use");
assert.equal(billingUnitLabel("SAAS_MONTHLY"), "월 구독분", "monthly billing unit should be subscriptions per month");
assert.equal(billingUnitLabel("SAAS_ANNUAL"), "연 구독분", "annual billing unit should be subscriptions per year");

assert.equal(billingActivePrice(baseCompany), 110000, "internal billing should use per-use price");
assert.equal(billingActivePrice({ ...baseCompany, billingModel: "SAAS_MONTHLY" }), 33000, "monthly SaaS billing should use monthly price");
assert.equal(billingActivePrice({ ...baseCompany, billingModel: "SAAS_ANNUAL" }), 330000, "annual SaaS billing should use annual price");

assert.equal(isBillingRevenueTransaction(transactions[0]), true, "confirmed revenue account should count as billing revenue");
assert.equal(isBillingRevenueTransaction(transactions[1]), true, "Hometax sales rows without account should count as billing revenue");
assert.equal(isBillingRevenueTransaction(transactions[2]), true, "subscription description should count as billing revenue");
assert.equal(isBillingRevenueTransaction(transactions[3]), true, "settlement description should count as billing revenue");
assert.equal(isBillingRevenueTransaction(transactions[4]), false, "an explicit non-revenue account should override revenue-like text");
assert.equal(isBillingRevenueTransaction(transactions[5]), false, "withdrawals should not count as billing revenue");

assert.equal(billingSupplyAmount(transactions[0]), 200000, "explicit supply amount should be used for billing");
assert.equal(billingSupplyAmount(transactions[1]), 100000, "missing supply amount should be estimated from VAT-inclusive deposit");

const internalEstimate = buildBillingEstimate(baseCompany, transactions);
assert.equal(internalEstimate.unitPrice, 110000, "internal estimate should expose active unit price");
assert.equal(internalEstimate.unitLabel, "회", "internal estimate should expose per-use unit label");
assert.equal(internalEstimate.revenueTransactionCount, 4, "billing estimate should count revenue-like transactions only");
assert.equal(internalEstimate.revenueSupplyAmount, 830000, "billing estimate should sum revenue supply amounts");
assert.equal(internalEstimate.estimatedUnits, 830000 / 110000, "internal estimate should divide supply amount by per-use price");

const monthlyEstimate = buildBillingEstimate({ ...baseCompany, billingModel: "SAAS_MONTHLY" }, transactions);
assert.equal(monthlyEstimate.unitPrice, 33000, "monthly estimate should expose monthly subscription price");
assert.equal(monthlyEstimate.unitLabel, "월 구독분", "monthly estimate should expose monthly unit label");
assert.equal(monthlyEstimate.estimatedUnits, 830000 / 33000, "monthly estimate should divide supply amount by monthly price");

const annualEstimate = buildBillingEstimate({ ...baseCompany, billingModel: "SAAS_ANNUAL" }, transactions);
assert.equal(annualEstimate.unitPrice, 330000, "annual estimate should expose annual subscription price");
assert.equal(annualEstimate.unitLabel, "연 구독분", "annual estimate should expose annual unit label");
assert.equal(annualEstimate.estimatedUnits, 830000 / 330000, "annual estimate should divide supply amount by annual price");

const zeroPriceEstimate = buildBillingEstimate({ ...baseCompany, perUseUnitPrice: 0 }, transactions);
assert.equal(zeroPriceEstimate.estimatedUnits, 0, "zero price should avoid division and require user input");

assert.equal(formatBillingUnits(12.345), "12.3", "large billing unit values should show one decimal at most");
assert.equal(formatBillingUnits(0.333), "0.33", "small billing unit values should show two decimals at most");
assert.equal(formatBillingUnits(1000), "1,000", "billing unit formatting should include Korean group separators");
assert.equal(formatBillingUnits(Number.POSITIVE_INFINITY), "0", "non-finite billing units should be safe to render");

console.log("Billing estimate verification passed.");

function buildTransaction({
  id,
  sourceType = "BANK",
  description,
  depositAmount,
  withdrawalAmount = 0,
  supplyAmount,
  confirmedAccount,
  suggestedAccount
}: {
  id: string;
  sourceType?: SourceType;
  description: string;
  depositAmount: number;
  withdrawalAmount?: number;
  supplyAmount?: number;
  confirmedAccount?: AppAccount;
  suggestedAccount?: AppAccount;
}): AppTransaction {
  return {
    id,
    sourceType,
    transactionDate: "2026-06-18",
    description,
    direction: depositAmount > 0 ? "DEPOSIT" : "WITHDRAWAL",
    depositAmount,
    withdrawalAmount,
    supplyAmount,
    evidenceStatus: "UNCHECKED",
    confirmedAccount,
    suggestedAccount
  };
}
