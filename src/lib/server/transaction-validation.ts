export type TransactionAmountValidationInput = {
  depositAmount?: number | null;
  withdrawalAmount?: number | null;
  direction?: string | null;
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

  return null;
}
