import { moneyToMinorUnits, validateDecimal14_2Amount, validateDecimal14_2SignedAmount } from "@/lib/server/money-validation";

export type TransactionAmountValidationInput = {
  depositAmount?: number | null;
  withdrawalAmount?: number | null;
  supplyAmount?: number | null;
  vatAmount?: number | null;
  balance?: number | null;
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
  const moneyIssue = [
    validateDecimal14_2Amount(depositAmount, "입금 금액"),
    validateDecimal14_2Amount(withdrawalAmount, "출금 금액"),
    payload.supplyAmount == null ? null : validateDecimal14_2Amount(payload.supplyAmount, "공급가액"),
    payload.vatAmount == null ? null : validateDecimal14_2Amount(payload.vatAmount, "부가세"),
    payload.balance == null ? null : validateDecimal14_2SignedAmount(payload.balance, "잔액")
  ].find((issue): issue is string => Boolean(issue));
  if (moneyIssue) return moneyIssue;

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

  const moneyIssue = [
    grossAmount === null ? null : validateDecimal14_2Amount(grossAmount, "거래 총액"),
    supplyAmount === null ? null : validateDecimal14_2Amount(supplyAmount, "공급가액"),
    vatAmount === null ? null : validateDecimal14_2Amount(vatAmount, "부가세")
  ].find((issue): issue is string => Boolean(issue));
  if (moneyIssue) return moneyIssue;

  if (grossAmount === null || grossAmount <= 0) return null;
  if (supplyAmount === null && vatAmount === null) return null;

  const grossMinorUnits = moneyToMinorUnits(grossAmount);
  const supplyMinorUnits = supplyAmount === null ? null : moneyToMinorUnits(supplyAmount);
  const vatMinorUnits = vatAmount === null ? null : moneyToMinorUnits(vatAmount);

  if (supplyMinorUnits !== null && supplyMinorUnits > grossMinorUnits) {
    return "공급가액은 거래 총액보다 클 수 없습니다.";
  }
  if (vatMinorUnits !== null && vatMinorUnits > grossMinorUnits) {
    return "부가세는 거래 총액보다 클 수 없습니다.";
  }
  if (supplyMinorUnits !== null && vatMinorUnits !== null && supplyMinorUnits + vatMinorUnits > grossMinorUnits) {
    return "공급가액과 부가세의 합은 거래 총액보다 클 수 없습니다.";
  }

  return null;
}
