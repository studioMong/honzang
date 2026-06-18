import type { AppCompany, AppTransaction, BillingModel } from "@/types";

export type BillingEstimate = {
  unitPrice: number;
  unitLabel: string;
  revenueTransactionCount: number;
  revenueSupplyAmount: number;
  estimatedUnits: number;
};

export function billingModelLabel(value: BillingModel) {
  const labels: Record<BillingModel, string> = {
    INTERNAL_PER_USE: "내부 회당 정산",
    SAAS_MONTHLY: "SaaS 월 구독",
    SAAS_ANNUAL: "SaaS 연 구독"
  };
  return labels[value];
}

export function billingActivePrice(company: Pick<AppCompany, "billingModel" | "perUseUnitPrice" | "monthlySubscriptionPrice" | "annualSubscriptionPrice">) {
  if (company.billingModel === "SAAS_MONTHLY") return company.monthlySubscriptionPrice;
  if (company.billingModel === "SAAS_ANNUAL") return company.annualSubscriptionPrice;
  return company.perUseUnitPrice;
}

export function buildBillingEstimate(
  company: Pick<AppCompany, "billingModel" | "perUseUnitPrice" | "monthlySubscriptionPrice" | "annualSubscriptionPrice">,
  transactions: AppTransaction[]
): BillingEstimate {
  const unitPrice = billingActivePrice(company);
  const revenueTransactions = transactions.filter(isBillingRevenueTransaction);
  const revenueSupplyAmount = revenueTransactions.reduce((sum, transaction) => sum + billingSupplyAmount(transaction), 0);
  return {
    unitPrice,
    unitLabel: billingUnitLabel(company.billingModel),
    revenueTransactionCount: revenueTransactions.length,
    revenueSupplyAmount,
    estimatedUnits: unitPrice > 0 ? revenueSupplyAmount / unitPrice : 0
  };
}

export function isBillingRevenueTransaction(transaction: AppTransaction) {
  const account = transaction.confirmedAccount ?? transaction.suggestedAccount ?? null;
  if (transaction.depositAmount <= 0) return false;
  if (account) return account.type === "REVENUE";
  return transaction.sourceType === "HOMETAX_SALES" || transaction.description.includes("구독") || transaction.description.includes("정산");
}

export function billingSupplyAmount(transaction: AppTransaction) {
  return transaction.supplyAmount ?? Math.round(transaction.depositAmount / 1.1);
}

export function billingUnitLabel(model: BillingModel) {
  if (model === "SAAS_MONTHLY") return "월 구독분";
  if (model === "SAAS_ANNUAL") return "연 구독분";
  return "회";
}

export function formatBillingUnits(value: number) {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: value >= 10 ? 1 : 2 }).format(value);
}
