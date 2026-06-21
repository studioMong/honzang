import type { AppCompany, AppTransaction, BillingModel } from "@/types";

export type BillingEstimate = {
  unitPrice: number;
  unitLabel: string;
  revenueTransactionCount: number;
  revenueSupplyAmount: number;
  estimatedUnits: number;
};

export type BillingEstimateRow = {
  항목: string;
  값: string | number;
  상태: string;
  확인: string;
  톤: "green" | "amber" | "blue";
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
  return transaction.sourceType === "HOMETAX_SALES" || transaction.sourceType === "PG" || transaction.description.includes("구독") || transaction.description.includes("정산");
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

export function buildBillingEstimateRows(
  company: Pick<AppCompany, "billingModel" | "perUseUnitPrice" | "monthlySubscriptionPrice" | "annualSubscriptionPrice">,
  transactions: AppTransaction[]
): BillingEstimateRow[] {
  const estimate = buildBillingEstimate(company, transactions);
  const revenueTransactions = transactions.filter(isBillingRevenueTransaction);
  const pgRevenueCount = revenueTransactions.filter((transaction) => transaction.sourceType === "PG").length;
  const unitReady = estimate.unitPrice > 0;
  return [
    {
      항목: "과금 모델",
      값: billingModelLabel(company.billingModel),
      상태: "선택됨",
      확인: "설정의 과금 모델 기준",
      톤: "green"
    },
    {
      항목: "기준 단가",
      값: unitReady ? formatKrw(estimate.unitPrice) : "미설정",
      상태: unitReady ? "단가 설정" : "단가 필요",
      확인: `${estimate.unitLabel} 기준 금액 확인`,
      톤: unitReady ? "green" : "amber"
    },
    {
      항목: "매출 거래",
      값: estimate.revenueTransactionCount,
      상태: estimate.revenueTransactionCount > 0 ? "집계됨" : "매출 없음",
      확인: "매출 계정, 홈택스 매출, PG 정산, 구독/정산 키워드 기준",
      톤: estimate.revenueTransactionCount > 0 ? "green" : "blue"
    },
    {
      항목: "PG 매출 후보",
      값: pgRevenueCount,
      상태: pgRevenueCount > 0 ? "포함" : "없음",
      확인: "PG/마켓 정산 CSV는 설명 키워드가 없어도 매출 과금 후보에 포함",
      톤: pgRevenueCount > 0 ? "green" : "blue"
    },
    {
      항목: "매출 공급가액",
      값: formatKrw(estimate.revenueSupplyAmount),
      상태: estimate.revenueSupplyAmount > 0 ? "집계됨" : "매출 없음",
      확인: "공급가액이 없으면 VAT 포함 입금액에서 1.1 기준으로 추정",
      톤: estimate.revenueSupplyAmount > 0 ? "green" : "blue"
    },
    {
      항목: "추정 단위",
      값: unitReady ? `${formatBillingUnits(estimate.estimatedUnits)} ${estimate.unitLabel}` : "단가 입력",
      상태: unitReady ? "계산됨" : "대기",
      확인: "매출 공급가액을 기준 단가로 나눈 참고값",
      톤: unitReady ? "green" : "amber"
    }
  ];
}

function formatKrw(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(value))}원`;
}
