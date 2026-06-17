import { SOURCE_TYPE_LABELS } from "@/lib/defaults";
import { formatDate, formatNumber } from "@/lib/format";
import type { AppImportBatch, AppTransaction, SourceType } from "@/types";

export const DATA_SOURCE_TYPES: SourceType[] = ["BANK", "CARD", "HOMETAX_SALES", "HOMETAX_PURCHASES", "CASH_RECEIPT", "PG"];

export type DataSourceRow = {
  자료: string;
  상태: string;
  톤: "green" | "amber" | "blue";
  거래: string;
  업로드: string;
  원본: string;
  기간: string;
  "다음 확인": string;
};

export function buildDataSourceRows(transactions: AppTransaction[], importBatches: AppImportBatch[] = []): DataSourceRow[] {
  return DATA_SOURCE_TYPES.map((sourceType) => {
    const sourceTransactions = transactions.filter((transaction) => transaction.sourceType === sourceType);
    const sourceBatches = filterSourceBatches(sourceType, sourceTransactions, importBatches);
    const originalFileCount = sourceBatches.filter((batch) => batch.hasOriginalFile).length;
    const dates = sourceTransactions.map((transaction) => transaction.transactionDate).filter(Boolean).sort();
    const hasTransactions = sourceTransactions.length > 0;
    const optionalSource = sourceType === "PG";

    return {
      자료: SOURCE_TYPE_LABELS[sourceType],
      상태: hasTransactions ? "반영됨" : optionalSource ? "선택" : "확인 필요",
      톤: hasTransactions ? "green" : optionalSource ? "blue" : "amber",
      거래: `${formatNumber(sourceTransactions.length)}건`,
      업로드: sourceBatches.length > 0 ? `${formatNumber(sourceBatches.length)}개 업로드` : "업로드 이력 없음",
      원본: sourceBatches.length > 0 ? `원본 CSV ${formatNumber(originalFileCount)}/${formatNumber(sourceBatches.length)}개` : "원본 CSV 없음",
      기간: hasTransactions ? `${formatDate(dates[0])} - ${formatDate(dates.at(-1) ?? dates[0])}` : "-",
      "다음 확인": hasTransactions ? dataSourceReadyMessage(sourceType) : dataSourceMissingMessage(sourceType)
    };
  });
}

function filterSourceBatches(sourceType: SourceType, transactions: AppTransaction[], importBatches: AppImportBatch[]) {
  const sourceBatches = importBatches.filter((batch) => batch.sourceType === sourceType);
  const transactionBatchIds = new Set(transactions.map((transaction) => transaction.importBatchId).filter((id): id is string => Boolean(id)));
  if (transactionBatchIds.size === 0) return sourceBatches;
  return sourceBatches.filter((batch) => transactionBatchIds.has(batch.id));
}

function dataSourceReadyMessage(sourceType: SourceType) {
  switch (sourceType) {
    case "BANK":
      return "입출금 누락 월이 없는지 잔액 흐름 확인";
    case "CARD":
      return "카드전표와 증빙 매칭 확인";
    case "HOMETAX_SALES":
      return "매출 입금과 세금계산서 매칭 확인";
    case "HOMETAX_PURCHASES":
      return "매입세액 공제 가능 여부 확인";
    case "CASH_RECEIPT":
      return "현금영수증/카드 매입 중복 반영 확인";
    case "PG":
      return "정산금액과 실제 입금액 차이 확인";
    case "MANUAL":
      return "수기 입력 거래의 계정과 증빙 확인";
  }
}

function dataSourceMissingMessage(sourceType: SourceType) {
  switch (sourceType) {
    case "BANK":
      return "법인 통장 입출금 CSV를 업로드";
    case "CARD":
      return "법인카드 이용내역 CSV를 업로드";
    case "HOMETAX_SALES":
      return "홈택스 매출 세금계산서 CSV 반영";
    case "HOMETAX_PURCHASES":
      return "홈택스 매입 세금계산서 CSV 반영";
    case "CASH_RECEIPT":
      return "홈택스 현금영수증/카드 매입 자료 확인";
    case "PG":
      return "PG/마켓 정산자료가 있으면 업로드";
    case "MANUAL":
      return "필요한 수기 거래는 거래내역에서 직접 추가";
  }
}
