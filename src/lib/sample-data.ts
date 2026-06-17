import type { AppClosingPeriod, AppCompany, AppEvidence, AppJournalEntry, AppTaxReport, AppTransaction, ReviewItem, SummaryReport } from "@/types";
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
  billingModel: "INTERNAL_PER_USE",
  perUseUnitPrice: 110000,
  monthlySubscriptionPrice: 33000,
  annualSubscriptionPrice: 330000
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
    balance: 5100000,
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
    balance: 8100000,
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
    balance: 7770000,
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

export const sampleClosingPeriods: AppClosingPeriod[] = [
  {
    id: "closing-sample-2026-05",
    period: "2026-05",
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    summaryPayload: {
      periodRange: {
        start: "2026-05-01",
        end: "2026-05-31"
      },
      report: {
        period: "2026-05",
        periodLabel: "2026년 5월",
        summary: {
          revenue: 2200000,
          expense: 730000,
          profit: 1470000,
          vatOutput: 200000,
          vatInput: 66000,
          vatPayable: 134000,
          missingEvidenceAmount: 0,
          reviewCount: 0,
          riskCount: 0
        },
        filingReadinessRows: [
          { 순서: 1, 점검: "법인 기본정보", 상태: "완료", 톤: "green", 근거: "사업자등록번호와 업종 확인", "다음 작업": "신고 전 홈택스 정보와 대조" },
          { 순서: 2, 점검: "자료 수집", 상태: "완료", 톤: "green", 근거: "필수 자료 업로드 완료", "다음 작업": "원본 CSV 백업 확인" },
          { 순서: 3, 점검: "월 마감", 상태: "마감 잠금", 톤: "green", 근거: "2026년 5월 확정 보관", "다음 작업": "필요 시 마감 스냅샷 상세 확인" }
        ],
        filingInputSummaryRows: [
          {
            신고: "부가세",
            "입력 항목": "과세 매출 공급가액",
            값: "2,000,000원",
            근거: "과세 매출 거래 공급가액 합계",
            상태: "집계됨",
            톤: "green",
            "최종 확인": "홈택스 매출 세금계산서와 통장 입금 대조"
          },
          {
            신고: "법인세",
            "입력 항목": "승인 분개/원장",
            값: "4개 / 8행",
            근거: "승인된 자동분개와 계정별 원장 행 수",
            상태: "원장 있음",
            톤: "green",
            "최종 확인": "차변/대변과 계정별 원장 대조"
          }
        ],
        dataSourceRows: [
          { 자료: "통장", 상태: "반영됨", 톤: "green", 거래: "4건", 업로드: "1개 업로드", 원본: "원본 CSV 1/1개", 기간: "2026-05", "다음 확인": "월말 잔액 대조" },
          { 자료: "홈택스 매출", 상태: "반영됨", 톤: "green", 거래: "2건", 업로드: "1개 업로드", 원본: "원본 CSV 1/1개", 기간: "2026-05", "다음 확인": "전자세금계산서 합계 대조" }
        ],
        bankBalanceRows: [
          { 점검: "잔액 순증감", 상태: "대조 완료", 톤: "green", 금액: 0, "다음 확인": "월말 통장 원장과 표본 확인" }
        ],
        filingScheduleRows: [],
        submissionGuideRows: [],
        filingPackageRows: [],
        reviewItems: [],
        withholdingRows: [],
        journalIntegrityRows: [],
        corporateTaxRows: [],
        cashFlowRows: [],
        financialStatementRows: [],
        ledgerRows: [],
        transactionCount: 4,
        journalEntryCount: 4
      }
    },
    closedAt: "2026-06-01T09:00:00.000Z",
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z"
  }
];

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
