import type { AppEvidence, AppTransaction, EvidenceStatus, ReviewItem } from "@/types";

const EVIDENCE_AMOUNT_TOLERANCE_WON = 1;

export type EvidenceAmountReviewTransaction = AppTransaction & {
  evidences?: EvidenceAmountInput[];
};

export type EvidenceAmountInput = Pick<AppEvidence, "supplyAmount" | "vatAmount" | "totalAmount"> & {
  id?: string | null;
};

export function buildEvidenceAmountReviewItems(transactions: EvidenceAmountReviewTransaction[]): ReviewItem[] {
  return transactions.flatMap((transaction) => {
    const grossAmount = transactionGrossAmount(transaction);
    const evidenceTotalAmount = comparableEvidenceTotalAmount(transaction.evidences ?? []);

    if (grossAmount <= 0 || evidenceTotalAmount === null) return [];

    const differenceAmount = Math.abs(evidenceTotalAmount - grossAmount);
    if (differenceAmount <= EVIDENCE_AMOUNT_TOLERANCE_WON) return [];

    return [
      {
        id: `${transaction.id}-evidence-amount`,
        severity: reviewSeverityForDifference(grossAmount, differenceAmount),
        reason: "연결 증빙 합계가 거래금액과 일치하지 않습니다.",
        recommendation: `거래금액 ${formatWon(grossAmount)}과 연결 증빙 합계 ${formatWon(evidenceTotalAmount)}의 차이 ${formatWon(differenceAmount)}를 확인하세요. 누락/중복 증빙 또는 거래 분할 여부를 정리하세요.`,
        status: "OPEN",
        transaction
      }
    ];
  });
}

export function resolveTransactionEvidenceStatus(
  transaction: Pick<AppTransaction, "depositAmount" | "withdrawalAmount">,
  evidences: EvidenceAmountInput[]
): EvidenceStatus {
  if (evidences.length === 0) return transaction.withdrawalAmount > 0 ? "MISSING" : "UNCHECKED";

  const grossAmount = transactionGrossAmount(transaction);
  const evidenceTotalAmount = comparableEvidenceTotalAmount(evidences);

  if (grossAmount > 0 && evidenceTotalAmount !== null && Math.abs(evidenceTotalAmount - grossAmount) <= EVIDENCE_AMOUNT_TOLERANCE_WON) {
    return "MATCHED";
  }

  return "ATTACHED";
}

function transactionGrossAmount(transaction: Pick<AppTransaction, "depositAmount" | "withdrawalAmount">) {
  return roundWon(transaction.depositAmount > 0 ? transaction.depositAmount : transaction.withdrawalAmount);
}

function comparableEvidenceTotalAmount(evidences: EvidenceAmountInput[]) {
  const evidenceAmounts = evidences.map(evidenceComparableAmount).filter((amount): amount is number => amount !== null);
  if (evidenceAmounts.length === 0) return null;
  return roundWon(evidenceAmounts.reduce((sum, amount) => sum + amount, 0));
}

function evidenceComparableAmount(evidence: Pick<AppEvidence, "supplyAmount" | "vatAmount" | "totalAmount">) {
  if (evidence.totalAmount !== null && evidence.totalAmount !== undefined) return roundWon(evidence.totalAmount);
  if (evidence.supplyAmount === null && evidence.vatAmount === null) return null;
  if (evidence.supplyAmount === undefined && evidence.vatAmount === undefined) return null;
  return roundWon((evidence.supplyAmount ?? 0) + (evidence.vatAmount ?? 0));
}

function reviewSeverityForDifference(grossAmount: number, differenceAmount: number): ReviewItem["severity"] {
  return differenceAmount >= Math.max(1000, grossAmount * 0.01) ? "DANGER" : "WARNING";
}

function roundWon(value: number) {
  return Math.round(value);
}

function formatWon(value: number) {
  return `${roundWon(value).toLocaleString("ko-KR")}원`;
}
