import type { AppCompany, AppEvidence, AppJournalEntry, AppTaxReport, AppTransaction, ReviewItem, SummaryReport } from "@/types";
import { DEFAULT_ACCOUNTS, DEFAULT_COMPANY_ID } from "@/lib/defaults";

const account = (code: string) => DEFAULT_ACCOUNTS.find((item) => item.code === code) ?? null;

export const sampleCompany: AppCompany = {
  id: DEFAULT_COMPANY_ID,
  name: "혼자장부 샘플 법인",
  businessRegistrationNumber: null,
  industry: "소프트웨어 개발 및 공급업",
  vatType: "GENERAL",
  fiscalYearEndMonth: 12,
  representativeSalaryEnabled: true,
  employeePayrollEnabled: false,
  contractorPaymentEnabled: true,
  billingModel: "INTERNAL_PER_USE"
};

export const sampleTransactions: AppTransaction[] = [
  {
    id: "tx-sample-1",
    sourceType: "BANK",
    transactionDate: "2026-06-03",
    description: "고객사 프로젝트 대금 입금",
    counterparty: "몽고객사",
    direction: "DEPOSIT",
    depositAmount: 1100000,
    withdrawalAmount: 0,
    supplyAmount: 1000000,
    vatAmount: 100000,
    suggestedAccount: account("401"),
    confirmedAccount: account("401"),
    evidenceStatus: "MATCHED"
  },
  {
    id: "tx-sample-2",
    sourceType: "CARD",
    transactionDate: "2026-06-05",
    description: "네이버 검색광고",
    counterparty: "네이버파이낸셜",
    direction: "WITHDRAWAL",
    depositAmount: 0,
    withdrawalAmount: 110000,
    supplyAmount: 100000,
    vatAmount: 10000,
    suggestedAccount: account("505"),
    confirmedAccount: account("505"),
    evidenceStatus: "ATTACHED"
  },
  {
    id: "tx-sample-3",
    sourceType: "CARD",
    transactionDate: "2026-06-09",
    description: "OpenAI API 결제",
    counterparty: "OpenAI",
    direction: "WITHDRAWAL",
    depositAmount: 0,
    withdrawalAmount: 42000,
    suggestedAccount: account("506"),
    confirmedAccount: account("506"),
    evidenceStatus: "MISSING",
    reviewReasons: ["해외 SaaS 결제는 증빙과 부가세 처리 검토가 필요합니다."]
  },
  {
    id: "tx-sample-4",
    sourceType: "BANK",
    transactionDate: "2026-06-10",
    description: "대표자 입금",
    counterparty: "대표",
    direction: "DEPOSIT",
    depositAmount: 3000000,
    withdrawalAmount: 0,
    suggestedAccount: account("281"),
    confirmedAccount: account("281"),
    evidenceStatus: "NOT_REQUIRED",
    reviewReasons: ["대표자 입금은 대표자차입금 여부를 확인해야 합니다."]
  },
  {
    id: "tx-sample-5",
    sourceType: "BANK",
    transactionDate: "2026-06-12",
    description: "프리랜서 디자인 외주비",
    counterparty: "김디자인",
    direction: "WITHDRAWAL",
    depositAmount: 0,
    withdrawalAmount: 330000,
    supplyAmount: 300000,
    vatAmount: 30000,
    suggestedAccount: account("502"),
    confirmedAccount: null,
    evidenceStatus: "UNCHECKED",
    reviewReasons: ["외주비는 원천세 또는 세금계산서 수취 여부 확인이 필요합니다."]
  }
];

export const sampleReviews: ReviewItem[] = [
  {
    id: "review-sample-1",
    severity: "WARNING",
    reason: "증빙 없는 해외 SaaS 결제",
    recommendation: "카드전표, 인보이스, 업무 관련성 메모를 함께 보관하세요.",
    status: "OPEN",
    transaction: sampleTransactions[2]
  },
  {
    id: "review-sample-2",
    severity: "INFO",
    reason: "대표자 입금 거래",
    recommendation: "대표자차입금으로 처리할지 확인하세요.",
    status: "OPEN",
    transaction: sampleTransactions[3]
  },
  {
    id: "review-sample-3",
    severity: "DANGER",
    reason: "외주비 원천세 검토 필요",
    recommendation: "사업소득 원천세 대상인지, 세금계산서 수취 거래인지 구분하세요.",
    status: "OPEN",
    transaction: sampleTransactions[4]
  }
];

export const sampleEvidences: AppEvidence[] = [
  {
    id: "ev-sample-1",
    evidenceType: "전자세금계산서",
    issueDate: "2026-06-03",
    counterparty: "몽고객사",
    supplyAmount: 1000000,
    vatAmount: 100000,
    totalAmount: 1100000,
    fileName: "sales-tax-invoice-sample.pdf",
    transactionId: "tx-sample-1",
    transaction: sampleTransactions[0]
  },
  {
    id: "ev-sample-2",
    evidenceType: "카드전표",
    issueDate: "2026-06-05",
    counterparty: "네이버파이낸셜",
    supplyAmount: 100000,
    vatAmount: 10000,
    totalAmount: 110000,
    fileName: "naver-ads-card-slip.pdf",
    transactionId: "tx-sample-2",
    transaction: sampleTransactions[1]
  }
];

export const sampleJournalEntries: AppJournalEntry[] = [];

export const sampleTaxReports: AppTaxReport[] = [];

export const sampleSummary: SummaryReport = {
  periodLabel: "2026년 6월",
  revenue: 1000000,
  expense: 482000,
  profit: 518000,
  vatOutput: 100000,
  vatInput: 40000,
  vatPayable: 60000,
  missingEvidenceAmount: 42000,
  reviewCount: 3,
  riskCount: 1
};
