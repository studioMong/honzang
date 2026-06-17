import type { AppClosingPeriod } from "@/types";
import { toCsvFileContent, type TableRow } from "@/lib/table-export";
import type { XlsxSheet } from "@/lib/xlsx";
import type { ZipFile } from "@/lib/zip";

export type ClosingSnapshotSummary = {
  revenue: number;
  expense: number;
  profit: number;
  vatOutput: number;
  vatInput: number;
  vatPayable: number;
  missingEvidenceAmount: number;
  reviewCount: number;
  riskCount: number;
};

export type ClosingSnapshotReportPayload = {
  summary: ClosingSnapshotSummary;
  filingReadinessRows: TableRow[];
  filingScheduleRows: TableRow[];
  submissionGuideRows: TableRow[];
  filingInputSummaryRows: TableRow[];
  dataSourceRows: TableRow[];
  filingPackageRows: TableRow[];
  reviewItems: TableRow[];
  withholdingRows: TableRow[];
  journalIntegrityRows: TableRow[];
  corporateTaxRows: TableRow[];
  cashFlowRows: TableRow[];
  bankBalanceRows: TableRow[];
  financialStatementRows: TableRow[];
  ledgerRows: TableRow[];
  transactionCount: number;
  journalEntryCount: number;
};

export type ClosingSnapshotExportPayload = {
  app: "혼자장부";
  exportType: "closing-period-snapshot";
  generatedAt: string;
  closingPeriod: Pick<AppClosingPeriod, "id" | "period" | "periodStart" | "periodEnd" | "closedAt" | "createdAt" | "updatedAt">;
  summary: ClosingSnapshotSummary;
  counts: {
    transactionCount: number;
    journalEntryCount: number;
    filingReadinessRows: number;
    filingInputSummaryRows: number;
    dataSourceRows: number;
    reviewItems: number;
    ledgerRows: number;
  };
  summaryRows: TableRow[];
  filingReadinessRows: TableRow[];
  filingScheduleRows: TableRow[];
  submissionGuideRows: TableRow[];
  filingInputSummaryRows: TableRow[];
  dataSourceRows: TableRow[];
  filingPackageRows: TableRow[];
  reviewItems: TableRow[];
  withholdingRows: TableRow[];
  journalIntegrityRows: TableRow[];
  corporateTaxRows: TableRow[];
  cashFlowRows: TableRow[];
  bankBalanceRows: TableRow[];
  financialStatementRows: TableRow[];
  ledgerRows: TableRow[];
  storedSummaryPayload: unknown;
  notes: string[];
};

export const CLOSING_SNAPSHOT_PACKAGE_FILES = [
  "closing-snapshot.json",
  "csv/summary.csv",
  "csv/filing-readiness.csv",
  "csv/filing-schedule.csv",
  "csv/submission-guide.csv",
  "csv/filing-input-summary.csv",
  "csv/data-sources.csv",
  "csv/filing-package.csv",
  "csv/review-items.csv",
  "csv/withholding-candidates.csv",
  "csv/journal-integrity.csv",
  "csv/corporate-tax-prep.csv",
  "csv/cash-flow.csv",
  "csv/bank-balance-check.csv",
  "csv/financial-statements.csv",
  "csv/ledger.csv"
] as const;

export function buildClosingSnapshotExportPayload(
  closingPeriod: AppClosingPeriod,
  payload: ClosingSnapshotReportPayload,
  generatedAt: Date | string = new Date()
): ClosingSnapshotExportPayload {
  const summaryRows = buildClosingSnapshotSummaryRows(closingPeriod, payload);
  return {
    app: "혼자장부",
    exportType: "closing-period-snapshot",
    generatedAt: typeof generatedAt === "string" ? generatedAt : generatedAt.toISOString(),
    closingPeriod: {
      id: closingPeriod.id,
      period: closingPeriod.period,
      periodStart: closingPeriod.periodStart,
      periodEnd: closingPeriod.periodEnd,
      closedAt: closingPeriod.closedAt,
      createdAt: closingPeriod.createdAt,
      updatedAt: closingPeriod.updatedAt
    },
    summary: payload.summary,
    counts: {
      transactionCount: payload.transactionCount,
      journalEntryCount: payload.journalEntryCount,
      filingReadinessRows: payload.filingReadinessRows.length,
      filingInputSummaryRows: payload.filingInputSummaryRows.length,
      dataSourceRows: payload.dataSourceRows.length,
      reviewItems: payload.reviewItems.length,
      ledgerRows: payload.ledgerRows.length
    },
    summaryRows,
    filingReadinessRows: payload.filingReadinessRows,
    filingScheduleRows: payload.filingScheduleRows,
    submissionGuideRows: payload.submissionGuideRows,
    filingInputSummaryRows: payload.filingInputSummaryRows,
    dataSourceRows: payload.dataSourceRows,
    filingPackageRows: payload.filingPackageRows,
    reviewItems: payload.reviewItems,
    withholdingRows: payload.withholdingRows,
    journalIntegrityRows: payload.journalIntegrityRows,
    corporateTaxRows: payload.corporateTaxRows,
    cashFlowRows: payload.cashFlowRows,
    bankBalanceRows: payload.bankBalanceRows,
    financialStatementRows: payload.financialStatementRows,
    ledgerRows: payload.ledgerRows,
    storedSummaryPayload: closingPeriod.summaryPayload ?? null,
    notes: [
      "월 마감 시점에 Postgres ClosingPeriod.summaryPayload로 보관된 신고 준비 스냅샷입니다.",
      "JSON은 원본 스냅샷과 표 데이터를 함께 포함합니다.",
      "ZIP과 XLSX는 홈택스 입력 전 대조에 필요한 표를 CSV/시트로 분리합니다."
    ]
  };
}

export function buildClosingSnapshotZipFiles(payload: ClosingSnapshotExportPayload): ZipFile[] {
  return [
    {
      path: "manifest.json",
      content: JSON.stringify(
        {
          app: payload.app,
          exportType: payload.exportType,
          generatedAt: payload.generatedAt,
          closingPeriod: payload.closingPeriod,
          summary: payload.summary,
          counts: payload.counts,
          files: CLOSING_SNAPSHOT_PACKAGE_FILES,
          notes: payload.notes
        },
        null,
        2
      )
    },
    { path: "closing-snapshot.json", content: JSON.stringify(payload, null, 2) },
    { path: "csv/summary.csv", content: toCsvFileContent(payload.summaryRows) },
    { path: "csv/filing-readiness.csv", content: toCsvFileContent(payload.filingReadinessRows) },
    { path: "csv/filing-schedule.csv", content: toCsvFileContent(payload.filingScheduleRows) },
    { path: "csv/submission-guide.csv", content: toCsvFileContent(payload.submissionGuideRows) },
    { path: "csv/filing-input-summary.csv", content: toCsvFileContent(payload.filingInputSummaryRows) },
    { path: "csv/data-sources.csv", content: toCsvFileContent(payload.dataSourceRows) },
    { path: "csv/filing-package.csv", content: toCsvFileContent(payload.filingPackageRows) },
    { path: "csv/review-items.csv", content: toCsvFileContent(payload.reviewItems) },
    { path: "csv/withholding-candidates.csv", content: toCsvFileContent(payload.withholdingRows) },
    { path: "csv/journal-integrity.csv", content: toCsvFileContent(payload.journalIntegrityRows) },
    { path: "csv/corporate-tax-prep.csv", content: toCsvFileContent(payload.corporateTaxRows) },
    { path: "csv/cash-flow.csv", content: toCsvFileContent(payload.cashFlowRows) },
    { path: "csv/bank-balance-check.csv", content: toCsvFileContent(payload.bankBalanceRows) },
    { path: "csv/financial-statements.csv", content: toCsvFileContent(payload.financialStatementRows) },
    { path: "csv/ledger.csv", content: toCsvFileContent(payload.ledgerRows) }
  ];
}

export function buildClosingSnapshotWorkbookSheets(payload: ClosingSnapshotExportPayload): XlsxSheet[] {
  return [
    { name: "요약", rows: payload.summaryRows },
    { name: "최종점검", rows: payload.filingReadinessRows },
    { name: "신고일정", rows: payload.filingScheduleRows },
    { name: "제출가이드", rows: payload.submissionGuideRows },
    { name: "입력값요약", rows: payload.filingInputSummaryRows },
    { name: "자료수집", rows: payload.dataSourceRows },
    { name: "신고패키지", rows: payload.filingPackageRows },
    { name: "검토", rows: payload.reviewItems },
    { name: "원천세", rows: payload.withholdingRows },
    { name: "복식검증", rows: payload.journalIntegrityRows },
    { name: "법인세", rows: payload.corporateTaxRows },
    { name: "현금흐름", rows: payload.cashFlowRows },
    { name: "잔액대조", rows: payload.bankBalanceRows },
    { name: "재무제표", rows: payload.financialStatementRows },
    { name: "원장", rows: payload.ledgerRows }
  ];
}

function buildClosingSnapshotSummaryRows(closingPeriod: AppClosingPeriod, payload: ClosingSnapshotReportPayload): TableRow[] {
  const blockerCount = payload.filingReadinessRows.filter((row) => row.톤 === "red").length;
  const warningCount = payload.filingReadinessRows.filter((row) => row.톤 === "amber").length;
  const bankBalance = summarizeClosingSnapshotBankBalanceRows(payload.bankBalanceRows);
  return [
    { 항목: "앱", 값: "혼자장부" },
    { 항목: "내보내기 유형", 값: "월 마감 스냅샷" },
    { 항목: "마감 월", 값: formatClosingSnapshotPeriodLabel(closingPeriod.period) },
    { 항목: "기간 시작", 값: closingPeriod.periodStart },
    { 항목: "기간 종료", 값: closingPeriod.periodEnd },
    { 항목: "마감 일시", 값: closingPeriod.closedAt },
    { 항목: "거래", 값: payload.transactionCount },
    { 항목: "승인 분개", 값: payload.journalEntryCount },
    { 항목: "신고 차단 항목", 값: blockerCount },
    { 항목: "신고 확인 항목", 값: warningCount },
    { 항목: "신고서 입력값", 값: payload.filingInputSummaryRows.length },
    { 항목: "자료 수집 항목", 값: payload.dataSourceRows.length },
    { 항목: "매출", 값: payload.summary.revenue },
    { 항목: "비용", 값: payload.summary.expense },
    { 항목: "손익", 값: payload.summary.profit },
    { 항목: "매출 부가세", 값: payload.summary.vatOutput },
    { 항목: "매입 부가세", 값: payload.summary.vatInput },
    { 항목: "예상 납부/환급 부가세", 값: payload.summary.vatPayable },
    { 항목: "증빙 누락 비용", 값: payload.summary.missingEvidenceAmount },
    { 항목: "검토 필요 건수", 값: payload.reviewItems.length },
    { 항목: "위험 거래 건수", 값: payload.summary.riskCount },
    { 항목: "통장 잔액 대조", 값: bankBalance.status },
    { 항목: "통장 잔액 차이", 값: bankBalance.difference }
  ];
}

export function formatClosingSnapshotPeriodLabel(period: string) {
  if (period === "ALL") return "전체 기간";
  const [year, month] = period.split("-");
  return `${year}년 ${Number(month)}월`;
}

function summarizeClosingSnapshotBankBalanceRows(rows: TableRow[]) {
  const hasRed = rows.some((row) => row.톤 === "red");
  const hasAmber = rows.some((row) => row.톤 === "amber");
  const missingBank = rows.some((row) => row.점검 === "법인 통장 CSV");
  const missingBalance = rows.some((row) => row.점검 === "잔액 컬럼" && row.상태 === "잔액 없음");
  const differenceRow = rows.find((row) => row.점검 === "잔액 대조 차이");
  return {
    status: missingBank ? "자료 없음" : missingBalance ? "잔액 없음" : hasRed ? "차액 발생" : hasAmber ? "부분 대조" : "대조 완료",
    difference: differenceRow?.금액 ?? "-"
  };
}
