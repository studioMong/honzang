import { hasAtMostTwoDecimalPlaces, MAX_DECIMAL_14_2_AMOUNT, minorUnitsToMoney, moneyToMinorUnits } from "@/lib/money";

export { MAX_DECIMAL_14_2_AMOUNT, minorUnitsToMoney, moneyToMinorUnits };

export function validateDecimal14_2Amount(value: number, label: string) {
  const signedIssue = validateDecimal14_2SignedAmount(value, label);
  if (signedIssue) return signedIssue;
  if (value < 0) {
    return `${label}은 0 이상이어야 합니다.`;
  }
  return null;
}

export function validateDecimal14_2SignedAmount(value: number, label: string) {
  if (!Number.isFinite(value)) {
    return `${label}은 유효한 숫자여야 합니다.`;
  }
  if (Math.abs(value) > MAX_DECIMAL_14_2_AMOUNT) {
    return `${label}의 절댓값은 ${MAX_DECIMAL_14_2_AMOUNT.toLocaleString("ko-KR")} 이하만 입력할 수 있습니다.`;
  }
  if (!hasAtMostTwoDecimalPlaces(value)) {
    return `${label}은 소수 둘째 자리까지만 입력할 수 있습니다.`;
  }
  return null;
}
