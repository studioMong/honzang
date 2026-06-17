export type TransactionAmountValidationInput = {
  depositAmount?: number | null;
  withdrawalAmount?: number | null;
  supplyAmount?: number | null;
  vatAmount?: number | null;
  direction?: string | null;
};

export type TransactionTaxAmountValidationInput = {
  grossAmount?: number | null;
  supplyAmount?: number | null;
  vatAmount?: number | null;
};

export function validateTransactionAmounts(payload: TransactionAmountValidationInput) {
  const depositAmount = payload.depositAmount ?? 0;
  const withdrawalAmount = payload.withdrawalAmount ?? 0;

  if (depositAmount <= 0 && withdrawalAmount <= 0) {
    return "입금 또는 출금 금액을 입력해야 합니다.";
  }
  if (depositAmount > 0 && withdrawalAmount > 0) {
    return "입금과 출금 중 하나만 입력해야 합니다.";
  }
  if (payload.direction === "DEPOSIT" && depositAmount <= 0) {
    return "입금 거래는 입금 금액이 0보다 커야 합니다.";
  }
  if (payload.direction === "WITHDRAWAL" && withdrawalAmount <= 0) {
    return "출금 거래는 출금 금액이 0보다 커야 합니다.";
  }

  const taxIssue = validateTransactionTaxAmounts({
    grossAmount: depositAmount > 0 ? depositAmount : withdrawalAmount,
    supplyAmount: payload.supplyAmount,
    vatAmount: payload.vatAmount
  });
  if (taxIssue) return taxIssue;

  return null;
}

export function validateTransactionTaxAmounts(payload: TransactionTaxAmountValidationInput) {
  const grossAmount = payload.grossAmount ?? null;
  const supplyAmount = payload.supplyAmount ?? null;
  const vatAmount = payload.vatAmount ?? null;

  if (grossAmount === null || grossAmount <= 0) return null;
  if (supplyAmount === null && vatAmount === null) return null;

  const roundedGross = roundWon(grossAmount);
  const roundedSupply = supplyAmount === null ? null : roundWon(supplyAmount);
  const roundedVat = vatAmount === null ? null : roundWon(vatAmount);

  if (roundedSupply !== null && roundedSupply > roundedGross) {
    return "공급가액은 거래 총액보다 클 수 없습니다.";
  }
  if (roundedVat !== null && roundedVat > roundedGross) {
    return "부가세는 거래 총액보다 클 수 없습니다.";
  }
  if (roundedSupply !== null && roundedVat !== null && roundedSupply + roundedVat > roundedGross) {
    return "공급가액과 부가세의 합은 거래 총액보다 클 수 없습니다.";
  }

  return null;
}

function roundWon(value: number) {
  return Math.round(value);
}
